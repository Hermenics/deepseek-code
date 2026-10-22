import { join, resolve } from 'path'
import { homedir } from 'os'
import { mkdir } from 'fs/promises'
import { readJson, writeJson } from '../utils/fs.js'
import { acquireFileLease } from '../orchestration/fileLease.js'

function getHistoryPath(): string {
  return join(process.env.HOME || homedir(), '.deepseek', 'input_history.json')
}
const MAX_ENTRIES = 200

export interface WritingStyleProfile {
  samples: number
  lowercase: number
  noAccents: number
  comma: number
  period: number
  averageLength: number
}

const EMPTY_STYLE: WritingStyleProfile = {
  samples: 0, lowercase: 0, noAccents: 0, comma: 0, period: 0, averageLength: 0,
}

function stylePath(): string {
  return join(process.env.HOME || homedir(), '.deepseek', 'writing_style.json')
}

/** Loads the persisted writing-style profile, defaulting missing fields (or a missing file) to zero counts. */
export async function loadWritingStyle(): Promise<WritingStyleProfile> {
  try {
    const value = await readJson<Partial<WritingStyleProfile>>(stylePath())
    return { ...EMPTY_STYLE, ...value }
  } catch {
    return { ...EMPTY_STYLE }
  }
}

/** Summarizes the profile as an English prompt fragment; a trait is reported when it appears in at least 60% of samples. */
export function describeWritingStyle(profile: WritingStyleProfile): string {
  if (profile.samples === 0) return 'There is not enough user-style data yet.'
  const ratio = (value: number) => value / profile.samples >= 0.6
  return [
    ratio(profile.lowercase) ? 'prefers lowercase writing' : 'usually uses uppercase letters',
    ratio(profile.noAccents) ? 'usually omits diacritics' : 'usually uses diacritics',
    ratio(profile.comma) ? 'often uses commas' : 'rarely uses commas',
    ratio(profile.period) ? 'often ends with a period' : 'rarely ends with a period',
    `typical message length of ${Math.round(profile.averageLength)} characters`,
  ].join('; ')
}

/** Folds one user message into the running writing-style counters; slash and shell (`!`) commands are ignored. */
async function updateWritingStyle(message: string): Promise<void> {
  const trimmed = message.trim()
  if (!trimmed || trimmed.startsWith('/') || trimmed.startsWith('!')) return
  const previous = await loadWritingStyle()
  const samples = previous.samples + 1
  const hasAccents = /[À-ÖØ-öø-ÿ]/.test(trimmed)
  const next: WritingStyleProfile = {
    samples,
    lowercase: previous.lowercase + (trimmed === trimmed.toLowerCase() ? 1 : 0),
    noAccents: previous.noAccents + (hasAccents ? 0 : 1),
    comma: previous.comma + (trimmed.includes(',') ? 1 : 0),
    period: previous.period + (/[.!?]\s*$/.test(trimmed) ? 1 : 0),
    averageLength: (previous.averageLength * previous.samples + trimmed.length) / samples,
  }
  await mkdir(join(process.env.HOME || homedir(), '.deepseek'), { recursive: true })
  await writeJson(stylePath(), next)
}

/** Returns the saved prompt history (oldest first), or an empty list when none exists. */
export async function loadInputHistory(): Promise<string[]> {
  try {
    return await readJson<string[]>(getHistoryPath())
  } catch {
    return []
  }
}

/**
 * Appends a prompt to the persisted history (capped at MAX_ENTRIES, consecutive duplicates skipped) and updates
 * the writing-style profile. Slash and shell (`!`) commands are never recorded.
 */
export async function appendInputHistory(entry: string): Promise<void> {
  const trimmed = entry.trim()
  if (trimmed.startsWith('/') || trimmed.startsWith('!')) return
  const historyPath = getHistoryPath()
  const lease = await acquireFileLease(`input-history:${resolve(historyPath)}`)
  try {
    const history = await loadInputHistory()
    if (history[history.length - 1] === trimmed) return
    history.push(trimmed)
    await mkdir(join(process.env.HOME || homedir(), '.deepseek'), { recursive: true })
    await writeJson(historyPath, history.slice(-MAX_ENTRIES))
    await updateWritingStyle(trimmed)
  } finally {
    await lease.release()
  }
}
