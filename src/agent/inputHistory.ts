import { join } from 'path'
import { homedir } from 'os'
import { mkdir } from 'fs/promises'
import { readJson, writeJson } from '../utils/fs.js'

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

export async function loadWritingStyle(): Promise<WritingStyleProfile> {
  try {
    const value = await readJson<Partial<WritingStyleProfile>>(stylePath())
    return { ...EMPTY_STYLE, ...value }
  } catch {
    return { ...EMPTY_STYLE }
  }
}

export function describeWritingStyle(profile: WritingStyleProfile): string {
  if (profile.samples === 0) return 'Ainda não há dados suficientes sobre o estilo do usuário.'
  const ratio = (value: number) => value / profile.samples >= 0.6
  return [
    ratio(profile.lowercase) ? 'prefere escrever em minúsculas' : 'usa maiúsculas normalmente',
    ratio(profile.noAccents) ? 'normalmente não usa acentos' : 'usa acentos normalmente',
    ratio(profile.comma) ? 'costuma usar vírgulas' : 'raramente usa vírgulas',
    ratio(profile.period) ? 'costuma terminar com ponto final' : 'raramente termina com ponto final',
    `comprimento típico de ${Math.round(profile.averageLength)} caracteres`,
  ].join('; ')
}

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

export async function loadInputHistory(): Promise<string[]> {
  try {
    return await readJson<string[]>(getHistoryPath())
  } catch {
    return []
  }
}

export async function appendInputHistory(entry: string): Promise<void> {
  const trimmed = entry.trim()
  if (trimmed.startsWith('/') || trimmed.startsWith('!')) return
  const history = await loadInputHistory()
  if (history[history.length - 1] === trimmed) return
  history.push(trimmed)
  const historyPath = getHistoryPath()
  await mkdir(join(process.env.HOME || homedir(), '.deepseek'), { recursive: true })
  await writeJson(historyPath, history.slice(-MAX_ENTRIES))
  await updateWritingStyle(trimmed)
}
