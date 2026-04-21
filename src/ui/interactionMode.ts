// Stub: tipos e constantes apenas — lógica será implementada na fase GREEN

export type InteractionMode = 'chat' | 'plan' | 'agent' | 'auto-accept'

export const MODES: InteractionMode[] = ['chat', 'plan', 'agent', 'auto-accept']

export const DEFAULT_MODE: InteractionMode = 'chat'

// Ciclo: chat → plan → agent → auto-accept → chat
export function nextMode(current: InteractionMode): InteractionMode {
  const index = MODES.indexOf(current)
  return MODES[(index + 1) % MODES.length]
}

export function isAutoAccept(mode: InteractionMode): boolean {
  return mode === 'auto-accept'
}

// Ferramentas read-only permitidas em todos os modos
const READ_ONLY_TOOLS = new Set([
  'read_file', 'read_folder', 'glob', 'grep', 'git',
  'web_fetch', 'introspect', 'todo', 'subagent',
])

// Permissões por modo
const TOOL_PERMISSIONS: Record<InteractionMode, Set<string>> = {
  chat:          new Set([...READ_ONLY_TOOLS, 'shell']),
  plan:          new Set([...READ_ONLY_TOOLS]),
  agent:         new Set([...READ_ONLY_TOOLS, 'shell', 'write_file', 'patch_file', 'update_knowledge']),
  'auto-accept': new Set([...READ_ONLY_TOOLS, 'shell', 'write_file', 'patch_file', 'update_knowledge']),
}

export function canUseTool(mode: InteractionMode, tool: string): boolean {
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
  'chat': 'Chat',
  'plan': 'Plan',
  'agent': 'Agent',
  'auto-accept': 'Auto',
}

export const MODE_COLORS: Record<InteractionMode, string> = {
  'chat': 'cyan',
  'plan': 'yellow',
  'agent': 'green',
  'auto-accept': 'red',
}

// O modelo NUNCA pode ativar 'auto-accept' — só o usuário
export function canModelActivateMode(mode: InteractionMode): boolean {
  return mode !== 'auto-accept'
}
