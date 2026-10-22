import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { formatContextLimit } from './cost.js'
import { updateFullConfig } from '../utils/credentials.js'

const CONFIG_PATH = join(homedir(), '.deepseek', 'config.json')
const DESCRIPTION_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// Auto-format: 'deepseek-flash' → 'DeepSeek Flash'
// Preserves "DeepSeek" branding (capital S) while formatting other segments normally
export function formatModelLabel(id: string): string {
  return id
    .split('-')
    .map((word) => {
      const formatted = word.charAt(0).toUpperCase() + word.slice(1)
      return formatted === 'Deepseek' ? 'DeepSeek' : formatted
    })
    .join(' ')
}

// Suffix patterns — catches any model variant (v4, v4.1, v5, etc.)
const PATTERN_DESCRIPTIONS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /-pro$/, description: '1M context window · Best for complex reasoning & coding' },
  { pattern: /-flash$/, description: '1M context window · Fast & efficient for everyday tasks' },
  { pattern: /-reasoner$/, description: '1M context window · Advanced reasoning with chain-of-thought' },
]

// Official OpenAI model catalog, checked before asking an LLM to research a new ID.
const CATALOG_DESCRIPTIONS: Record<string, string> = {
  'deepseek-flash': '1M context window · Native visual understanding · Fast & efficient for everyday tasks',
  'gpt-6-astra': 'Most capable model for complex reasoning, coding, research, and professional work',
  'gpt-5.6-sol': 'Flagship model for complex professional work',
  'gpt-5.6-terra': 'Balances intelligence and cost for professional workloads',
  'gpt-5.6-luna': 'Lowest-cost GPT-5.6 model for high-volume workloads',
  'gpt-daybreak-blue-latest': 'Flagship general-purpose model with defensive cybersecurity safeguards',
  'gpt-5.5': 'Flagship model for complex coding and professional work',
  'gpt-5.4-mini': 'Fast, efficient model for coding, computer use, and subagents',
}

/** Looks up a built-in description for a model id (provider prefix stripped): exact catalog match first, then suffix patterns. */
export function getKnownDescription(id: string): string {
  const modelId = id.split('/').pop() ?? id
  return CATALOG_DESCRIPTIONS[modelId] ?? PATTERN_DESCRIPTIONS.find((p) => p.pattern.test(modelId))?.description ?? ''
}

/** Reads ~/.deepseek/config.json synchronously, returning an empty object when it is missing or corrupt. */
function loadConfig(): Record<string, any> {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    /* ignore corrupt config */
  }
  return {}
}

/** Legacy entries and descriptions whose research is more than 30 days old are refreshed. */
export function isCachedDescriptionFresh(updatedAt: unknown, now = Date.now()): boolean {
  if (typeof updatedAt !== 'string') return false
  const timestamp = Date.parse(updatedAt)
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < DESCRIPTION_CACHE_MAX_AGE_MS
}

/** Returns cached model descriptions that are non-generic and backed by an http(s) source URL. */
function loadCachedDescriptions(): Record<string, string> {
  const config = loadConfig()
  const descriptions = config.modelDescriptions as Record<string, unknown> | undefined
  const sources = config.modelDescriptionSources as Record<string, unknown> | undefined
  const updatedAt = config.modelDescriptionUpdatedAt as Record<string, unknown> | undefined
  return Object.fromEntries(
    Object.entries(descriptions ?? {}).filter(([id, value]) =>
      typeof value === 'string' && !isGenericModelDescription(value) && typeof sources?.[id] === 'string' && /^https?:\/\//.test(sources[id] as string) && isCachedDescriptionFresh(updatedAt?.[id]),
    ),
  ) as Record<string, string>
}

/** Detects boilerplate or placeholder descriptions (e.g. "context window unknown") that should not be shown or cached. */
export function isGenericModelDescription(description: string): boolean {
  return /context window(?: size)?(?: is)? unknown|model details and context window size are unknown|AI model variant|\bline model\b|\bmodel\s*;\s*\d[\d,.]*\s+context\b|OpenAI general-purpose model|fast,? efficient general-purpose|cost-sensitive.*high-volume/i.test(description)
}

/**
 * Merges researched descriptions into the config cache. Only non-generic entries with an http(s) source URL are kept,
 * both for the new batch and for previously cached entries.
 */
export async function saveCachedDescriptions(descriptions: Record<string, string>, sources: Record<string, string> = {}): Promise<void> {
  await updateFullConfig(current => {
    const config = current as Record<string, any>
    const previousSources = config.modelDescriptionSources ?? {}
    const previousUpdatedAt = config.modelDescriptionUpdatedAt ?? {}
    const allSources = { ...previousSources, ...sources }
    const now = new Date().toISOString()
    const existing = Object.fromEntries(
      Object.entries(config.modelDescriptions ?? {}).filter(([id, value]) => typeof value === 'string' && !isGenericModelDescription(value) && typeof allSources[id] === 'string' && /^https?:\/\//.test(allSources[id]) && isCachedDescriptionFresh(previousUpdatedAt[id])),
    )
    const next = Object.fromEntries(
      Object.entries(descriptions).filter(([id, value]) => typeof value === 'string' && !isGenericModelDescription(value) && typeof allSources[id] === 'string' && /^https?:\/\//.test(allSources[id])),
    )
    const modelDescriptions = { ...existing, ...next }
    return {
      ...config,
      modelDescriptions,
      modelDescriptionSources: Object.fromEntries(Object.keys(modelDescriptions).map((id) => [id, allSources[id]])),
      modelDescriptionUpdatedAt: Object.fromEntries(Object.keys(modelDescriptions).map((id) => [id, sources[id] ? now : previousUpdatedAt[id]])),
    }
  })
}

// Full resolution: known patterns → config.json cache
export function getModelDescription(id: string, contextLimit?: number): string {
  const description = getKnownDescription(id) || loadCachedDescriptions()[id] || ''
  const useful = description && !isGenericModelDescription(description) ? description : ''
  if (useful) {
    if (contextLimit && !/\bcontext\b/i.test(useful)) return `${useful} · ${formatContextLimit(contextLimit)}`
    return useful
  }
  return ''
}
