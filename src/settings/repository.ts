import { createHash, randomUUID } from 'crypto'
import { BUDGET_LEVELS, budgetProfile, DEFAULT_BUDGET_LEVEL, isBudgetLevel } from './budget.js'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { homedir } from 'os'
import type {
  DeepSeekSettings,
  SettingOrigin,
  SettingResolution,
  SettingsExport,
  SettingsLevel,
  SettingsSnapshot,
  ValidationIssue,
} from './types.js'

const LEVELS: SettingsLevel[] = ['user', 'project', 'local']

export const DEFAULT_SETTINGS: DeepSeekSettings = {
  budget: DEFAULT_BUDGET_LEVEL,
  provider: { name: 'deepseek', timeoutMs: 30_000 },
  interaction: { defaultMode: 'build' },
  compaction: { enabled: true, threshold: 0.9 },
  promptRefiner: { enabled: false, minimumLength: 30, excludeTypes: ['command'] },
  permissions: { autoApproveLowRisk: false },
  risk: { enabled: true, thresholds: { largeFileLines: 100, burstCount: 3 } },
  agents: { concurrency: 5, permissionPolicy: 'inherit', disabledBuiltins: [] },
  memory: { enabled: true, scope: 'user' },
  sessions: { retention: 50, autoResume: 'off' },
  git: {
    checkpoint: true,
    worktree: 'ask',
    branchPattern: 'deepseek/{slug}-{shortId}',
    reviewDiff: false,
    verifyAfterEdit: true,
    generatedPatterns: [],
  },
  lsp: { servers: [], timeoutMs: 10_000 },
  mcp: { enabled: false },
  goal: { maxContinuations: 10 },
  workflows: { enabled: true },
  interface: {
    theme: 'dark',
    vim: false,
    density: 'comfortable',
    reducedMotion: false,
    alternateScreen: true,
    showThoughts: true,
    showToolCalls: true,
    showDiffs: true,
    statusBar: ['mode', 'model', 'tokens', 'branch', 'context'],
    narrowPriority: ['mode', 'context', 'model', 'branch', 'tokens'],
  },
}

const KNOWN_TOP_LEVEL = new Set([
  'provider', 'model', 'interaction', 'compaction', 'promptRefiner',
  'permissions', 'risk', 'agents', 'memory', 'sessions', 'git', 'lsp', 'mcp', 'interface',
  'hooks', 'goal', 'workflows', 'keybindings', 'budget', 'theme', 'language', 'autoCompact', 'autoCompactThreshold',
])

/** True for plain non-null, non-array objects. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Deep copy via a JSON round-trip; only safe for JSON-serialisable settings data. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Reads a dot-separated path (e.g. `git.worktree`); an empty path returns the source itself. */
function getAtPath(source: unknown, path: string): unknown {
  if (!path) return source
  return path.split('.').reduce<unknown>((value, key) => {
    return isObject(value) ? value[key] : undefined
  }, source)
}

/** Writes a value at a dot-separated path, replacing any non-object intermediate with a fresh object. */
function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) cursor[part] = {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts.at(-1)!] = value
}

/** Deletes the key at a dot-separated path and prunes parent objects left empty by the deletion. */
function unsetAtPath(target: Record<string, unknown>, path: string): void {
  const parts = path.split('.')
  const parents: Array<{ object: Record<string, unknown>; key: string }> = []
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) return
    parents.push({ object: cursor, key: part })
    cursor = cursor[part] as Record<string, unknown>
  }
  delete cursor[parts.at(-1)!]
  for (const { object, key } of parents.reverse()) {
    if (isObject(object[key]) && Object.keys(object[key] as object).length === 0) delete object[key]
  }
}

/** Settings paths whose arrays accumulate across levels (permission rules, risk rules, hooks, disabled builtins) instead of being replaced. */
function shouldConcat(path: string): boolean {
  return [
    'permissions.allow', 'permissions.deny', 'permissions.suppress',
    'risk.rules',
    ...['PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStart', 'SubagentStop',
      'SessionStart', 'Setup', 'SessionEnd', 'PreCompact', 'PostCompact',
      'InstructionsLoaded', 'UserPromptExpansion', 'PostToolUseFailure', 'PermissionDenied', 'Notification',
      'StopFailure', 'ConfigChange', 'DirectoryAdded', 'FileChanged', 'Elicitation', 'ElicitationResult']
      .map(event => `hooks.${event}`),
    ...['UserPromptSubmit', 'Stop',
      'MessageDisplay', 'PostToolBatch', 'TaskCreated', 'TaskCompleted', 'TeammateIdle', 'CwdChanged',
      'WorktreeCreate', 'WorktreeRemove'].map(event => `hooks.${event}`),
    'agents.disabledBuiltins',
  ].includes(path)
}

