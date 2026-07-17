import { randomUUID } from 'crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { homedir } from 'os'
import type { Model } from '../commands.js'
import type { SettingsLevel } from '../settings/types.js'
import { loadMergedSettings } from '../settings/loader.js'
import { FIXED_AGENTS } from '../tools/SubAgent/fixedAgents.js'
import type { SubAgentRole } from '../tools/SubAgent/permissions.js'
import { globFiles } from '../utils/fs.js'

export type AgentUsage = 'primary' | 'subagent' | 'both'
export type AgentSource = 'builtin' | 'user' | 'additional' | 'project' | 'local'

export interface AgentPermissionConfig {
  policy?: 'inherit' | 'isolated'
  allow?: string[]
  deny?: string[]
}

export interface AgentConfig {
  name: string
  description?: string
  usage?: AgentUsage
  role?: SubAgentRole
  enabled?: boolean
  model?: Model
  systemPrompt: string
  files?: string[]
  color?: string
  tools?: string[] | '*'
  permissions?: AgentPermissionConfig
  extends?: string
  /** Legacy alias retained for old agent JSON files. */
  allowedTools?: string[] | '*'
}

interface StoredAgentConfig extends Omit<Partial<AgentConfig>, 'name'> {
  name: string
}

export interface LoadedAgent {
  config: AgentConfig
  source: 'local' | 'global' | 'builtin' | 'additional'
  origin: AgentSource
  path?: string
  overridden?: boolean
}

interface AgentLayer {
  source: AgentSource
  legacySource: LoadedAgent['source']
  directory?: string
}

function directories(additional: string[] = [], cwd = process.cwd()): AgentLayer[] {
  return [
    { source: 'builtin', legacySource: 'builtin' },
    { source: 'user', legacySource: 'global', directory: join(homedir(), '.deepseek', 'agents') },
    ...additional.map(directory => ({ source: 'additional' as const, legacySource: 'additional' as const, directory })),
    { source: 'project', legacySource: 'local', directory: join(cwd, '.deepseek', 'agents') },
    { source: 'local', legacySource: 'local', directory: join(cwd, '.deepseek', 'agents.local') },
  ]
}

function builtins(): Map<string, StoredAgentConfig> {
  return new Map(Object.values(FIXED_AGENTS).map(def => [def.name, {
    name: def.name,
    description: def.displayName,
    usage: 'both',
    role: def.role,
    enabled: true,
    systemPrompt: def.systemPrompt,
    extends: `builtin:${def.name}`,
  }]))
}

function validName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)
}

async function readStored(path: string): Promise<StoredAgentConfig | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as StoredAgentConfig
    if (!value || typeof value.name !== 'string' || !validName(value.name)) return null
    if (typeof value.systemPrompt !== 'string' && typeof value.extends !== 'string') return null
    return value
  } catch {
    return null
  }
}

function mergeAgent(base: StoredAgentConfig | undefined, override: StoredAgentConfig): StoredAgentConfig {
  return {
    ...base,
    ...override,
    permissions: { ...base?.permissions, ...override.permissions },
    name: override.name,
  }
}

