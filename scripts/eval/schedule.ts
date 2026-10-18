import { fingerprint, fingerprintTree } from './protocol.js'
import { readFile, realpath } from 'node:fs/promises'

export interface EvalArm { name: 'a' | 'b'; root: string; checkoutFingerprint: string }
export interface ABJob { task: string; run: number; pairId: string; firstArm: 'a' | 'b' }
export interface ABPlan {
  schemaVersion: 1
  seed: number
  taskRunKeys: string[]
  taskSuiteFingerprint: string
  frozenHarnessFingerprint: string
  runtimeLockFingerprint: string
  commonOptions: { model?: string; mode: string; effort?: string; browser: string; timeout: string; budget: string; runBudget: string; official: boolean; keep: boolean; transcripts: boolean }
  arms: EvalArm[]
  jobs: ABJob[]
}

const EXPERIMENTAL_CONFIG_FIELDS = [
  'provider', 'model', 'configFingerprint', 'runtimeFingerprint', 'schemaFingerprint',
  'initialTreeHash', 'promptHash', 'graderHash',
] as const

/** Validate explicit USD ceilings before any worker can be launched. */
export function validateABBudgets(totalBudgetUsd: number, runBudgetUsd: number): void {
  if (!Number.isFinite(totalBudgetUsd) || totalBudgetUsd <= 0
    || !Number.isFinite(runBudgetUsd) || runBudgetUsd <= 0
    || runBudgetUsd > totalBudgetUsd) {
    throw new Error('A/B budgets must be finite positive USD amounts and the per-run budget cannot exceed the total budget')
  }
}

/** Never pass a per-run ceiling larger than the remaining aggregate A/B allowance. */
export function runBudgetForRemaining(runBudgetUsd: number, remainingBudgetUsd: number): number {
  if (!Number.isFinite(runBudgetUsd) || runBudgetUsd <= 0 || !Number.isFinite(remainingBudgetUsd) || remainingBudgetUsd <= 0) {
    throw new Error('Cannot launch an A/B run without finite positive remaining budget')
  }
  return Math.min(runBudgetUsd, remainingBudgetUsd)
}

/** Use observed/estimated run spend conservatively; normalized fixed-price comparison cost is separate. */
export function accountedCostUsd(record: Record<string, unknown>): number {
  const values: number[] = []
  for (const key of ['estimatedCostUsd', 'actualCostUsd', 'costUsd'] as const) {
    const value = record[key]
    if (value === undefined || value === null && key === 'actualCostUsd') continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`Eval record has unusable ${key}; refusing to treat missing or invalid cost as zero`)
    }
    values.push(value)
  }
  if (!values.length) throw new Error('Eval record has no finite non-negative cost estimate or observation')
  return Math.max(...values)
}

/** Require every promotion-critical identity to match before proceeding to the next pair. */
export function assertABPairCompatible(left: Record<string, unknown>, right: Record<string, unknown>, pairId: string): void {
  const differences = EXPERIMENTAL_CONFIG_FIELDS.filter(field => typeof left[field] !== 'string' || !left[field]
    || typeof right[field] !== 'string' || !right[field] || left[field] !== right[field])
  if (differences.length) throw new Error(`Experimental config changed within pair ${pairId} (${differences.join(', ')}); records retained but comparison must not promote`)
}

