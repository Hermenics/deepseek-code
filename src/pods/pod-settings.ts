import type { SettingsLevel, SettingsSnapshot } from '../settings/types.js'

export const POD_SETTING_FIELDS = [
  { path: 'model.default', category: 'Provider & model', label: 'Fallback model', description: 'Used only when the active provider profile has no preferred model.', kind: 'text' },
  { path: 'provider.timeoutMs', category: 'Provider & model', label: 'Request timeout', description: 'Maximum time to wait for a provider response, in milliseconds.', kind: 'number', min: 100, max: 600000 },
  { path: 'budget', category: 'Agent behavior', label: 'Spending level', description: 'Adjusts delegation, review and context costs together.', kind: 'select', options: ['broke', 'comfortable', 'loaded'] },
  { path: 'interaction.defaultMode', category: 'Agent behavior', label: 'Default mode', description: 'Choose how new DeepSeek Code sessions approach work.', kind: 'select', options: ['build', 'plan', 'review', 'auto'], userOnly: true },
  { path: 'goal.maxContinuations', category: 'Agent behavior', label: 'Goal turns', description: 'Maximum continuation turns for a persistent goal.', kind: 'number', min: 1, max: 100 },
  { path: 'promptRefiner.enabled', category: 'Agent behavior', label: 'Prompt refinement', description: 'Refine longer coding requests before execution.', kind: 'boolean' },
  { path: 'promptRefiner.model', category: 'Agent behavior', label: 'Refiner model', description: 'Optional model override. Reset to inherit the primary model.', kind: 'text' },
  { path: 'promptRefiner.minimumLength', category: 'Agent behavior', label: 'Refinement minimum length', description: 'Messages shorter than this are never refined.', kind: 'number', min: 1, max: 10000 },
  { path: 'compaction.enabled', category: 'Context', label: 'Automatic compaction', description: 'Summarize context near the configured threshold.', kind: 'boolean' },
  { path: 'compaction.threshold', category: 'Context', label: 'Compaction threshold', description: 'Context utilization ratio from 0.70 to 0.95.', kind: 'number', min: 0.7, max: 0.95, step: 0.01 },
  { path: 'agents.concurrency', category: 'Agents', label: 'Concurrent agents', description: 'Maximum parallel subagents, from 1 to 16.', kind: 'number', min: 1, max: 16 },
  { path: 'agents.subagentModel', category: 'Agents', label: 'Subagent model', description: 'Model for delegated work. Reset to inherit the primary model.', kind: 'text' },
  { path: 'agents.maxAggregateTokens', category: 'Agents', label: 'Turn token budget', description: 'Reported tokens across primary and delegated calls in one turn.', kind: 'number', min: 1, max: Number.MAX_SAFE_INTEGER, integer: true },
  { path: 'agents.maxAggregateCostUsd', category: 'Agents', label: 'Turn cost budget (USD)', description: 'Estimated spend across primary and delegated calls in one turn.', kind: 'number', min: Number.MIN_VALUE, max: Number.MAX_VALUE, step: 'any' },
  { path: 'agents.permissionPolicy', category: 'Agents', label: 'Subagent permissions', description: 'Inherit parent permissions or isolate allow rules.', kind: 'select', options: ['inherit', 'isolated'] },
  { path: 'memory.enabled', category: 'Memory & sessions', label: 'Memory', description: 'Enable durable agent and user memory.', kind: 'boolean' },
  { path: 'memory.scope', category: 'Memory & sessions', label: 'Memory scope', description: 'Store memory for the user or this project.', kind: 'select', options: ['user', 'project'] },
  { path: 'sessions.retention', category: 'Memory & sessions', label: 'Session retention', description: 'Maximum number of saved sessions.', kind: 'number', min: 1, max: 10000 },
  { path: 'sessions.autoResume', category: 'Memory & sessions', label: 'Auto-resume', description: 'Automatically resume the latest session in this project.', kind: 'select', options: ['off', 'project-last'], restart: true },
  { path: 'git.checkpoint', category: 'Git & worktrees', label: 'File checkpoints', description: 'Save file state before mutating tools edit it.', kind: 'boolean' },
  { path: 'git.worktree', category: 'Git & worktrees', label: 'Worktree policy', description: 'Disable, ask before, or automatically isolate work.', kind: 'select', options: ['off', 'ask', 'auto'] },
  { path: 'git.reviewDiff', category: 'Git & worktrees', label: 'Review changes', description: 'Review the diff after file changes.', kind: 'boolean' },
  { path: 'git.verifyAfterEdit', category: 'Git & worktrees', label: 'Verify after edits', description: 'Offer the project verification command after edits.', kind: 'boolean' },
  { path: 'interface.theme', category: 'Interface', label: 'Terminal theme', description: 'Theme used by DeepSeek Code TUI.', kind: 'select', options: ['dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi'] },
  { path: 'interface.language', category: 'Interface', label: 'Response language', description: 'Preferred language for responses.', kind: 'language' },
  { path: 'interface.density', category: 'Interface', label: 'Interface density', description: 'Choose compact or comfortable spacing.', kind: 'select', options: ['compact', 'comfortable'] },
  { path: 'interface.vim', category: 'Interface', label: 'Vim input', description: 'Persist Vim-style input mode.', kind: 'boolean' },
  { path: 'interface.alternateScreen', category: 'Interface', label: 'Fullscreen', description: 'Run the TUI in the terminal alternate buffer. Applies next session.', kind: 'boolean', restart: true },
  { path: 'interface.reducedMotion', category: 'Interface', label: 'Reduced motion', description: 'Disable non-essential terminal animations.', kind: 'boolean' },
  { path: 'interface.showThoughts', category: 'Interface', label: 'Show thoughts', description: 'Show or hide reasoning panels in the TUI.', kind: 'boolean' },
  { path: 'interface.showToolCalls', category: 'Interface', label: 'Show tool calls', description: 'Show tool call details in the TUI transcript.', kind: 'boolean' },
  { path: 'interface.showDiffs', category: 'Interface', label: 'Show diffs', description: 'Show file diffs in the TUI transcript.', kind: 'boolean' },
  { path: 'lsp.timeoutMs', category: 'Language servers', label: 'LSP timeout', description: 'Maximum language-server request time, in milliseconds.', kind: 'number', min: 100, max: 60000, userOnly: true },
] as const

function atPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value)
}

export function podSettingsView(snapshot: SettingsSnapshot, level: SettingsLevel) {
  return POD_SETTING_FIELDS.filter(field => level === 'user' || !('userOnly' in field && field.userOnly)).map(field => ({
    ...field,
    value: atPath(snapshot.levels[level].data, field.path),
    effective: atPath(snapshot.effective, field.path),
    origin: snapshot.origins[field.path] ?? 'default',
  }))
}

export function validatePodSettingPath(path: string, level: SettingsLevel): void {
  const field = POD_SETTING_FIELDS.find(item => item.path === path)
  if (!field) throw new Error('This setting is not available in Pods')
  if ('userOnly' in field && field.userOnly && level !== 'user') throw new Error('This setting can only be changed at User scope')
}

export function validatePodSetting(path: string, value: unknown, level: SettingsLevel): void {
  validatePodSettingPath(path, level)
  const field = POD_SETTING_FIELDS.find(item => item.path === path)!
  if (field.kind === 'boolean' && typeof value !== 'boolean') throw new Error(`${field.label} must be true or false`)
  if (field.kind === 'select' && (typeof value !== 'string' || !(field.options as readonly string[]).includes(value))) throw new Error(`Choose a valid ${field.label.toLowerCase()}`)
  if (field.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max)) throw new Error(`${field.label} must be between ${field.min} and ${field.max}`)
  if (field.kind === 'number' && 'integer' in field && field.integer && !Number.isSafeInteger(value)) throw new Error(`${field.label} must be a safe integer`)
  if (field.kind === 'text' && (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value))) throw new Error(`${field.label} must be a model ID`)
  if (field.kind === 'language' && (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\x00-\x1f\x7f]/.test(value))) throw new Error('Response language must be a non-empty single line')
}
