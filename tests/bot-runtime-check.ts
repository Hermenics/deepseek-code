// Runnable process-level check: bun tests/bot-runtime-check.ts
// Child-only configuration doubles keep the real Agent, HTTP provider and tools in use.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { BotStore } from '../src/bots/store.js'
import { findChromium } from '../src/utils/platform.js'

if (process.argv[2] === '--bot-worker') {
  if (process.connected) {
    assert.equal(process.env.DEEPSEEK_BOTS_TOKEN, undefined)
    assert.equal(process.env.BOT_CHECK_SUPERVISOR_SECRET, undefined)
    assert.equal(process.env.OPENAI_API_KEY, undefined)
  }
  process.env.DEEPSEEK_NO_STREAM = process.env.BOT_CHECK_STREAMING ? '0' : '1'
  process.env.DEEPSEEK_DISABLE_MEMORY = '1'
  process.env.DEEPSEEK_FEATURES = 'browser'
  const { mock } = await import('bun:test')
  const providerUrl = process.env.BOT_CHECK_PROVIDER_URL ?? await readFile(`${process.argv[3]}.provider-url`, 'utf8').catch(() => '')
  const provider = { provider: 'local' as const, localBaseUrl: providerUrl, localModel: 'bot-check' }
  mock.module('../src/settings/loader.js', () => ({ loadMergedSettings: async () => ({
    interaction: { defaultMode: 'build' }, mcp: { enabled: false }, memory: { enabled: false },
    promptRefiner: { enabled: false }, git: { checkpoint: false, verifyAfterEdit: false },
    permissions: { allow: ['Shell(*)', 'read_file(*)'], deny: ['Shell(rm *)'] },
  }) }))
  mock.module('../src/ui/setup/ApiKeySetup.js', () => ({ loadSavedConfig: async () => ({ providerConfig: process.env.BOT_CHECK_NO_PROVIDER ? null : provider, theme: 'dark', language: null, enchant: false }) }))
  const pauseBoundary = (message: object, file: string) => {
    process.send?.(message)
    const deadline = Date.now() + 15000, wait = new Int32Array(new SharedArrayBuffer(4))
    while (!existsSync(file)) {
      if (Date.now() > deadline) throw Error('Native fixture boundary timed out')
      Atomics.wait(wait, 0, 0, 20)
    }
  }
  if (process.env.BOT_CHECK_CONTROL_GATE) {
    const { botControl: nativeControl } = await import('../src/bots/control.js')
    mock.module('../src/bots/control.js', () => ({ botControl(...args: Parameters<typeof nativeControl>) {
      const tool = nativeControl(...args), execute = tool.execute.bind(tool)
      let paused = false
      tool.execute = async (input, context, callbacks) => {
        // Native admission already completed; pause outside the mutation's transaction.
        if (!paused) { paused = true; pauseBoundary({ type: 'control-barrier' }, process.env.BOT_CHECK_CONTROL_GATE!) }
        return execute(input, context, callbacks)
      }
      return tool
    } }))
  }
  if (process.env.BOT_CHECK_PROCEDURE_GATE) {
    const exports = { ...await import('../src/bots/procedures.js') }, nativeGuard = exports.procedureGuard
    mock.module('../src/bots/procedures.js', () => ({ ...exports, procedureGuard(...args: Parameters<typeof nativeGuard>) {
      const guard = nativeGuard(...args), before = guard.before.bind(guard)
      let paused = false
      guard.before = async (input, tab) => {
        // Native batch/action admission completed; DOM checking has no SQLite writer yet.
        if (!paused && input.action === 'click') { paused = true; pauseBoundary({ type: 'procedure-barrier' }, process.env.BOT_CHECK_PROCEDURE_GATE!) }
        return before(input, tab)
      }
      return guard
    } }))
  }
  if (process.env.BOT_CHECK_CRASH === '1') BotStore.prototype.completeAction = () => { process.exit(86) }
  if (process.env.BOT_CHECK_STOP_GATE) {
    const acknowledge = BotStore.prototype.acknowledgeStop
    let paused = false
    BotStore.prototype.acknowledgeStop = function(...args) {
      if (!paused) {
        paused = true; pauseBoundary({ type: 'stop-barrier' }, process.env.BOT_CHECK_STOP_GATE!)
      }
      return acknowledge.apply(this, args)
    }
  }
  if (process.env.BOT_CHECK_ADMISSION_GATE) {
    const consume = BotStore.prototype.consumeDecision, writeOwned = BotStore.prototype.writeOwned
    let approved = false, paused = false
    BotStore.prototype.consumeDecision = function(...args) {
      const result = consume.apply(this, args)
      approved = true
      return result
    }
    BotStore.prototype.writeOwned = async function<T>(runId: string, owner: string, operation: () => T, signal?: AbortSignal): Promise<T> {
      // The approval transaction has committed. Pause before the next owned
      // transaction, so another process can commit guidance before admission.
      if (approved && !paused) {
        paused = true; pauseBoundary({ type: 'admission-barrier' }, process.env.BOT_CHECK_ADMISSION_GATE!)
      }
      return writeOwned.call(this, runId, owner, operation, signal) as Promise<T>
    }
  }
  if (process.env.BOT_CHECK_CLAIM_GATE) {
    const claim = BotStore.prototype.claim
    let paused = false
    BotStore.prototype.claim = function(...args) {
      if (!paused) {
        paused = true; pauseBoundary({ type: 'claim-barrier' }, process.env.BOT_CHECK_CLAIM_GATE!)
      }
      return claim.apply(this, args)
    }
  }
  if (process.env.BOT_CHECK_ACTIVITY_PHASE) {
    // Pause only callback delivery, before its database transaction can start.
    const { Agent } = await import('../src/agent/agent.js')
    const original = Agent.prototype.run, phase = process.env.BOT_CHECK_ACTIVITY_PHASE
    let paused = false
    const pause = () => {
      if (paused) return
      paused = true; pauseBoundary({ type: 'activity-barrier', phase }, join(dirname(process.argv[3]!), 'release-activity'))
    }
    Agent.prototype.run = function(input, cb) {
      return original.call(this, input, { ...cb,
        onToolCall(name, args) { if (phase === 'call') pause(); cb.onToolCall(name, args) },
        onToolResult(name, result, args) { if (phase === 'result') pause(); cb.onToolResult(name, result, args) },
      })
    }
  }
  const { runBotWorker } = await import('../src/bots/worker.js')
  await runBotWorker(process.argv[3]!, process.argv[4]!)
} else {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-bot-runtime-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  const bot = store.createBot({ name: 'engineer', projectRoot: directory, instructions: 'Carry out the queued request and report observed results.' })
  const receiver = store.createBot({ name: 'researcher', projectRoot: directory, instructions: 'Read the source and report its actual contents.', agentConfig: 'reviewer' })
  await writeFile(join(directory, 'input.txt'), 'Persisted source evidence')
  const privateDirectory = join(directory, 'actors', bot.id, 'private-fixture')
  await mkdir(privateDirectory, { recursive: true })
  await writeFile(join(privateDirectory, 'state.txt'), 'private-runtime-proof')
  let privateStateLeaked = false
  let requests = 0, independentTaskIsolated = false, browserSessionRestored = false, humanLogin = false
  let procedureEffects = 0, changedProcedure = false, learnedName = '', learnedSkillRead = false, procedureRejectionObserved = false
  let releaseChild: (() => void) | undefined, childWaiting = false
  const childGate = new Promise<void>(resolve => { releaseChild = resolve })
  let releaseFollowup: (() => void) | undefined, followupWaiting = false, followupRequested = false
  const followupGate = new Promise<void>(resolve => { releaseFollowup = resolve })
  const response = (message: object, finishReason = 'stop') => Response.json({
    id: 'bot-check-completion', object: 'chat.completion', created: 1, model: 'bot-check',
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
  })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/procedure') return new Response(`<!doctype html><title>Procedure</title><label>Message<input id=message></label><button onclick="fetch('/procedure-effect',{method:'POST'});out.textContent='Saved '+message.value">${changedProcedure ? 'Publish' : 'Save'}</button><p id=out></p>`, { headers: { 'content-type': 'text/html' } })
    if (url.pathname === '/procedure-effect') { procedureEffects++; return new Response('ok') }
    if (url.pathname === '/browser-login') return new Response('<!doctype html><title>Fixture</title><p>Logged in</p>', { headers: { 'content-type': 'text/html', 'set-cookie': 'bot_session=fixture-cookie-value; Path=/; HttpOnly' } })
    if (url.pathname === '/browser-whoami') {
      browserSessionRestored = request.headers.get('cookie')?.includes('bot_session=fixture-cookie-value') ?? false
      return new Response(`<!doctype html><title>Fixture</title><p>${browserSessionRestored ? 'Session active' : 'Anonymous'}</p>`, { headers: { 'content-type': 'text/html' } })
    }
    if (url.pathname === '/human-login') return new Response('<!doctype html><title>Human login</title><form action="/human-auth" method="post"><label>Password<input name="password" type="password" style="position:absolute;left:10px;top:10px;width:200px;height:30px"></label><button style="position:absolute;left:10px;top:70px">Sign in</button></form>', { headers: { 'content-type': 'text/html' } })
    if (url.pathname === '/human-auth') {
      humanLogin = (await request.text()) === 'password=human-check-password'
      return new Response('<!doctype html><title>Signed in</title><p>Human login completed</p><script>alert("Login confirmed")</script>', { headers: { 'content-type': 'text/html', 'set-cookie': 'human_session=human-check-cookie; Path=/; HttpOnly' } })
    }
    if (request.method !== 'POST') return new Response('Not found', { status: 404 })
    requests++
    const body = await request.json() as { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content?: unknown; tool_calls?: Array<{ function: { arguments: string } }> }> }
    // The runtime's final message is a per-request reference snapshot. Keep
    // this deterministic provider's task interpreter on the actual user turn.
    const current = body.messages.findLastIndex(m => m.role === 'user' && !String(m.content).startsWith('[Current saved notes —'))
    const prompt = String(body.messages[current]?.content ?? '')
    const done = body.messages.slice(current + 1).some(m => m.role === 'tool')
    const terminal = body.tools?.find(t => ['submit_result', 'submit_workflow_result'].includes(t.function.name))?.function.name
    if (prompt.includes('Runtime privacy check')) {
      privateStateLeaked ||= JSON.stringify(body.messages).includes('private-runtime-proof')
      const steps = [
        { name: 'read_file', args: { path: join(privateDirectory, 'state.txt') } },
        { name: 'grep', args: { pattern: 'runtime-proof', path: '.' } },
        { name: 'read_folder', args: { path: '.', recursive: true } },
        { name: 'glob', args: { pattern: '**/state.txt' } },
        { name: 'write_file', args: { path: join(privateDirectory, 'new.txt'), content: 'must not write' } },
      ]
      const next = steps[body.messages.slice(current + 1).filter(m => m.role === 'tool').length]
      if (!next) return response({ content: 'Runtime exclusions checked through native tools.' })
      return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) } }] }, 'tool_calls')
    }
    if (prompt.includes('Safe routine test scenario')) {
      const steps = [
        { name: 'write_file', args: { path: join(directory, 'routine-test-write.txt'), content: 'must remain simulated' } },
        { name: 'shell', args: { command: `printf pwn > '${join(directory, 'routine-test-shell.txt')}'` } },
        { name: 'browser', args: { action: 'navigate', url: `${url.origin}/procedure-effect` } },
        { name: 'web_fetch', args: { url: `${url.origin}/procedure-effect` } },
        { name: 'bot_control', args: { action: 'schedule', name: 'Must not be created', prompt: 'Mutate live schedule', schedule: { kind: 'once', at: Date.now() + 120_000 }, messageId: 'unsafe-schedule' } },
      ]
      const used = body.messages.slice(current + 1).filter(m => m.role === 'tool').length
      const next = steps[used]
      if (!next) return response({ content: 'Safe test scenario reviewed; proposed effects were simulated.' })
      assert.ok(body.tools?.some(tool => tool.function.name === next.name), `test fixture tool ${next.name} is available`)
      return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) } }] }, 'tool_calls')
    }
    if (prompt.includes('Coordinate check')) {
      if (done) return response({ content: 'The research was queued durably; its outcome is still pending.' })
      return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: 'bot_control', arguments: JSON.stringify({ action: 'send', bot: receiver.name, prompt: 'Restore check: read the current input.', messageId: 'source-research' }) } }] }, 'tool_calls')
    }
    if (!terminal && prompt.includes('Runtime background task outcomes')) {
      if (prompt.includes('failing-source')) return response({ content: 'Delegated work failed; no successful result exists.' })
      assert.match(prompt, /Read persisted source|Workflow read persisted source/)
      if (!prompt.includes('Workflow read persisted source') && !followupRequested) {
        followupRequested = true
        return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: 'ask_agent', arguments: JSON.stringify({ agent: 'reviewer', question: 'followup-source: verify input.txt after the initial source result.' }) } }] }, 'tool_calls')
      }
      if (done) return response({ content: 'Follow-up delegated; actual result pending.' })
      return response({ content: 'Delivered observed delegated result: persisted source was read.' })
    }
    if (terminal) {
      if (!done) return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'input.txt' }) } }] }, 'tool_calls')
      if (prompt.includes('background-source')) { childWaiting = true; await childGate }
      if (prompt.includes('followup-source')) { followupWaiting = true; await followupGate }
      if (body.messages.some(m => m.role === 'user' && String(m.content).includes('failing-source'))) return response({ content: 'No schema-valid terminal result.' })
      const result = terminal === 'submit_workflow_result' ? { result: 'Workflow read persisted source' } : { summary: 'Read persisted source', confidence: 1, filesRead: ['input.txt'], filesChanged: [], issuesFound: [], suggestions: [], metadata: {} }
      return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: terminal, arguments: JSON.stringify(result) } }] }, 'tool_calls')
    }
    if (prompt.includes('Background check') || prompt.includes('Background failure check') || prompt.includes('Workflow check')) {
      if (done) return response({ content: 'Coordinator finished; retain background ownership until its result is observed.' })
      const workflow = prompt.includes('Workflow check')
      const args = workflow ? { script: "export const meta = { name: 'source-check', description: 'Read the source through the native child agent' }; return await agent('workflow-source', {label:'read-source'});", args: { occurrenceId: prompt } }
        : { agent: 'reviewer', question: `${prompt.includes('Background failure check') ? 'failing-source' : 'background-source'}: read input.txt and report the observed content.` }
      return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: workflow ? 'workflow' : 'ask_agent', arguments: JSON.stringify(args) } }] }, 'tool_calls')
    }
    if (prompt.includes('Procedure')) {
      const latest = body.messages.slice(current + 1).findLast(m => m.tool_calls?.length)?.tool_calls?.[0]?.function
      const previous = latest ? JSON.parse(latest.arguments) : {}
      const fresh = prompt.includes('Routine occurrence'), text = fresh ? 'fresh-work' : 'demonstration-not-to-store'
      let name = 'browser', args: object
      if (!done && fresh) { name = 'skill'; args = { name: learnedName } }
      else if (!done || previous.name === learnedName) {
        if (previous.name === learnedName) learnedSkillRead = body.messages.some(m => m.role === 'tool' && String(m.content).includes('Observed browser procedure'))
        args = { action: 'navigate', url: `${url.origin}/procedure` }
      } else if (previous.action === 'navigate') args = { action: 'type', ref: 'e1', text }
      else if (previous.action === 'type') args = { action: 'batch', steps: [{ action: 'click', ref: 'e2' }, { action: 'expect', text: 'Saved ' + text }] }
      else {
        if (changedProcedure) procedureRejectionObserved = String(body.messages.findLast(m => m.role === 'tool')?.content).includes('target changed, is ambiguous or unavailable')
        return response({ content: 'Procedure finished with its observed result.' })
      }
      return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls')
    }
    if (done && prompt.includes('Browser handoff')) {
      const action = JSON.parse(body.messages.slice(current + 1).findLast(m => m.tool_calls?.length)?.tool_calls?.[0]?.function.arguments ?? '{}').action
      if (action === 'navigate') return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: 'browser', arguments: JSON.stringify({ action: 'handoff', reason: 'Log into the fixture as a human.' }) } }] }, 'tool_calls')
      return response({ content: 'Human handoff finished.' })
    }
    if (done) return response({ content: prompt.includes('Restore check') ? 'History restored and input read.' : prompt.includes('Browser') ? 'Browser turn finished.' : 'Approved command ran.' })
    if (prompt.includes('Restore check')) independentTaskIsolated = !body.messages.some(m => m.role === 'assistant' && m.content === 'Approved command ran.')
    const tool = prompt.includes('Browser') ? 'browser' : prompt.includes('Restore check') ? 'read_file' : 'shell'
    const args = tool === 'browser' ? { action: 'navigate', url: `${url.origin}/${prompt.includes('Browser handoff') ? 'human-login' : prompt.includes('Browser restore') ? 'browser-whoami' : 'browser-login'}` }
      : tool === 'read_file' ? { path: 'input.txt' }
      : { command: prompt.includes('Crash check') ? 'printf effect >> crash-marker.txt' : prompt.includes('Deny check') ? 'printf forbidden' : 'printf approved' }
    return response({ content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] }, 'tool_calls')
  } })
  const children: Array<ReturnType<typeof Bun.spawn>> = []
  const spawn = (crash = false, extraEnv: NodeJS.ProcessEnv = {}, onMessage?: (message: any) => void) => {
    const env: NodeJS.ProcessEnv = { ...process.env, BOT_CHECK_PROVIDER_URL: `http://127.0.0.1:${server.port}/v1`, BOT_CHECK_CRASH: crash ? '1' : '0', DEEPSEEK_NO_STREAM: '1', DEEPSEEK_DISABLE_MEMORY: '1', ...extraEnv }
    delete env.DEEPSEEK_BOTS_TOKEN
    const worker = Bun.spawn([process.execPath, resolve(import.meta.path), '--bot-worker', path, bot.id], {
      cwd: directory, env,
      stdout: 'pipe', stderr: 'pipe',
      ipc(message) { onMessage?.(message) },
    })
    children.push(worker)
    return worker
  }
  const until = async <T>(read: () => T | undefined, timeout = 15_000): Promise<T> => {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const value = read(); if (value !== undefined) return value
      await delay(30)
    }
    throw new Error('Runtime check timed out')
  }
  const review = async (runId: string, answer: 'once' | 'deny') => {
    const decision = await until(() => store.conversation(bot.id).decisions.find(d => d.runId === runId))
    assert.equal(store.getRun(runId).status, 'waiting')
    assert.throws(() => store.answerDecision(decision.id, 'changed-action', answer), /stale/)
    store.answerDecision(decision.id, decision.fingerprint, answer)
  }
  const checkExit = async (worker: ReturnType<typeof Bun.spawn>, code = 0) => {
    let exit: number
    try { exit = await until(() => worker.exitCode ?? undefined) }
    catch (error) {
      worker.kill('SIGKILL'); await worker.exited
      throw new Error(`${String(error)}; runs=${JSON.stringify(store.listRuns(bot.id))}; decisions=${JSON.stringify(store.conversation(bot.id).decisions)}; stderr=${await new Response(worker.stderr as ReadableStream<Uint8Array>).text()}`)
    }
    if (exit !== code) throw new Error(`Worker exit ${exit}: ${await new Response(worker.stderr as ReadableStream<Uint8Array>).text()}`)
  }
  let stage = 'approved action'
  try {
    const first = store.enqueue(bot.id, 'Approved check'), w1 = spawn()
    await review(first.id, 'once'); await checkExit(w1)
    assert.equal(store.getRun(first.id).status, 'completed')
    assert.match(store.getRun(first.id).output, /Approved command ran/)
    assert.equal(store.hasUncertainActions(first.id), false)
    const denied = store.enqueue(bot.id, 'Deny check'), w2 = spawn()
    stage = 'denied action'
    await review(denied.id, 'deny'); await checkExit(w2)
    assert.equal(store.getRun(denied.id).status, 'failed')
    assert.equal(store.store.query('SELECT id FROM bot_actions WHERE run_id = ?', denied.id).length, 0)
    const oldGoal = store.enqueue(bot.id, 'Unfinished prior occurrence'), timestamp = new Date().toISOString()
    store.claim(bot.id, 'state-fixture')
    store.checkpoint(oldGoal.id, 'state-fixture', store.transcript(bot.id, oldGoal.id), '', { goal: {
      objective: 'Only the unfinished prior occurrence', status: 'blocked', tokensUsed: 40, timeUsedSeconds: 1,
      consecutiveBlockCount: 3, continuations: 1, createdAt: timestamp, updatedAt: timestamp, startedAt: timestamp,
    }, todos: [] })
    store.finish(oldGoal.id, 'state-fixture', 'blocked', 'Prior task blocker')
    store.acknowledgeStop(oldGoal.id, 'state-fixture')
    const resumed = store.enqueue(bot.id, 'Restore check'), w3 = spawn()
    stage = 'independent task context with its own goal'
    await checkExit(w3)
    assert.equal(store.getRun(resumed.id).status, 'completed')
    assert.equal(independentTaskIsolated, true)
    assert.match(JSON.stringify(store.transcript(bot.id)), /Persisted source evidence/)
    stage = 'legacy runtime review and explicit CLI reset'
    const legacy = store.enqueue(bot.id, 'Restore check'), legacyState = store.runtimeState(bot.id, oldGoal.id)
    store.store.run('UPDATE bot_runs SET attempt = 1,runtime_state = NULL,legacy_runtime_state = ? WHERE id = ?', JSON.stringify(legacyState), legacy.id)
    const legacyWorker = spawn(); await checkExit(legacyWorker)
    assert.equal(store.getRun(legacy.id).status, 'blocked')
    assert.equal(store.getRun(legacy.id).owner, null, 'Initialization failure must finish cleanup')
    const runtimeCli = async (args: string[]) => {
      const client = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/index.tsx'), 'pods', ...args, '--db', path], { stdout: 'pipe', stderr: 'pipe' })
      assert.equal(await client.exited, 0, await new Response(client.stderr as ReadableStream<Uint8Array>).text())
      return await new Response(client.stdout).json() as { current: unknown; legacy: unknown }
    }
    assert.deepEqual(await runtimeCli(['runtime', legacy.id]), { current: null, legacy: legacyState })
    const reset = await runtimeCli(['reset-runtime', legacy.id, '--evidence', 'Reviewed the ambiguous snapshot; this occurrence must establish its own goal and limits.'])
    assert.deepEqual(reset.current, { goal: null, todos: [] })
    assert.deepEqual(reset.legacy, legacyState)
    store.reconcile(legacy.id, 'No actions occurred before the legacy ownership check stopped initialization.')
    store.retry(legacy.id, true)
    const resumedLegacy = spawn(); await checkExit(resumedLegacy)
    assert.equal(store.getRun(legacy.id).status, 'completed')
    stage = 'private runtime files inside the project'
    const privateRun = store.enqueue(bot.id, 'Runtime privacy check'), privateWorker = spawn()
    await until(() => {
      for (const d of store.conversation(bot.id).decisions.filter(d => d.runId === privateRun.id)) store.answerDecision(d.id, d.fingerprint, 'once')
      return privateWorker.exitCode !== null ? true : undefined
    })
    await checkExit(privateWorker)
    assert.equal(store.getRun(privateRun.id).status, 'completed')
    assert.equal(privateStateLeaked, false)
    assert.equal(await readFile(join(privateDirectory, 'state.txt'), 'utf8'), 'private-runtime-proof')
    await assert.rejects(readFile(join(privateDirectory, 'new.txt')), { code: 'ENOENT' })
    stage = 'native background ownership'
    const background = store.enqueue(bot.id, 'Background check'), backgroundWorker = spawn()
    await until(() => {
      for (const d of store.conversation(bot.id).decisions.filter(d => d.runId === background.id)) store.answerDecision(d.id, d.fingerprint, 'once')
      return childWaiting && store.getRun(background.id).output.includes('Coordinator finished') ? true : undefined
    })
    assert.equal(store.getRun(background.id).status, 'running')
    assert.equal(backgroundWorker.exitCode, null)
    releaseChild!()
    await until(() => {
      for (const d of store.conversation(bot.id).decisions.filter(d => d.runId === background.id)) store.answerDecision(d.id, d.fingerprint, 'once')
      return followupWaiting && store.getRun(background.id).output.includes('Follow-up delegated') ? true : undefined
    })
    assert.equal(store.getRun(background.id).status, 'running')
    releaseFollowup!(); await checkExit(backgroundWorker)
    assert.equal(store.getRun(background.id).status, 'completed', JSON.stringify(store.transcript(bot.id).at(-1)))
    assert.match(JSON.stringify(store.transcript(bot.id)), /Runtime background task outcomes/)
    assert.match(store.getRun(background.id).output, /Delivered observed delegated result/)
    assert.equal(store.events(bot.id).query().filter(e => e.type === 'BotBackgroundResultsReady' && e.payload.runId === background.id).length, 2)
    stage = 'native workflow ownership'
    const workflow = store.enqueue(bot.id, 'Workflow check'), workflowWorker = spawn()
    await until(() => {
      for (const d of store.conversation(bot.id).decisions.filter(d => d.runId === workflow.id)) store.answerDecision(d.id, d.fingerprint, 'once')
      return workflowWorker.exitCode === null ? undefined : true
    }, 30_000)
    await checkExit(workflowWorker)
    assert.equal(store.getRun(workflow.id).status, 'completed')
    assert.match(JSON.stringify(store.transcript(bot.id)), /Workflow read persisted source/)
    assert.match(store.getRun(workflow.id).output, /Delivered observed delegated result/)
    stage = 'native background failure delivery'
    const failedBackground = store.enqueue(bot.id, 'Background failure check'), failedBackgroundWorker = spawn()
    await until(() => {
      for (const d of store.conversation(bot.id).decisions.filter(d => d.runId === failedBackground.id)) store.answerDecision(d.id, d.fingerprint, 'once')
      return failedBackgroundWorker.exitCode !== null ? true : undefined
    })
    await checkExit(failedBackgroundWorker)
    assert.equal(store.getRun(failedBackground.id).status, 'failed')
    assert.match(store.getRun(failedBackground.id).output, /Delegated work failed/)
    assert.match(store.getRun(failedBackground.id).error!, /Background work did not succeed/)
    stage = 'isolated safe routine preview'
    const safeRoutine = store.addRoutine(bot.id, { name: 'Safe preview', prompt: 'Safe routine test scenario', schedule: { kind: 'event', topic: 'safe-test' } })
    const routineBefore = store.routines(bot.id).find(item => item.id === safeRoutine.id)!
    const receiptsBefore = store.store.query('SELECT * FROM bot_event_receipts WHERE scope_id=?', bot.id)
    const procedureEffectsBefore = procedureEffects
    const safePreview = store.testRoutineNow(bot.id, safeRoutine.id, 'safe-preview')
    assert.equal(safePreview.testMode, true)
    const previewWorker = spawn()
    await until(() => previewWorker.exitCode !== null ? true : undefined)
    await checkExit(previewWorker)
    assert.equal(store.getRun(safePreview.id).status, 'completed')
    assert.equal(store.getRun(safePreview.id).testMode, true)
    const simulated = store.store.query<{ tool: string; status: string; read_only: number; checkpointed: number }>('SELECT tool,status,read_only,checkpointed FROM bot_actions WHERE run_id=? ORDER BY created_at,rowid', safePreview.id)
    assert.deepEqual(simulated.map(action => action.tool), ['write_file', 'shell', 'browser', 'web_fetch', 'bot_control'])
    assert.ok(simulated.every(action => action.status === 'simulated' && action.read_only === 1 && action.checkpointed === 1))
    assert.equal(existsSync(join(directory, 'routine-test-write.txt')), false)
    assert.equal(existsSync(join(directory, 'routine-test-shell.txt')), false)
    assert.equal(procedureEffects, procedureEffectsBefore, 'browser and network proposals never reached the fixture')
    assert.deepEqual(store.routines(bot.id).find(item => item.id === safeRoutine.id), routineBefore)
    assert.deepEqual(store.store.query('SELECT * FROM bot_event_receipts WHERE scope_id=?', bot.id), receiptsBefore)
    assert.equal(store.routines(bot.id).some(item => item.name === 'Must not be created'), false)
    if (findChromium() && process.platform !== 'win32') {
      for (const prompt of ['Browser login check', 'Browser restore check']) {
        stage = prompt
        const job = store.enqueue(bot.id, prompt), worker = spawn()
        // Origin, risk and exact-action reviews all retain their original arguments.
        await until(() => {
          for (const d of store.conversation(bot.id).decisions.filter(d => d.runId === job.id)) store.answerDecision(d.id, d.fingerprint, 'once')
          return worker.exitCode === null ? undefined : true
        }, 30_000)
        await checkExit(worker)
        assert.equal(store.getRun(job.id).status, 'completed')
      }
      assert.equal(browserSessionRestored, true)
      assert.equal(JSON.stringify(store.transcript(bot.id)).includes('fixture-cookie-value'), false)
      stage = 'learned procedure demonstration'
      const demonstration = store.enqueue(bot.id, 'Procedure demonstration'), demonstrator = spawn()
      const approveUntilExit = async (worker: ReturnType<typeof Bun.spawn>, runId: string) => {
        await until(() => {
          for (const d of store.conversation(bot.id).decisions.filter(d => d.runId === runId)) store.answerDecision(d.id, d.fingerprint, 'once')
          return worker.exitCode === null ? undefined : true
        }, 30_000)
        await checkExit(worker)
      }
      await approveUntilExit(demonstrator, demonstration.id)
      assert.equal(store.getRun(demonstration.id).status, 'completed')
      assert.equal(procedureEffects, 1)
      const learned = store.learnProcedure(bot.id, demonstration.id, 'save-message')
      learnedName = learned.name
      const manifest = await readFile(join(store.skillDirectory(bot.id), learned.name, 'SKILL.md'), 'utf8')
      assert.equal(manifest.includes('demonstration-not-to-store'), false)
      assert.equal(JSON.stringify(store.browserSteps(demonstration.id)).includes('demonstration-not-to-store'), false)
      const inputs = { input2: 'fresh-work', expectedText4: 'Saved fresh-work' }
      const routine = store.addRoutine(bot.id, { name: 'Procedure routine', prompt: 'Procedure fresh occurrence', schedule: { kind: 'interval', everyMs: 60_000 }, procedureId: learned.id, procedureInputs: inputs })
      stage = 'learned procedure reuse'
      const occurrence = store.dispatchDue(Date.now() + 60_001).find(r => r.source === 'routine:' + routine.id)!
      const reuse = spawn(); await approveUntilExit(reuse, occurrence.id)
      assert.equal(store.getRun(occurrence.id).status, 'completed')
      assert.equal(store.getRun(occurrence.id).procedureCursor, 4)
      assert.equal(procedureEffects, 2)
      assert.equal(learnedSkillRead, true)
      changedProcedure = true
      stage = 'learned procedure page drift'
      const drift = store.dispatchDue(Date.now() + 120_002).find(r => r.source === 'routine:' + routine.id)!
      const gate = join(directory, 'release-procedure')
      let reached!: () => void
      const barrier = new Promise<void>(done => { reached = done })
      const drifting = spawn(false, { BOT_CHECK_PROCEDURE_GATE: gate }, message => { if (message?.type === 'procedure-barrier') reached() })
      const reviewing = approveUntilExit(drifting, drift.id)
      let writer: ReturnType<typeof Bun.spawn> | undefined
      try {
        await Promise.race([barrier, reviewing.then(() => { throw Error('Drift worker stopped before native guard admission') })])
        let locked!: () => void
        const holding = new Promise<void>(done => { locked = done })
        const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_PROCEDURE_PATH);
          db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},8000)`
        writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_PROCEDURE_PATH: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
        await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its drift lock') })])
        await writeFile(gate, '')
        assert.equal(await writer.exited, 0); await reviewing
      } finally {
        await writeFile(gate, '')
        if (writer?.exitCode === null) writer.kill()
        if (writer) await writer.exited
        await reviewing
      }
      assert.equal(store.getRun(drift.id).status, 'blocked')
      assert.equal(procedureEffects, 2, 'Changed target must be rejected before its effect')
      assert.equal(store.getProcedure(bot.id, learned.id).status, 'needs_review')
      assert.equal(store.routines(bot.id).find(r => r.id === routine.id)?.enabled, false)
      assert.equal(procedureRejectionObserved, true, 'The model must receive the observed DOM rejection, not a SQLite busy error')
    }
    const crash = store.enqueue(bot.id, 'Crash check'), w4 = spawn(true)
    stage = 'crash'
    await review(crash.id, 'once'); await checkExit(w4, 86)
    assert.equal(await readFile(join(directory, 'crash-marker.txt'), 'utf8'), 'effect')
    assert.equal(store.recover(Date.now() + 31_000).find(r => r.id === crash.id)?.status, 'blocked')
    assert.throws(() => store.retry(crash.id), /Reconcile/)
    store.reconcile(crash.id, 'The marker contains one effect. Do not replay the crashed action.')
    const { serveBots } = await import('../src/bots/service.js')
    const controller = new AbortController()
    const previousUrl = process.env.BOT_CHECK_PROVIDER_URL
    const previousPanelToken = process.env.DEEPSEEK_BOTS_TOKEN
    const previousSupervisorSecret = process.env.BOT_CHECK_SUPERVISOR_SECRET
    const previousOpenAiKey = process.env.OPENAI_API_KEY
    process.env.BOT_CHECK_PROVIDER_URL = `http://127.0.0.1:${server.port}/v1`
    process.env.DEEPSEEK_BOTS_TOKEN = 'supervisor-credential-must-not-reach-workers'
    process.env.BOT_CHECK_SUPERVISOR_SECRET = 'unclassified-supervisor-secret'
    process.env.OPENAI_API_KEY = 'unrelated-provider-secret'
    await writeFile(`${path}.provider-url`, `http://127.0.0.1:${server.port}/v1`)
    let panelUrl = ''
    const panelToken = 'runtime-panel-check-' + 'x'.repeat(48)
    const service = serveBots({ path, concurrency: 1, signal: controller.signal, entrypoint: import.meta.path,
      web: { token: panelToken, port: 0 }, onWebListening: url => { panelUrl = url },
    })
    try {
      stage = 'supervisor enqueue'
      const client = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/index.tsx'), 'pods', 'send', bot.id, 'Approved check', '--db', path], { stdout: 'pipe', stderr: 'pipe' })
      assert.equal(await client.exited, 0)
      const queued = await new Response(client.stdout).json() as { id: string }
      stage = 'supervisor approval'
      // The enqueueing client has exited; the independently running supervisor executes its work.
      await review(queued.id, 'once')
      stage = 'supervisor completion'
      await until(() => store.getRun(queued.id).status === 'completed' ? true : undefined)
      stage = 'bounded workers and durable bot handoff'
      const coordination = store.enqueue(bot.id, 'Coordinate check')
      await until(() => store.conversation(bot.id).decisions.find(d => d.runId === coordination.id))
      const receiverWaiting = store.enqueue(receiver.id, 'Restore check: bounded worker check')
      await delay(700)
      assert.equal(store.getRun(receiverWaiting.id).status, 'queued', 'A waiting worker still occupies its concurrency slot')
      await until(() => {
        for (const d of store.conversation(bot.id).decisions.filter(d => d.runId === coordination.id)) store.answerDecision(d.id, d.fingerprint, 'once')
        return store.getRun(coordination.id).status === 'completed' ? true : undefined
      })
      const handed = await until(() => store.listRuns(receiver.id).find(r => r.source === `bot:${bot.id}:run:${coordination.id}`))
      assert.equal(handed.occurrenceId, `${coordination.id}:handoff:source-research`)
      await until(() => {
        for (const d of store.conversation(receiver.id).decisions) store.answerDecision(d.id, d.fingerprint, 'once')
        return store.getRun(handed.id).status === 'completed' && store.getRun(receiverWaiting.id).status === 'completed' ? true : undefined
      })
      assert.match(JSON.stringify(store.transcript(receiver.id)), /Persisted source evidence/)
      if (findChromium() && process.platform !== 'win32') {
        stage = 'remote browser handoff'
        const handoff = store.enqueue(bot.id, 'Browser handoff check')
        const decision = await until(() => {
          const decisions = store.conversation(bot.id).decisions.filter(d => d.runId === handoff.id)
          for (const d of decisions.filter(d => d.kind === 'permission')) store.answerDecision(d.id, d.fingerprint, 'once')
          return decisions.find(d => d.kind === 'question')
        }, 30_000)
        assert.equal(decision.request.browserHandoff, true)
        const control = async (command: string, args?: object) => {
          const result = await fetch(panelUrl + '/api/bots/' + bot.id + '/browser', {
            method: 'POST', headers: { authorization: 'Bearer ' + panelToken, 'content-type': 'application/json' },
            body: JSON.stringify({ runId: handoff.id, command, args }),
          })
          const value = await result.json() as any
          assert.equal(result.ok, true, JSON.stringify(value))
          return value
        }
        assert.equal((await control('take')).held, true)
        const view = await control('image')
        assert.ok(view.image.length > 100)
        const actionsBefore = store.store.query('SELECT id FROM bot_actions WHERE run_id = ?', handoff.id).length
        const stale = await fetch(panelUrl + '/api/bots/' + bot.id + '/browser', {
          method: 'POST', headers: { authorization: 'Bearer ' + panelToken, 'content-type': 'application/json' },
          body: JSON.stringify({ runId: handoff.id, command: 'click', args: { viewId: 'stale-view', x: 35, y: 25 } }),
        })
        assert.equal(stale.status, 400)
        assert.equal(store.store.query('SELECT id FROM bot_actions WHERE run_id = ?', handoff.id).length, actionsBefore)
        await control('click', { viewId: view.id, x: 35, y: 25 })
        await control('type', { text: 'human-check-password' })
        assert.deepEqual(store.browserSteps(handoff.id).map(step => step.action), ['navigate', 'handoff'])
        const loggedIn = await control('press', { key: 'Enter' })
        assert.equal(humanLogin, true)
        assert.equal(loggedIn.dialog?.type, 'alert')
        await control('dialog', { accept: true })
        store.answerDecision(decision.id, decision.fingerprint, { '0': 'Done' })
        await delay(300)
        assert.notEqual(store.getRun(handoff.id).status, 'completed')
        await control('release')
        await until(() => store.getRun(handoff.id).status === 'completed' ? true : undefined)
        assert.equal(JSON.stringify(store.transcript(bot.id)).includes('human-check-password'), false)
        assert.equal(JSON.stringify(store.browserSteps(handoff.id)).includes('human-check-password'), false)
        assert.equal(JSON.stringify(store.events(bot.id).query({ limit: 10_000 })).includes('human-check-password'), false)
        assert.equal(JSON.stringify(store.store.query('SELECT args,result FROM bot_actions WHERE run_id = ?', handoff.id)).includes('human-check-password'), false)
        assert.equal(store.hasUncertainActions(handoff.id), false)
      }
      const routine = store.addRoutine(bot.id, { name: 'Future', prompt: 'Future check', schedule: { kind: 'interval', everyMs: 60_000 } })
      const cancelled = store.enqueue(bot.id, 'Deny check')
      stage = 'supervisor cancellation decision'
      await until(() => store.conversation(bot.id).decisions.find(d => d.runId === cancelled.id))
      store.cancel(cancelled.id)
      stage = 'supervisor cancelled worker exit'
      await until(() => {
        const starts = store.events(bot.id).query({ type: 'BotWorkerStarted' })
        const last = starts.at(-1)
        return last && store.events(bot.id).query({ type: 'BotWorkerExited' }).some(e => e.payload.pid === last.payload.pid) ? true : undefined
      })
      assert.equal(store.getRun(cancelled.id).status, 'cancelled')
      assert.equal(store.routines(bot.id).find(r => r.id === routine.id)?.enabled, true)
    } finally {
      controller.abort(); await service
      if (previousUrl === undefined) delete process.env.BOT_CHECK_PROVIDER_URL
      else process.env.BOT_CHECK_PROVIDER_URL = previousUrl
      if (previousPanelToken === undefined) delete process.env.DEEPSEEK_BOTS_TOKEN
      else process.env.DEEPSEEK_BOTS_TOKEN = previousPanelToken
      if (previousSupervisorSecret === undefined) delete process.env.BOT_CHECK_SUPERVISOR_SECRET
      else process.env.BOT_CHECK_SUPERVISOR_SECRET = previousSupervisorSecret
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previousOpenAiKey
    }
    console.log('Bot runtime check passed: real Agent/HTTP/tools, native background/workflow completion, bounded workers and bot handoffs, learned skills with fresh inputs and DOM drift rejection, approvals, history, Codimium/remote takeover, crash reconciliation and cancellation.')
  } catch (error) {
    throw new Error(`${stage}: ${String(error)}; runs=${JSON.stringify(store.listRuns(bot.id))}; decisions=${JSON.stringify(store.conversation(bot.id).decisions)}; worker log=${await readFile(join(directory, 'actors', bot.id, 'worker.log'), 'utf8').catch(() => '')}`)
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
    await Promise.allSettled(children.map(child => child.exited))
    server.stop(true); store.close(); await rm(directory, { recursive: true, force: true })
  }
}
