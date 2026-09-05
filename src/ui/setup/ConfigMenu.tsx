import { useEffect, useMemo, useRef, useState } from 'react'
import { execa } from 'execa'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import { invalidateInkFrame, withInkPaused } from '../../ink/root.js'
import type { ThemeName } from '../../types/provider.js'
import type { DeepSeekSettings, SettingOrigin, SettingsLevel, SettingsSnapshot } from '../../settings/types.js'
import { DEFAULT_SETTINGS, SettingsRepository, getCredentialsPath, resolveSetting } from '../../settings/repository.js'
import { loadFullConfig, saveFullConfig } from '../../utils/credentials.js'
import { loadMemory } from '../../agent/memory.js'
import { listSessions } from '../../agent/session.js'
import { getThemeColors } from '../theme.js'
import { shouldFilterKey } from '../input/keyFilter.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import AgentLibrary from './AgentLibrary.js'
import HookLibrary from './HookLibrary.js'
import { editPromptMarkdown } from './promptEditor.js'
import { resolvePermission } from '../../permissions/index.js'

type Kind = 'boolean' | 'enum' | 'number' | 'text' | 'list' | 'json' | 'secret' | 'action'

interface SettingDefinition {
  path: string
  label: string
  description: string
  kind: Kind
  options?: string[]
  credentialKey?: string
  aliases?: string[]
  restart?: boolean
  action?: 'test-provider' | 'preview-refiner' | 'preview-permission' | 'agents' | 'permissions-help' | 'clear-approvals' | 'hooks' | 'clear-memory' | 'clear-sessions-project' | 'clear-sessions-global' | 'reload' | 'open-scope' | 'open-credentials' | 'export' | 'reset-scope' | 'diagnostics'
}

const MODEL_SETTING_PATHS = new Set(['model.default', 'promptRefiner.model', 'agents.subagentModel'])

interface Category {
  id: string
  label: string
  short: string
  description: string
  items: SettingDefinition[]
}

