#!/usr/bin/env bun
/**
 * Agent-quality eval (improvement plan, step 0).
 *
 * Runs each task in a throwaway git repo with the real Agent from src/ (not dist/), runs the repo's own
 * `bun test`, then copies the task's hidden checks in and runs them alone. A run passes when both exit 0 and
 * the run finished within its time limit and both budgets. `outcome` splits the failures by cause (see
 * compare.ts classifyOutcome) and `hiddenPass` records the hidden checks alone. Compare labels with compare.ts.
 *
 *   bun scripts/eval/run.ts [--tasks a,b] [--runs 3] [--label baseline] [--model id] [--mode build] [--timeout 10] [--keep] [--transcripts] [--concurrency 4]
 *                           [--official] [--budget 1] [--run-budget 0.3] [--effort low|high|max]
 *
 * --official ignores settings.json (endpoint, default model) and uses the official DeepSeek API with
 * deepseek-flash. --budget stops the suite once the estimated spend reaches it (USD); --run-budget
 * aborts a single run that goes over it.
 *
 * Task layout: scripts/eval/tasks/<name>/{prompt.md, repo/, check/}. Fixture tests live in
 * repo/test/ (singular) so the main `bun test tests` filter never picks them up.
 *
 * Browser tasks add serve.ts (a fixture web server started outside the agent's workspace, see
 * browser-fixture.ts); prompt placeholders `{{URL}}` and `{{key}}` come from its per-run state, and
 * check/expect.json `{ "finalMessageIncludes": "answer" }` also requires the final message to quote
 * the value only the rendered page shows. --browser native (default) enables the built-in browser
 * tool; --browser playwright disables it and gives the agent the Playwright MCP server instead
 * (approved with a throwaway trust file, never the user's).
 * Results append to scripts/eval/results/<label>.jsonl (git-ignored). Each run uses its own Bun process so
 * module-level state such as todoStore cannot leak between concurrent Agent instances.
 *
 * Headless like --pipe: no ask_user_questions, paths outside the task repo rejected (the model gets a path
 * error and keeps going), post-edit verification always approved, and every other approval, risky shell
 * commands included, granted per session. Memory is off (DEEPSEEK_DISABLE_MEMORY) so runs do not learn
 * from each other.
 */
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
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
    effort: { type: 'string' },
    browser: { type: 'string', default: 'native' },
    transcripts: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '1' },
    worker: { type: 'boolean', default: false },
    'worker-run': { type: 'string' },
    'worker-result': { type: 'string' },
  },
})
if (!['native', 'playwright'].includes(opts.browser!)) throw new Error('--browser must be native or playwright')

const MODES = ['build', 'auto', 'plan', 'review']
if (!MODES.includes(opts.mode!)) throw new Error(`--mode must be one of ${MODES.join(', ')}`)
const runs = Number(opts.runs)
const timeoutMs = Number(opts.timeout) * 60_000
if (!Number.isInteger(runs) || runs < 1 || !(timeoutMs > 0)) throw new Error('--runs must be a positive integer and --timeout a positive number of minutes')
const label = opts.label!.replace(/[^\w.-]/g, '_')
const budgetUsd = Number(opts.budget)
const runBudgetUsd = Number(opts['run-budget'])
if (!(budgetUsd > 0) || !(runBudgetUsd > 0)) throw new Error('--budget and --run-budget must be positive USD amounts')
const EFFORTS = ['low', 'high', 'max'] as const
type Effort = typeof EFFORTS[number]
if (opts.effort !== undefined && !EFFORTS.includes(opts.effort as Effort)) throw new Error(`--effort must be one of ${EFFORTS.join(', ')}`)