/** Stable seeded PRNG shared by plan creation and tests. */
function randomFor(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffled<T>(items: T[], seed: number): T[] {
  const result = [...items]
  const random = randomFor(seed)
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

export function createABJobs(tasks: string[], runs: number, seed: number): ABJob[] {
  if (!Number.isSafeInteger(seed) || !Number.isInteger(runs) || runs < 1 || tasks.length < 1 || new Set(tasks).size !== tasks.length) {
    throw new Error('A/B schedule needs unique tasks, positive runs and a safe seed')
  }
  const random = randomFor(seed)
  const jobs = tasks.flatMap(task => Array.from({ length: runs }, (_, i) => ({
    task, run: i + 1, pairId: `${task}:${i + 1}`, firstArm: (random() < 0.5 ? 'a' : 'b') as 'a' | 'b',
  })))
  return shuffled(jobs, seed ^ 0x5f3759df)
}

/** Fingerprint code and local fixtures, excluding only volatile VCS/dependency/eval output. */
export async function fingerprintArm(root: string): Promise<string> {
  return fingerprintTree(root, new Set(['.git', 'node_modules', '__eval_check__']), new Set(['scripts/eval/results']))
}

export async function fingerprintTaskSuite(root: string, tasks: string[]): Promise<string> {
  const entries = await Promise.all([...tasks].sort().map(async task => [task, await fingerprintTree(`${root}/scripts/eval/tasks/${task}`)] as const))
  return fingerprint(entries)
}

async function sharedFingerprints(root: string): Promise<{ harness: string; lock: string }> {
  const [harness, packageManifest, bunLock, npmLock, pnpmLock] = await Promise.all([
    fingerprintTree(`${root}/scripts/eval`, new Set(['.git', 'node_modules', '__eval_check__']), new Set(['tasks', 'results'])),
    readFile(`${root}/package.json`).catch(() => Buffer.from('')),
    readFile(`${root}/bun.lock`).catch(() => Buffer.from('')),
    readFile(`${root}/package-lock.json`).catch(() => Buffer.from('')),
    readFile(`${root}/pnpm-lock.yaml`).catch(() => Buffer.from('')),
  ])
  return { harness, lock: fingerprint([packageManifest.toString('base64'), bunLock.toString('base64'), npmLock.toString('base64'), pnpmLock.toString('base64')]) }
}

export async function createABPlan(input: {
  seed: number; runs: number; tasks: string[]; rootA: string; rootB: string;
  commonOptions: ABPlan['commonOptions']
}): Promise<ABPlan> {
  validateABBudgets(Number(input.commonOptions.budget), Number(input.commonOptions.runBudget))
  const [checkoutA, checkoutB, suiteA, suiteB, sharedA, sharedB] = await Promise.all([
    fingerprintArm(input.rootA), fingerprintArm(input.rootB),
    fingerprintTaskSuite(input.rootA, input.tasks), fingerprintTaskSuite(input.rootB, input.tasks),
    sharedFingerprints(input.rootA), sharedFingerprints(input.rootB),
  ])
  if (await realpath(input.rootA) === await realpath(input.rootB)) throw new Error('A/B arms must be distinct checkout directories')
  if (suiteA !== suiteB) throw new Error('A/B arms do not have identical frozen task prompts, repos and hidden graders')
  if (sharedA.harness !== sharedB.harness || sharedA.lock !== sharedB.lock) throw new Error('A/B arms must use identical eval harness scripts and dependency lockfiles')
  const taskRunKeys = input.tasks.flatMap(task => Array.from({ length: input.runs }, (_, index) => `${task}:${index + 1}`)).sort()
  return {
    schemaVersion: 1, seed: input.seed, taskRunKeys,
    taskSuiteFingerprint: suiteA,
    frozenHarnessFingerprint: sharedA.harness,
    runtimeLockFingerprint: sharedA.lock,
    commonOptions: input.commonOptions,
    arms: [
      { name: 'a', root: input.rootA, checkoutFingerprint: checkoutA },
      { name: 'b', root: input.rootB, checkoutFingerprint: checkoutB },
    ],
    jobs: createABJobs(input.tasks, input.runs, input.seed),
  }
}

export async function verifyABPlan(plan: ABPlan): Promise<void> {
  if (plan.schemaVersion !== 1 || !Number.isSafeInteger(plan.seed) || plan.arms.length !== 2 || plan.jobs.length !== plan.taskRunKeys.length) {
    throw new Error('Invalid A/B plan')
  }
  validateABBudgets(Number(plan.commonOptions?.budget), Number(plan.commonOptions?.runBudget))
  const [a, b] = plan.arms
  if (a?.name !== 'a' || b?.name !== 'b' || a.root === b.root) throw new Error('A/B plan must identify two distinct arms')
  const [actualA, actualB, suiteA, suiteB, sharedA, sharedB] = await Promise.all([
    fingerprintArm(a.root), fingerprintArm(b.root),
    fingerprintTaskSuite(a.root, [...new Set(plan.taskRunKeys.map(key => key.slice(0, key.lastIndexOf(':'))))]),
    fingerprintTaskSuite(b.root, [...new Set(plan.taskRunKeys.map(key => key.slice(0, key.lastIndexOf(':'))))]),
    sharedFingerprints(a.root), sharedFingerprints(b.root),
  ])
  if (actualA !== a.checkoutFingerprint || actualB !== b.checkoutFingerprint) throw new Error('A/B checkout changed after the plan was frozen')
  if (suiteA !== suiteB || suiteA !== plan.taskSuiteFingerprint) throw new Error('A/B frozen task suite changed after the plan was created')
  if (sharedA.harness !== plan.frozenHarnessFingerprint || sharedB.harness !== plan.frozenHarnessFingerprint || sharedA.lock !== plan.runtimeLockFingerprint || sharedB.lock !== plan.runtimeLockFingerprint) {
    throw new Error('A/B eval harness or dependency lockfile changed after the plan was created')
  }
  const planned = new Set(plan.taskRunKeys)
  if (planned.size !== plan.taskRunKeys.length || plan.taskRunKeys.some(key => !/^[^:]+:[1-9]\d*$/.test(key)) || plan.jobs.some(job =>
    !planned.has(job.pairId) || job.pairId !== `${job.task}:${job.run}` || !Number.isSafeInteger(job.run) || job.run < 1 || !['a', 'b'].includes(job.firstArm)) ||
    new Set(plan.jobs.map(job => job.pairId)).size !== planned.size || plan.jobs.length !== planned.size) {
    throw new Error('A/B plan has missing, duplicate or invalid pair assignments')
  }
}
