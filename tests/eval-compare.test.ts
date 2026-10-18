import { describe, expect, it } from 'bun:test'
import { isPeakTime } from '../src/agent/cost.js'
import { FIXED_PRICE_AT, classifyOutcome, compare, fixedCostUsd, rotationBand, wilson, type EvalRecord } from '../scripts/eval/compare.js'
import { attestCheckerTrees, fingerprint, fingerprintTree, recordHasIntegrityFailure, transcriptForPersistence, validateEvalRecord } from '../scripts/eval/protocol.js'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accountedCostUsd, assertABPairCompatible, createABJobs, createABPlan, runBudgetForRemaining, validateABBudgets, verifyABPlan } from '../scripts/eval/schedule.js'

/** Eval records for one task from a list of pass results. */
const runs = (task: string, passes: boolean[], extra: Partial<EvalRecord> = {}): EvalRecord[] =>
  passes.map((pass, index) => ({
    protocolVersion: 2, task, run: index + 1, pass, costUsd: 0.01, modelSeedSupported: false,
    provider: 'deepseek', model: 'deepseek-flash', configFingerprint: 'config', runtimeFingerprint: 'runtime',
    checkerStable: true, hiddenGraderStable: true, integrityFailures: [], initialTreeHash: 'initial', finalTreeHash: 'final', promptHash: 'prompt', graderHash: 'grader',
    schemaFingerprint: 'schema',
    plannedTaskRunKeys: passes.map((_, i) => `${task}:${i + 1}`), taskSetFingerprint: 'same-suite',
    ...extra,
  }))

