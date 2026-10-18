#!/usr/bin/env bun
/**
 * Compares two eval labels written by run.ts.
 *
 *   bun scripts/eval/compare.ts <labelA> <labelB> [--tasks a,b] [--iterations 5000] [--seed 1]
 *
 * Prints, per label, the pass rate with a 95% Wilson interval, outcome breakdown and cost per pass;
 * per task, the B − A pass-rate difference; overall, a task-clustered 90% interval. It preserves run
 * pairs only when both records declare the same provider, model and supported sampling seed.
 *
 * Promotion rule (plan step 4): B is promoted over A when the task-clustered difference is at least +10 points,
 * the 90% interval excludes zero and the cost per pass rises by no more than 20%.
 * Rotation rule: a task counts for the metric while its pass rate sits in 30–70%; above that it is a
 * regression test, below it a human-audit signal.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { estimateCost } from '../../src/agent/cost.js'
import { fingerprint, hasCompleteMatchingCoverage, recordHasIntegrityFailure, validateEvalRecord } from './protocol.js'

export type Outcome = 'pass' | 'agent_fail' | 'timeout' | 'budget' | 'infra_error' | 'deny_abort'

export interface EvalRecord {
  task: string
  model?: string
  run?: number
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
  tokenCount?: number
  /** Assistant turns in the run: one per model request. */
  modelCalls?: number
  pairId?: string
  providerSeed?: number | string
  agentDurationMs?: number
  checkerDurationMs?: number
  provider?: string
  configFingerprint?: string
  runtimeFingerprint?: string
  schemaFingerprint?: string
  initialTreeHash?: string
  promptHash?: string
  graderHash?: string
  modelSeedSupported?: boolean
  protocolVersion?: number
  checkerStable?: boolean
  integrityFailures?: string[]
  plannedTaskRunKeys?: string[]
  taskSetFingerprint?: string
  actualCostUsd?: number | null
  estimatedCostUsd?: number
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

/** Prices token usage at one fixed rate (Flash, off-peak) so labels compare on usage, not on the price in effect. */
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

/** Small seeded PRNG so the bootstrap interval is reproducible for a given --seed. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Share of true values in a list of pass results. */
const rate = (xs: boolean[]) => xs.filter(Boolean).length / xs.length
/** Cost of one record: fixedCostUsd when present, else a fixed-price estimate from its tokens, else its raw costUsd. */
const costOf = (r: EvalRecord) => r.fixedCostUsd ?? r.estimatedCostUsd ?? (r.promptTokens !== undefined ? fixedCostUsd(r) : r.costUsd ?? 0)

export interface TaskRow { task: string; a?: { pass: number; n: number }; b?: { pass: number; n: number }; diff?: number }

export interface Comparison {
  labels: Array<{ pass: number; n: number; ci: [number, number]; outcomes: Record<string, number>; costPerPass: number | null; actualCostUsd: number | null; avgTokens: number | null; avgModelCalls: number | null }>
  tasks: TaskRow[]
  paired: { tasks: number; runs: number; diff: number; ci90: [number, number] } | null
  costRatio: number | null
  promoted: boolean
}

