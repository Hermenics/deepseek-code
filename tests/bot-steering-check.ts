// Native Agent/HTTP/worker guidance: bun tests/bot-steering-check.ts [inference|streaming|approval|admission|effect|final|delegated|workflow|recover]
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { startBotWebServer } from '../src/bots/web.js'

const cases = ['inference', 'streaming', 'approval', 'admission', 'effect', 'final', 'delegated', 'workflow', 'recover'], selected = process.argv[2]
if (selected && !cases.includes(selected)) throw Error('Unknown steering check')
for (const name of selected ? [selected] : cases) {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-steering-check-')), path = join(directory, 'state.db')
  const store = new BotStore({ path }), bot = store.createBot({ name: 'steering', projectRoot: directory, instructions: 'Follow the current task and user corrections, preserving observed outcomes.' })
  await writeFile(join(directory, 'old.txt'), 'Old source must not be read')
  await writeFile(join(directory, 'new.txt'), 'Native revised source evidence')
  const run = store.enqueue(bot.id, 'Active steering fixture'), guidance = 'Use the revised output path and read new.txt for the delegated task.'
  const token = 'steering-fixture-' + 'x'.repeat(40), web = startBotWebServer(store, { token, port: 0 })
  let release!: () => void, announce!: () => void, requests = 0, childRequests = 0, spawned = false, changedObserved = false, coordinatorWhileChildHeld = false
  const gate = new Promise<void>(done => { release = done }), entered = new Promise<void>(done => { announce = done })
  let admissionHeld = false
  const admissionGate = join(directory, 'release-admission')
  const response = (message: object) => {
    const base = { id: 'steering-response', created: 1, model: 'bot-check' }, reason = 'tool_calls' in message ? 'tool_calls' : 'stop'
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    if (name === 'streaming') {
      const delta = { role: 'assistant', ...message } as Record<string, unknown>
      if (Array.isArray(delta.tool_calls)) delta.tool_calls = delta.tool_calls.map((call, index) => ({ ...call, index }))
      const chunks = [{ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] },
        { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: reason }], usage }]
      return new Response(chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }
    return Response.json({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: reason }], usage })
  }
  const call = (tool: string, args: object) => response({ content: null, tool_calls: [{ id: `steering-${requests}-${childRequests}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] })
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content?: unknown }> }
    const terminal = body.tools?.find(tool => ['submit_result','submit_workflow_result'].includes(tool.function.name))
    const changed = body.messages.some(message => message.role === 'user' && String(message.content).includes(guidance))
    if (terminal) {
      childRequests++
      if (childRequests === 1) { announce(); await gate; return call('read_file', { path: 'old.txt' }) }
      assert.equal(changed, true, 'Delegated inference must receive current guidance')
      const nativeRead = body.messages.some(message => message.role === 'tool' && String(message.content).includes('Native revised source evidence'))
      if (!nativeRead) return call('read_file', { path: 'new.txt' })
      return call(terminal.function.name, terminal.function.name === 'submit_workflow_result' ? { result: 'Read revised source: Native revised source evidence' }
        : { summary: 'Read revised source: Native revised source evidence', confidence: 1, filesRead: ['new.txt'], filesChanged: [], issuesFound: [], suggestions: [], metadata: {} })
    }
    requests++
    if (name === 'effect' && requests === 1) return response({ content: null, tool_calls: [
      { id: 'started-effect', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: "printf 'old\\n' >> old-effect.txt; while ! test -f release-effect; do sleep 0.02; done; printf 'old effect observed'" }) } },
      { id: 'superseded-batch-effect', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: "printf 'stale\\n' >> stale-effect.txt" }) } },
    ] })
    if (name === 'delegated' || name === 'workflow') {
      if (!spawned) {
        spawned = true
        return name === 'delegated' ? call('ask_agent', { agent: 'reviewer', question: 'Read the delegated steering fixture source old.txt and report its contents.' })
          : call('workflow', { script: 'export const meta={name:"steered-source",description:"Read current delegated source"};return await agent("Read the delegated steering fixture source old.txt and report its contents.",{label:"steered-source"});', args: { occurrenceId: run.occurrenceId } })
      }
      if (changed) { changedObserved = true; if (childRequests === 1) coordinatorWhileChildHeld = true }
      return response({ content: body.messages.some(message => String(message.content).includes('Runtime background task outcomes'))
        ? 'Delivered the native revised delegated source.' : 'Coordinator continues supervising the delegated task.' })
    }
    if (requests === 1 && !['approval','admission'].includes(name)) {
      announce(); await gate
      return name === 'final' || name === 'recover' ? response({ content: 'Old result must be reconsidered.' }) : call('shell', { command: "printf 'old\\n' >> old-effect.txt" })
    }
    if (!changed) return call('shell', { command: "printf 'old\\n' >> old-effect.txt" })
    changedObserved = true
    if (name === 'final' || name === 'recover') return response({ content: 'Current guidance was delivered in the same occurrence.' })
    const effect = body.messages.some(message => message.role === 'tool' && String(message.content).includes('revised effect observed'))
    return effect ? response({ content: 'Revised action completed once.' }) : call('shell', { command: "printf 'revised\\n' >> revised-effect.txt; printf 'revised effect observed'" })
  } })
  const spawn = () => {
    const env: NodeJS.ProcessEnv = { ...process.env, BOT_CHECK_PROVIDER_URL: provider.url.href + 'v1' }; delete env.DEEPSEEK_BOTS_TOKEN
    if (name === 'streaming') env.BOT_CHECK_STREAMING = '1'
    if (name === 'admission') env.BOT_CHECK_ADMISSION_GATE = admissionGate
    return Bun.spawn([process.execPath, resolve(import.meta.dir, 'bot-runtime-check.ts'), '--bot-worker', path, bot.id], {
      env, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message?.type === 'admission-barrier') admissionHeld = true },
    })
  }
  let worker = spawn(), errors = new Response(worker.stderr).text()
  const until = async (condition: () => boolean, ms = 20000) => {
    const end = Date.now() + ms
    while (!condition()) {
      assert.equal(worker.exitCode, null, worker.exitCode === null ? 'Worker stopped too early' : await errors)
      assert.ok(Date.now() < end, `${name}: native steering boundary timed out`)
      await Bun.sleep(50)
    }
  }
  try {
    let priorDecision: ReturnType<BotStore['getDecision']> | undefined
    if (name === 'approval') await until(() => { priorDecision = store.conversation(bot.id).decisions[0]; return Boolean(priorDecision) })
    else if (name === 'admission') await until(() => {
      for (const decision of store.conversation(bot.id).decisions) store.answerDecision(decision.id, decision.fingerprint, 'once')
      return admissionHeld
    })
    else if (name === 'effect') await until(() => {
      for (const decision of store.conversation(bot.id).decisions) store.answerDecision(decision.id, decision.fingerprint, 'once')
      return existsSync(join(directory, 'old-effect.txt'))
    })
    else if (name === 'delegated' || name === 'workflow') await until(() => {
      for (const decision of store.conversation(bot.id).decisions) store.answerDecision(decision.id, decision.fingerprint, 'once')
      return childRequests === 1
    })
    else await Promise.race([entered, worker.exited.then(async () => { throw Error(await errors) })])
    const submit = async () => {
      const deadline = Date.now() + 20000
      while (true) {
        const response = await fetch(web.url + `/api/runs/${run.id}/messages`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ message: guidance, messageId: 'native-correction' }) })
        if (response.status !== 503) return response
        // Native worker writes can briefly own SQLite. Exercise the published
        // retry contract using the same message ID; no accepted input is lost.
        assert.equal((await response.json()).code, 'database_busy')
        assert.equal(response.headers.get('retry-after'), '1')
        assert.ok(Date.now() < deadline, 'Guidance HTTP writer contention did not resolve')
        await Bun.sleep(1000)
      }
    }
    const accepted = await submit(); assert.equal(accepted.status, 201, await accepted.clone().text())
    const entry = await accepted.json() as { sequence: number; id: string }
    assert.equal((await submit()).status, 201)
    assert.equal(store.steeringMessages(run.id).length, 1)
    if (name === 'admission') await writeFile(admissionGate, '')
    if (name === 'effect') {
      assert.equal(store.hasUncertainActions(run.id), true, 'The actual admitted shell is still running')
      await writeFile(join(directory, 'release-effect'), '')
    }
    if (priorDecision) {
      assert.equal(store.getDecision(priorDecision.id).status, 'cancelled')
      assert.throws(() => store.answerDecision(priorDecision!.id, priorDecision!.fingerprint, 'once'), /stale/)
    }
    // ask_agent returns immediately; workflow is a foreground tool which the
    // coordinator awaits. Both descendants must discard their stale response.
    if (name === 'delegated') { await until(() => coordinatorWhileChildHeld); assert.equal(worker.exitCode, null) }
    if (name === 'recover') {
      worker.kill('SIGKILL'); await worker.exited; release()
      store.store.run('UPDATE bot_runs SET lease_until=? WHERE id=?', Date.now() - 1, run.id)
      assert.equal(store.recover()[0]!.status, 'queued')
      worker = spawn(); errors = new Response(worker.stderr).text()
    } else release()
    await until(() => {
      for (const decision of store.conversation(bot.id).decisions) {
        assert.equal(JSON.stringify(decision.request).includes('old-effect.txt'), false, 'Old proposal cannot retain an approval')
        store.answerDecision(decision.id, decision.fingerprint, 'once')
      }
      return worker.exitCode !== null
    })
    assert.equal(await worker.exited, 0, await errors)
    const result = store.getRun(run.id)
    assert.equal(result.status, 'completed', result.error ?? 'Run did not complete')
    assert.equal(result.owner, null); assert.equal(result.occurrenceId, run.occurrenceId)
    assert.equal(result.attempt, name === 'recover' ? 2 : 1); assert.equal(result.steeringCursor, entry.sequence)
    assert.equal(changedObserved, true); assert.equal(store.listRuns(bot.id).length, 1)
    assert.equal(store.events(bot.id).query({ type: 'BotRunSteered' }).length, 1)
    assert.equal(store.transcript(bot.id).filter(message => message.role === 'user' && String(message.content).includes(`[User guidance ${entry.id}`)).length, 1)
    if (name === 'effect') {
      assert.equal(await readFile(join(directory, 'old-effect.txt'), 'utf8'), 'old\n')
      assert.equal(store.hasUncertainActions(run.id), false)
      const actions = store.store.query<{ args: string }>('SELECT args FROM bot_actions WHERE run_id=? AND tool=?', run.id, 'shell')
      assert.equal(actions.length, 2, 'One started effect and one revised effect; no stale batch effect')
    } else await assert.rejects(readFile(join(directory, 'old-effect.txt')), { code: 'ENOENT' })
    await assert.rejects(readFile(join(directory, 'stale-effect.txt')), { code: 'ENOENT' })
    if (['inference','streaming','approval','admission','effect'].includes(name)) assert.equal(await readFile(join(directory, 'revised-effect.txt'), 'utf8'), 'revised\n')
    if (name === 'delegated' || name === 'workflow') {
      const actions = store.store.query<{ args: string; task_id: string | null }>('SELECT args,task_id FROM bot_actions WHERE run_id=? AND tool=?', run.id, 'read_file')
      assert.equal(actions.length, 1); assert.ok(actions[0]!.task_id)
      assert.equal(JSON.parse(actions[0]!.args).path.endsWith('new.txt'), true)
      assert.match(result.output, /Delivered the native revised delegated source/)
    }
    console.log(`Passed native active guidance: ${name}`)
  } finally {
    release(); if (worker.exitCode === null) worker.kill('SIGKILL'); await worker.exited
    provider.stop(true); web.server.stop(true); store.close(); await rm(directory, { recursive: true, force: true })
  }
}