/**
 * Deep-merges settings levels left to right: later objects override earlier keys, arrays are replaced,
 * except paths listed in `shouldConcat`, which are concatenated and de-duplicated by JSON value.
 */
export function mergeSettings(...levels: DeepSeekSettings[]): DeepSeekSettings {
  const merge = (base: unknown, next: unknown, path: string): unknown => {
    if (next === undefined) return base
    if (Array.isArray(next)) {
      if (Array.isArray(base) && shouldConcat(path)) {
        return [...new Map([...base, ...next].map(item => [JSON.stringify(item), item])).values()]
      }
      return clone(next)
    }
    if (isObject(next)) {
      const result: Record<string, unknown> = isObject(base) ? clone(base) : {}
      for (const [key, value] of Object.entries(next)) {
        result[key] = merge(result[key], value, path ? `${path}.${key}` : key)
      }
      return result
    }
    return next
  }
  return levels.reduce<DeepSeekSettings>((result, level) => merge(result, level, '') as DeepSeekSettings, {})
}

/** Maps deprecated top-level keys (`theme`, `language`, `autoCompact*`, string `model`) onto their current nested locations without overwriting newer values. */
function legacyCompatibility(raw: DeepSeekSettings): DeepSeekSettings {
  const migrated: DeepSeekSettings = clone(raw)
  const interfaceSettings = { ...(isObject(raw.interface) ? raw.interface : {}) }
  const compaction = { ...(isObject(raw.compaction) ? raw.compaction : {}) }

  if (interfaceSettings.theme === undefined && raw.theme !== undefined) interfaceSettings.theme = raw.theme
  if (interfaceSettings.language === undefined && raw.language !== undefined) interfaceSettings.language = raw.language
  if (compaction.enabled === undefined && raw.autoCompact !== undefined) compaction.enabled = raw.autoCompact
  if (compaction.threshold === undefined && raw.autoCompactThreshold !== undefined) compaction.threshold = raw.autoCompactThreshold
  if (Object.keys(interfaceSettings).length) migrated.interface = interfaceSettings
  if (Object.keys(compaction).length) migrated.compaction = compaction
  if (typeof raw.model === 'string') migrated.model = { default: raw.model }
  return migrated
}

/**
 * Recomputes the effective allow/deny/suppress lists level by level so that a `suppress` rule
 * removes an `allow` rule granted by an earlier level; later levels may still re-allow it.
 */
function applyPermissionSuppressions(levels: DeepSeekSettings[], effective: DeepSeekSettings): void {
  let allow: string[] = []
  let deny: string[] = []
  const suppress: string[] = []
  for (const level of levels) {
    const permissions = level.permissions
    if (!isObject(permissions)) continue
    for (const rule of Array.isArray(permissions.suppress) ? permissions.suppress.filter((value): value is string => typeof value === 'string') : []) {
      allow = allow.filter(candidate => candidate !== rule)
      if (!suppress.includes(rule)) suppress.push(rule)
    }
    for (const rule of Array.isArray(permissions.allow) ? permissions.allow.filter((value): value is string => typeof value === 'string') : []) if (!allow.includes(rule)) allow.push(rule)
    for (const rule of Array.isArray(permissions.deny) ? permissions.deny.filter((value): value is string => typeof value === 'string') : []) if (!deny.includes(rule)) deny.push(rule)
  }
  effective.permissions = { ...(isObject(effective.permissions) ? effective.permissions : {}), allow, deny, suppress }
}

/** Deterministic short hook id derived from its position and command, so hooks without an explicit id keep the same id across reloads. */
function stableHookId(parts: unknown[]): string {
  return `hook-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 12)}`
}

