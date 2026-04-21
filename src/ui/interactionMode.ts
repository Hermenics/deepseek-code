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

// Permissões por modo — apenas as combinações explicitamente permitidas
const TOOL_PERMISSIONS: Record<InteractionMode, Set<string>> = {
  chat: new Set(['read_file', 'web_fetch', 'shell']),
  plan: new Set(['read_file', 'web_fetch']),
  agent: new Set(['read_file', 'write_file', 'shell', 'web_fetch']),
  'auto-accept': new Set(['read_file', 'write_file', 'shell', 'web_fetch']),
}

export function canUseTool(mode: InteractionMode, tool: string): boolean {
  return TOOL_PERMISSIONS[mode].has(tool)
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