const CATEGORIES: Category[] = [
  {
    id: 'provider', label: 'Provider & Model', short: 'Provider', description: 'Backend, endpoints, credentials and model defaults.',
    items: [
      { path: 'provider.name', label: 'Provider', description: 'DeepSeek API, AWS Bedrock, Google Vertex AI or a local OpenAI-compatible server. Project-scope values are ignored.', kind: 'enum', options: ['deepseek', 'bedrock', 'vertex', 'local'], restart: true, aliases: ['backend'] },
      { path: 'model.default', label: 'Default model', description: 'Model used by the primary agent. Applies immediately when compatible with this provider.', kind: 'enum', aliases: ['llm'] },
      { path: 'provider.endpoint', label: 'Endpoint', description: 'Optional API base URL. Project-scope values are ignored so saved credentials cannot follow a repository endpoint.', kind: 'text', restart: true, aliases: ['base url'] },
      { path: 'provider.timeoutMs', label: 'Connection timeout', description: 'Maximum provider request time in milliseconds.', kind: 'number' },
      { path: 'provider.region', label: 'AWS region', description: 'AWS Bedrock region.', kind: 'text', restart: true },
      { path: 'provider.profile', label: 'AWS profile', description: 'Named AWS credentials profile.', kind: 'text', restart: true },
      { path: 'provider.projectId', label: 'GCP project', description: 'Google Cloud project for Vertex AI.', kind: 'text', restart: true },
      { path: 'provider.location', label: 'GCP location', description: 'Vertex AI region, such as us-central1.', kind: 'text', restart: true },
      { path: '$secret.DEEPSEEK_API_KEY', credentialKey: 'DEEPSEEK_API_KEY', label: 'DeepSeek API key', description: 'Stored only in ~/.deepseek/config.json. Enter replaces it; Backspace on an empty editor removes it.', kind: 'secret' },
      { path: '$secret.GCP_CREDENTIALS', credentialKey: 'GCP_CREDENTIALS', label: 'GCP credentials', description: 'Path or credential value stored only in the credentials file.', kind: 'secret' },
      { path: '$action.test-provider', label: 'Test connection', description: 'Checks latency and asks the active provider for available models.', kind: 'action', action: 'test-provider' },
    ],
  },
  {
    id: 'behavior', label: 'Agent Behavior', short: 'Behavior', description: 'Default interaction mode and prompt refinement.',
    items: [
      { path: 'interaction.defaultMode', label: 'Default mode', description: 'Build, Plan, Review or Auto. Auto may only be set at User scope.', kind: 'enum', options: ['build', 'plan', 'review', 'auto'] },
      { path: 'promptRefiner.enabled', label: 'Prompt refinement', description: 'Refine sufficiently long coding requests before execution.', kind: 'boolean' },
      { path: 'promptRefiner.model', label: 'Refiner model', description: 'Optional model override; empty inherits the primary model.', kind: 'enum' },
      { path: 'promptRefiner.minimumLength', label: 'Minimum length', description: 'Messages shorter than this character count are never refined.', kind: 'number' },
      { path: 'promptRefiner.excludeTypes', label: 'Never refine', description: 'Comma-separated message types, such as command and follow-up.', kind: 'list' },
      { path: 'goal.maxContinuations', label: 'Default goal turns', description: 'Maximum auto-continuation turns for /goal. Default 3. Override per-goal with --turns.', kind: 'number' },
      { path: 'permissions.autoApproveLowRisk', label: 'Autoapprove low risk', description: 'Allow low-risk operations without a prompt. Deny and high-risk checks remain mandatory.', kind: 'boolean' },
      { path: '$action.preview-refiner', label: 'Refiner preview', description: 'Use the current conversation model to compare original and refined prompts.', kind: 'action', action: 'preview-refiner' },
    ],
  },
  {
    id: 'context', label: 'Context & Compaction', short: 'Context', description: 'Automatic context compaction policy.',
    items: [
      { path: 'compaction.enabled', label: 'Auto-compact', description: 'Automatically summarizes context near the configured threshold. Manual compaction remains /compact.', kind: 'boolean' },
      { path: 'compaction.threshold', label: 'Threshold', description: 'Context utilization ratio from 0.70 to 0.95. Default is 0.90.', kind: 'number' },
    ],
  },
  {
    id: 'permissions', label: 'Permissions & Risk', short: 'Permissions', description: 'Allow/deny rules, inheritance and risk checks.',
    items: [
      { path: 'permissions.allow', label: 'Allow rules', description: 'Rules such as Shell(git *) or ReadFile. Rules inherit across scopes.', kind: 'list', aliases: ['whitelist'] },
      { path: 'permissions.deny', label: 'Deny rules', description: 'Mandatory deny rules. Higher scopes cannot suppress them.', kind: 'list', aliases: ['block blacklist'] },
      { path: 'permissions.suppress', label: 'Suppress inherited allow', description: 'Exact inherited allow rules to hide at this scope.', kind: 'list' },
      { path: 'risk.enabled', label: 'Risk analysis', description: 'Evaluate built-in and custom risk rules before tool execution.', kind: 'boolean' },
      { path: 'risk.thresholds.largeFileLines', label: 'Large file threshold', description: 'Line count that marks an overwrite as high risk.', kind: 'number' },
      { path: 'risk.thresholds.burstCount', label: 'Edit burst threshold', description: 'Number of writes that activates burst risk.', kind: 'number' },
      { path: 'risk.rules', label: 'Custom risk rules', description: 'JSON array of rules with id, level, tool, pattern or condition.', kind: 'json' },
      { path: '$action.preview-permission', label: 'Preview rule match', description: 'Enter a tool name and optional JSON arguments to see allow, deny or ask.', kind: 'action', action: 'preview-permission' },
      { path: '$action.permissions-help', label: 'Explain permissions', description: 'Show the same effective policy explained by /permissions.', kind: 'action', action: 'permissions-help' },
      { path: '$action.clear-approvals', label: 'Clear session approvals', description: 'Forget approvals granted for this running session.', kind: 'action', action: 'clear-approvals' },
    ],
  },
  {
    id: 'agents', label: 'Agents', short: 'Agents', description: 'Unified primary/subagent registry and delegation policy.',
    items: [
      { path: '$action.agents', label: 'Agent library', description: 'Create, edit, duplicate, disable or restore scoped JSON agents.', kind: 'action', action: 'agents' },
      { path: 'agents.default', label: 'Default agent', description: 'Primary agent selected for the next session.', kind: 'text', restart: true },
      { path: 'agents.basePrompt', label: 'Subagent base prompt', description: 'Editable prompt composed before each specialization. The executor protocol remains protected.', kind: 'text' },
      { path: 'agents.subagentModel', label: 'Subagent model', description: 'Default model for delegated work.', kind: 'enum' },
      { path: 'agents.concurrency', label: 'Concurrency', description: 'Maximum concurrent subagents, from 1 to 16.', kind: 'number' },
      { path: 'agents.permissionPolicy', label: 'Permission policy', description: 'Inherit parent rules or isolate allow rules. Parent deny and risk rules always remain.', kind: 'enum', options: ['inherit', 'isolated'] },
      { path: 'agents.additionalDirectories', label: 'Additional directories', description: 'Comma-separated agent library paths.', kind: 'list' },
      { path: 'agents.disabledBuiltins', label: 'Disabled built-ins', description: 'Built-ins disabled by name. Restore removes the scoped override.', kind: 'list' },
    ],
  },
  {
    id: 'memory', label: 'Memory & Sessions', short: 'Memory', description: 'Memory scope, retention, resume and safe export.',
    items: [
      { path: 'memory.enabled', label: 'Memory', description: 'Enable durable agent and user memory.', kind: 'boolean' },
      { path: 'memory.scope', label: 'Memory scope', description: 'Store memory globally for the user or within this project.', kind: 'enum', options: ['user', 'project'] },
      { path: 'sessions.retention', label: 'Session retention', description: 'Maximum saved sessions. Default is 50.', kind: 'number' },
      { path: 'sessions.autoResume', label: 'Auto-resume', description: 'Off or resume the last session for this project. Explicit CLI flags always win.', kind: 'enum', options: ['off', 'project-last'], restart: true },
      { path: '$action.clear-memory', label: 'Clear active memory', description: 'Clear the effective User or Project memory directory after confirmation.', kind: 'action', action: 'clear-memory' },
      { path: '$action.clear-sessions-project', label: 'Clear project sessions', description: 'Delete saved sessions whose working directory is this project.', kind: 'action', action: 'clear-sessions-project' },
      { path: '$action.clear-sessions-global', label: 'Clear all sessions', description: 'Delete all saved sessions globally. Requires explicit confirmation.', kind: 'action', action: 'clear-sessions-global' },
      { path: '$action.export', label: 'Export bundle', description: 'Write a JSON bundle without secrets containing effective settings.', kind: 'action', action: 'export' },
    ],
  },
  {
    id: 'git', label: 'Git & Worktrees', short: 'Git', description: 'Checkpoints, isolated work and mutation review.',
    items: [
      { path: 'git.checkpoint', label: 'Automatic checkpoint', description: 'Checkpoint files before mutating tools edit them.', kind: 'boolean' },
      { path: 'git.worktree', label: 'Worktree policy', description: 'Disable, ask, or automatically isolate work in a worktree.', kind: 'enum', options: ['off', 'ask', 'auto'] },
      { path: 'git.branchPattern', label: 'Branch pattern', description: 'Template for worktree branches. Supports {slug} and {shortId}.', kind: 'text' },
      { path: 'git.reviewDiff', label: 'Review diff', description: 'Review the diff before releasing a final response after mutations.', kind: 'boolean' },
      { path: 'git.verifyAfterEdit', label: 'Verify after edit', description: 'Offer the detected project test command after an agent changes files.', kind: 'boolean' },
      { path: 'git.generatedPatterns', label: 'Generated files', description: 'Patterns excluded from checkpoints, tracking and review, but still editable.', kind: 'list' },
    ],
  },
  {
    id: 'interface', label: 'Interface', short: 'Interface', description: 'Theme, language, density and information visibility.',
    items: [
      { path: 'interface.theme', label: 'Theme', description: 'Color theme for the TUI.', kind: 'enum', options: ['dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi'] },
      { path: 'interface.language', label: 'Language', description: 'Preferred response language.', kind: 'text' },
      { path: 'interface.vim', label: 'Vim input', description: 'Persist Vim-style input mode.', kind: 'boolean' },
      { path: 'interface.density', label: 'Density', description: 'Compact or comfortable vertical spacing.', kind: 'enum', options: ['compact', 'comfortable'] },
      { path: 'interface.reducedMotion', label: 'Reduced motion', description: 'Disable non-essential shimmer and motion.', kind: 'boolean' },
      { path: 'interface.alternateScreen', label: 'Fullscreen', description: 'Run the TUI in the terminal alternate buffer, pinning the input to the bottom. On by default. Turn it off to keep native scrollback. Applies next session.', kind: 'boolean', restart: true },
      { path: 'interface.showThoughts', label: 'Show thoughts', description: 'Show or hide reasoning panels without deleting history data.', kind: 'boolean' },
      { path: 'interface.showToolCalls', label: 'Show tool calls', description: 'Show tool call details in the transcript.', kind: 'boolean' },
      { path: 'interface.showDiffs', label: 'Show diffs', description: 'Show diffs while preserving their history records.', kind: 'boolean' },
      { path: 'interface.statusBar', label: 'Status bar order', description: 'Comma-separated order: mode, model, tokens, branch, context.', kind: 'list' },
      { path: 'interface.narrowPriority', label: 'Narrow priorities', description: 'Truncation priority for status items in narrow terminals.', kind: 'list' },
      { path: 'interface.subagentStatusLine', label: 'Subagent status line', description: 'Optional trusted User-scoped command. Project and Local values are ignored. Receives task JSON on stdin and returns JSONL rows with id and content.', kind: 'json' },
    ],
  },
  {
    id: 'hooks', label: 'Hooks', short: 'Hooks', description: 'User-scoped executable lifecycle hooks.',
    items: [
      { path: '$action.hooks', label: 'Hook library', description: 'Create, edit, enable, disable, test and remove hooks. Project hooks are shown as ignored.', kind: 'action', action: 'hooks' },
      { path: 'hooks.PreToolUse', label: 'PreToolUse hooks', description: 'User-only matcher/command hooks run before tools.', kind: 'json' },
      { path: 'hooks.PostToolUse', label: 'PostToolUse hooks', description: 'User-only matcher/command hooks run after tools.', kind: 'json' },
      { path: 'hooks.PermissionRequest', label: 'PermissionRequest hooks', description: 'User-only matcher/command hooks can allow or deny permission requests.', kind: 'json' },
      { path: 'hooks.UserPromptSubmit', label: 'UserPromptSubmit hooks', description: 'User-only command hooks run before a prompt is processed.', kind: 'json' },
      { path: 'hooks.Stop', label: 'Stop hooks', description: 'User-only command hooks run when a turn is ready to stop.', kind: 'json' },
      { path: 'hooks.SessionStart', label: 'SessionStart hooks', description: 'User-only matcher hooks; match source: startup, resume, clear, or compact.', kind: 'json' },
      { path: 'hooks.SessionEnd', label: 'SessionEnd hooks', description: 'User-only matcher hooks; match reason: clear, logout, prompt_input_exit, or other.', kind: 'json' },
      { path: 'hooks.PreCompact', label: 'PreCompact hooks', description: 'User-only matcher hooks before compaction; match trigger: manual or auto.', kind: 'json' },
      { path: 'hooks.PostCompact', label: 'PostCompact hooks', description: 'User-only matcher hooks after compaction; match trigger: manual or auto.', kind: 'json' },
      { path: 'hooks.SubagentStart', label: 'SubagentStart hooks', description: 'User-only matcher/command hooks run when a subagent starts.', kind: 'json' },
      { path: 'hooks.SubagentStop', label: 'SubagentStop hooks', description: 'User-only matcher/command hooks run when a subagent stops.', kind: 'json' },
      { path: 'hooks.Setup', label: 'Setup hooks', description: 'User-only matcher hooks; match trigger: init or maintenance.', kind: 'json' },
      { path: 'hooks.InstructionsLoaded', label: 'InstructionsLoaded hooks', description: 'User-only matcher hooks run when project instructions are loaded.', kind: 'json' },
      { path: 'hooks.UserPromptExpansion', label: 'UserPromptExpansion hooks', description: 'User-only matcher hooks run when a command expands into a prompt.', kind: 'json' },
      { path: 'hooks.MessageDisplay', label: 'MessageDisplay hooks', description: 'User-only command hooks run when assistant text is displayed.', kind: 'json' },
      { path: 'hooks.PostToolUseFailure', label: 'PostToolUseFailure hooks', description: 'User-only matcher hooks run after a tool fails.', kind: 'json' },
      { path: 'hooks.PostToolBatch', label: 'PostToolBatch hooks', description: 'User-only command hooks run after a tool batch resolves.', kind: 'json' },
      { path: 'hooks.PermissionDenied', label: 'PermissionDenied hooks', description: 'User-only matcher hooks run when automatic permission denies a tool.', kind: 'json' },
      { path: 'hooks.Notification', label: 'Notification hooks', description: 'User-only matcher hooks run when the CLI emits a notification.', kind: 'json' },
      { path: 'hooks.TaskCreated', label: 'TaskCreated hooks', description: 'User-only command hooks run when a task is created.', kind: 'json' },
      { path: 'hooks.TaskCompleted', label: 'TaskCompleted hooks', description: 'User-only command hooks run when a task completes.', kind: 'json' },
      { path: 'hooks.StopFailure', label: 'StopFailure hooks', description: 'User-only matcher hooks run when a turn ends with an API failure.', kind: 'json' },
      { path: 'hooks.TeammateIdle', label: 'TeammateIdle hooks', description: 'User-only command hooks run when a teammate becomes idle.', kind: 'json' },
      { path: 'hooks.ConfigChange', label: 'ConfigChange hooks', description: 'User-only matcher hooks run when settings change.', kind: 'json' },
      { path: 'hooks.CwdChanged', label: 'CwdChanged hooks', description: 'User-only command hooks run when the working directory changes.', kind: 'json' },
      { path: 'hooks.DirectoryAdded', label: 'DirectoryAdded hooks', description: 'User-only matcher hooks run when a directory is added.', kind: 'json' },
      { path: 'hooks.FileChanged', label: 'FileChanged hooks', description: 'User-only matcher hooks run when a watched file changes.', kind: 'json' },
      { path: 'hooks.WorktreeCreate', label: 'WorktreeCreate hooks', description: 'User-only command hooks run before a worktree is created.', kind: 'json' },
      { path: 'hooks.WorktreeRemove', label: 'WorktreeRemove hooks', description: 'User-only command hooks run when a worktree is removed.', kind: 'json' },
      { path: 'hooks.Elicitation', label: 'Elicitation hooks', description: 'User-only matcher hooks run when an MCP server requests input.', kind: 'json' },
      { path: 'hooks.ElicitationResult', label: 'ElicitationResult hooks', description: 'User-only matcher hooks run after an MCP elicitation response.', kind: 'json' },
    ],
  },
  {
    id: 'advanced', label: 'Advanced', short: 'Advanced', description: 'Paths, reload, diagnostics, reset and raw files.',
    items: [
      { path: '$action.reload', label: 'Reload settings', description: 'Re-read all scopes and apply compatible values without restarting.', kind: 'action', action: 'reload' },
      { path: '$action.open-scope', label: 'Open scope file', description: 'Pause the TUI and open the selected scope JSON in $VISUAL or $EDITOR.', kind: 'action', action: 'open-scope' },
      { path: '$action.open-credentials', label: 'Open credentials', description: 'Open ~/.deepseek/config.json separately from non-secret settings.', kind: 'action', action: 'open-credentials' },
      { path: '$action.diagnostics', label: 'Diagnostics', description: 'Show scope paths, validation issues and unknown top-level keys.', kind: 'action', action: 'diagnostics' },
      { path: 'lsp.servers', label: 'Language servers', description: 'User-scoped JSON array of trusted LSP commands and file extensions.', kind: 'json' },
      { path: 'lsp.timeoutMs', label: 'LSP timeout', description: 'Maximum language-server request time in milliseconds.', kind: 'number' },
      { path: 'mcp.enabled', label: 'Enable project MCP servers', description: 'User opt-in only. Each workspace and exact .deepseek/mcp.json hash still requires a separate confirmation.', kind: 'boolean', restart: true },
      { path: '$action.reset-scope', label: 'Reset scope', description: 'Remove all known and unknown settings overrides from the selected scope.', kind: 'action', action: 'reset-scope' },
      { path: '$action.export', label: 'Export effective settings', description: 'Write a secret-free diagnostic export into .deepseek.', kind: 'action', action: 'export' },
    ],
  },
]

