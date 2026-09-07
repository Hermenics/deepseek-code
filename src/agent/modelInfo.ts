import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { formatContextLimit } from './cost.js'

const CONFIG_PATH = join(homedir(), '.deepseek', 'config.json')

// Auto-format: 'deepseek-v4-flash' → 'DeepSeek V4 Flash'
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
  'gpt-6-astra': 'Most capable model for complex reasoning, coding, research, and professional work',
  'gpt-5.6-sol': 'Flagship model for complex professional work',
  'gpt-5.6-terra': 'Balances intelligence and cost for professional workloads',
  'gpt-5.6-luna': 'Lowest-cost GPT-5.6 model for high-volume workloads',
  'gpt-daybreak-blue-latest': 'Flagship general-purpose model with defensive cybersecurity safeguards',
  'gpt-5.5': 'Flagship model for complex coding and professional work',
  'gpt-5.4-mini': 'Fast, efficient model for coding, computer use, and subagents',
}

export function getKnownDescription(id: string): string {
  const modelId = id.split('/').pop() ?? id
  return CATALOG_DESCRIPTIONS[modelId] ?? PATTERN_DESCRIPTIONS.find((p) => p.pattern.test(modelId))?.description ?? ''
}

function loadConfig(): Record<string, any> {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    /* ignore corrupt config */
  }
  return {}
}

function saveConfig(config: Record<string, any>): void {
  const dir = join(homedir(), '.deepseek')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

function loadCachedDescriptions(): Record<string, string> {
  const config = loadConfig()
  const descriptions = config.modelDescriptions as Record<string, unknown> | undefined
  const sources = config.modelDescriptionSources as Record<string, unknown> | undefined
  return Object.fromEntries(
    Object.entries(descriptions ?? {}).filter(([id, value]) =>
      typeof value === 'string' && !isGenericModelDescription(value) && typeof sources?.[id] === 'string' && /^https?:\/\//.test(sources[id] as string),
    ),
  ) as Record<string, string>
}

export function isGenericModelDescription(description: string): boolean {
  return /context window(?: size)?(?: is)? unknown|model details and context window size are unknown|AI model variant|\bline model\b|\bmodel\s*;\s*\d[\d,.]*\s+context\b|OpenAI general-purpose model|fast,? efficient general-purpose|cost-sensitive.*high-volume/i.test(description)
}

export function saveCachedDescriptions(descriptions: Record<string, string>, sources: Record<string, string> = {}): void {
  const config = loadConfig()
  const previousSources = config.modelDescriptionSources ?? {}
  const allSources = { ...previousSources, ...sources }
  const existing = Object.fromEntries(
    Object.entries(config.modelDescriptions ?? {}).filter(([id, value]) => typeof value === 'string' && !isGenericModelDescription(value) && typeof allSources[id] === 'string' && /^https?:\/\//.test(allSources[id])),
  )
  const next = Object.fromEntries(
    Object.entries(descriptions).filter(([id, value]) => typeof value === 'string' && !isGenericModelDescription(value) && typeof allSources[id] === 'string' && /^https?:\/\//.test(allSources[id])),
  )
  config.modelDescriptions = { ...existing, ...next }
  config.modelDescriptionSources = Object.fromEntries(Object.keys(config.modelDescriptions).map((id) => [id, allSources[id]]))
  saveConfig(config)
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
