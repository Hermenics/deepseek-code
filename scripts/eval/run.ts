#!/usr/bin/env bun
/**
 * Agent-quality eval (improvement plan, step 0).
 *
 * Runs each task in a throwaway git repo with the real Agent from src/ (not dist/), then copies
 * the task's hidden checks in and runs `bun test`. A run passes when that exits 0 and the run finished within
 * its time limit and both budgets.
 *
 *   bun scripts/eval/run.ts [--tasks a,b] [--runs 3] [--label baseline] [--model id] [--mode build] [--timeout 10] [--keep]
 *                           [--official] [--budget 1] [--run-budget 0.3]
 *
 * --official ignores settings.json (endpoint, default model) and uses the official DeepSeek API with
 * deepseek-flash. --budget stops the suite once the estimated spend reaches it (USD); --run-budget
 * aborts a single run that goes over it.
 *
 * Task layout: scripts/eval/tasks/<name>/{prompt.md, repo/, check/}. Fixture tests live in
 * repo/test/ (singular) so the main `bun test tests` filter never picks them up.
 * Results append to scripts/eval/results/<label>.jsonl (git-ignored).
 *
 * Headless like --pipe: no ask_user_questions, destructive shell commands denied, paths outside the task
 * repo denied, post-edit verification always approved, every other approval granted per session.
 */
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { execa } from 'execa'

const EVAL_DIR = import.meta.dir
const TASKS_DIR = join(EVAL_DIR, 'tasks')
const ROOT = resolve(EVAL_DIR, '../..')
const OFFICIAL_BASE_URL = 'https://api.deepseek.com'