/** Drops malformed hook entries in place and fills in missing `id` and `enabled` (default true) for matcher-based and plain command hook events. */
function normalizeHooks(settings: DeepSeekSettings): void {
  if (!isObject(settings.hooks)) { settings.hooks = undefined; return }
  for (const event of ['PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStart', 'SubagentStop',
    'SessionStart', 'Setup', 'SessionEnd', 'PreCompact', 'PostCompact',
    'InstructionsLoaded', 'UserPromptExpansion', 'PostToolUseFailure', 'PermissionDenied', 'Notification',
    'StopFailure', 'ConfigChange', 'DirectoryAdded', 'FileChanged', 'Elicitation', 'ElicitationResult'] as const) {
    const matchers = settings.hooks[event]
    settings.hooks[event] = Array.isArray(matchers) ? matchers.flatMap((matcher, matcherIndex) => {
      if (!isObject(matcher) || typeof matcher.matcher !== 'string' || !Array.isArray(matcher.hooks)) return []
      return [{
        ...matcher,
        id: typeof matcher.id === 'string' ? matcher.id : stableHookId([event, matcher.matcher, matcherIndex]),
        enabled: typeof matcher.enabled === 'boolean' ? matcher.enabled : true,
        hooks: matcher.hooks.flatMap((hook, hookIndex) => !isObject(hook) || typeof hook.command !== 'string' ? [] : [{
          ...hook,
          id: typeof hook.id === 'string' ? hook.id : stableHookId([event, matcher.matcher, hook.command, hookIndex]),
          enabled: typeof hook.enabled === 'boolean' ? hook.enabled : true,
        }]),
      }]
    }) : undefined
  }
  for (const event of ['UserPromptSubmit', 'Stop',
    'MessageDisplay', 'PostToolBatch', 'TaskCreated', 'TaskCompleted', 'TeammateIdle', 'CwdChanged',
    'WorktreeCreate', 'WorktreeRemove'] as const) {
    const commands = settings.hooks[event]
    settings.hooks[event] = Array.isArray(commands) ? commands.flatMap((hook, index) =>
      !isObject(hook) || typeof hook.command !== 'string' ? [] : [{
        ...hook,
        id: typeof hook.id === 'string' ? hook.id : stableHookId([event, hook.command, index]),
        enabled: typeof hook.enabled === 'boolean' ? hook.enabled : true,
      }]
    ) : undefined
  }
}

/** Reads preference keys (THEME, MODEL, PROVIDER, ...) from the legacy `~/.deepseek/config.json` as the lowest-priority settings layer; any failure yields `{}`. */
async function loadLegacyPreferences(): Promise<DeepSeekSettings> {
  try {
    const raw = JSON.parse(await readFile(join(homedir(), '.deepseek', 'config.json'), 'utf8')) as Record<string, unknown>
    const legacy: DeepSeekSettings = {}
    if (typeof raw.THEME === 'string') legacy.interface = { ...legacy.interface, theme: raw.THEME as never }
    if (typeof raw.LANGUAGE === 'string') legacy.interface = { ...legacy.interface, language: raw.LANGUAGE }
    if (raw.ENCHANT === 'true' || raw.ENCHANT === 'false') legacy.promptRefiner = { enabled: raw.ENCHANT === 'true' }
    if (typeof raw.MODEL === 'string') legacy.model = { default: raw.MODEL }
    if (typeof raw.PROVIDER === 'string') {
      legacy.provider = {
        name: raw.PROVIDER as never,
        endpoint: typeof raw.DEEPSEEK_BASE_URL === 'string' ? raw.DEEPSEEK_BASE_URL : typeof raw.LOCAL_BASE_URL === 'string' ? raw.LOCAL_BASE_URL : undefined,
        region: typeof raw.AWS_REGION === 'string' ? raw.AWS_REGION : undefined,
        profile: typeof raw.AWS_PROFILE === 'string' ? raw.AWS_PROFILE : undefined,
        projectId: typeof raw.GCP_PROJECT === 'string' ? raw.GCP_PROJECT : undefined,
        location: typeof raw.GCP_LOCATION === 'string' ? raw.GCP_LOCATION : undefined,
      }
    }
    return legacy
  } catch {
    return {}
  }
}

/** File path of a settings level: user `~/.deepseek/settings.json`, project `.deepseek/settings.json`, local `.deepseek/settings.local.json`. */
export function getSettingsPath(level: SettingsLevel, cwd = process.cwd()): string {
  if (level === 'user') return join(homedir(), '.deepseek', 'settings.json')
  if (level === 'project') return join(cwd, '.deepseek', 'settings.json')
  return join(cwd, '.deepseek', 'settings.local.json')
}

/** Path of the private config file that holds credentials (`~/.deepseek/config.json`), kept out of the settings files. */
export function getCredentialsPath(): string {
  return join(homedir(), '.deepseek', 'config.json')
}

