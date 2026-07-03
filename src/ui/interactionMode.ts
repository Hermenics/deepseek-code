// Interaction modes and tool permission matrix

export type InteractionMode = 'plan' | 'build' | 'auto'

export const MODES: InteractionMode[] = ['plan', 'build', 'auto']

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

// Ferramentas read-only permitidas em todos os modos
const READ_ONLY_TOOLS = new Set([
  'read_file', 'read_folder', 'glob', 'grep', 'git',
  'web_fetch', 'introspect', 'todo', 'subagent', 'memory',
])

// Permissões por modo
const TOOL_PERMISSIONS: Record<InteractionMode, Set<string>> = {
  build: new Set([...READ_ONLY_TOOLS, 'shell', 'write_file', 'patch_file', 'update_knowledge']),
  auto: new Set([...READ_ONLY_TOOLS, 'shell', 'write_file', 'patch_file', 'update_knowledge']),
  plan: new Set([...READ_ONLY_TOOLS]),
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
  'auto': 'Auto',
}

export const MODE_COLORS: Record<InteractionMode, string> = {
  'build': 'green',
  'plan': 'yellow',
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
  if (toolName !== 'write_file' && toolName !== 'patch_file') return false
  const filePath = (args.path ?? args.file_path ?? '') as string
  return filePath.includes('.deepseek')
}
