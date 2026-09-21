import { describe, expect, it } from 'bun:test'
import { isPeakTime } from '../src/agent/cost.js'
import { FIXED_PRICE_AT, classifyOutcome, compare, fixedCostUsd, rotationBand, wilson, type EvalRecord } from '../scripts/eval/compare.js'

const runs = (task: string, passes: boolean[], extra: Partial<EvalRecord> = {}): EvalRecord[] =>
  passes.map((pass) => ({ task, pass, costUsd: 0.01, ...extra }))

describe('eval compare', () => {
  it('computes the Wilson interval the plan quotes for 7/9', () => {
    const [lo, hi] = wilson(7, 9)
    expect(lo).toBeCloseTo(0.453, 2)
    expect(hi).toBeCloseTo(0.937, 2)
    expect(wilson(0, 0)).toEqual([0, 1])
  })

  it('pairs by task with unequal run counts and reports a task missing from one label', () => {
    const a = [...runs('t1', [true, false]), ...runs('t2', [false, false, false]), ...runs('only-a', [true])]
    const b = [...runs('t1', [true, true, true, true]), ...runs('t2', [true, false, false, false, false, false])]

    const result = compare(a, b, { iterations: 500 })

    expect(result.tasks.map((t) => t.task)).toEqual(['only-a', 't1', 't2'])
    expect(result.tasks[0]).toEqual({ task: 'only-a', a: { pass: 1, n: 1 } })
    expect(result.paired!.tasks).toBe(2)
    // t1: 1 − 0.5, t2: 1/6 − 0 → mean 1/3
    expect(result.paired!.diff).toBeCloseTo((0.5 + 1 / 6) / 2, 6)
    expect(result.paired!.ci90[0]).toBeLessThanOrEqual(result.paired!.diff)
    expect(result.paired!.ci90[1]).toBeGreaterThanOrEqual(result.paired!.diff)
    expect(result.labels[0]!.n).toBe(6)
  })

  it('promotes only a clear gain that does not cost more than 20% per pass', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e', 'f']
    const base = tasks.flatMap((t) => runs(t, [true, false, false, false, false, true, false, false, false, false]))
    const better = tasks.flatMap((t) => runs(t, [true, true, true, true, true, true, false, false, false, false]))
    expect(compare(base, better, { iterations: 1000 }).promoted).toBe(true)
    const pricey = better.map((r) => ({ ...r, costUsd: 0.1 }))
    expect(compare(base, pricey, { iterations: 1000 }).promoted).toBe(false)
    expect(compare(base, base, { iterations: 1000 }).promoted).toBe(false)
  })

  it('classifies a proxy error as infrastructure, not an agent failure', () => {
    expect(classifyOutcome({ pass: false, finalMessage: 'x\n⚠ Proxy error: upstream 502' })).toBe('infra_error')
    expect(classifyOutcome({ pass: false, error: 'Agent did not stop within 60s of abort' })).toBe('infra_error')
    expect(classifyOutcome({ pass: false, denyAborted: true })).toBe('deny_abort')
    expect(classifyOutcome({ pass: false, timedOut: true })).toBe('timeout')
    expect(classifyOutcome({ pass: false, overBudget: true })).toBe('budget')
    expect(classifyOutcome({ pass: false })).toBe('agent_fail')
    expect(classifyOutcome({ pass: true, timedOut: false })).toBe('pass')
  })

  it('prices every label the same way, off-peak', () => {
    expect(isPeakTime(FIXED_PRICE_AT)).toBe(false)
    expect(fixedCostUsd({ promptTokens: 1_000_000, cachedTokens: 0, completionTokens: 1_000_000 })).toBeCloseTo(0.75, 6)
  })

  it('bands tasks for the 30–70% rotation rule', () => {
    expect(rotationBand(0.8)).toBe('regression')
    expect(rotationBand(0.5)).toBe('metric')
    expect(rotationBand(0.3)).toBe('metric')
    expect(rotationBand(0.2)).toBe('checker-suspect')
  })
})