/** Pairs only runs with an explicitly supported, matching provider seed; otherwise estimates by task. */
export function compare(a: EvalRecord[], b: EvalRecord[], options: { iterations?: number; seed?: number } = {}): Comparison {
  for (const record of [...a, ...b]) validateEvalRecord(record)
  /** Groups pass results by task. */
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

  const pairKey = (record: EvalRecord): string | undefined => {
    if (record.modelSeedSupported !== true || record.providerSeed === undefined || !record.provider || !record.model) return undefined
    const runIdentity = record.pairId ?? (Number.isSafeInteger(record.run) && record.run! > 0 ? `run:${record.run}` : undefined)
    return runIdentity === undefined ? undefined : `${record.provider}:${record.model}:seed:${record.providerSeed}:pair:${runIdentity}`
  }
  const groupPairs = (records: EvalRecord[]) => {
    const grouped = new Map<string, Map<string, EvalRecord[]>>()
    for (const record of records) {
      const key = pairKey(record)
      if (!key) continue
      const byPair = grouped.get(record.task) ?? new Map<string, EvalRecord[]>()
      byPair.set(key, [...(byPair.get(key) ?? []), record])
      grouped.set(record.task, byPair)
    }
    return grouped
  }
  const pairsA = groupPairs(a)
  const pairsB = groupPairs(b)
  const pairedByTask = shared.flatMap(task => {
    const byA = pairsA.get(task)
    const byB = pairsB.get(task)
    if (!byA || !byB) return []
    const pairs = [...byA.keys()].flatMap(key => {
      const left = byA.get(key)!
      const right = byB.get(key)
      return left.length === 1 && right?.length === 1 ? [{ a: left[0]!.pass, b: right[0]!.pass }] : []
    })
    return pairs.length ? [{ task, pairs }] : []
  })

  let paired: Comparison['paired'] = null
  if (pairedByTask.length > 0) {
    const taskDiff = (pairs: Array<{ a: boolean; b: boolean }>) =>
      pairs.reduce((sum, pair) => sum + Number(pair.b) - Number(pair.a), 0) / pairs.length
    const diff = pairedByTask.reduce((sum, task) => sum + taskDiff(task.pairs), 0) / pairedByTask.length
    const random = mulberry32(options.seed ?? 1)
    const pickN = <T>(xs: T[]) => Array.from(xs, () => xs[Math.floor(random() * xs.length)]!)
    const iterations = options.iterations ?? 5000
    if (!Number.isInteger(iterations) || iterations < 1) throw new Error(`iterations must be a positive integer, got ${iterations}`)
    const samples: number[] = []
    for (let i = 0; i < iterations; i++) {
      const tasksSample = pickN(pairedByTask)
      samples.push(tasksSample.reduce((sum, task) => sum + taskDiff(pickN(task.pairs)), 0) / tasksSample.length)
    }
    samples.sort((x, y) => x - y)
    /** Value at quantile `q` of the sorted bootstrap samples. */
    const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!
    paired = { tasks: pairedByTask.length, runs: pairedByTask.reduce((sum, task) => sum + task.pairs.length, 0), diff, ci90: [at(0.05), at(0.95)] }
  } else if (shared.length > 0) {
    // Older records may not contain run identity; cluster by task without implying run-level pairing.
    const diff = shared.reduce((sum, task) => sum + rate(tb.get(task)!) - rate(ta.get(task)!), 0) / shared.length
    const random = mulberry32(options.seed ?? 1)
    const pickN = <T>(xs: T[]) => Array.from(xs, () => xs[Math.floor(random() * xs.length)]!)
    const iterations = options.iterations ?? 5000
    if (!Number.isInteger(iterations) || iterations < 1) throw new Error(`iterations must be a positive integer, got ${iterations}`)
    const samples = Array.from({ length: iterations }, () => {
      const tasksSample = pickN(shared)
      return tasksSample.reduce((sum, task) => sum + rate(pickN(tb.get(task)!)) - rate(pickN(ta.get(task)!)), 0) / tasksSample.length
    }).sort((x, y) => x - y)
    const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!
    paired = { tasks: shared.length, runs: 0, diff, ci90: [at(0.05), at(0.95)] }
  }

  /** Pass count, Wilson interval, outcome breakdown and cost per pass for one label. */
  const summarize = (records: EvalRecord[]) => {
    const pass = records.filter((r) => r.pass).length
    const outcomes: Record<string, number> = {}
    for (const r of records) {
      const outcome = r.outcome ?? classifyOutcome(r)
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    }
    const cost = records.reduce((sum, r) => sum + costOf(r), 0)
    /** Mean of a per-run number over the runs that recorded it. */
    const mean = (pick: (r: EvalRecord) => number | undefined) => {
      const values = records.map(pick).filter((value): value is number => typeof value === 'number')
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
    }
    const actualCosts = records.map(record => record.actualCostUsd).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    return { pass, n: records.length, ci: wilson(pass, records.length), outcomes, costPerPass: pass > 0 ? cost / pass : null, actualCostUsd: actualCosts.length === records.length ? actualCosts.reduce((sum, value) => sum + value, 0) : null, avgTokens: mean(r => r.tokenCount), avgModelCalls: mean(r => r.modelCalls) }
  }
  const labels = [summarize(a), summarize(b)]
  const costRatio = labels[0]!.costPerPass && labels[1]!.costPerPass ? labels[1]!.costPerPass / labels[0]!.costPerPass : null
  const validRecords = [...a, ...b]
  const planKeys = (records: EvalRecord[]) => records[0]?.plannedTaskRunKeys
  const plannedA = planKeys(a)
  const plannedB = planKeys(b)
  const allPlannedA = [...new Set(a.flatMap(record => record.plannedTaskRunKeys ?? []))].sort()
  const allPlannedB = [...new Set(b.flatMap(record => record.plannedTaskRunKeys ?? []))].sort()
  const planMatches = plannedA && plannedB
    ? JSON.stringify(allPlannedA) === JSON.stringify(allPlannedB) && a.every(record => record.taskSetFingerprint === a[0]?.taskSetFingerprint) && b.every(record => record.taskSetFingerprint === b[0]?.taskSetFingerprint) && a[0]?.taskSetFingerprint === b[0]?.taskSetFingerprint && a[0]?.taskSetFingerprint === fingerprint(allPlannedA)
    : validRecords.every(record => record.protocolVersion !== 2)
  const completePlan = plannedA && plannedB
    ? JSON.stringify(allPlannedA) === JSON.stringify(a.map(record => `${record.task}:${record.run}`).sort())
      && JSON.stringify(allPlannedB) === JSON.stringify(b.map(record => `${record.task}:${record.run}`).sort())
    : hasCompleteMatchingCoverage(a, b)
  const noIntegrityFailures = validRecords.every(record => !recordHasIntegrityFailure(record))
  const sameExperimentalConfig = (() => {
    if (validRecords.some(record => record.protocolVersion !== 2)) return false
    const fields = ['provider', 'model', 'configFingerprint', 'runtimeFingerprint', 'schemaFingerprint', 'initialTreeHash', 'promptHash', 'graderHash'] as const
    const byPair = new Map<string, EvalRecord[]>()
    for (const record of validRecords) {
      const pairId = record.pairId ?? `${record.task}:${record.run}`
      byPair.set(pairId, [...(byPair.get(pairId) ?? []), record])
    }
    return [...byPair.values()].every(pair => pair.length === 2 && fields.every(field => pair[0]?.[field] !== undefined && pair[0]?.[field] === pair[1]?.[field]))
  })()
  const promoted = paired !== null && paired.tasks >= 5 && paired.diff >= 0.10 && paired.ci90[0] > 0 && costRatio !== null && costRatio <= 1.2 && planMatches && completePlan && noIntegrityFailures && sameExperimentalConfig
  return { labels, tasks, paired, costRatio, promoted }
}