/** Loads one settings level; a missing file is empty data, while unreadable or non-object JSON is reported via `error` instead of throwing. */
async function readLevel(level: SettingsLevel, cwd?: string) {
  const path = getSettingsPath(level, cwd)
  try {
    const data = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isObject(data)) throw new Error('The root value must be a JSON object')
    return { level, path, data: data as DeepSeekSettings }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { level, path, data: {} }
    return { level, path, data: {}, error: (error as Error).message }
  }
}

/** Maps every leaf setting path to the highest-priority level that defines it. */
function collectOrigins(
  levels: SettingsSnapshot['levels'],
  prefix = '',
  result: Record<string, SettingOrigin> = {},
): Record<string, SettingOrigin> {
  for (const level of LEVELS) {
    const walk = (value: unknown, path: string) => {
      if (isObject(value)) {
        for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key)
      } else {
        result[path] = level
      }
    }
    walk(levels[level].data, prefix)
  }
  return result
}

/** Validates one level's raw settings and returns errors plus scope warnings (e.g. options that are ignored outside User scope). */
export function validateSettings(settings: DeepSeekSettings, level?: SettingsLevel): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (path: string, message: string, severity: 'error' | 'warning' = 'error') => issues.push({ path, level, message, severity })
  const validateKeybindings = (value: unknown, path: string) => {
    if (!isObject(value)) { add(path, 'Must be an object'); return }
    for (const [action, binding] of Object.entries(value)) {
      if (binding === null) continue
      if (typeof binding === 'string' && binding.trim()) continue
      if (Array.isArray(binding) && binding.length > 0 && binding.every(item => typeof item === 'string' && item.trim())) continue
      add(`${path}.${action}`, 'Must be a non-empty key string, a non-empty array of key strings, or null')
    }
  }
  const budget = settings.budget as unknown
  if (budget !== undefined && !isBudgetLevel(budget)) add('budget', `Must be one of ${BUDGET_LEVELS.join(', ')}`)
  const threshold = settings.compaction?.threshold
  if (threshold !== undefined && (typeof threshold !== 'number' || threshold < 0.7 || threshold > 0.95)) add('compaction.threshold', 'Must be between 0.70 and 0.95')
  const concurrency = settings.agents?.concurrency
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)) add('agents.concurrency', 'Must be an integer from 1 to 16')
  const retention = settings.sessions?.retention
  if (retention !== undefined && (!Number.isInteger(retention) || retention < 1)) add('sessions.retention', 'Must be a positive integer')
  const workflows = settings.workflows as unknown
  if (workflows !== undefined && !isObject(workflows)) add('workflows', 'Must be an object')
  else if (isObject(workflows) && workflows.enabled !== undefined && typeof workflows.enabled !== 'boolean') add('workflows.enabled', 'Must be a boolean')
  const minimum = settings.promptRefiner?.minimumLength
  if (minimum !== undefined && (!Number.isInteger(minimum) || minimum < 1)) add('promptRefiner.minimumLength', 'Must be a positive integer')
  const timeout = settings.provider?.timeoutMs
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 100)) add('provider.timeoutMs', 'Must be at least 100 milliseconds')
  if (settings.provider?.activeProfileId !== undefined && (typeof settings.provider.activeProfileId !== 'string' || !settings.provider.activeProfileId.trim())) add('provider.activeProfileId', 'Must be a non-empty profile id')
  const largeLines = settings.risk?.thresholds?.largeFileLines
  if (largeLines !== undefined && (!Number.isInteger(largeLines) || largeLines < 1)) add('risk.thresholds.largeFileLines', 'Must be a positive integer')
  const burstCount = settings.risk?.thresholds?.burstCount
  if (burstCount !== undefined && (!Number.isInteger(burstCount) || burstCount < 1)) add('risk.thresholds.burstCount', 'Must be a positive integer')
  const permissions = settings.permissions as unknown
  if (permissions !== undefined && !isObject(permissions)) add('permissions', 'Must be an object')
  if (isObject(permissions)) for (const kind of ['allow', 'deny', 'suppress'] as const) {
    const rules = permissions[kind]
    if (rules !== undefined && !Array.isArray(rules)) { add(`permissions.${kind}`, 'Must be an array'); continue }
    for (const [index, rule] of (rules ?? []).entries()) {
      if (typeof rule !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(?:\(.+\))?$/.test(rule)) add(`permissions.${kind}.${index}`, `Invalid permission rule: ${String(rule)}`)
    }
  }
  const hookIds = new Set<string>()
  const validateHook = (hook: unknown, path: string) => {
    if (!isObject(hook)) { add(path, 'Must be a hook object'); return }
    if (typeof hook.command !== 'string' || !hook.command.trim()) add(`${path}.command`, 'Hook command cannot be empty')
    if (hook.timeout !== undefined && (typeof hook.timeout !== 'number' || !Number.isFinite(hook.timeout) || hook.timeout <= 0)) add(`${path}.timeout`, 'Hook timeout must be positive')
    if (hook.id !== undefined && typeof hook.id !== 'string') add(`${path}.id`, 'Hook id must be a string')
    if (typeof hook.id === 'string' && hookIds.has(hook.id)) add(`${path}.id`, `Duplicate hook id: ${hook.id}`)
    if (typeof hook.id === 'string') hookIds.add(hook.id)
  }
  const hooks = settings.hooks as unknown
  if (hooks !== undefined && !isObject(hooks)) add('hooks', 'Must be an object')
  if (isObject(hooks)) {
    for (const event of ['PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStart', 'SubagentStop',
      'SessionStart', 'Setup', 'SessionEnd', 'PreCompact', 'PostCompact',
      'InstructionsLoaded', 'UserPromptExpansion', 'PostToolUseFailure', 'PermissionDenied', 'Notification',
      'StopFailure', 'ConfigChange', 'DirectoryAdded', 'FileChanged', 'Elicitation', 'ElicitationResult'] as const) {
      const matchers = hooks[event]
      if (matchers !== undefined && !Array.isArray(matchers)) { add(`hooks.${event}`, 'Must be an array'); continue }
      for (const [matcherIndex, matcher] of (matchers ?? []).entries()) {
        const matcherPath = `hooks.${event}.${matcherIndex}`
        if (!isObject(matcher)) { add(matcherPath, 'Must be a matcher object'); continue }
        if (typeof matcher.matcher !== 'string') add(`${matcherPath}.matcher`, 'Matcher must be a string')
        if (!Array.isArray(matcher.hooks)) { add(`${matcherPath}.hooks`, 'Must be an array'); continue }
        matcher.hooks.forEach((hook, hookIndex) => validateHook(hook, `${matcherPath}.hooks.${hookIndex}`))
      }
    }
    for (const event of ['UserPromptSubmit', 'Stop',
      'MessageDisplay', 'PostToolBatch', 'TaskCreated', 'TaskCompleted', 'TeammateIdle', 'CwdChanged',
      'WorktreeCreate', 'WorktreeRemove'] as const) {
      const commands = hooks[event]
      if (commands !== undefined && !Array.isArray(commands)) add(`hooks.${event}`, 'Must be an array')
      else (commands ?? []).forEach((hook, index) => validateHook(hook, `hooks.${event}.${index}`))
    }
  }
  const lsp = settings.lsp as unknown
  if (lsp !== undefined && !isObject(lsp)) add('lsp', 'Must be an object')
  if (isObject(lsp)) {
    if (lsp.timeoutMs !== undefined && (typeof lsp.timeoutMs !== 'number' || !Number.isFinite(lsp.timeoutMs) || lsp.timeoutMs < 100 || lsp.timeoutMs > 60_000)) add('lsp.timeoutMs', 'Must be between 100 and 60000 milliseconds')
    if (lsp.servers !== undefined && !Array.isArray(lsp.servers)) add('lsp.servers', 'Must be an array')
    for (const [index, server] of (Array.isArray(lsp.servers) ? lsp.servers : []).entries()) {
      const path = `lsp.servers.${index}`
      if (!isObject(server)) { add(path, 'Must be a server object'); continue }
      if (typeof server.name !== 'string' || !server.name.trim()) add(`${path}.name`, 'Name cannot be empty')
      if (typeof server.command !== 'string' || !server.command.trim()) add(`${path}.command`, 'Command cannot be empty')
      if (!Array.isArray(server.extensions) || server.extensions.some(extension => typeof extension !== 'string' || !extension.startsWith('.'))) add(`${path}.extensions`, 'Must be extensions beginning with a dot')
      if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some(arg => typeof arg !== 'string'))) add(`${path}.args`, 'Must be an array of strings')
      if (server.languageId !== undefined && typeof server.languageId !== 'string') add(`${path}.languageId`, 'Must be a string')
    }
  }
  const mcp = settings.mcp as unknown
  if (mcp !== undefined && !isObject(mcp)) add('mcp', 'Must be an object')
  if (isObject(mcp) && mcp.enabled !== undefined && typeof mcp.enabled !== 'boolean') add('mcp.enabled', 'Must be a boolean')
  const interfaceSettings = settings.interface as unknown
  if (isObject(interfaceSettings)) {
    const statusLine = interfaceSettings.subagentStatusLine
    if (statusLine !== undefined) {
      if (!isObject(statusLine)) add('interface.subagentStatusLine', 'Must be an object')
      else {
        if (statusLine.type !== 'command') add('interface.subagentStatusLine.type', 'Must be command')
        if (typeof statusLine.command !== 'string' || !statusLine.command.trim()) add('interface.subagentStatusLine.command', 'Command cannot be empty')
      }
    }
  }
  if (settings.keybindings !== undefined) validateKeybindings(settings.keybindings, 'keybindings')
  if (isObject(settings.interface) && settings.interface.keybindings !== undefined) {
    validateKeybindings(settings.interface.keybindings, 'interface.keybindings')
  }
  if (level === 'project') {
    for (const field of ['name', 'endpoint', 'region', 'profile', 'projectId', 'location'] as const) {
      if (settings.provider?.[field] !== undefined) add(`provider.${field}`, `Project provider.${field} is ignored; configure it at User or Local scope`, 'warning')
    }
    if (Array.isArray(settings.permissions?.allow) && settings.permissions.allow.length > 0) {
      add('permissions.allow', 'Project allow rules are ignored; configure trusted allow rules at User or Local scope', 'warning')
    }
  }
  if (level !== undefined && level !== 'user' && settings.provider?.activeProfileId !== undefined) {
    add('provider.activeProfileId', 'Provider profiles are user-scoped; this value is ignored outside User scope', 'warning')
  }
  if (level !== 'user' && settings.interaction?.defaultMode === 'auto') add('interaction.defaultMode', 'Auto can only be selected at User scope')
  if (level !== 'user' && settings.hooks && Object.keys(settings.hooks).length > 0) add('hooks', 'Executable hooks are ignored outside User scope', 'warning')
  if (level !== 'user' && settings.lsp && Object.keys(settings.lsp).length > 0) add('lsp', 'Language-server commands are ignored outside User scope', 'warning')
  if (level !== 'user' && settings.mcp && Object.keys(settings.mcp).length > 0) add('mcp', 'Project MCP servers can only be enabled at User scope', 'warning')
  if (level !== 'user' && isObject(interfaceSettings) && interfaceSettings.subagentStatusLine !== undefined) {
    add('interface.subagentStatusLine', 'Executable status-line commands are ignored outside User scope', 'warning')
  }
  if (settings.git?.branchPattern !== undefined && !settings.git.branchPattern.includes('{shortId}')) add('git.branchPattern', 'Include {shortId} to keep branch names unique', 'warning')
  return issues
}