export type SettingsLayout = 'wide' | 'medium' | 'narrow'
export function getSettingsLayout(width: number): SettingsLayout {
  return width >= 110 ? 'wide' : width >= 72 ? 'medium' : 'narrow'
}
export function getSettingsNavigationHeight(height: number): number {
  return Math.max(6, Math.min(9, height - 13))
}
export { CATEGORIES as SETTINGS_CATEGORIES }

interface ConfigMenuProps {
  currentTheme: ThemeName
  currentLanguage: string | null
  enchantEnabled: boolean
  onThemeSelect(t: ThemeName): void
  onLanguageSet(lang: string): void
  onEnchantToggle(enabled: boolean): void
  onClose(): void
  onThemeChange?(t: ThemeName): void
  onSettingsChanged?(settings: DeepSeekSettings, snapshot: SettingsSnapshot): void | Promise<void>
  onTestConnection?(settings: DeepSeekSettings, credentials: Record<string, string>): Promise<string[]>
  onClearApprovals?(): void
  onPermissionsHelp?(): string
  onPreviewRefiner?(prompt: string): Promise<string>
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF'
  if (Array.isArray(value)) return value.length ? value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(', ') : '[]'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function valueAt(settings: DeepSeekSettings, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, settings)
}

export function getSettingsWindow<T>(items: T[], selected: number, max: number): { before: boolean; after: boolean; start: number; values: T[] } {
  if (items.length <= max) return { before: false, after: false, start: 0, values: items }
  // Keep the current page still until the selection reaches its last visible row.
  // Centering on every key press makes terminal renderers repaint and compress rows.
  const start = Math.max(0, Math.min(selected - max + 1, items.length - max))
  return { before: start > 0, after: start + max < items.length, start, values: items.slice(start, start + max) }
}

