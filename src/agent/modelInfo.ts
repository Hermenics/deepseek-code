import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

export function getKnownDescription(id: string): string {
  return PATTERN_DESCRIPTIONS.find((p) => p.pattern.test(id))?.description ?? ''
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
  return loadConfig().modelDescriptions ?? {}
}

export function saveCachedDescriptions(descriptions: Record<string, string>): void {
  const config = loadConfig()
  const existing = config.modelDescriptions ?? {}
  config.modelDescriptions = { ...existing, ...descriptions }
  saveConfig(config)
}

// Full resolution: known patterns → config.json cache
export function getModelDescription(id: string): string {
  return getKnownDescription(id) || loadCachedDescriptions()[id] || ''
}
