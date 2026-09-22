#!/usr/bin/env bun
/**
 * Compares two eval labels written by run.ts.
 *
 *   bun scripts/eval/compare.ts <labelA> <labelB> [--tasks a,b] [--iterations 5000] [--seed 1]
 *
 * Prints, per label, the pass rate with a 95% Wilson interval, the outcome breakdown and the cost per
 * pass at a fixed price; per task, the paired pass-rate difference (B − A); overall, the mean paired
 * difference with a 90% bootstrap interval that resamples tasks and then runs inside each task, so one
 * noisy task cannot pass for a real effect. Labels may have different run counts, and a task present in
 * only one label is listed and left out of the paired difference.
 *
 * Promotion rule (plan step 4): B is promoted over A when the paired difference is at least +10 points,
 * the 90% interval excludes zero and the cost per pass rises by no more than 20%.
 * Rotation rule: a task counts for the metric while its pass rate sits in 30–70%; above that it is a
 * regression test, below it a checker-bug suspect.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { estimateCost } from '../../src/agent/cost.js'

export type Outcome = 'pass' | 'agent_fail' | 'timeout' | 'budget' | 'infra_error' | 'deny_abort'

export interface EvalRecord {
  task: string
  pass: boolean
  timedOut?: boolean
  overBudget?: boolean
  error?: string
  finalMessage?: string
  denyAborted?: boolean
  outcome?: Outcome
  costUsd?: number
  fixedCostUsd?: number
  promptTokens?: number
  completionTokens?: number
  cachedTokens?: number
}

/** Why a run ended the way it did. `pass` keeps run.ts's definition; the rest splits failures by cause. */
export function classifyOutcome(r: Pick<EvalRecord, 'pass' | 'timedOut' | 'overBudget' | 'error' | 'finalMessage' | 'denyAborted'>): Outcome {
  if (r.pass) return 'pass'
  if (r.error || r.finalMessage?.includes('⚠ Proxy error')) return 'infra_error'
  if (r.denyAborted) return 'deny_abort'
  if (r.timedOut) return 'timeout'
  if (r.overBudget) return 'budget'
  return 'agent_fail'
}

// Flash, off-peak (a Sunday): one price for every label so provider price changes and peak hours
// cannot show up as a cost difference between two arms.
const FIXED_PRICE_MODEL = 'deepseek-flash'
export const FIXED_PRICE_AT = new Date('2026-01-04T12:00:00Z')

export function fixedCostUsd(usage: { promptTokens?: number; completionTokens?: number; cachedTokens?: number }): number {
  return estimateCost(FIXED_PRICE_MODEL, {
    promptTokens: usage.promptTokens ?? 0, completionTokens: usage.completionTokens ?? 0, cachedTokens: usage.cachedTokens ?? 0,
  }, FIXED_PRICE_AT)
}