export async function loadAgentRegistry(cwd = process.cwd()): Promise<LoadedAgent[]> {
  const settings = await loadMergedSettings(cwd)
  const layers = directories(settings.agents?.additionalDirectories, cwd)
  const builtinDefinitions = builtins()
  const resolved = new Map<string, { raw: StoredAgentConfig; layer: AgentLayer; path?: string; overridden: boolean }>()

  for (const [name, raw] of builtinDefinitions) {
    resolved.set(name, { raw, layer: layers[0]!, overridden: false })
  }

  for (const layer of layers.slice(1)) {
    const pending = new Map<string, { raw: StoredAgentConfig; path: string }>()
    for (const file of await globFiles(/\.json$/, layer.directory!)) {
      const path = join(layer.directory!, file)
      const raw = await readStored(path)
      if (!raw) continue
      pending.set(raw.name, { raw, path })
    }

    const layerResolved = new Map<string, { raw: StoredAgentConfig; layer: AgentLayer; path: string; overridden: boolean }>()
    const resolving = new Set<string>()
    const resolve = (name: string): { raw: StoredAgentConfig; layer: AgentLayer; path: string; overridden: boolean } => {
      const cached = layerResolved.get(name)
      if (cached) return cached
      const entry = pending.get(name)
      if (!entry) throw new Error(`Agent '${name}' is missing from the current layer.`)
      if (resolving.has(name)) throw new Error(`Agent inheritance cycle: ${[...resolving, name].join(' -> ')}`)
      resolving.add(name)
      const previous = resolved.get(name)
      let base = previous?.raw
      if (entry.raw.extends?.startsWith('builtin:')) {
        const baseName = entry.raw.extends.slice('builtin:'.length)
        base = builtinDefinitions.get(baseName)
        if (!base) throw new Error(`Agent '${name}' extends missing builtin '${baseName}'.`)
      } else if (entry.raw.extends) {
        base = pending.has(entry.raw.extends)
          ? resolve(entry.raw.extends).raw
          : resolved.get(entry.raw.extends)?.raw
        if (!base) throw new Error(`Agent '${name}' extends missing agent '${entry.raw.extends}'.`)
      }
      const value = { raw: mergeAgent(base, entry.raw), layer, path: entry.path, overridden: Boolean(previous) }
      resolving.delete(name)
      layerResolved.set(name, value)
      return value
    }
    for (const name of pending.keys()) resolved.set(name, resolve(name))
  }

  const disabled = new Set(settings.agents?.disabledBuiltins ?? [])
  const results: LoadedAgent[] = []
  for (const [name, entry] of resolved) {
    const raw = entry.raw
    if (entry.layer.source === 'builtin' && disabled.has(name)) raw.enabled = false
    if (typeof raw.systemPrompt !== 'string') continue
    results.push({
      config: {
        ...raw,
        usage: raw.usage ?? 'primary',
        enabled: raw.enabled ?? true,
        systemPrompt: raw.systemPrompt,
        tools: raw.tools ?? raw.allowedTools,
      },
      source: entry.layer.legacySource,
      origin: entry.layer.source,
      path: entry.path,
      overridden: entry.overridden,
    })
  }
  return results.sort((a, b) => a.config.name.localeCompare(b.config.name))
}

export async function loadAgentConfig(name: string): Promise<LoadedAgent> {
  const agent = (await loadAgentRegistry()).find(candidate => candidate.config.name === name && candidate.config.enabled !== false)
  if (!agent) throw new Error(`Agent '${name}' was not found or is disabled.`)
  return agent
}

export async function listAgents(): Promise<Array<{ name: string; source: LoadedAgent['source']; origin: AgentSource; usage: AgentUsage; enabled: boolean }>> {
  return (await loadAgentRegistry()).map(agent => ({
    name: agent.config.name,
    source: agent.source,
    origin: agent.origin,
    usage: agent.config.usage ?? 'primary',
    enabled: agent.config.enabled !== false,
  }))
}

function directoryForLevel(level: SettingsLevel): string {
  if (level === 'user') return join(homedir(), '.deepseek', 'agents')
  if (level === 'project') return join(process.cwd(), '.deepseek', 'agents')
  return join(process.cwd(), '.deepseek', 'agents.local')
}

export function getAgentConfigPath(level: SettingsLevel, name: string): string {
  return join(directoryForLevel(level), `${name}.json`)
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, path)
}

export async function saveAgentConfig(level: SettingsLevel, config: StoredAgentConfig): Promise<void> {
  if (!validName(config.name)) throw new Error('Agent names may contain letters, numbers, underscore and dash')
  if (typeof config.systemPrompt !== 'string' && typeof config.extends !== 'string') throw new Error('An agent needs systemPrompt or extends')
  await atomicWrite(join(directoryForLevel(level), `${config.name}.json`), config)
}

export async function deleteAgentConfig(level: SettingsLevel, name: string): Promise<void> {
  if (!validName(name)) throw new Error('Invalid agent name')
  await rm(join(directoryForLevel(level), `${name}.json`), { force: true })
}

export async function duplicateAgent(sourceName: string, targetName: string, level: SettingsLevel): Promise<void> {
  const source = await loadAgentConfig(sourceName)
  await saveAgentConfig(level, { ...source.config, name: targetName, extends: undefined, enabled: true })
}

export async function resetAgentOverride(level: SettingsLevel, name: string): Promise<void> {
  await deleteAgentConfig(level, name)
}

export function composeSubAgentPrompt(config: AgentConfig, basePrompt: string, task: string, memoryContext: string): string {
  const memory = memoryContext ? `\n\n## Memory / Prior Context\n${memoryContext}` : ''
  return `${basePrompt.trim()}\n\n${config.systemPrompt.trim()}${memory}\n\n## Working Directory\n${process.cwd()}\n\n## Task\n${task}\n\n## Protected executor protocol (not editable)\nAfter completing the task, end with one JSON code block containing: summary, confidence (0-1), filesRead, filesChanged, issuesFound, suggestions and metadata.`
}
