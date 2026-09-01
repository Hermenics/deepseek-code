import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

export const FEATURES = {
  wordDiff: {
    label: 'Word Diff',
    description: 'Show word-level diffs instead of line-level',
    default: true,
  },
  microCompact: {
    label: 'Micro Compact',
    description: 'Aggressively compact short tool outputs',
    default: true,
  },
  fuzzyFileSearch: {
    label: 'Fuzzy File Search',
    description: 'Use fuzzy matching when searching for files',
    default: true,
  },
  ghostReplies: {
    label: 'Suggested Replies',
    description: 'Suggest a reply to the assistant\'s latest question',
    default: true,
  },
} as const

export type FeatureName = keyof typeof FEATURES

const FEATURES_PATH = join(homedir(), '.deepseek', 'features.json')

export function filterFeatureFlags(parsed: unknown): Partial<Record<FeatureName, boolean>> {
  if (!parsed || typeof parsed !== 'object') return {}
  const saved = parsed as Record<string, unknown>
  return Object.fromEntries(
    (Object.keys(FEATURES) as FeatureName[])
      .filter((name) => typeof saved[name] === 'boolean')
      .map((name) => [name, saved[name]]),
  ) as Partial<Record<FeatureName, boolean>>
}

export function loadFeatures(): Record<FeatureName, boolean> {
  const defaults = Object.fromEntries(
    Object.entries(FEATURES).map(([k, v]) => [k, v.default])
  ) as Record<FeatureName, boolean>

  try {
    const raw = readFileSync(FEATURES_PATH, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return { ...defaults, ...filterFeatureFlags(parsed) }
  } catch {
    return defaults
  }
}

export function saveFeatures(flags: Record<FeatureName, boolean>): void {
  mkdirSync(join(homedir(), '.deepseek'), { recursive: true })
  writeFileSync(FEATURES_PATH, JSON.stringify(flags, null, 2))
}

export function isEnabled(flag: FeatureName, flags: Record<FeatureName, boolean>): boolean {
  return flags[flag]
}
