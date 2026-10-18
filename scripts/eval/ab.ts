#!/usr/bin/env bun
/** Frozen two-arm eval scheduler. Creating/verifying a plan is local; model calls require --execute. */
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { execa } from 'execa'
import { fingerprint } from './protocol.js'
import { accountedCostUsd, assertABPairCompatible, createABPlan, runBudgetForRemaining, validateABBudgets, verifyABPlan, type ABPlan } from './schedule.js'
import { validateEvalRecord } from './protocol.js'
import { assertCheckerSandboxAvailable } from './checker.js'

const { values: args } = parseArgs({ options: {
  'root-a': { type: 'string' }, 'root-b': { type: 'string' }, tasks: { type: 'string' }, runs: { type: 'string', default: '1' },
  seed: { type: 'string', default: '1' }, plan: { type: 'string' }, execute: { type: 'boolean', default: false },
  model: { type: 'string' }, mode: { type: 'string', default: 'build' }, effort: { type: 'string' }, browser: { type: 'string', default: 'native' },
  timeout: { type: 'string', default: '10' }, budget: { type: 'string', default: '1' }, 'run-budget': { type: 'string', default: '0.3' },
  official: { type: 'boolean', default: false }, keep: { type: 'boolean', default: false }, transcripts: { type: 'boolean', default: false },
} })

const planPath = args.plan ? resolve(args.plan) : undefined
let plan: ABPlan
if (args.execute) {
  if (!planPath) throw new Error('--execute requires an existing --plan file')
  plan = JSON.parse(await readFile(planPath, 'utf8')) as ABPlan
  await verifyABPlan(plan)
} else {
  if (!planPath || !args['root-a'] || !args['root-b'] || !args.tasks) {
    throw new Error('Plan mode requires --plan, --root-a, --root-b and --tasks; no model calls are made without --execute')
  }
  const tasks = args.tasks.split(',').map(task => task.trim()).filter(Boolean)
  const runs = Number(args.runs), seed = Number(args.seed)
  if (!Number.isInteger(runs) || runs < 1 || !Number.isSafeInteger(seed)) throw new Error('--runs and --seed must be positive/safe integers')
  const rootA = resolve(args['root-a']), rootB = resolve(args['root-b'])
  const inside = (root: string) => {
    const path = relative(root, planPath)
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
  }
  if (inside(rootA) || inside(rootB)) throw new Error('--plan must be outside both arm checkouts so saving it cannot mutate a frozen arm')
  plan = await createABPlan({
    seed, runs, tasks, rootA, rootB,
    commonOptions: {
      model: args.model, mode: args.mode!, effort: args.effort, browser: args.browser!, timeout: args.timeout!,
      budget: args.budget!, runBudget: args['run-budget']!, official: args.official!, keep: args.keep!, transcripts: args.transcripts!,
    },
  })
  await mkdir(dirname(planPath), { recursive: true })
  await writeFile(planPath, JSON.stringify(plan, null, 2), { mode: 0o600 })
  await chmod(planPath, 0o600)
}

console.log(JSON.stringify({
  status: args.execute ? 'EXECUTION_EXPLICITLY_REQUESTED' : 'DRY_RUN_PLAN_ONLY',
  plan: planPath, seed: plan.seed, pairs: plan.jobs.length, tasks: plan.taskRunKeys,
  taskSuiteFingerprint: plan.taskSuiteFingerprint,
  arms: plan.arms.map(({ name, checkoutFingerprint }) => ({ name, checkoutFingerprint })),
  order: plan.jobs.map(job => ({ pairId: job.pairId, firstArm: job.firstArm })),
}, null, 2))
if (!args.execute) process.exit(0)

// Refuse before launching the first paid model worker if checker containment is unavailable.
assertCheckerSandboxAvailable()

