// Interaction modes and tool permission matrix

export type InteractionMode = 'plan' | 'review' | 'build' | 'auto'

export const MODES: InteractionMode[] = ['plan', 'review', 'build', 'auto']

export const DEFAULT_MODE: InteractionMode = 'build'

// Ciclo: plan → build → auto → plan
export function nextMode(current: InteractionMode): InteractionMode {
  const index = MODES.indexOf(current)
  return MODES[(index + 1) % MODES.length]
}

export function isBuildMode(mode: InteractionMode): boolean {
  return mode === 'build'
}

export function isAutoMode(mode: InteractionMode): boolean {
  return mode === 'auto'
}

export function isReviewMode(mode: InteractionMode): boolean {
  return mode === 'review'
}

// Ferramentas read-only permitidas em todos os modos
const READ_ONLY_TOOLS = new Set([
  'read_file', 'read_folder', 'glob', 'grep', 'lsp',
  'web_fetch', 'introspect', 'todo', 'memory',
  'git', 'workflow', 'get_goal',
])

const BUILD_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  'shell', 'write_file', 'edit_file', 'patch_file', 'update_knowledge',
  'subagent', 'ask_agent', 'moa', 'update_goal',
])

// Permissões por modo. Auto names every native tool so /permissions remains
// accurate; canUseTool still permits dynamically discovered MCP tools there.
const TOOL_PERMISSIONS: Record<InteractionMode, Set<string>> = {
  build: BUILD_TOOLS,
  auto: new Set([...BUILD_TOOLS, 'write_plan', 'submit_plan', 'create_goal']),
  plan: new Set([...READ_ONLY_TOOLS, 'write_plan', 'submit_plan']),
  review: new Set(READ_ONLY_TOOLS),
}

export function canUseTool(mode: InteractionMode, tool: string): boolean {
  // Auto mode: zero restrictions, everything is allowed
  if (mode === 'auto') return true
  // MCP tools (contain '__') follow the same rules as shell — allowed in modes that permit shell
  if (tool.includes('__')) {
    return TOOL_PERMISSIONS[mode].has('shell')
  }
  return TOOL_PERMISSIONS[mode].has(tool)
}

export function getToolsForMode(mode: InteractionMode): string[] {
  return [...TOOL_PERMISSIONS[mode]]
}

export const MODE_LABELS: Record<InteractionMode, string> = {
  'build': 'Build',
  'plan': 'Plan',
  'review': 'Review',
  'auto': 'Auto',
}

export const MODE_COLORS: Record<InteractionMode, string> = {
  'build': 'green',
  'plan': 'yellow',
  'review': 'blue',
  'auto': 'red',
}

// Modelo pode ativar build e plan, mas NÃO auto (só usuário via Shift+Tab)
export function canModelActivateMode(mode: InteractionMode): boolean {
  return mode !== 'auto'
}

// ── Helpers para Build mode: detecção de shell destrutivo e write em .deepseek ──

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-\w*r|-\w*f)/,        // rm -rf, rm -r, rm -f with recursive
  /\brmdir\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\b/,
  /\bgit\s+push\s+(--force|-f)\b/,
  /\bgit\s+push\b.*\s+(--force|-f)/,
  /\bgit\s+checkout\s+--\s*\./,
  /\bgit\s+restore\s+\./,
  /\bchmod\s+-R\b/,
  /\bchown\s+-R\b/,
  /\bdd\s+/,
  /\bmkfs\b/,
  /\bfdisk\b/,
]

export function isDestructiveShell(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))
}

export function isConfigWrite(toolName: string, args: Record<string, unknown>): boolean {
  if (!['write_file', 'edit_file', 'patch_file'].includes(toolName)) return false
  const filePath = (args.path ?? args.file_path ?? '') as string
  return filePath.includes('.deepseek')
}
