/** Maps internal tool names → display names */
export const TOOL_DISPLAY: Record<string, string> = {
  read_file:        'Read',
  write_file:       'Write',
  patch_file:       'Edit',
  read_folder:      'List',
  shell:            'Bash',
  grep:             'Grep',
  glob:             'Glob',
  web_fetch:        'WebFetch',
  subagent:         'Agent',
  git:              'Git',
  introspect:       'Introspect',
  update_knowledge: 'UpdateKnowledge',
  todo:             'TodoWrite',
  ask_user_questions: 'AskUser',
}

const TOOL_PREVIEW_MAX_CHARS = 60

function truncatePreview(value: string, max = TOOL_PREVIEW_MAX_CHARS): string {
  if (value.length <= max) return value
  if (max <= 1) return '…'.slice(0, max)
  return value.slice(0, max - 1) + '…'
}

function summarizeAskUserQuestions(questions: unknown[]): string {
  const firstQuestion = questions.find((item): item is Record<string, unknown> => (
    !!item && typeof item === 'object' && typeof (item as Record<string, unknown>).question === 'string'
  ))
  const question = typeof firstQuestion?.question === 'string' ? firstQuestion.question : ''
  if (!question) return `${questions.length} question${questions.length === 1 ? '' : 's'}`
  const suffix = questions.length > 1 ? ` · ${questions.length} questions` : ''
  const questionBudget = Math.max(0, TOOL_PREVIEW_MAX_CHARS - suffix.length)
  return truncatePreview(question, questionBudget) + suffix
}

/** Converts AskUserQuestions payloads into a short human-readable TUI summary. */
export function summarizeAskUserPayload(payload: string): string {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return truncatePreview(payload)
    const record = parsed as Record<string, unknown>
    if (Array.isArray(record.questions)) return summarizeAskUserQuestions(record.questions)
    if (record.cancelled === true) return 'cancelled'
    if (record.answers && typeof record.answers === 'object' && !Array.isArray(record.answers)) {
      const count = Object.keys(record.answers).length
      return `${count} answer${count === 1 ? '' : 's'}`
    }
  } catch {
    // Keep non-JSON errors readable below.
  }
  return truncatePreview(payload)
}

/** Keeps structured tool results compact without exposing raw JSON in the TUI. */
export function summarizeStructuredPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as unknown
    if (Array.isArray(parsed)) return `${parsed.length} item${parsed.length === 1 ? '' : 's'}`
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (typeof record.error === 'string') return truncatePreview(`Error: ${record.error}`)
      if (typeof record.path === 'string') return truncatePreview(record.path)
      const fieldCount = Object.keys(record).length
      return `${fieldCount} field${fieldCount === 1 ? '' : 's'}`
    }
  } catch {
    // Plain-text tool output remains readable below.
  }
  return truncatePreview(payload)
}

export function summarizeToolPayload(toolName: string, payload: string): string {
  return toolName === 'ask_user_questions' ? summarizeAskUserPayload(payload) : summarizeStructuredPayload(payload)
}

/** Builds the active tool preview without leaking AskUserQuestions JSON. */
export function previewToolCallArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'ask_user_questions') return summarizeAskUserPayload(JSON.stringify(args))
  const serialized = JSON.stringify(args)
  const fieldPreview = previewStreamingArgs(serialized)
  if (fieldPreview) return fieldPreview
  const stringValue = Object.values(args).find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (stringValue) return truncatePreview(stringValue)
  const argumentCount = Object.keys(args).length
  return argumentCount > 0 ? `${argumentCount} argument${argumentCount === 1 ? '' : 's'}` : ''
}

export function summarizeToolResult(toolName: string, result: string): string {
  return summarizeToolPayload(toolName, result)
}

/**
 * Pulls the key argument out of partially-streamed JSON tool args, so the tool
 * card can show `Write src/foo.ts` while the model is still emitting the call.
 * Intentionally a preview scanner, not a JSON parser — the closing brace may
 * never arrive. Ported from Kimi Code's STREAMING_ARGS_FIELD_RE.
 */
const STREAMING_ARGS_FIELD_RE =
  /"(path|file_path|command|pattern|query|url|action|task|description)"\s*:\s*"((?:\\.|[^"\\])*)"/g

/** Bounds the scan; a streamed `content` field can be megabytes long. */
const STREAMING_ARGS_PREVIEW_MAX_CHARS = 64 * 1024

export function previewStreamingArgs(argsText: string): string {
  const text = argsText.slice(0, STREAMING_ARGS_PREVIEW_MAX_CHARS)
  const match = STREAMING_ARGS_FIELD_RE.exec(text)
  STREAMING_ARGS_FIELD_RE.lastIndex = 0
  const value = match?.[2]
  if (!value) return ''
  const unescaped = value.replace(/\\n/g, ' ').replace(/\\(.)/g, '$1')
  return unescaped.length > 60 ? unescaped.slice(0, 60) + '…' : unescaped
}

/** Visual style per tool type */
export const TOOL_STYLE: Record<string, { icon: string; color: string }> = {
  Read:            { icon: '▸', color: '#5599ff' },
  Write:           { icon: '▸', color: '#44cc44' },
  Edit:            { icon: '▸', color: '#44cc44' },
  List:            { icon: '▸', color: '#5599ff' },
  Bash:            { icon: '$', color: '#cc66ff' },
  Grep:            { icon: '⌕', color: '#cccc44' },
  Glob:            { icon: '⌕', color: '#cccc44' },
  WebFetch:        { icon: '↗', color: '#44cccc' },
  Agent:           { icon: '◈', color: '#44cccc' },
  Git:             { icon: '⎇', color: '#ff8844' },
  Introspect:      { icon: '◎', color: '#888888' },
  UpdateKnowledge: { icon: '◎', color: '#888888' },
  TodoWrite:       { icon: '☐', color: '#cccc44' },
}
