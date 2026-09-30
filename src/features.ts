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
  readBeforeEdit: {
    label: 'Read Before Edit',
    description: 'Reject edits to files the agent has not read or that changed on disk since it read them',
    default: true,
  },
  browser: {
    label: 'Browser',
    description: 'Let the agent drive a local Chrome to open, inspect and test web pages (asks before each new site)',
    default: false,
  },
} as const

export type FeatureName = keyof typeof FEATURES

const FEATURES_PATH = join(homedir(), '.deepseek', 'features.json')

/** Keeps only known feature names with boolean values from parsed `features.json` content, dropping anything else. */
export function filterFeatureFlags(parsed: unknown): Partial<Record<FeatureName, boolean>> {
  if (!parsed || typeof parsed !== 'object') return {}
  const saved = parsed as Record<string, unknown>
  return Object.fromEntries(
    (Object.keys(FEATURES) as FeatureName[])
      .filter((name) => typeof saved[name] === 'boolean')
      .map((name) => [name, saved[name]]),
  ) as Partial<Record<FeatureName, boolean>>
}

/**
 * `DEEPSEEK_FEATURES=browser,-microCompact` turns flags on or off for this process only (evals, CI),
 * without touching `~/.deepseek/features.json`. Unknown names are ignored.
 */
export function envFeatureOverrides(value = process.env.DEEPSEEK_FEATURES): Partial<Record<FeatureName, boolean>> {
  const overrides: Partial<Record<FeatureName, boolean>> = {}
  for (const item of (value ?? '').split(',').map(part => part.trim()).filter(Boolean)) {
    const name = item.replace(/^-/, '') as FeatureName
    if (name in FEATURES) overrides[name] = !item.startsWith('-')
  }
  return overrides
}

/** Reads `~/.deepseek/features.json` synchronously and overlays it on the defaults (then the environment override); falls back to defaults on any read or parse error. */
export function loadFeatures(): Record<FeatureName, boolean> {
  const defaults = Object.fromEntries(
    Object.entries(FEATURES).map(([k, v]) => [k, v.default])
  ) as Record<FeatureName, boolean>

  try {
    const raw = readFileSync(FEATURES_PATH, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return { ...defaults, ...filterFeatureFlags(parsed), ...envFeatureOverrides() }
  } catch {
    return { ...defaults, ...envFeatureOverrides() }
  }
}

/** Writes the full flag map to `~/.deepseek/features.json`, creating the directory if needed. */
export function saveFeatures(flags: Record<FeatureName, boolean>): void {
  mkdirSync(join(homedir(), '.deepseek'), { recursive: true })
  writeFileSync(FEATURES_PATH, JSON.stringify(flags, null, 2))
}

export function isEnabled(flag: FeatureName, flags: Record<FeatureName, boolean>): boolean {
  return flags[flag]
}