const { values: opts } = parseArgs({
  options: {
    tasks: { type: 'string' },
    runs: { type: 'string', default: '1' },
    label: { type: 'string', default: new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') },
    model: { type: 'string' },
    mode: { type: 'string', default: 'build' },
    timeout: { type: 'string', default: '10' },
    keep: { type: 'boolean', default: false },
    official: { type: 'boolean', default: false },
    budget: { type: 'string', default: '1' },
    'run-budget': { type: 'string', default: '0.3' },
  },
})

const MODES = ['build', 'auto', 'plan', 'review']
if (!MODES.includes(opts.mode!)) throw new Error(`--mode must be one of ${MODES.join(', ')}`)
const runs = Number(opts.runs)
const timeoutMs = Number(opts.timeout) * 60_000
if (!Number.isInteger(runs) || runs < 1 || !(timeoutMs > 0)) throw new Error('--runs must be a positive integer and --timeout a positive number of minutes')
const label = opts.label!.replace(/[^\w.-]/g, '_')
const budgetUsd = Number(opts.budget)
const runBudgetUsd = Number(opts['run-budget'])
if (!(budgetUsd > 0) || !(runBudgetUsd > 0)) throw new Error('--budget and --run-budget must be positive USD amounts')

// Keep eval conversations out of the user's real history.
process.env.DEEPSEEK_HISTORY_PATH = join(tmpdir(), `deepseek-eval-history-${process.pid}.json`)
const { Agent } = await import('../../src/agent/agent.js')
const { loadSavedConfig } = await import('../../src/ui/setup/ApiKeySetup.js')
const { setShellConfirmHandler } = await import('../../src/tools/Shell/Shell.js')
const { detectVerificationCommand, runVerification } = await import('../../src/agent/verify.js')

const saved = (await loadSavedConfig()).providerConfig
const officialKey = saved?.apiKey ?? process.env.DEEPSEEK_API_KEY
if (opts.official && !officialKey) throw new Error('--official needs DEEPSEEK_API_KEY in ~/.deepseek/config.json or the environment')
const providerConfig = opts.official ? { provider: 'deepseek' as const, apiKey: officialKey, baseURL: OFFICIAL_BASE_URL } : saved
if (!providerConfig && !process.env.DEEPSEEK_API_KEY) throw new Error('No saved provider config and DEEPSEEK_API_KEY is not set')
const model = opts.model ?? (opts.official ? 'deepseek-flash' : undefined)
setShellConfirmHandler(async () => false)

/** Real account balance (free endpoint); undefined when not using --official or the call fails. */
async function officialBalanceUsd(): Promise<number | undefined> {
  if (!opts.official) return undefined
  try {
    const res = await fetch(`${OFFICIAL_BASE_URL}/user/balance`, { headers: { Authorization: `Bearer ${officialKey}` }, signal: AbortSignal.timeout(15_000) })
    const body = await res.json() as { balance_infos?: { currency: string; total_balance: string }[] }
    const usd = body.balance_infos?.find((b) => b.currency === 'USD')
    return usd ? Number(usd.total_balance) : undefined
  } catch {
    return undefined
  }
}

const allTasks = (await readdir(TASKS_DIR, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()
const tasks = opts.tasks ? opts.tasks.split(',').map((t) => t.trim()) : allTasks
const unknown = tasks.filter((t) => !allTasks.includes(t))
if (unknown.length > 0) throw new Error(`Unknown task(s): ${unknown.join(', ')}. Available: ${allTasks.join(', ')}`)

const commit = (await execa('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })).stdout
const dirty = (await execa('git', ['status', '--porcelain'], { cwd: ROOT })).stdout.length > 0
const resultsFile = join(EVAL_DIR, 'results', `${label}.jsonl`)
await mkdir(join(EVAL_DIR, 'results'), { recursive: true })

const tail = (text: string, lines = 40) => text.split('\n').slice(-lines).join('\n')

async function runOnce(task: string, run: number) {
  const dir = await mkdtemp(join(tmpdir(), `deepseek-eval-${task}-`))
  await cp(join(TASKS_DIR, task, 'repo'), dir, { recursive: true })
  const git = (...args: string[]) => execa('git', args, { cwd: dir })
  await git('init', '-q')
  await git('add', '-A')
  await git('-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'commit', '-qm', 'initial')
  const prompt = (await readFile(join(TASKS_DIR, task, 'prompt.md'), 'utf8')).trim()

  const agent = new Agent(providerConfig ?? undefined, { projectRoot: dir })
  await agent.readyPromise
  if (model) agent.setModel(model as Parameters<typeof agent.setModel>[0])
  agent.interactionMode = opts.mode as typeof agent.interactionMode
  agent.setToolPermissionHandler(async (request) => (request.reason === 'outside_workspace' ? 'deny' : 'session'))
  // Headless stand-in for the TUI's "Run verification?" prompt, answered yes.
  agent.setVerificationHandler(async () => {
    const command = await detectVerificationCommand(dir)
    return command ? runVerification(command, dir) : undefined
  })

  const tools: Record<string, number> = {}
  let error: string | undefined
  let timedOut = false
  const started = Date.now()
  let overBudget = false
  const timer = setTimeout(() => { timedOut = true; agent.abort() }, timeoutMs)
  const costWatch = setInterval(() => {
    if (agent.getSessionStats().costUsd > runBudgetUsd) { overBudget = true; agent.abort() }
  }, 1_000)
  try {
    const finished = new Promise<void>((done, fail) => {
      agent.run(prompt, {
        onToken() {},
        onToolCall(name) { tools[name] = (tools[name] ?? 0) + 1 },
        onToolResult() {},
        onDone: done,
      }).then(() => done(), fail)
    })
    const stuck = new Promise<never>((_, fail) => {
      setTimeout(() => fail(new Error('Agent did not stop within 60s of abort')), timeoutMs + 60_000).unref()
    })
    await Promise.race([finished, stuck])
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    clearTimeout(timer)
    clearInterval(costWatch)
  }
  const durationMs = Date.now() - started
  const stats = agent.getSessionStats()
  const usedModel = agent.model
  const transcript = agent.getRawMessages()
  const finalMessage = transcript
    .flatMap((m) => ('role' in m && m.role === 'assistant' && typeof m.content === 'string' && m.content.trim() ? [m.content] : []))
    .at(-1)?.slice(-1500)
  await agent.shutdown()

  await cp(join(TASKS_DIR, task, 'check'), join(dir, '__eval_check__'), { recursive: true })
  const check = await execa('bun', ['test'], { cwd: dir, reject: false, all: true, timeout: 120_000 })
  // Usage recorded after the last budget poll can still push a run over, so check the final cost too.
  const withinBudget = stats.costUsd <= runBudgetUsd && spentUsd + stats.costUsd <= budgetUsd
  const pass = check.exitCode === 0 && !timedOut && !overBudget && withinBudget
  // Failed runs keep the whole conversation (reasoning, tool calls and results) for diagnosis.
  let transcriptPath: string | undefined
  if (!pass) {
    transcriptPath = join(EVAL_DIR, 'results', label, `${task}-${run}.json`)
    await mkdir(join(EVAL_DIR, 'results', label), { recursive: true })
    await writeFile(transcriptPath, JSON.stringify(transcript, null, 2))
  }
  const record = {
    label, task, run, pass, timedOut, overBudget, error, durationMs, model: usedModel, mode: opts.mode, finalMessage, commit, dirty, tools, ...stats,
    checkOutput: pass ? undefined : tail(check.all ?? ''),
    transcriptPath,
  }
  await appendFile(resultsFile, JSON.stringify(record) + '\n')
  if (opts.keep) console.log(`  kept ${dir}`)
  else await rm(dir, { recursive: true, force: true })
  return record
}

console.log(`Eval "${label}" · ${tasks.length} task(s) × ${runs} run(s) · mode ${opts.mode} · deepseek-code ${commit}${dirty ? '+dirty' : ''}`)
const balanceBefore = await officialBalanceUsd()
if (balanceBefore !== undefined) console.log(`DeepSeek balance $${balanceBefore.toFixed(2)} · budget $${budgetUsd} total, $${runBudgetUsd} per run · model ${model}`)
const records: Awaited<ReturnType<typeof runOnce>>[] = []
let spentUsd = 0
// ponytail: runs are sequential; parallelize once the suite grows and the provider rate limit allows it
suite: for (const task of tasks) {
  for (let run = 1; run <= runs; run++) {
    if (spentUsd >= budgetUsd) {
      console.log(`Budget $${budgetUsd} reached ($${spentUsd.toFixed(4)} estimated); skipping the remaining runs.`)
      break suite
    }
    process.stdout.write(`${task} #${run} … `)
    const r = await runOnce(task, run)
    records.push(r)
    spentUsd += r.costUsd
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${Math.round(r.durationMs / 1000)}s ${r.tokenCount} tok $${r.costUsd.toFixed(4)}${r.timedOut ? ' (timeout)' : ''}${r.overBudget ? ' (run budget)' : ''}${r.error ? ` · error: ${r.error}` : ''}`)
  }
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
console.table(Object.fromEntries(tasks.filter((task) => records.some((r) => r.task === task)).map((task) => {
  const rs = records.filter((r) => r.task === task)
  return [task, {
    pass: `${rs.filter((r) => r.pass).length}/${rs.length}`,
    avgTokens: Math.round(avg(rs.map((r) => r.tokenCount))),
    avgSeconds: Math.round(avg(rs.map((r) => r.durationMs)) / 1000),
    avgCostUsd: Number(avg(rs.map((r) => r.costUsd)).toFixed(4)),
  }]
})))
console.log(`Total: ${records.filter((r) => r.pass).length}/${records.length} passed · estimated $${spentUsd.toFixed(4)} · ${resultsFile}`)
const balanceAfter = await officialBalanceUsd()
if (balanceBefore !== undefined && balanceAfter !== undefined) {
  console.log(`DeepSeek balance $${balanceAfter.toFixed(2)} (real spend ≈ $${(balanceBefore - balanceAfter).toFixed(2)}; the balance can lag a few minutes)`)
}
await rm(process.env.DEEPSEEK_HISTORY_PATH!, { force: true })
process.exit(0)