/** Where a task sits in the rotation rule; `checker-suspect` remains the legacy API value for human audit. */
export function rotationBand(passRate: number): 'metric' | 'regression' | 'checker-suspect' {
  if (passRate > 0.7) return 'regression'
  if (passRate < 0.3) return 'checker-suspect'
  return 'metric'
}

/** Reads every record of `results/<label>.jsonl`. */
async function readLabel(label: string): Promise<EvalRecord[]> {
  const text = await readFile(join(import.meta.dir, 'results', `${label}.jsonl`), 'utf8')
  return text.split('\n').filter((line) => line.trim()).map((line, index) => {
    let record: unknown
    try { record = JSON.parse(line) } catch { throw new Error(`Invalid JSON in ${label}.jsonl line ${index + 1}`) }
    try { validateEvalRecord(record) } catch (error) { throw new Error(`${label}.jsonl line ${index + 1}: ${(error as Error).message}`) }
    return record as EvalRecord
  })
}

if (import.meta.main) {
  const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: { tasks: { type: 'string' }, iterations: { type: 'string', default: '5000' }, seed: { type: 'string', default: '1' } },
  })
  if (positionals.length !== 2) throw new Error('usage: bun scripts/eval/compare.ts <labelA> <labelB> [--tasks a,b] [--iterations 5000] [--seed 1]')
  const [labelA, labelB] = positionals as [string, string]
  const only = opts.tasks ? new Set(opts.tasks.split(',').map((t) => t.trim())) : undefined
  /** Applies the --tasks filter. */
  const keep = (records: EvalRecord[]) => (only ? records.filter((r) => only.has(r.task)) : records)
  const [a, b] = [keep(await readLabel(labelA)), keep(await readLabel(labelB))]
  const result = compare(a, b, { iterations: Number(opts.iterations), seed: Number(opts.seed) })

  /** Formats a fraction as a whole percentage. */
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`
  /** Formats a fraction as signed percentage points. */
  const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}pp`
  console.table(Object.fromEntries([labelA, labelB].map((label, i) => {
    const s = result.labels[i]!
    return [label, {
      pass: `${s.pass}/${s.n}`, rate: pct(s.pass / Math.max(1, s.n)), wilson95: `${pct(s.ci[0])}–${pct(s.ci[1])}`,
      costPerPass: s.costPerPass === null ? '—' : `$${s.costPerPass.toFixed(4)}`,
      actualCost: s.actualCostUsd === null ? 'unavailable' : `$${s.actualCostUsd.toFixed(4)}`,
      avgTokens: s.avgTokens === null ? '—' : Math.round(s.avgTokens),
      avgModelCalls: s.avgModelCalls === null ? '—' : Number(s.avgModelCalls.toFixed(1)),
      outcomes: Object.entries(s.outcomes).map(([k, v]) => `${k}:${v}`).join(' '),
    }]
  })))
  console.table(Object.fromEntries(result.tasks.map((row) => {
    const bRate = row.b ? row.b.pass / row.b.n : undefined
    return [row.task, {
      [labelA]: row.a ? `${row.a.pass}/${row.a.n}` : 'missing',
      [labelB]: row.b ? `${row.b.pass}/${row.b.n}` : 'missing',
      diff: row.diff === undefined ? '—' : signed(row.diff),
      band: bRate === undefined ? '—' : rotationBand(bRate) === 'checker-suspect' ? 'human-audit' : rotationBand(bRate),
    }]
  })))
  const [ca, cb] = result.labels.map((s) => s.ci)
  const overlap = ca![0] <= cb![1] && cb![0] <= ca![1]
  console.log(`Wilson 95% intervals ${overlap ? 'overlap' : 'do not overlap'}; overlap is not an equivalence test.`)
  if (result.paired) {
    const design = result.paired.runs
      ? `${result.paired.runs} matched run pair(s)`
      : 'task-clustered records (provider sampling seed unavailable; not paired by run)'
    console.log(`Diff (${labelB} − ${labelA}) over ${design} in ${result.paired.tasks} task(s): ${signed(result.paired.diff)} · 90% bootstrap ${signed(result.paired.ci90[0])} to ${signed(result.paired.ci90[1])}`)
  } else {
    console.log('No task is present in both labels; nothing to pair.')
  }
  if (result.costRatio !== null) console.log(`Cost per pass (fixed price): ×${result.costRatio.toFixed(2)}`)
  const [first, second] = result.labels
  if (first?.avgTokens && second?.avgTokens) console.log(`Tokens per run: ${labelB} uses ${pct(second.avgTokens / first.avgTokens)} of ${labelA}`)
  if (first?.avgModelCalls && second?.avgModelCalls) console.log(`Model calls per run: ${labelB} uses ${pct(second.avgModelCalls / first.avgModelCalls)} of ${labelA}`)
  console.log(`Promotion rule (≥ +10pp, 90% task-clustered CI excludes 0, ≥5 shared tasks, cost per pass ≤ ×1.20): ${result.promoted ? 'PROMOTE' : 'do not promote'}`)
  for (const [i, label] of [labelA, labelB].entries()) {
    const records = i === 0 ? a : b
    const low = records.filter((r) => !r.pass).length / Math.max(1, records.length) > 0.7
    if (low) console.log(`${label}: low pass rate; audit the checker and task validity with a human before changing any task or target.`)
    const agentTimes = records.flatMap((r) => typeof r.agentDurationMs === 'number' ? [r.agentDurationMs] : [])
    const checkerTimes = records.flatMap((r) => typeof r.checkerDurationMs === 'number' ? [r.checkerDurationMs] : [])
    if (agentTimes.length || checkerTimes.length) console.log(`${label} mean duration: agent ${agentTimes.length ? `${Math.round(agentTimes.reduce((x, y) => x + y, 0) / agentTimes.length / 1000)}s` : 'n/a'}, checker ${checkerTimes.length ? `${Math.round(checkerTimes.reduce((x, y) => x + y, 0) / checkerTimes.length / 1000)}s` : 'n/a'}`)
  }
  const matchingPairs = result.paired?.runs ?? 0
  if (matchingPairs) console.log(`${matchingPairs} matched run pair(s); pair seed controls schedule metadata only, provider/model sampling seed support is not enabled.`)
}