// Keep eval conversations out of the user's real history.
process.env.DEEPSEEK_HISTORY_PATH = join(tmpdir(), `deepseek-eval-history-${process.pid}.json`)
process.env.DEEPSEEK_DISABLE_MEMORY = '1'
const { Agent } = await import('../../src/agent/agent.js')
const { loadSavedConfig } = await import('../../src/ui/setup/ApiKeySetup.js')
const { setShellConfirmHandler } = await import('../../src/tools/Shell/Shell.js')
const { detectVerificationCommand, runVerification } = await import('../../src/agent/verify.js')
const { classifyOutcome, fixedCostUsd } = await import('./compare.js')
const { approveMcpConfig, loadMcpTools } = await import('../../src/agent/mcp.js')

/** Starts a browser task's fixture server; resolves with its URL and the per-run state (answer included). */
async function startFixture(task: string, repoDir: string): Promise<{ url: string; state: Record<string, string>; stop: () => Promise<void> } | null> {
  const serve = join(TASKS_DIR, task, 'serve.ts')
  if (!existsSync(serve)) return null
  const stateDir = await mkdtemp(join(tmpdir(), 'deepseek-eval-state-'))
  const stateFile = join(stateDir, 'state.json')
  const proc = Bun.spawn(['bun', serve], { env: { ...process.env, EVAL_REPO: repoDir, EVAL_STATE: stateFile }, stdout: 'pipe', stderr: 'inherit' })
  const stop = async () => {
    if (proc.exitCode === null) proc.kill()
    await proc.exited
    await rm(stateDir, { recursive: true, force: true })
  }
  const reader = proc.stdout.getReader()
  let output = ''
  const deadline = Date.now() + 15_000
  while (!/READY (\S+)/.test(output)) {
    if (Date.now() > deadline) { await stop(); throw new Error(`${task}/serve.ts did not print READY`) }
    let timer: ReturnType<typeof setTimeout>
    let read: Awaited<ReturnType<typeof reader.read>> | null
    try {
      read = await Promise.race([
        reader.read(),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), deadline - Date.now()) }),
      ])
    } finally {
      clearTimeout(timer!)
    }
    if (read === null) { await stop(); throw new Error(`${task}/serve.ts did not print READY`) }
    if (read.done) { await stop(); throw new Error(`${task}/serve.ts exited before READY`) }
    output += new TextDecoder().decode(read.value)
  }
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, string>
    return { url: output.match(/READY (\S+)/)![1]!, state, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

/** Gives the agent the Playwright MCP server (the comparison baseline), approved with a throwaway trust file. */
async function installPlaywrightMcp(agent: InstanceType<typeof Agent>, dir: string): Promise<() => Promise<void>> {
  const trustDir = await mkdtemp(join(tmpdir(), 'deepseek-eval-trust-'))
  const trustFile = join(trustDir, 'trust.json')
  try {
    const pending = await loadMcpTools(dir, { enabled: true, trustFile })
    if (pending.approval) await approveMcpConfig(dir, pending.approval, trustFile)
    const loaded = await loadMcpTools(dir, { enabled: true, trustFile, initialTimeoutMs: 60_000 })
    if (loaded.errors.length) throw new Error(`Playwright MCP failed: ${loaded.errors.join('; ')}`)
    ;(agent as unknown as { installMcpTools(tools: unknown[]): void }).installMcpTools(loaded.tools)
    return async () => {
      try { await loaded.cleanup?.() }
      finally { await rm(trustDir, { recursive: true, force: true }) }
    }
  } catch (error) {
    await rm(trustDir, { recursive: true, force: true })
    throw error
  }
}

const saved = (await loadSavedConfig()).providerConfig
const officialKey = saved?.apiKey ?? process.env.DEEPSEEK_API_KEY
if (opts.official && !officialKey) throw new Error('--official needs DEEPSEEK_API_KEY in ~/.deepseek/config.json or the environment')
const providerConfig = opts.official ? { provider: 'deepseek' as const, apiKey: officialKey, baseURL: OFFICIAL_BASE_URL } : saved
if (!providerConfig && !process.env.DEEPSEEK_API_KEY) throw new Error('No saved provider config and DEEPSEEK_API_KEY is not set')
const model = opts.model ?? (opts.official ? 'deepseek-flash' : undefined)
// Host only: the key and any path or query never reach the results file.
const baseURLHost = (() => {
  const url = (providerConfig?.provider === 'local' ? providerConfig.localBaseUrl : undefined) ?? providerConfig?.baseURL ?? process.env.DEEPSEEK_BASE_URL
  try { return url ? new URL(url).host : 'default' } catch { return 'invalid' }
})()
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
  /** Runs git inside the task repository. */
  const git = (...args: string[]) => execa('git', args, { cwd: dir })
  const browserTask = existsSync(join(TASKS_DIR, task, 'serve.ts'))
  if (browserTask && opts.browser === 'playwright') {
    await mkdir(join(dir, '.deepseek'), { recursive: true })
    await writeFile(join(dir, '.deepseek', 'mcp.json'), JSON.stringify({ servers: { playwright: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated', '--browser', 'chrome'] } } }, null, 2))
  }
  await git('init', '-q')
  await git('add', '-A')
  await git('-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'commit', '-qm', 'initial')
  const fixture = await startFixture(task, dir)
  let ownedAgent: InstanceType<typeof Agent> | undefined
  let closeMcp: (() => Promise<void>) | undefined
  try {
    const prompt = (await readFile(join(TASKS_DIR, task, 'prompt.md'), 'utf8')).trim()
      .replaceAll('{{URL}}', fixture?.url ?? '')
      .replace(/\{\{(\w+)\}\}/g, (match, key: string) => fixture?.state[key] ?? match)
    process.env.DEEPSEEK_FEATURES = browserTask && opts.browser === 'native' ? 'browser' : '-browser'

    const agent = new Agent(providerConfig ?? undefined, { projectRoot: dir })
    ownedAgent = agent
    await agent.readyPromise
    closeMcp = browserTask && opts.browser === 'playwright' ? await installPlaywrightMcp(agent, dir) : undefined
  if (model) agent.setModel(model as Parameters<typeof agent.setModel>[0])
  agent.interactionMode = opts.mode as typeof agent.interactionMode
  if (opts.effort) agent.setEffortLevel(opts.effort as Effort)
  agent.setToolPermissionHandler(async (request) => (request.reason === 'outside_workspace' ? 'reject' : 'session'))
  // Headless stand-in for the TUI's "Run verification?" prompt, answered yes.
  agent.setVerificationHandler(async () => {
    const command = await detectVerificationCommand(dir)
    return command ? runVerification(command, dir) : undefined
  })

  const tools: Record<string, number> = {}
  // Latest token breakdown per delegated task (subagents + their verifiers); the parent's stats only
  // carry its own tokens, so the fixed-price cost adds these.
  const delegated = new Map<string, { promptTokens?: number; completionTokens?: number; cachedTokens?: number }>()
  const unsubscribe = agent.orchestrator.subscribe((event) => {
    if (event.type === 'metrics_updated' && event.taskId) delegated.set(event.taskId, event.payload.metrics as { promptTokens?: number })
  })
  let error: string | undefined
  let timedOut = false
  let denyAborted = false
  const started = Date.now()
  let overBudget = false
  const timer = setTimeout(() => { timedOut = true; agent.abort() }, timeoutMs)
  const costWatch = setInterval(() => {
    if (agent.getSessionStats().costUsd > Math.min(runBudgetUsd, budgetUsd)) { overBudget = true; agent.abort() }
  }, 1_000)
  try {
    const finished = new Promise<void>((done, fail) => {
      agent.run(prompt, {
        onToken() {},
        onToolCall(name) { tools[name] = (tools[name] ?? 0) + 1 },
        onToolResult() {},
        onDone: done,
        onDenyAbort() { denyAborted = true },
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
  const effort = agent.effortLevel
  const budgetLevel = agent.settings.budget ?? 'default'
  unsubscribe()
  const delegatedUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
  for (const m of delegated.values()) {
    delegatedUsage.promptTokens += m.promptTokens ?? 0
    delegatedUsage.completionTokens += m.completionTokens ?? 0
    delegatedUsage.cachedTokens += m.cachedTokens ?? 0
  }
  const modelCalls = transcript.filter((m) => 'role' in m && m.role === 'assistant').length
  const expectFile = join(TASKS_DIR, task, 'check', 'expect.json')
  const expected = existsSync(expectFile) ? (JSON.parse(await readFile(expectFile, 'utf8')) as { finalMessageIncludes?: string }).finalMessageIncludes : undefined
  const answer = expected ? fixture?.state[expected] : undefined
  const answerOk = answer === undefined || (finalMessage ?? '').toLowerCase().includes(answer.toLowerCase())

  // Hash of everything the agent changed, so identical outputs across runs are visible.
  await git('add', '-A')
  const diff = await git('diff', '--cached', '--binary', 'HEAD')
  const diffHash = createHash('sha256').update(diff.stdout).digest('hex').slice(0, 16)
  // Visible tests first, then the hidden checks alone, so neither suite runs twice.
  const visible = await execa('bun', ['test'], { cwd: dir, reject: false, all: true, timeout: 120_000 })
  await cp(join(TASKS_DIR, task, 'check'), join(dir, '__eval_check__'), { recursive: true })
  const hidden = await execa('bun', ['test', './__eval_check__'], { cwd: dir, reject: false, all: true, timeout: 120_000 })
  const hiddenPass = hidden.exitCode === 0 && answerOk
  // Usage recorded after the last budget poll can still push a run over, so check both limits again.
  if (stats.costUsd > budgetUsd) overBudget = true
  const withinBudget = stats.costUsd <= runBudgetUsd && !overBudget
  const pass = visible.exitCode === 0 && hiddenPass && !timedOut && !overBudget && withinBudget
  // Failed runs keep the whole conversation (reasoning, tool calls and results) for diagnosis; --transcripts keeps every run's.
  let transcriptPath: string | undefined
  if (!pass || opts.transcripts) {
    transcriptPath = join(EVAL_DIR, 'results', label, `${task}-${run}.json`)
    await mkdir(join(EVAL_DIR, 'results', label), { recursive: true })
    await writeFile(transcriptPath, JSON.stringify(transcript, null, 2))
  }
  const outcome = classifyOutcome({ pass, timedOut, overBudget, error, finalMessage, denyAborted })
  const record = {
    label, task, run, pass, outcome, hiddenPass, answerOk, browserArm: browserTask ? opts.browser : undefined, modelCalls, timedOut, overBudget, denyAborted, error, durationMs,
    model: usedModel, mode: opts.mode, effort, budgetLevel, baseURLHost, diffHash, finalMessage, commit, dirty, tools, ...stats,
    delegatedUsage,
    fixedCostUsd: fixedCostUsd({
      promptTokens: stats.promptTokens + delegatedUsage.promptTokens,
      completionTokens: stats.completionTokens + delegatedUsage.completionTokens,
      cachedTokens: stats.cachedTokens + delegatedUsage.cachedTokens,
    }),
    checkOutput: pass ? undefined : tail(`${visible.all ?? ''}\n--- hidden checks ---\n${hidden.all ?? ''}${answerOk ? '' : `\n--- the final message did not quote the page value ${answer} ---`}`),
    transcriptPath,
  }
  if (opts.keep) console.log(`  kept ${dir}`)
  else await rm(dir, { recursive: true, force: true })
  return record
  } finally {
    try { await closeMcp?.() }
    finally {
      try { await ownedAgent?.shutdown() }
      finally { await fixture?.stop() }
    }
  }
}

const records: Awaited<ReturnType<typeof runOnce>>[] = []
let spentUsd = 0

if (opts.worker) {
  const task = tasks[0]
  const run = Number(opts['worker-run'])
  const resultPath = opts['worker-result'] ? resolve(opts['worker-result']) : ''
  const resultRelative = resultPath ? relative(tmpdir(), resultPath) : ''
  const outsideTmp = resultRelative === '..'
    || resultRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(resultRelative)
  if (tasks.length !== 1 || runs !== 1 || !task || !Number.isInteger(run) || run < 1 || !resultPath || outsideTmp) {
    throw new Error('Invalid internal eval worker arguments')
  }
  const record = await runOnce(task, run)
  await writeFile(resultPath, JSON.stringify(record))
  await rm(process.env.DEEPSEEK_HISTORY_PATH!, { force: true })
  process.exit(0)
}

console.log(`Eval "${label}" · ${tasks.length} task(s) × ${runs} run(s) · mode ${opts.mode} · deepseek-code ${commit}${dirty ? '+dirty' : ''}`)
const balanceBefore = await officialBalanceUsd()
if (balanceBefore !== undefined) console.log(`DeepSeek balance $${balanceBefore.toFixed(2)} · budget $${budgetUsd} total, $${runBudgetUsd} per run · model ${model}`)
const concurrency = Math.max(1, Math.trunc(Number(opts.concurrency)) || 1)
const jobs = tasks.flatMap(task => Array.from({ length: runs }, (_, i) => ({ task, run: i + 1 })))
let budgetHit = false

async function runIsolated(task: string, run: number) {
  const workerDir = await mkdtemp(join(tmpdir(), 'deepseek-eval-worker-'))
  const resultPath = join(workerDir, 'record.json')
  const remainingBudget = budgetUsd - spentUsd
  const workerBudget = concurrency === 1 ? remainingBudget : remainingBudget / concurrency
  const args = [
    join(EVAL_DIR, 'run.ts'), '--worker', '--worker-run', String(run), '--worker-result', resultPath,
    '--tasks', task, '--runs', '1', '--label', label, '--mode', opts.mode!, '--timeout', opts.timeout!,
    '--budget', String(workerBudget), '--run-budget', String(runBudgetUsd), '--browser', opts.browser!, '--concurrency', '1',
  ]
  if (opts.model) args.push('--model', opts.model)
  if (opts.effort) args.push('--effort', opts.effort)
  if (opts.official) args.push('--official')
  if (opts.keep) args.push('--keep')
  if (opts.transcripts) args.push('--transcripts')

  try {
    const child = Bun.spawn([process.execPath, ...args], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
    const exitCode = await child.exited
    if (exitCode !== 0) throw new Error(`${task} #${run} worker exited with code ${exitCode}`)
    return JSON.parse(await readFile(resultPath, 'utf8')) as Awaited<ReturnType<typeof runOnce>>
  } finally {
    await rm(workerDir, { recursive: true, force: true })
  }
}

// The parent owns scheduling and result writes; each worker owns one Agent and all its module state.
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    if (spentUsd >= budgetUsd) {
      if (!budgetHit) console.log(`Budget $${budgetUsd} reached ($${spentUsd.toFixed(4)} estimated); skipping the remaining runs.`)
      budgetHit = true
      return
    }
    if (concurrency === 1) process.stdout.write(`${job.task} #${job.run} … `)
    const r = await runIsolated(job.task, job.run)
    if (spentUsd + r.costUsd > budgetUsd) {
      r.pass = false
      r.overBudget = true
      r.outcome = classifyOutcome(r)
    }
    records.push(r)
    spentUsd += r.costUsd
    await appendFile(resultsFile, JSON.stringify(r) + '\n')
    console.log(`${concurrency === 1 ? '' : `${job.task} #${job.run} `}${r.pass ? 'PASS' : `FAIL (${r.outcome})`} ${Math.round(r.durationMs / 1000)}s ${r.tokenCount} tok $${r.costUsd.toFixed(4)}${r.timedOut ? ' (timeout)' : ''}${r.overBudget ? ' (run budget)' : ''}${r.error ? ` · error: ${r.error}` : ''}`)
  }
}))

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