/**
 * Loads all levels and builds the effective settings: defaults, then the budget profile, then legacy, user,
 * project and local data. Project and local levels are sanitised first so a checked-out repo cannot add
 * hooks, LSP/MCP servers, status-line commands, provider routing, permission grants or auto mode.
 */
export async function loadSettingsSnapshot(cwd?: string): Promise<SettingsSnapshot> {
  const loaded = await Promise.all(LEVELS.map(level => readLevel(level, cwd)))
  const levels = Object.fromEntries(loaded.map(item => [item.level, item])) as SettingsSnapshot['levels']
  const legacy = await loadLegacyPreferences()
  const safeScopedLevel = (data: DeepSeekSettings, level: SettingsLevel): DeepSeekSettings => {
    const safe = clone(data)
    safe.hooks = undefined
    safe.lsp = undefined
    safe.mcp = undefined
    // A checked-out project must never be able to introduce an executable
    // status-line command. Keep the setting available in its scope snapshot
    // for diagnostics, but only merge the user-scoped value into effective
    // runtime settings.
    if (level !== 'user' && safe.interface?.subagentStatusLine !== undefined) {
      delete safe.interface.subagentStatusLine
      if (Object.keys(safe.interface).length === 0) delete safe.interface
    }
    if (level === 'project' && safe.provider) {
      // A checked-out project must not choose provider routing used with
      // credentials loaded from the user's private config.
      const timeoutMs = safe.provider.timeoutMs
      safe.provider = timeoutMs === undefined ? undefined : { timeoutMs }
      if (!safe.provider) delete safe.provider
    }
    if (level === 'local' && safe.provider?.activeProfileId !== undefined) {
      delete safe.provider.activeProfileId
      if (Object.keys(safe.provider).length === 0) delete safe.provider
    }
    if (level === 'project' && safe.permissions) {
      // A checked-out project may deny capabilities, but cannot grant them.
      delete safe.permissions.allow
      if (Object.keys(safe.permissions).length === 0) delete safe.permissions
    }
    if (safe.interaction?.defaultMode === 'auto') delete safe.interaction.defaultMode
    return safe
  }
  const safeProject = safeScopedLevel(levels.project.data, 'project')
  const safeLocal = safeScopedLevel(levels.local.data, 'local')
  const mergeLevels = [legacy, levels.user.data, safeProject, safeLocal]
  // The budget level is resolved first so its profile can be laid down
  // between the defaults and the user's files. Underneath, never on top:
  // a limit someone wrote by hand outranks a mood setting, and picking
  // "I'm broke" must not quietly discard it.
  const chosenBudget = mergeSettings(DEFAULT_SETTINGS, ...mergeLevels).budget
  const budgetLayer = budgetProfile(isBudgetLevel(chosenBudget) ? chosenBudget : undefined).settings
  const effective = legacyCompatibility(mergeSettings(DEFAULT_SETTINGS, budgetLayer, ...mergeLevels))
  applyPermissionSuppressions(mergeLevels, effective)
  normalizeHooks(effective)
  const origins = collectOrigins(levels)
  const issues: ValidationIssue[] = []
  for (const item of loaded) {
    if (item.error) issues.push({ path: '', level: item.level, severity: 'error', message: item.error })
    issues.push(...validateSettings(item.data, item.level))
  }
  const unknownPaths = [...new Set(loaded.flatMap(item => Object.keys(item.data).filter(key => !KNOWN_TOP_LEVEL.has(key))))]
  return { effective, legacy, levels, origins, issues, unknownPaths, loadedAt: new Date().toISOString() }
}

