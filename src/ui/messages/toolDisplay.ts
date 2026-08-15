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