export function getNextSettingOption(current: unknown, options: string[]): string {
  return options[(options.indexOf(String(current ?? '')) + 1) % options.length] ?? ''
}

export default function ConfigMenu(props: ConfigMenuProps) {
  const [repository] = useState(() => new SettingsRepository())
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [scope, setScope] = useState<SettingsLevel>('user')
  const [categoryIndex, setCategoryIndex] = useState(0)
  const [itemIndex, setItemIndex] = useState(0)
  const [focus, setFocus] = useState<'categories' | 'items'>('categories')
  const [narrowPage, setNarrowPage] = useState<'categories' | 'items' | 'detail'>('categories')
  const [searching, setSearching] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<SettingDefinition | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [status, setStatus] = useState('Loading settings…')
  const [busy, setBusy] = useState(false)
  const [apiModels, setApiModels] = useState<string[]>([])
  const [confirmAction, setConfirmAction] = useState<'reset-scope' | 'clear-memory' | 'clear-sessions-project' | 'clear-sessions-global' | null>(null)
  const [library, setLibrary] = useState<'agents' | 'hooks' | null>(null)
  const firstPaint = useRef(true)

  const width = process.stdout.columns || 80
  const height = process.stdout.rows || 24
  const layout = getSettingsLayout(width)
  const colors = getThemeColors(props.currentTheme)

  const reload = async (message = 'Settings reloaded') => {
    setBusy(true)
    try {
      const [next, nextCredentials] = await Promise.all([repository.reload(), loadFullConfig()])
      setSnapshot(next)
      setCredentials(nextCredentials)
      await props.onSettingsChanged?.(next.effective, next)
      setStatus(message)
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void reload('Ready') }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return CATEGORIES
    return CATEGORIES.map(category => ({
      ...category,
      items: category.items.filter(item => [item.label, item.description, category.label, ...(item.aliases ?? [])].join(' ').toLowerCase().includes(query)),
    })).filter(category => category.items.length > 0)
  }, [search])
  useEffect(() => { setCategoryIndex(0); setItemIndex(0) }, [search])
  useEffect(() => {
    // The settings list changes styles and occasionally its visible window on
    // the same keypress. Force full damage so shorter/reordered terminal rows
    // cannot inherit cells from the previous frame.
    invalidateInkFrame(process.stdout, firstPaint.current)
    firstPaint.current = false
  }, [categoryIndex, itemIndex, focus, scope, search, layout])

  const category = filtered[Math.min(categoryIndex, Math.max(0, filtered.length - 1))]
  const item = category?.items[Math.min(itemIndex, Math.max(0, category.items.length - 1))]
  const effectiveValue = item && snapshot
    ? item.kind === 'secret' ? credentials[item.credentialKey!] : valueAt(snapshot.effective, item.path)
    : undefined

  const saveValue = async (definition: SettingDefinition, raw: string) => {
    try {
      setBusy(true)
      if (definition.path === '$preview') {
        setStatus(await props.onPreviewRefiner?.(raw) ?? 'Refiner preview unavailable')
      } else if (definition.path === '$permission-preview') {
        const separator = raw.indexOf(' ')
        const tool = (separator < 0 ? raw : raw.slice(0, separator)).trim()
        let args: Record<string, unknown> = {}
        if (separator >= 0 && raw.slice(separator + 1).trim()) args = JSON.parse(raw.slice(separator + 1)) as Record<string, unknown>
        const decision = resolvePermission(snapshot?.effective.permissions, tool, args)
        setStatus(`Permission preview · ${tool}: ${decision.toUpperCase()}`)
      } else if (definition.kind === 'secret') {
        const next = { ...credentials }
        if (raw) next[definition.credentialKey!] = raw
        else delete next[definition.credentialKey!]
        await saveFullConfig(next)
        setCredentials(next)
        setStatus(raw ? 'Credential replaced' : 'Credential removed')
      } else {
        let value: unknown = raw
        if (definition.kind === 'boolean') value = raw === 'true'
        if (definition.kind === 'number') value = Number(raw)
        if (definition.kind === 'list') value = raw.split(',').map(entry => entry.trim()).filter(Boolean)
        if (definition.kind === 'json') value = raw.trim() ? JSON.parse(raw) : []
        const next = raw === '' && definition.kind === 'text'
          ? await repository.unset(scope, definition.path)
          : await repository.set(scope, definition.path, value)
        setSnapshot(next)
        await props.onSettingsChanged?.(next.effective, next)
        if (definition.path === 'interface.theme') props.onThemeSelect(value as ThemeName)
        if (definition.path === 'interface.language') {
          const language = valueAt(next.effective, definition.path)
          if (typeof language === 'string') props.onLanguageSet(language)
        }
        if (definition.path === 'promptRefiner.enabled') props.onEnchantToggle(Boolean(value))
        setStatus(definition.restart ? 'Saved · active next session' : 'Saved · active now')
      }
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`)
    } finally {
      setBusy(false)
      setEditing(null)
      setEditorValue('')
    }
  }

  const openExternal = async (path: string) => {
    const editor = process.env.VISUAL || process.env.EDITOR
    if (!editor) { setStatus('Set $VISUAL or $EDITOR first'); return }
    await mkdir(dirname(path), { recursive: true })
    try {
      await withInkPaused(() => execa(editor, [path], { stdio: 'inherit' }).then(() => undefined))
    } catch (error) {
      setStatus(`Editor error: ${(error as Error).message}`)
    } finally { await reload('File closed · settings reloaded') }
  }

  const runAction = async (definition: SettingDefinition) => {
    try { switch (definition.action) {
      case 'reload': await reload(); break
      case 'test-provider': {
        if (!props.onTestConnection) { setStatus('Connection test unavailable'); break }
        setBusy(true)
        const started = Date.now()
        try {
          const models = await props.onTestConnection(snapshot!.effective, credentials)
          setApiModels(models)
          setStatus(`Connected in ${Date.now() - started}ms · ${models.length} model${models.length === 1 ? '' : 's'} found`)
        } catch (error) { setStatus(`Connection failed: ${(error as Error).message}`) }
        finally { setBusy(false) }
        break
      }
      case 'preview-refiner':
        setEditing({ ...definition, path: '$preview', kind: 'text', label: 'Prompt to preview' })
        setEditorValue('')
        setStatus('Type a prompt and press Enter')
        break
      case 'preview-permission':
        setEditing({ ...definition, path: '$permission-preview', kind: 'text', label: 'Tool and JSON arguments' })
        setEditorValue('shell {"command":"git status"}')
        setStatus('Format: tool_name {"argument":"value"}')
        break
      case 'permissions-help': setStatus(props.onPermissionsHelp?.().replace(/\n/g, ' · ').slice(0, Math.max(40, width - 12)) ?? 'Use /permissions for the effective policy'); break
      case 'clear-approvals': props.onClearApprovals?.(); setStatus('Session approvals cleared'); break
      case 'open-scope': if (snapshot) await openExternal(snapshot.levels[scope].path); break
      case 'open-credentials': await openExternal(getCredentialsPath()); break
      case 'diagnostics': {
        const paths = snapshot ? (['user', 'project', 'local'] as SettingsLevel[]).map(level => `${level}: ${snapshot.levels[level].path}`).join(' · ') : 'paths unavailable'
        const issues = snapshot?.issues.length ? snapshot.issues.map(issue => `${issue.level ?? 'effective'}:${issue.path || 'JSON'} ${issue.message}`).join(' · ') : 'no validation issues'
        const unknown = snapshot?.unknownPaths.length ? snapshot.unknownPaths.join(', ') : 'none'
        setStatus(`${paths} · Unknown keys: ${unknown} · ${issues}`)
        break
      }
      case 'export': {
        const [agentMemory, userMemory, sessions] = await Promise.all([
          loadMemory('agent'),
          loadMemory('user'),
          listSessions(),
        ])
        const bundle = await repository.export({
          memory: { agent: agentMemory, user: userMemory },
          sessions,
        })
        const path = join(process.cwd(), '.deepseek', `settings-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
        setStatus(`Exported without secrets · ${path}`)
        break
      }
      case 'reset-scope': setConfirmAction('reset-scope'); setStatus(`Press y to reset all ${scope} overrides, or n to cancel`); break
      case 'clear-memory': setConfirmAction('clear-memory'); setStatus('Press y to clear the active memory directory, or n to cancel'); break
      case 'clear-sessions-project': setConfirmAction('clear-sessions-project'); setStatus('Press y to delete sessions for this project, or n to cancel'); break
      case 'clear-sessions-global': setConfirmAction('clear-sessions-global'); setStatus('Press y to delete ALL saved sessions, or n to cancel'); break
      case 'agents': setLibrary('agents'); break
      case 'hooks': setLibrary('hooks'); break
      default: setStatus('Unknown settings action')
    } } catch (error) { setStatus(`Error: ${(error as Error).message}`) }
  }

  const activate = async (definition: SettingDefinition) => {
    if (!snapshot || busy) return
    if (definition.path === 'interface.subagentStatusLine' && scope !== 'user') {
      setStatus('Ignored outside User scope · switch to User to edit')
      return
    }
    if (definition.path === 'agents.basePrompt') {
      try { await saveValue(definition, await editPromptMarkdown('subagent-base-prompt', String(effectiveValue ?? ''))) }
      catch (error) { setStatus(`Editor error: ${(error as Error).message}`) }
      return
    }
    if (definition.kind === 'action') { await runAction(definition); return }
    if (definition.kind === 'boolean') {
      const current = Boolean(valueAt(snapshot.effective, definition.path))
      await saveValue(definition, String(!current))
      return
    }
    if (definition.kind === 'enum') {
      let options = definition.options ?? []
      if (MODEL_SETTING_PATHS.has(definition.path)) {
        let models = apiModels
        if (!models.length) {
          setBusy(true)
          setStatus('Loading provider models…')
          try { models = await props.onTestConnection?.(snapshot.effective, credentials) ?? [] }
          catch (error) { setStatus(`Model list failed: ${(error as Error).message}`); return }
          finally { setBusy(false) }
          if (!models.length) { setStatus('No models found · check Provider › Test connection'); return }
          setApiModels(models)
        }
        options = definition.path === 'model.default' ? models : ['', ...models]
      }
      await saveValue(definition, getNextSettingOption(effectiveValue, options))
      return
    }
    setEditing(definition)
    if (definition.kind === 'secret') setEditorValue('')
    else if (definition.kind === 'json') setEditorValue(effectiveValue ? JSON.stringify(effectiveValue) : '[]')
    else setEditorValue(Array.isArray(effectiveValue) ? effectiveValue.join(', ') : effectiveValue === undefined ? '' : String(effectiveValue))
  }

  useInput((input: string, key: Key, event) => {
    if (key.wheelUp || key.wheelDown || shouldFilterKey(event.keypress)) return
    if (confirmAction) {
      if (input.toLowerCase() === 'y') {
        const action = confirmAction
        setConfirmAction(null)
        void (async () => {
          try {
            if (action === 'reset-scope') {
              const next = await repository.reset(scope)
              setSnapshot(next); await props.onSettingsChanged?.(next.effective, next); setStatus(`${scope} scope reset`)
            } else if (action === 'clear-memory') {
              const { clearMemory } = await import('../../agent/memory.js')
              await clearMemory(); setStatus('Active memory cleared')
            } else {
              const { clearSessions } = await import('../../agent/session.js')
              const count = await clearSessions(action === 'clear-sessions-global' ? 'global' : 'project')
              setStatus(`${count} session${count === 1 ? '' : 's'} deleted`)
            }
          } catch (error) { setStatus(`Error: ${(error as Error).message}`) }
        })()
      } else if (input.toLowerCase() === 'n' || key.escape) { setConfirmAction(null); setStatus('Destructive action cancelled') }
      return
    }
    if (editing) {
      if (key.escape) { setEditing(null); setEditorValue(''); setStatus('Edit cancelled'); return }
      if (key.return) { void saveValue(editing, editorValue); return }
      if (key.backspace || key.delete) { setEditorValue(value => value.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) setEditorValue(value => value + input)
      return
    }
    if (searching) {
      if (key.escape) { setSearching(false); setSearch(''); setCategoryIndex(0); setItemIndex(0); return }
      if (key.return) { setSearching(false); setCategoryIndex(0); setItemIndex(0); return }
      if (key.backspace || key.delete) { setSearch(value => value.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) setSearch(value => value + input)
      return
    }
    if (key.tab) {
      const scopes: SettingsLevel[] = ['user', 'project', 'local']
      setScope(current => scopes[(scopes.indexOf(current) + (key.shift ? scopes.length - 1 : 1)) % scopes.length]!)
      return
    }
    if (input === '/') { setSearching(true); return }
    if (key.escape || input === 'q') {
      if (layout === 'narrow' && narrowPage !== 'categories') {
        if (narrowPage === 'detail') { setNarrowPage('items'); setFocus('items') }
        else { setNarrowPage('categories'); setFocus('categories') }
      } else props.onClose()
      return
    }
    if (key.leftArrow && layout !== 'narrow') { setFocus('categories'); return }
    if (key.rightArrow && layout !== 'narrow') { if (category?.items.length) setFocus('items'); return }
    if (key.upArrow || input === 'k') {
      if (focus === 'categories' || (layout === 'narrow' && narrowPage === 'categories')) {
        if (filtered.length === 0) return
        setCategoryIndex(index => (index - 1 + filtered.length) % filtered.length); setItemIndex(0)
      } else if (category?.items.length) setItemIndex(index => (index - 1 + category.items.length) % category.items.length)
      return
    }
    if (key.downArrow || input === 'j') {
      if (focus === 'categories' || (layout === 'narrow' && narrowPage === 'categories')) {
        if (filtered.length === 0) return
        setCategoryIndex(index => (index + 1) % filtered.length); setItemIndex(0)
      } else if (category?.items.length) setItemIndex(index => (index + 1) % category.items.length)
      return
    }
    if (key.return) {
      if (layout === 'narrow' && narrowPage === 'categories') { if (category) { setNarrowPage('items'); setFocus('items') } return }
      if (layout === 'narrow' && narrowPage === 'items') { if (item) setNarrowPage('detail'); return }
      if (focus === 'categories') { if (category?.items.length) setFocus('items'); return }
      if (item) void activate(item)
      return
    }
    if ((input === 'e' || input === ' ') && item && (focus === 'items' || layout === 'narrow')) void activate(item)
    if (input === 'r' && item && snapshot && !item.path.startsWith('$')) {
      void repository.unset(scope, item.path).then(async next => {
        setSnapshot(next)
        await props.onSettingsChanged?.(next.effective, next)
        setStatus(item.path === 'interface.subagentStatusLine' && scope !== 'user'
          ? 'Ignored override removed · User scope controls this setting'
          : 'Override removed · inherited value active')
      }).catch(error => setStatus(`Error: ${error.message}`))
    }
  }, { isActive: library === null })

  const navigationHeight = getSettingsNavigationHeight(height)
  const categoryWindow = getSettingsWindow(filtered, categoryIndex, layout === 'narrow' ? Math.max(4, height - 8) : navigationHeight - 2)
  const itemWindow = getSettingsWindow(category?.items ?? [], itemIndex, layout === 'narrow' ? Math.max(4, height - 8) : Math.max(1, navigationHeight - 5))
  const resolution = item && snapshot && !item.path.startsWith('$') ? resolveSetting(snapshot, item.path) : null
  const origin: SettingOrigin | undefined = resolution?.origin
  const scopeValue = item && snapshot && !item.path.startsWith('$') ? valueAt(snapshot.levels[scope].data, item.path) : undefined
  const defaultValue = item && !item.path.startsWith('$') ? valueAt(DEFAULT_SETTINGS, item.path) : undefined
  const invalidScope = snapshot?.levels[scope].error
  const statusLineRestricted = item?.path === 'interface.subagentStatusLine' && scope !== 'user'

  const Header = () => (
    <Box flexDirection="column" flexShrink={0}>
      <Box justifyContent="space-between">
        <Text bold color={colors.primary}>DeepSeek Code · Settings</Text>
        <Text dimColor>{busy ? 'Loading…' : `Scope: ${scope[0]!.toUpperCase()}${scope.slice(1)}`}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>{layout === 'narrow' ? `Settings / ${category?.short ?? 'Search'}${narrowPage === 'detail' && item ? ` / ${item.label}` : ''}` : 'User < Project < Local · per-field save'}</Text>
        <Text color={search ? colors.primary : colors.textDim}>/{search || ' search'}</Text>
      </Box>
      {invalidScope ? <Text color={colors.error}>Invalid JSON · saves blocked: {invalidScope}</Text> : null}
      {width < 40 || height < 12 ? <Text color={colors.warning}>Terminal too small · use at least 40×12 for safe editing</Text> : null}
    </Box>
  )

  const Categories = () => (
    <Box flexDirection="column" width={layout === 'wide' ? 25 : layout === 'medium' ? 17 : undefined} paddingRight={1}>
      <Text dimColor>{categoryWindow.before ? '  ↑ more' : ' '}</Text>
      {categoryWindow.values.map((entry, offset) => {
        const index = categoryWindow.start + offset
        const selected = index === categoryIndex && (layout === 'narrow' ? narrowPage === 'categories' : focus === 'categories')
        const label = layout === 'medium' ? entry.short.padEnd(13) : entry.label
        return <Text key={entry.id} bold={selected} color={selected ? colors.primary : colors.text} wrap={layout === 'medium' ? 'truncate-end' : 'wrap'}>{selected ? '› ' : '  '}{label}</Text>
      })}
      <Text dimColor>{categoryWindow.after ? '  ↓ more' : ' '}</Text>
    </Box>
  )

  const Items = () => category ? (
    <Box flexDirection="column" width={layout === 'wide' ? 38 : layout === 'medium' ? Math.max(44, width - 20) : undefined} paddingX={layout === 'wide' ? 1 : 0}>
      <Text bold flexShrink={0}>{category.label}</Text>
      <Text dimColor wrap="truncate-end" flexShrink={0}>{category.description}</Text>
      <Box marginTop={1} flexDirection="column" flexShrink={0}>
        <Text dimColor flexShrink={0}>{itemWindow.before ? `  ↑ ${itemWindow.start} above` : ' '}</Text>
        {itemWindow.values.map((entry, offset) => {
          const index = itemWindow.start + offset
          const selected = index === itemIndex && (layout === 'narrow' ? narrowPage === 'items' : focus === 'items')
          const value = entry.kind === 'secret'
            ? (credentials[entry.credentialKey!] ? '••••••••' : 'not set')
            : entry.kind === 'action' ? 'open'
            : entry.path === 'interface.subagentStatusLine' && scope !== 'user' ? 'ignored'
            : displayValue(snapshot ? valueAt(snapshot.effective, entry.path) : undefined)
          return (
            <Box key={entry.path} width="100%" justifyContent="space-between" flexShrink={0}>
              <Text bold={selected} color={selected ? colors.primary : colors.text} wrap={layout === 'narrow' ? 'wrap' : 'truncate-end'} flexShrink={1}>{selected ? '› ' : '  '}{entry.label}</Text>
              <Text color={selected ? colors.primary : colors.textDim} wrap={layout === 'narrow' ? 'wrap' : 'truncate-middle'} flexShrink={0}>{value}</Text>
            </Box>
          )
        })}
        <Text dimColor flexShrink={0}>{itemWindow.after ? `  ↓ ${category.items.length - itemWindow.start - itemWindow.values.length} below` : ' '}</Text>
      </Box>
    </Box>
  ) : <Text dimColor>No setting matches this search.</Text>

  const Detail = () => item ? (
    <Box flexDirection="column" flexGrow={1} width="100%">
      <Text bold color={colors.primary}>{item.label}</Text>
      <Box marginTop={layout === 'medium' ? 0 : 1}><Text wrap={layout === 'medium' ? 'truncate-end' : 'wrap'}>{item.description}</Text></Box>
      <Box marginTop={layout === 'medium' ? 0 : 1} flexDirection="column">
        {statusLineRestricted ? <Text color={colors.warning}>Ignored outside User scope · only a User value can be active</Text> : resolution ? <Text dimColor>{layout === 'narrow'
          ? `Effective: ${item.kind === 'secret' ? (effectiveValue ? '•••••••• configured' : 'not configured') : displayValue(effectiveValue)} · ${scope}${scopeValue === undefined ? ' inherited' : ' override'}`
          : `Effective: ${item.kind === 'secret' ? (effectiveValue ? '•••••••• configured' : 'not configured') : displayValue(effectiveValue)} · Origin: ${origin} · editing: ${scope}${scopeValue === undefined ? ' (inherited)' : ' (override)'}`}</Text> : <Text dimColor>{`Effective: ${item.kind === 'secret' ? (effectiveValue ? '•••••••• configured' : 'not configured') : displayValue(effectiveValue)}`}</Text>}
        {layout !== 'medium' && defaultValue !== undefined ? <Text dimColor>Default: {displayValue(defaultValue)}</Text> : null}
        {layout !== 'medium' && resolution && resolution.overrides.length > 1 ? <Text dimColor>Chain: {resolution.overrides.map(entry => entry.level).join(' → ')}</Text> : null}
        {statusLineRestricted ? null : item.restart ? <Text color={colors.warning}>△ Applies next session</Text> : item.kind !== 'action' ? <Text color={colors.success}>✓ Applies immediately</Text> : null}
      </Box>
      {layout !== 'medium' && item.path === 'agents.basePrompt' ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Protected executor protocol</Text>
          <Text color={colors.textDim}>JSON result fields: summary, confidence, filesRead, filesChanged, issuesFound, suggestions, metadata.</Text>
        </Box>
      ) : null}
      <Box marginTop={layout === 'medium' ? 0 : 1}><Text dimColor>{item.kind === 'boolean' ? 'Enter toggles' : MODEL_SETTING_PATHS.has(item.path) ? (apiModels.length ? `Enter cycles: ${item.path === 'model.default' ? '' : 'inherit · '}${apiModels.join(' · ')}` : 'Enter loads and cycles provider models') : item.path === 'agents.basePrompt' ? 'Enter opens Markdown editor · r restores inherited value' : item.kind === 'enum' ? `Enter cycles: ${item.options?.join(' · ')}` : item.kind === 'action' ? 'Enter runs action' : 'Enter edits · r restores inherited value'}</Text></Box>
    </Box>
  ) : <Text dimColor>No setting matches this search.</Text>

  const Footer = () => (
    <Box flexDirection="column" flexShrink={0}>
      {editing ? (
        <Box flexDirection="column">
          <Text color={colors.primary}>{editing.kind === 'secret' ? 'New secret (hidden)' : `Edit ${editing.label}`}</Text>
          <Text>{editing.kind === 'secret' ? '•'.repeat(editorValue.length) || '…' : editorValue || '…'}<Text color={colors.primary}>█</Text></Text>
          <Text dimColor>Enter save · Esc cancel</Text>
        </Box>
      ) : (
        <>
          <Text color={status.startsWith('Error') || status.includes('failed') ? colors.error : colors.textDim} wrap="truncate-end">{status}</Text>
          <Text dimColor wrap="truncate-end">↑↓ navigate · Enter select/edit · / search · Tab scope · r inherit · Esc back/close</Text>
        </>
      )}
    </Box>
  )

  if (library === 'agents') {
    return <AgentLibrary scope={scope} theme={props.currentTheme} onBack={() => { setLibrary(null); void reload('Agent registry reloaded') }} onChanged={() => undefined} />
  }
  if (library === 'hooks') {
    return <HookLibrary scope={scope} theme={props.currentTheme} onBack={() => { setLibrary(null); void reload('Hooks reloaded') }} />
  }

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
      <Header />
      <Box marginTop={1} flexGrow={1} minHeight={0}>
        {layout !== 'narrow' ? (
          <Box flexDirection="column" width="100%">
            <Box height={navigationHeight} flexShrink={0}><Categories /><Text color={colors.textInactive}>{'│\n'.repeat(navigationHeight - 1)}│</Text><Items /></Box>
            <Box marginTop={navigationHeight === 9 && height >= 22 ? 3 : 1} flexGrow={1} minHeight={0} width="100%"><Detail /></Box>
          </Box>
        ) : narrowPage === 'categories' ? <Categories /> : narrowPage === 'items' ? <Items /> : <Detail />}
      </Box>
      <Footer />
    </Box>
  )
}