/** Writes settings JSON with mode 0600 through a temp file and rename, so readers never see a partial file. */
async function atomicWrite(path: string, data: DeepSeekSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Read-modify-write of one level: refuses invalid existing JSON, validates the result, writes atomically and returns a fresh snapshot. */
async function mutateLevel(level: SettingsLevel, cwd: string | undefined, mutation: (data: Record<string, unknown>) => void): Promise<SettingsSnapshot> {
  const current = await readLevel(level, cwd)
  if (current.error) throw new Error(`Cannot update invalid JSON at ${current.path}: ${current.error}`)
  const next = clone(current.data) as Record<string, unknown>
  mutation(next)
  const issues = validateSettings(next as DeepSeekSettings, level).filter(issue => issue.severity === 'error')
  if (issues.length) throw new Error(issues.map(issue => `${issue.path}: ${issue.message}`).join('; '))
  await atomicWrite(current.path, next as DeepSeekSettings)
  return loadSettingsSnapshot(cwd)
}

/** Sets one dot-path value at a level; rejects anything that looks like a secret. */
export async function setSetting(level: SettingsLevel, path: string, value: unknown, cwd?: string): Promise<SettingsSnapshot> {
  assertNoSecrets(path, value)
  return mutateLevel(level, cwd, data => setAtPath(data, path, value))
}

const SECRET_NAME = /api.?key|token|secret|credential|password/i

/** Recursively checks whether any object key in the value looks like a secret name. */
function containsSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretKey)
  if (!isObject(value)) return false
  return Object.entries(value).some(([key, child]) => SECRET_NAME.test(key) || containsSecretKey(child))
}

