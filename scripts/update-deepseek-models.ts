#!/usr/bin/env bun
/**
 * Syncs DeepSeek model details and pricing from the official pricing page into
 * src/agent/deepseekModels.json, the single source for /cost, context limits and the docs site.
 *
 *   bun scripts/update-deepseek-models.ts
 *
 * Throws without writing when the page no longer parses into a complete table, so a layout change on
 * DeepSeek's side shows up as a failed run instead of silently wrong prices.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const PRICING_PAGE_URL = 'https://api-docs.deepseek.com/quick_start/pricing'
const OUTPUT = join(import.meta.dir, '../src/agent/deepseekModels.json')
// Still accepted by the API but no longer named on the pricing page; both were served by deepseek-flash on 2026-09-13.
const UNLISTED_ALIASES: Record<string, string> = { 'deepseek-chat': 'deepseek-flash', 'deepseek-reasoner': 'deepseek-flash' }

export interface Rates { cacheHit: number; cacheMiss: number; output: number }

export interface DeepSeekModel {
  id: string
  version: string
  contextTokens: number
  maxOutputTokens: number
  vision: boolean
  concurrency: number
  /** USD per 1M tokens. */
  pricing: { offPeak: Rates; peak: Rates }
}

export interface DeepSeekModelsData {
  source: string
  /** UTC weekdays (0 = Sunday) and HH:MM ranges (end exclusive) billed at peak rates. */
  peakHoursUtc: { weekdays: number[]; ranges: [string, string][] }
  models: DeepSeekModel[]
  /** Retired model names the API still accepts, mapped to the model that serves them. */
  legacyAliases: Record<string, string>
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const RATE_KEYS = ['cacheHit', 'cacheMiss', 'output'] as const

function toText(html: string): string {
  return html
    .replace(/<sup>[\s\S]*?<\/sup>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name]!)
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseVision(cell: string, id: string): boolean {
  if (cell === '✓') return true
  if (/^not supported$/i.test(cell)) return false
  throw new Error(`Unexpected vision value "${cell}" for ${id}`)
}

/** Adds aliases the page no longer names; fails when any alias points to a model the page does not list. */
export function withLegacyAliases(data: DeepSeekModelsData, extra: Record<string, string>): DeepSeekModelsData {
  const legacyAliases = { ...extra, ...data.legacyAliases }
  const ids = new Set(data.models.map((model) => model.id))
  const orphaned = Object.entries(legacyAliases).filter(([, target]) => !ids.has(target))
  if (orphaned.length > 0) {
    throw new Error(`Legacy aliases point to models missing from the pricing page: ${orphaned.map(([alias, target]) => `${alias} -> ${target}`).join(', ')}`)
  }
  return { ...data, legacyAliases }
}

function parseTokens(text: string): number {
  const match = text.match(/(\d+(?:\.\d+)?)\s*([KM])\b/i)
  if (!match) throw new Error(`Unrecognized token amount "${text}"`)
  return Math.round(Number(match[1]) * (match[2]!.toUpperCase() === 'M' ? 1_000_000 : 1_000))
}

export function parsePricingPage(html: string): DeepSeekModelsData {
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0]
  if (!table) throw new Error('Pricing table not found')
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((row) => [...row[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => toText(cell[1]!)))

  const ids = rows.find((cells) => cells[0] === 'MODEL')?.slice(1) ?? []
  if (ids.length === 0 || ids.some((id) => !/^deepseek-[a-z0-9.-]+$/.test(id))) throw new Error(`Unexpected model row: ${JSON.stringify(ids)}`)

  /** Values of the row labelled `label`; one spanning cell applies to every model. */
  const valuesFor = (label: RegExp): string[] => {
    const cells = rows.find((row) => label.test(row[0] ?? ''))
    if (!cells) throw new Error(`Row ${label} not found`)
    const values = cells.slice(1)
    if (values.length === 1) return ids.map(() => values[0]!)
    if (values.length !== ids.length) throw new Error(`Row ${label} has ${values.length} values for ${ids.length} models`)
    return values
  }

  const prices = ids.map(() => ({ offPeak: {} as Partial<Rates>, peak: {} as Partial<Rates> }))
  let category: keyof Rates | undefined
  for (const cells of rows) {
    const heading = cells.find((cell) => /CACHE HIT|CACHE MISS|OUTPUT TOKENS/i.test(cell))
    if (heading) category = /CACHE HIT/i.test(heading) ? 'cacheHit' : /CACHE MISS/i.test(heading) ? 'cacheMiss' : 'output'
    const period = cells.find((cell) => /^(OFF-PEAK|PEAK)$/i.test(cell))
    if (!category || !period) continue
    const key = category
    const bucket = /^OFF/i.test(period) ? 'offPeak' : 'peak'
    cells.slice(-ids.length).forEach((cell, i) => {
      const amount = cell.match(/^\$(\d+(?:\.\d+)?)$/)?.[1]
      if (!amount) throw new Error(`Unexpected price "${cell}" for ${ids[i]}`)
      prices[i]![bucket][key] = Number(amount)
    })
  }

  const versions = valuesFor(/^MODEL VERSION$/)
  const context = valuesFor(/^CONTEXT LENGTH$/)
  const maxOutput = valuesFor(/^MAX OUTPUT$/)
  const vision = valuesFor(/^Vision$/)
  const concurrency = valuesFor(/^Concurrency Limit/)
  const models = ids.map((id, i): DeepSeekModel => {
    const { offPeak, peak } = prices[i]!
    for (const rates of [offPeak, peak]) {
      for (const key of RATE_KEYS) if (!(rates[key]! > 0)) throw new Error(`Missing ${key} price for ${id}`)
    }
    const limit = Number(concurrency[i])
    if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Unexpected concurrency "${concurrency[i]}" for ${id}`)
    return {
      id,
      version: versions[i]!,
      contextTokens: parseTokens(context[i]!),
      maxOutputTokens: parseTokens(maxOutput[i]!),
      vision: parseVision(vision[i]!, id),
      concurrency: limit,
      pricing: { offPeak: offPeak as Rates, peak: peak as Rates },
    }
  })

  const notes = toText(html.slice(html.indexOf('</table>')))
  const peakNote = notes.match(/Peak hours are (.+?) UTC, (\w+) through (\w+)/)
  const ranges = [...(peakNote?.[1] ?? '').matchAll(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/g)].map((m): [string, string] => [m[1]!, m[2]!])
  const from = WEEKDAYS.indexOf(peakNote?.[2]?.toLowerCase() ?? '')
  const to = WEEKDAYS.indexOf(peakNote?.[3]?.toLowerCase() ?? '')
  if (ranges.length === 0 || from < 0 || to < from) throw new Error(`Unrecognized peak-hours note: ${JSON.stringify(peakNote?.[0])}`)

  const legacyAliases: Record<string, string> = {}
  for (const note of notes.matchAll(/Use (deepseek-[\w.-]+) as the model name\. The legacy names? (.+?) (?:is|are) still accepted/g)) {
    for (const alias of note[2]!.match(/deepseek-[\w.-]+/g) ?? []) legacyAliases[alias] = note[1]!
  }

  return {
    source: PRICING_PAGE_URL,
    peakHoursUtc: { weekdays: Array.from({ length: to - from + 1 }, (_, i) => from + i), ranges },
    models,
    legacyAliases,
  }
}

if (import.meta.main) {
  const response = await fetch(PRICING_PAGE_URL, { headers: { 'User-Agent': 'deepseek-code-models-sync' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`GET ${PRICING_PAGE_URL} -> HTTP ${response.status}`)
  const data = withLegacyAliases(parsePricingPage(await response.text()), UNLISTED_ALIASES)
  const next = JSON.stringify(data, null, 2) + '\n'
  const current = await readFile(OUTPUT, 'utf8').catch(() => '')
  if (current === next) {
    console.log('DeepSeek models: unchanged')
  } else {
    await writeFile(OUTPUT, next)
    console.log(`DeepSeek models: updated ${OUTPUT} (${data.models.map((m) => m.id).join(', ')})`)
  }
}