/** Wilson score interval for k successes in n trials (z = 1.96 → 95%). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1]
  const p = k / n
  const denom = 1 + z * z / n
  const center = (p + z * z / (2 * n)) / denom
  const half = (z / denom) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rate = (xs: boolean[]) => xs.filter(Boolean).length / xs.length
const costOf = (r: EvalRecord) => r.fixedCostUsd ?? (r.promptTokens !== undefined ? fixedCostUsd(r) : r.costUsd ?? 0)

export interface TaskRow { task: string; a?: { pass: number; n: number }; b?: { pass: number; n: number }; diff?: number }

export interface Comparison {
  labels: Array<{ pass: number; n: number; ci: [number, number]; outcomes: Record<string, number>; costPerPass: number | null }>
  tasks: TaskRow[]
  paired: { tasks: number; diff: number; ci90: [number, number] } | null
  costRatio: number | null
  promoted: boolean
}

export function compare(a: EvalRecord[], b: EvalRecord[], options: { iterations?: number; seed?: number } = {}): Comparison {
  const byTask = (records: EvalRecord[]) => {
    const map = new Map<string, boolean[]>()
    for (const r of records) map.set(r.task, [...(map.get(r.task) ?? []), r.pass])
    return map
  }
  const ta = byTask(a)
  const tb = byTask(b)
  const allTasks = [...new Set([...ta.keys(), ...tb.keys()])].sort()
  const shared = allTasks.filter((t) => ta.has(t) && tb.has(t))

  const tasks: TaskRow[] = allTasks.map((task) => {
    const ra = ta.get(task)
    const rb = tb.get(task)
    return {
      task,
      ...(ra ? { a: { pass: ra.filter(Boolean).length, n: ra.length } } : {}),
      ...(rb ? { b: { pass: rb.filter(Boolean).length, n: rb.length } } : {}),
      ...(ra && rb ? { diff: rate(rb) - rate(ra) } : {}),
    }
  })

  let paired: Comparison['paired'] = null
  if (shared.length > 0) {
    const meanDiff = (pick: (t: string, runs: boolean[]) => boolean[]) =>
      shared.reduce((sum, t) => sum + rate(pick(t, tb.get(t)!)) - rate(pick(t, ta.get(t)!)), 0) / shared.length
    const diff = meanDiff((_, runs) => runs)
    const random = mulberry32(options.seed ?? 1)
    const pickN = <T>(xs: T[]) => Array.from(xs, () => xs[Math.floor(random() * xs.length)]!)
    const iterations = options.iterations ?? 5000
    if (!Number.isInteger(iterations) || iterations < 1) throw new Error(`iterations must be a positive integer, got ${iterations}`)
    const samples: number[] = []
    for (let i = 0; i < iterations; i++) {
      const tasksSample = pickN(shared)
      samples.push(tasksSample.reduce((sum, t) => sum + rate(pickN(tb.get(t)!)) - rate(pickN(ta.get(t)!)), 0) / tasksSample.length)
    }
    samples.sort((x, y) => x - y)
    const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!
    paired = { tasks: shared.length, diff, ci90: [at(0.05), at(0.95)] }
  }

  const summarize = (records: EvalRecord[]) => {
    const pass = records.filter((r) => r.pass).length
    const outcomes: Record<string, number> = {}
    for (const r of records) {
      const outcome = r.outcome ?? classifyOutcome(r)
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    }
    const cost = records.reduce((sum, r) => sum + costOf(r), 0)
    return { pass, n: records.length, ci: wilson(pass, records.length), outcomes, costPerPass: pass > 0 ? cost / pass : null }
  }
  const labels = [summarize(a), summarize(b)]
  const costRatio = labels[0]!.costPerPass && labels[1]!.costPerPass ? labels[1]!.costPerPass / labels[0]!.costPerPass : null
  const promoted = paired !== null && paired.diff >= 0.10 && paired.ci90[0] > 0 && costRatio !== null && costRatio <= 1.2
  return { labels, tasks, paired, costRatio, promoted }
}

export function rotationBand(passRate: number): 'metric' | 'regression' | 'checker-suspect' {
  if (passRate > 0.7) return 'regression'
  if (passRate < 0.3) return 'checker-suspect'
  return 'metric'
}

async function readLabel(label: string): Promise<EvalRecord[]> {
  const text = await readFile(join(import.meta.dir, 'results', `${label}.jsonl`), 'utf8')
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as EvalRecord)
}

if (import.meta.main) {
  const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: { tasks: { type: 'string' }, iterations: { type: 'string', default: '5000' }, seed: { type: 'string', default: '1' } },
  })
  if (positionals.length !== 2) throw new Error('usage: bun scripts/eval/compare.ts <labelA> <labelB> [--tasks a,b] [--iterations 5000] [--seed 1]')
  const [labelA, labelB] = positionals as [string, string]
  const only = opts.tasks ? new Set(opts.tasks.split(',').map((t) => t.trim())) : undefined
  const keep = (records: EvalRecord[]) => (only ? records.filter((r) => only.has(r.task)) : records)
  const [a, b] = [keep(await readLabel(labelA)), keep(await readLabel(labelB))]
  const result = compare(a, b, { iterations: Number(opts.iterations), seed: Number(opts.seed) })

  const pct = (x: number) => `${(x * 100).toFixed(0)}%`
  const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}pp`
  console.table(Object.fromEntries([labelA, labelB].map((label, i) => {
    const s = result.labels[i]!
    return [label, {
      pass: `${s.pass}/${s.n}`, rate: pct(s.pass / Math.max(1, s.n)), wilson95: `${pct(s.ci[0])}–${pct(s.ci[1])}`,
      costPerPass: s.costPerPass === null ? '—' : `$${s.costPerPass.toFixed(4)}`,
      outcomes: Object.entries(s.outcomes).map(([k, v]) => `${k}:${v}`).join(' '),
    }]
  })))
  console.table(Object.fromEntries(result.tasks.map((row) => {
    const bRate = row.b ? row.b.pass / row.b.n : undefined
    return [row.task, {
      [labelA]: row.a ? `${row.a.pass}/${row.a.n}` : 'missing',
      [labelB]: row.b ? `${row.b.pass}/${row.b.n}` : 'missing',
      diff: row.diff === undefined ? '—' : signed(row.diff),
      band: bRate === undefined ? '—' : rotationBand(bRate),
    }]
  })))
  const [ca, cb] = result.labels.map((s) => s.ci)
  const overlap = ca![0] <= cb![1] && cb![0] <= ca![1]
  console.log(`Wilson 95% intervals ${overlap ? 'OVERLAP — the labels are not distinguishable at this n' : 'do not overlap'}.`)
  if (result.paired) {
    console.log(`Paired diff (${labelB} − ${labelA}) over ${result.paired.tasks} shared task(s): ${signed(result.paired.diff)} · 90% bootstrap ${signed(result.paired.ci90[0])} to ${signed(result.paired.ci90[1])}`)
  } else {
    console.log('No task is present in both labels; nothing to pair.')
  }
  if (result.costRatio !== null) console.log(`Cost per pass (fixed price): ×${result.costRatio.toFixed(2)}`)
  console.log(`Promotion rule (≥ +10pp, 90% CI excludes 0, cost per pass ≤ ×1.20): ${result.promoted ? 'PROMOTE' : 'do not promote'}`)
}