/** Throws when a path or value looks like a secret, since secrets belong in the private config file, not in settings. */
function assertNoSecrets(path: string, value: unknown): void {
  if (SECRET_NAME.test(path) || containsSecretKey(value)) throw new Error('Secrets must be stored in ~/.deepseek/config.json')
}

/** Sets several dot-path values at a level in one atomic write; rejects secrets. */
export async function setSettings(level: SettingsLevel, entries: Array<[string, unknown]>, cwd?: string): Promise<SettingsSnapshot> {
  for (const [path, value] of entries) assertNoSecrets(path, value)
  return mutateLevel(level, cwd, data => {
    for (const [path, value] of entries) setAtPath(data, path, value)
  })
}

/** Removes one dot-path value from a level, pruning parents left empty. */
export async function unsetSetting(level: SettingsLevel, path: string, cwd?: string): Promise<SettingsSnapshot> {
  return mutateLevel(level, cwd, data => unsetAtPath(data, path))
}

/** Clears a single path, or empties the whole level file when no path is given. */
export async function resetSettings(level: SettingsLevel, path?: string, cwd?: string): Promise<SettingsSnapshot> {
  if (path) return unsetSetting(level, path, cwd)
  const current = await readLevel(level, cwd)
  if (current.error) throw new Error(`Cannot reset invalid JSON at ${current.path}: ${current.error}`)
  await atomicWrite(current.path, {})
  return loadSettingsSnapshot(cwd)
}