const freezePlan = (records: EvalRecord[]): EvalRecord[] => {
  const plannedTaskRunKeys = records.map(record => `${record.task}:${record.run}`).sort()
  const taskSetFingerprint = fingerprint(plannedTaskRunKeys)
  return records.map(record => ({ ...record, plannedTaskRunKeys, taskSetFingerprint }))
}

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
    const base = freezePlan(tasks.flatMap((t) => runs(t, [true, false, false, false, false, true, false, false, false, false])))
    const better = freezePlan(tasks.flatMap((t) => runs(t, [true, true, true, true, true, true, false, false, false, false])))
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

  it('rejects malformed and integrity-failed records for promotion', () => {
    expect(() => validateEvalRecord({ task: 'x', pass: 'yes' })).toThrow('pass must be boolean')
    expect(recordHasIntegrityFailure({ protocolVersion: 2, checkerStable: false, integrityFailures: [] })).toBe(true)
    const tasks = ['a', 'b', 'c', 'd', 'e', 'f']
    const base = freezePlan(tasks.flatMap(task => runs(task, [true, false, false, false, false, true, false, false, false, false])))
    const better = freezePlan(tasks.flatMap(task => runs(task, [true, true, true, true, true, true, false, false, false, false])))
    expect(compare(base, better, { iterations: 200 }).promoted).toBe(true)
    expect(compare(base, better.filter(record => !(record.task === 'f' && record.run === 10)), { iterations: 200 }).promoted).toBe(false)
    expect(() => compare(base, better.map(record => record.task === 'a' && record.run === 1 ? { ...record, checkerStable: false } : record), { iterations: 200 })).toThrow('claims pass despite failed integrity checks')
  })

  it('requires usable non-negative accounting instead of treating absent or invalid cost as zero', () => {
    expect(accountedCostUsd({ estimatedCostUsd: 0.02, actualCostUsd: 0.03, costUsd: 0.025 })).toBe(0.03)
    expect(accountedCostUsd({ costUsd: 0 })).toBe(0)
    expect(() => accountedCostUsd({})).toThrow(/no finite non-negative cost/)
    expect(() => accountedCostUsd({ estimatedCostUsd: Number.NaN, costUsd: 0 })).toThrow(/unusable estimatedCostUsd/)
    expect(() => accountedCostUsd({ actualCostUsd: -0.01 })).toThrow(/unusable actualCostUsd/)
    expect(() => accountedCostUsd({ fixedCostUsd: 0.2 })).toThrow(/no finite non-negative cost/)
    const record = runs('a', [true])[0]!
    expect(() => validateEvalRecord({ ...record, costUsd: undefined })).toThrow(/missing usable run-cost accounting/)
    expect(() => validateEvalRecord({ ...record, costUsd: -1 })).toThrow(/invalid costUsd/)
    expect(() => validateEvalRecord({ ...record, costUsd: undefined, estimatedCostUsd: undefined, fixedCostUsd: 0.2 })).toThrow(/normalized fixedCostUsd is not spend/)
  })

  it('validates finite A/B ceilings and caps each child run to the remaining aggregate budget', () => {
    validateABBudgets(1, 0.3)
    expect(() => validateABBudgets(Number.POSITIVE_INFINITY, 0.3)).toThrow(/finite positive/)
    expect(() => validateABBudgets(0.2, 0.3)).toThrow(/cannot exceed/)
    expect(runBudgetForRemaining(0.3, 0.1)).toBe(0.1)
    expect(runBudgetForRemaining(0.1, 0.3)).toBe(0.1)
    expect(() => runBudgetForRemaining(0.3, 0)).toThrow(/without finite positive remaining budget/)
  })

  it('checks every promotion-critical field before accepting a paired run', () => {
    const left = { provider: 'deepseek', model: 'm', configFingerprint: 'c', runtimeFingerprint: 'r', schemaFingerprint: 's', initialTreeHash: 'i', promptHash: 'p', graderHash: 'g' }
    assertABPairCompatible(left, { ...left }, 'task:1')
    for (const field of Object.keys(left)) {
      expect(() => assertABPairCompatible(left, { ...left, [field]: 'drift' }, 'task:1')).toThrow(field)
    }
  })

  it('strips private reasoning and redacts credential canaries before transcript persistence', () => {
    const safe = transcriptForPersistence([{ role: 'assistant', content: 'token=sk-abcdefghijklmnopqrstuvwxyz', reasoning_content: 'private reasoning', private_reasoning: 'private' }]) as Array<Record<string, unknown>>
    expect(JSON.stringify(safe)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(JSON.stringify(safe)).not.toContain('private reasoning')
    expect(safe[0]).toHaveProperty('content', 'token=[REDACTED]')
  })

  it('fingerprints initial task trees deterministically and detects edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eval-integrity-'))
    try {
      await mkdir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.ts'), 'const x = 1\n')
      const before = await fingerprintTree(root)
      expect(await fingerprintTree(root)).toBe(before)
      await writeFile(join(root, 'src', 'a.ts'), 'const x = 2\n')
      expect(await fingerprintTree(root)).not.toBe(before)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('attests each checker phase and rejects a changed hidden grader copy', () => {
    const clean = attestCheckerTrees({ visibleBefore: 'v', visibleAfter: 'v', hiddenBefore: 'h', hiddenAfter: 'h', hiddenGraderCopyHash: 'grader', graderHash: 'grader' })
    expect(clean.checkerStable).toBe(true)
    expect(clean.hiddenGraderStable).toBe(true)
    expect(clean.integrityFailures).toEqual([])
    const tampered = attestCheckerTrees({ visibleBefore: 'v', visibleAfter: 'changed', hiddenBefore: 'h', hiddenAfter: 'changed', hiddenGraderCopyHash: 'tampered', graderHash: 'grader' })
    expect(tampered.checkerStable).toBe(false)
    expect(tampered.hiddenGraderStable).toBe(false)
    expect(tampered.integrityFailures).toEqual(['workspace changed while checks ran', 'copied hidden grader differs from frozen grader'])
  })

  it('creates a deterministic randomized schedule with the complete common task/run matrix', () => {
    const first = createABJobs(['alpha', 'beta', 'gamma'], 4, 42)
    expect(createABJobs(['alpha', 'beta', 'gamma'], 4, 42)).toEqual(first)
    expect(first.map(job => job.pairId).sort()).toEqual(['alpha', 'beta', 'gamma'].flatMap(task => [1, 2, 3, 4].map(run => `${task}:${run}`)).sort())
    expect(new Set(first.map(job => job.firstArm))).toEqual(new Set(['a', 'b']))
    expect(createABJobs(['alpha', 'beta', 'gamma'], 4, 43)).not.toEqual(first)
  })

  it('freezes distinct arm checkouts and identical task fixtures, then rejects later mutations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eval-ab-plan-'))
    const armA = join(root, 'arm-a'), armB = join(root, 'arm-b')
    const commonOptions = { model: 'deepseek-flash', mode: 'build', browser: 'native', timeout: '10', budget: '1', runBudget: '0.3', official: false, keep: false, transcripts: false }
    try {
      for (const arm of [armA, armB]) {
        await mkdir(join(arm, 'scripts/eval/tasks/frozen/repo'), { recursive: true })
        await mkdir(join(arm, 'scripts/eval/tasks/frozen/check'), { recursive: true })
        await writeFile(join(arm, 'scripts/eval/tasks/frozen/prompt.md'), 'same task')
        await writeFile(join(arm, 'scripts/eval/tasks/frozen/repo/src.txt'), 'same initial tree')
        await writeFile(join(arm, 'scripts/eval/tasks/frozen/check/hidden.test.ts'), 'assert frozen')
      }
      await writeFile(join(armA, 'src.ts'), 'arm a')
      await writeFile(join(armB, 'src.ts'), 'arm b')
      const plan = await createABPlan({ seed: 9, runs: 2, tasks: ['frozen'], rootA: armA, rootB: armB, commonOptions })
      expect(plan.jobs).toHaveLength(2)
      await verifyABPlan(plan)
      await expect(verifyABPlan({ ...plan, commonOptions: { ...plan.commonOptions, budget: 'Infinity' } })).rejects.toThrow(/finite positive/)
      await writeFile(join(armB, 'src.ts'), 'changed after freeze')
      await expect(verifyABPlan(plan)).rejects.toThrow('checkout changed after the plan was frozen')
      await writeFile(join(armB, 'scripts/eval/tasks/frozen/check/hidden.test.ts'), 'changed grader')
      await expect(createABPlan({ seed: 9, runs: 2, tasks: ['frozen'], rootA: armA, rootB: armB, commonOptions }))
        .rejects.toThrow('identical frozen task prompts, repos and hidden graders')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('rejects promotion when paired records used different runtime configuration', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e', 'f']
    const base = freezePlan(tasks.flatMap(task => runs(task, [true, false, false, false, false, true, false, false, false, false])))
    const better = freezePlan(tasks.flatMap(task => runs(task, [true, true, true, true, true, true, false, false, false, false])))
    const drifted = better.map(record => record.task === 'a' && record.run === 1 ? { ...record, configFingerprint: 'different-config' } : record)
    expect(compare(base, drifted, { iterations: 200 }).promoted).toBe(false)
  })
})