const totalBudgetUsd = Number(plan.commonOptions.budget)
const runBudgetUsd = Number(plan.commonOptions.runBudget)
validateABBudgets(totalBudgetUsd, runBudgetUsd)
let accountedSpend = 0
const planId = fingerprint({ seed: plan.seed, tasks: plan.taskRunKeys, arms: plan.arms.map(arm => arm.checkoutFingerprint) }).slice(0, 12)
for (const arm of plan.arms) {
  if (existsSync(join(arm.root, 'scripts/eval/results', `ab-${planId}-${arm.name}.jsonl`))) {
    throw new Error(`Results already exist for plan ${planId} arm ${arm.name}; create a new frozen plan to avoid duplicate/interrupted-pair ambiguity`)
  }
}
const results: Array<{ arm: 'a' | 'b'; record: Record<string, unknown> }> = []

async function runPair(armName: 'a' | 'b', task: string, run: number): Promise<Record<string, unknown>> {
  const arm = plan.arms.find(item => item.name === armName)!
  const workerDir = await mkdtemp(join(tmpdir(), 'deepseek-ab-worker-'))
  const resultPath = join(workerDir, 'record.json')
  const remainingBudget = totalBudgetUsd - accountedSpend
  if (remainingBudget <= 0) throw new Error(`Total A/B budget exhausted before ${armName} ${task}:${run}`)
  const options = plan.commonOptions
  const command = [
    process.execPath, join(arm.root, 'scripts/eval/run.ts'), '--worker', '--worker-run', String(run), '--worker-result', resultPath,
    '--tasks', task, '--runs', '1', '--label', `ab-${planId}-${armName}`, '--mode', options.mode, '--timeout', options.timeout,
    '--budget', String(remainingBudget), '--run-budget', String(runBudgetForRemaining(runBudgetUsd, remainingBudget)), '--browser', options.browser, '--concurrency', '1',
    '--seed', String(plan.seed), '--planned-task-run-keys', JSON.stringify(plan.taskRunKeys),
  ]
  if (options.model) command.push('--model', options.model)
  if (options.effort) command.push('--effort', options.effort)
  if (options.official) command.push('--official')
  if (options.keep) command.push('--keep')
  if (options.transcripts) command.push('--transcripts')
  try {
    const child = Bun.spawn(command, { cwd: arm.root, stdout: 'inherit', stderr: 'inherit' })
    const exitCode = await child.exited
    if (exitCode !== 0) throw new Error(`A/B arm ${armName} ${task}:${run} exited ${exitCode}`)
    const record = JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>
    validateEvalRecord(record)
    if (record.task !== task || record.run !== run) throw new Error(`A/B arm ${armName} returned the wrong task/run record for ${task}:${run}`)
    const spend = accountedCostUsd(record)
    if (spend > remainingBudget) {
      record.pass = false
      record.overBudget = true
      record.outcome = 'budget'
    }
    record.abPlanId = planId
    record.abArm = armName
    record.pairId = `${task}:${run}`
    record.scheduleSeed = plan.seed
    const resultFile = join(arm.root, 'scripts/eval/results', `ab-${planId}-${armName}.jsonl`)
    await mkdir(join(arm.root, 'scripts/eval/results'), { recursive: true })
    accountedSpend += spend
    await appendFile(resultFile, `${JSON.stringify(record)}\n`, { mode: 0o600 })
    return record
  } finally { await rm(workerDir, { recursive: true, force: true }) }
}

for (const job of plan.jobs) {
  const first = job.firstArm
  const second = first === 'a' ? 'b' : 'a'
  const left = await runPair(first, job.task, job.run)
  // Recheck frozen trees before spending on the second arm; result directories are excluded.
  await verifyABPlan(plan)
  const right = await runPair(second, job.task, job.run)
  results.push({ arm: first, record: left }, { arm: second, record: right })
  assertABPairCompatible(left, right, job.pairId)
}
await verifyABPlan(plan)
console.log(`A/B complete: ${results.length} arm runs across ${plan.jobs.length} common task/run pairs; conservative accounted spend $${accountedSpend.toFixed(4)}. No provider seed support is claimed.`)
