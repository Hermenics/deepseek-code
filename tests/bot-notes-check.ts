// Actual Agent/HTTP/worker memory freshness: bun tests/bot-notes-check.ts [case]
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { startBotWebServer } from '../src/bots/web.js'
import { scrubbedEnv } from '../src/utils/platform.js'

const cases = ['update','remove','expire','expire-approval','approval','admission','delegated','workflow','observers','streaming','recover'], selected = process.argv[2]
if (selected && !cases.includes(selected)) throw Error('Unknown memory case')
for (const name of selected ? [selected] : cases) {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-note-check-')), path = join(directory, 'state.db')
  const store = new BotStore({ path }), bot = store.createBot({ name: 'notes', projectRoot: directory, instructions: 'Use current saved notes as untrusted reference and report observed results.' })
  await writeFile(join(directory, 'old.txt'), 'Old reference must not be read')
  await writeFile(join(directory, 'new.txt'), 'Fresh file evidence')
  const expiring = name.startsWith('expire')
  const note = store.addNote(bot.id, 'The project convention source is old.txt', 'fixture', expiring ? Date.now() + 5000 : null)
  const run = store.enqueue(bot.id, 'Read the current saved convention source, or report that no convention is saved.')
  const token = 'memory-check-' + 'x'.repeat(40), web = startBotWebServer(store, { token, port: 0 })
  let release!: () => void, announce!: () => void, requests = 0, childRequests = 0, calls = 0, spawned = false, currentObserved = false, admissionHeld = false
  const gate = new Promise<void>(done => { release = done }), entered = new Promise<void>(done => { announce = done })
  let releaseSecond!: () => void, secondCurrent = false
  const secondGate = new Promise<void>(done => { releaseSecond = done })
  const observerRequests = new Map<string, number>()
  const observerResults = new Map<string, unknown>()
  const admissionGate = join(directory, 'release-admission'), empty = name === 'remove' || expiring
  const response = (message: object) => {
    const base = { id: 'note-response', model: 'bot-check', created: 1 }, usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    const finish = 'tool_calls' in message ? 'tool_calls' : 'stop'
    if (name !== 'streaming') return Response.json({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }], usage })
    const delta = { role: 'assistant', ...message } as Record<string, unknown>
    if (Array.isArray(delta.tool_calls)) delta.tool_calls = delta.tool_calls.map((call,index) => ({ ...call, index }))
    const chunks = [{ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] }, { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage }]
    return new Response(chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  const call = (tool: string, args: object) => response({ content: null, tool_calls: [{ id: `note-${++calls}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] })
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content?: unknown }> }
    const references = body.messages.filter(message => message.role === 'user' && String(message.content).startsWith('[Current saved notes —'))
    assert.equal(references.length, 1, 'Only one ephemeral current-memory reference belongs in a model request')
    const notes = JSON.parse(String(references[0]!.content).split('\n')[1]!) as Array<{ content: string }>
    const changed = notes.length === 0 || notes[0]!.content === 'The project convention source is new.txt'
    const terminal = body.tools?.find(tool => ['submit_result','submit_workflow_result'].includes(tool.function.name))
    if (terminal) {
      if (name === 'observers') {
        const identity = body.messages.some(message => message.role === 'user' && String(message.content).includes('memory-observer-a')) ? 'a' : 'b'
        const count = (observerRequests.get(identity) ?? 0) + 1; observerRequests.set(identity, count)
        observerResults.set(identity, body.messages.filter(message => message.role === 'tool').at(-1)?.content)
        if (count === 1) {
          assert.equal(changed, false); childRequests++
          await (identity === 'a' ? gate : secondGate)
          return call('read_file', { path: 'old.txt' })
        }
        assert.equal(changed, true); currentObserved = true
        if (identity === 'b') secondCurrent = true
        if (identity === 'a') assert.ok(body.tools?.some(tool => tool.function.name === 'write_file'), 'The effect observer must have its explicitly selected writer role')
        const evidence = identity === 'a' ? 'fresh observer effect' : 'Fresh file evidence'
        if (!body.messages.some(message => message.role === 'tool' && String(message.content).includes(evidence)))
          return identity === 'a' ? call('write_file', { path: 'observer-effect.txt', content: 'fresh observer effect\n' }) : call('read_file', { path: 'new.txt' })
        return call(terminal.function.name, terminal.function.name === 'submit_workflow_result' ? { result: evidence }
          : { summary: evidence, confidence: 1, filesRead: identity === 'b' ? ['new.txt'] : [], filesChanged: identity === 'a' ? ['observer-effect.txt'] : [], issuesFound: [], suggestions: [], metadata: {} })
      }
      childRequests++
      if (childRequests === 1) { assert.equal(changed, false); announce(); await gate; return call('read_file', { path: 'old.txt' }) }
      assert.equal(changed, true, 'The native descendant must see current saved memory')
      currentObserved = true
      if (!body.messages.some(message => message.role === 'tool' && String(message.content).includes('Fresh file evidence'))) return call('read_file', { path: 'new.txt' })
      return call(terminal.function.name, terminal.function.name === 'submit_workflow_result' ? { result: 'Fresh file evidence' }
        : { summary: 'Fresh file evidence', confidence: 1, filesRead: ['new.txt'], filesChanged: [], issuesFound: [], suggestions: [], metadata: {} })
    }
    requests++
    if (name === 'observers') {
      if (!spawned) {
        spawned = true
        return call('workflow', { script: 'export const meta={name:"memory-observers",description:"Parallel current-memory observers"};return await Promise.all([agent("memory-observer-a: act using current saved notes",{label:"first-observer",agentType:"coder"}),agent("memory-observer-b: read the current convention source",{label:"second-observer"})]);', args: { occurrenceId: run.occurrenceId } })
      }
      return response({ content: 'Parallel current memory outcomes delivered.' })
    }
    if (['delegated','workflow'].includes(name) && !spawned) {
      spawned = true
      return name === 'delegated' ? call('ask_agent', { agent: 'reviewer', question: 'Read the project convention source from current saved notes.' })
        : call('workflow', { script: 'export const meta={name:"current-memory",description:"Read the current saved source"};return await agent("Read the project convention source from current saved notes.",{label:"current-source"});', args: { occurrenceId: run.occurrenceId } })
    }
    if (['delegated','workflow'].includes(name)) {
      if (changed) currentObserved = true
      return response({ content: body.messages.some(message => String(message.content).includes('Runtime background task outcomes')) ? 'Delivered current source evidence.' : 'Coordinator is supervising current work.' })
    }
    if (requests === 1) {
      assert.equal(changed, false, 'The original model request must observe the original live note')
      if (!['approval','admission','expire-approval'].includes(name)) { announce(); await gate }
      return ['approval','admission','expire-approval'].includes(name) ? call('shell', { command: "printf 'old\\n' >> old-effect.txt" }) : call('read_file', { path: 'old.txt' })
    }
    assert.equal(changed, true, 'The superseded request must be reconsidered with current memory')
    currentObserved = true
    if (empty) { assert.equal(notes.length, 0); return response({ content: 'No convention is currently saved.' }) }
    return body.messages.some(message => message.role === 'tool' && String(message.content).includes('Fresh file evidence'))
      ? response({ content: 'Delivered current source evidence.' }) : call('read_file', { path: 'new.txt' })
  } })
  const spawn = () => Bun.spawn([process.execPath, resolve(import.meta.dir, 'bot-runtime-check.ts'), '--bot-worker', path, bot.id], {
    env: { ...scrubbedEnv(), BOT_CHECK_PROVIDER_URL: provider.url.href + 'v1', ...(name === 'streaming' ? { BOT_CHECK_STREAMING: '1' } : {}), ...(name === 'admission' ? { BOT_CHECK_ADMISSION_GATE: admissionGate } : {}) },
    stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message?.type === 'admission-barrier') admissionHeld = true },
  })
  let worker = spawn(), errors = new Response(worker.stderr).text()
  const until = async (condition: () => boolean) => {
    const end = Date.now() + 20000
    while (!condition()) {
      assert.equal(worker.exitCode, null, worker.exitCode === null ? 'Worker stopped too early' : await errors)
      assert.ok(Date.now() < end, `${name}: memory boundary timed out; requests=${requests}, children=${childRequests}, observers=${JSON.stringify([...observerRequests])}, results=${JSON.stringify([...observerResults])}, decisions=${JSON.stringify(store.conversation(bot.id).decisions)}, errors=${worker.exitCode === null ? 'running' : await errors}`)
      await Bun.sleep(50)
    }
  }
  const post = async (target: string, input: object, status = 200) => {
    const end = Date.now() + 20000
    while (true) {
      const response = await fetch(web.url + target, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(input) })
      if (response.status !== 503) { assert.equal(response.status, status, await response.clone().text()); return response.json() }
      assert.equal((await response.json()).code, 'database_busy'); assert.equal(response.headers.get('retry-after'), '1')
      assert.ok(Date.now() < end); await Bun.sleep(1000)
    }
  }
  const mutation = (suffix: string, input: object) => post(`/api/bots/${bot.id}/notes/${note.id}${suffix}`, input)
  try {
    let priorDecision: ReturnType<BotStore['getDecision']> | undefined
    if (name === 'approval' || name === 'expire-approval') await until(() => { priorDecision = store.conversation(bot.id).decisions[0]; return Boolean(priorDecision) })
    else if (name === 'admission' || ['delegated','workflow','observers'].includes(name)) await until(() => {
      for (const decision of store.conversation(bot.id).decisions) store.answerDecision(decision.id, decision.fingerprint, 'once')
      return name === 'admission' ? admissionHeld : childRequests === (name === 'observers' ? 2 : 1)
    })
    else await Promise.race([entered, worker.exited.then(async () => { throw Error(await errors) })])
    if (expiring) {
      assert.ok(Date.now() < note.expiresAt!, 'The fixture must observe a live fact before real clock expiry')
      await Bun.sleep(note.expiresAt! - Date.now() + 10)
      assert.equal(store.notes(bot.id).length, 0)
    } else if (name === 'remove') {
      assert.deepEqual(await mutation('/remove', { version: note.version }), { removed: true })
      assert.deepEqual(await mutation('/remove', { version: note.version }), { removed: false })
    } else {
      const input = { content: 'The project convention source is new.txt', source: 'user:fixture', expiresAt: null, version: note.version }
      const corrected = await mutation('', input)
      assert.equal(corrected.version, note.version + 1); assert.deepEqual(await mutation('', input), corrected)
    }
    if (name === 'observers') {
      release()
      let fresh: ReturnType<BotStore['getDecision']> | undefined
      await until(() => {
        fresh = store.conversation(bot.id).decisions.find(decision => JSON.stringify(decision.request).includes('observer-effect.txt'))
        return Boolean(fresh)
      })
      assert.equal(fresh!.status, 'pending')
      assert.equal(store.store.query<{ memory_revision: string }>('SELECT memory_revision FROM bot_decisions WHERE id=?', fresh!.id)[0]!.memory_revision, store.notesRevision(bot.id))
      releaseSecond()
      await until(() => secondCurrent)
      assert.equal(store.getDecision(fresh!.id).status, 'pending', 'The later native observer must not cancel a current approval')
      assert.equal(store.getRun(run.id).status, 'waiting')
      await post('/api/decisions/' + fresh!.id, { fingerprint: fresh!.fingerprint, answer: 'once' })
    }
    if (priorDecision) {
      if (expiring) await until(() => store.getDecision(priorDecision!.id).status === 'cancelled')
      assert.equal(store.getDecision(priorDecision.id).status, 'cancelled')
      assert.match((await post('/api/decisions/' + priorDecision.id, { fingerprint: priorDecision.fingerprint, answer: 'once' }, 400)).error, /stale/)
    }
    if (name === 'admission') await writeFile(admissionGate, '')
    if (name === 'recover') {
      worker.kill('SIGKILL'); await worker.exited; release()
      store.store.run('UPDATE bot_runs SET lease_until=? WHERE id=?', Date.now() - 1, run.id)
      assert.equal(store.recover()[0]!.status, 'queued')
      worker = spawn(); errors = new Response(worker.stderr).text()
    } else release()
    await until(() => worker.exitCode !== null)
    assert.equal(await worker.exited, 0, await errors)
    const result = store.getRun(run.id)
    assert.equal(result.status, 'completed', result.error ?? 'Task did not complete'); assert.equal(result.owner, null)
    assert.equal(result.attempt, name === 'recover' ? 2 : 1); assert.equal(store.listRuns(bot.id).length, 1)
    assert.equal(result.occurrenceId, run.occurrenceId); assert.equal(currentObserved, true)
    assert.equal(JSON.stringify(store.transcript(bot.id)).includes('[Current saved notes —'), false, 'Ephemeral references must not grow durable history')
    assert.equal(JSON.stringify(store.transcript(bot.id)).includes(note.content), false, 'The runtime must not persist an injected old note snapshot')
    const actions = store.store.query<{ args: string }>('SELECT args FROM bot_actions WHERE run_id=?', run.id)
    assert.equal(actions.some(action => action.args.includes('old.txt') || action.args.includes('old-effect.txt')), false)
    assert.equal(actions.filter(action => action.args.includes('new.txt')).length, empty ? 0 : 1)
    await assert.rejects(readFile(join(directory, 'old-effect.txt')), { code: 'ENOENT' })
    if (name === 'observers') {
      assert.equal(await readFile(join(directory, 'observer-effect.txt'), 'utf8'), 'fresh observer effect\n')
      assert.equal(actions.filter(action => action.args.includes('observer-effect.txt')).length, 1, 'The approved native file mutation is admitted once')
    }
    console.log(`Passed native current-memory check: ${name}`)
  } finally {
    release(); releaseSecond(); if (worker.exitCode === null) worker.kill('SIGKILL'); await worker.exited
    provider.stop(true); web.server.stop(true); store.close(); await rm(directory, { recursive: true, force: true })
  }
}