/** Explains a setting: its effective value, the level it comes from and each level's override, omitting values that level is not allowed to set. */
export function resolveSetting(snapshot: SettingsSnapshot, path: string): SettingResolution {
  const legacyValue = getAtPath(snapshot.legacy, path)
  const overrides: SettingResolution['overrides'] = [
    ...(legacyValue === undefined ? [] : [{ level: 'legacy' as const, value: legacyValue }]),
    ...LEVELS.flatMap(level => {
    const value = getAtPath(snapshot.levels[level].data, path)
    if (level !== 'user' && path === 'interaction.defaultMode' && value === 'auto') return []
    if ((level === 'project' && /^provider\.(name|endpoint|region|profile|projectId|location)$/.test(path)) ||
      (level !== 'user' && path === 'provider.activeProfileId')) return []
    if (level === 'project' && path === 'permissions.allow') return []
    if (level !== 'user' && (path.startsWith('hooks.') || path === 'lsp' || path.startsWith('lsp.') || path === 'mcp' || path.startsWith('mcp.'))) return []
    if (level !== 'user' && (path === 'interface.subagentStatusLine' || path.startsWith('interface.subagentStatusLine.'))) return []
    return value === undefined ? [] : [{ level, value }]
    }),
  ]
  const value = getAtPath(snapshot.effective, path)
  const origin = overrides.at(-1)?.level ?? 'default'
  return { path, value, origin, overrides }
}

/** Recursively drops keys that look like secrets so exports are safe to share. */
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets)
  if (!isObject(value)) return value
  const clean: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (/key|token|secret|credential|password/i.test(key)) continue
    clean[key] = stripSecrets(child)
  }
  return clean
}

/** Builds a versioned, secret-free export of the effective settings plus optional memory and sessions data. */
export function createSettingsExport(snapshot: SettingsSnapshot, extra: Pick<SettingsExport, 'memory' | 'sessions'> = {}): SettingsExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: stripSecrets(snapshot.effective) as DeepSeekSettings,
    ...(extra.memory === undefined ? {} : { memory: stripSecrets(extra.memory) }),
    ...(extra.sessions === undefined ? {} : { sessions: stripSecrets(extra.sessions) }),
  }
}

/** Settings access bound to one working directory that caches the latest snapshot after every load or write. */
export class SettingsRepository {
  private snapshot?: SettingsSnapshot
  constructor(private readonly cwd = process.cwd()) {}
  async reload(): Promise<SettingsSnapshot> { this.snapshot = await loadSettingsSnapshot(this.cwd); return this.snapshot }
  async getSnapshot(): Promise<SettingsSnapshot> { return this.snapshot ?? this.reload() }
  async set(level: SettingsLevel, path: string, value: unknown): Promise<SettingsSnapshot> { this.snapshot = await setSetting(level, path, value, this.cwd); return this.snapshot }
  async setMany(level: SettingsLevel, entries: Array<[string, unknown]>): Promise<SettingsSnapshot> { this.snapshot = await setSettings(level, entries, this.cwd); return this.snapshot }
  async unset(level: SettingsLevel, path: string): Promise<SettingsSnapshot> { this.snapshot = await unsetSetting(level, path, this.cwd); return this.snapshot }
  async reset(level: SettingsLevel, path?: string): Promise<SettingsSnapshot> { this.snapshot = await resetSettings(level, path, this.cwd); return this.snapshot }
  async export(extra?: Pick<SettingsExport, 'memory' | 'sessions'>): Promise<SettingsExport> { return createSettingsExport(await this.getSnapshot(), extra) }
}
