// Real Agent/control/database check: bun tests/bot-control-check.ts [schedule|learn|update_note|forget|expired]
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { scrubbedEnv } from '../src/utils/platform.js'

const cases = ['schedule', 'learn', 'update_note', 'forget', 'expired'], selected = process.argv[2]
if (selected && !cases.includes(selected)) throw Error('Unknown control-check case')
for (const name of selected ? [selected] : cases) {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-native-control-')), path = join(directory, 'state.db')
  const store = new BotStore({ path }), holdMs = name === 'expired' ? 31000 : 8000
  const bot = store.createBot({ name: 'control-fixture', projectRoot: directory, instructions: 'Perform the exact requested control once and report its observed result.' })
  const source = store.enqueue(bot.id, 'Recorded demonstration')
  store.claim(bot.id, 'demonstrator')
  store.recordBrowserStep(source.id, 'demonstrator', { action: 'navigate', url: 'https://example.com/task' })
  store.recordBrowserStep(source.id, 'demonstrator', { action: 'expect', text: 'Done' })
  store.checkpoint(source.id, 'demonstrator', [])
  store.finish(source.id, 'demonstrator', 'completed', 'Observed'); store.acknowledgeStop(source.id, 'demonstrator')
  const run = store.enqueue(bot.id, 'Controlled mutation check')
  const note = ['update_note','forget'].includes(name) ? store.addNote(bot.id, 'Previous convention', 'fixture') : undefined
  const args = name === 'learn' ? { action: 'learn', runId: source.id, name: 'controlled-method' }
    : note ? { action: name, id: note.id, version: note.version, content: 'Current convention', source: 'fixture' }
    : { action: 'schedule', name: 'Controlled routine', prompt: 'Read current sources', messageId: 'fixture-routine', schedule: { kind: 'event', topic: 'fixture-only' } }
  const gate = join(directory, 'release-control')
  let reached!: () => void, receiptObserved = false, requests = 0
  const barrier = new Promise<void>(done => { reached = done })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { messages: Array<{ role: string; content?: unknown }> }
    requests++
    const done = body.messages.some(message => message.role === 'tool')
    if (done) receiptObserved = String(body.messages.findLast(message => message.role === 'tool')?.content).includes(name === 'learn' ? 'controlled-method' : name === 'update_note' ? 'Current convention' : name === 'forget' ? 'Note removed.' : 'Controlled routine')
    const message = done ? { content: 'Confirmed durable control result.' }
      : { content: null, tool_calls: [{ id: 'one-control', type: 'function', function: { name: 'bot_control', arguments: JSON.stringify(args) } }] }
    return Response.json({ id: 'control-response', object: 'chat.completion', created: 1, model: 'bot-check',
      choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: done ? 'stop' : 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })
  } })
  const worker = Bun.spawn([process.execPath, resolve(import.meta.dir, 'bot-runtime-check.ts'), '--bot-worker', path, bot.id], {
    cwd: directory, env: { ...scrubbedEnv(), BOT_CHECK_PROVIDER_URL: server.url.href + 'v1', BOT_CHECK_CONTROL_GATE: gate },
    stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message?.type === 'control-barrier') reached() },
  })
  const errors = new Response(worker.stderr).text()
  let writer: ReturnType<typeof Bun.spawn> | undefined, ready = false
  void barrier.then(() => { ready = true })
  const deadline = setTimeout(() => { void writeFile(gate, '').finally(() => worker.kill()) }, 55000)
  try {
    const end = Date.now() + 15000
    while (!ready) {
      for (const decision of store.conversation(bot.id).decisions) {
        assert.equal(decision.kind, 'permission')
        store.answerDecision(decision.id, decision.fingerprint, 'once')
      }
      assert.equal(worker.exitCode, null, worker.exitCode === null ? 'Worker exited before native control admission' : await errors)
      assert.ok(Date.now() < end, 'Native control admission timed out')
      await Bun.sleep(25)
    }
    const claimed = store.getRun(run.id)
    assert.ok(claimed.owner && claimed.leaseUntil! > Date.now())
    assert.equal(store.hasUncertainActions(run.id), true, 'Native action admission must precede the fixture barrier')
    let locked!: () => void
    const holding = new Promise<void>(done => { locked = done })
    const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_CONTROL_PATH);
      db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},${holdMs})`
    writer = Bun.spawn([process.execPath, '-e', code], { env: { ...scrubbedEnv(), DEEPSEEK_CONTROL_PATH: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its native lock') })])
    await writeFile(gate, '')
    await Bun.sleep(100)
    assert.equal(store.routines(bot.id).length, 0)
    assert.equal(store.procedures(bot.id).length, 0)
    if (note) assert.deepEqual(store.notes(bot.id), [note], 'The note mutation cannot commit while another writer holds SQLite')
    assert.equal(existsSync(join(store.skillDirectory(bot.id), 'controlled-method', 'SKILL.md')), false)
    assert.equal(await writer.exited, 0)
    assert.equal(await worker.exited, 0, await errors)
    if (name === 'expired') {
      assert.ok(claimed.leaseUntil! < Date.now())
      assert.equal(receiptObserved, false)
      assert.equal(store.routines(bot.id).length, 0)
      assert.equal(store.procedures(bot.id).length, 0)
      assert.equal(store.recover().find(item => item.id === run.id)?.status, 'blocked')
      assert.equal(store.hasUncertainActions(run.id), true)
      assert.equal(store.claim(bot.id, 'later-owner'), null)
    } else {
      assert.equal(receiptObserved, true, 'The model must receive the native committed control result')
      assert.equal(requests, 2)
      assert.equal(store.getRun(run.id).status, 'completed')
      assert.equal(store.getRun(run.id).owner, null)
      assert.equal(store.hasUncertainActions(run.id), false)
      assert.deepEqual(store.store.query('SELECT status,checkpointed FROM bot_actions WHERE run_id=?', run.id), [{ status: 'completed', checkpointed: 1 }])
      if (name === 'learn') {
        assert.equal(store.procedures(bot.id).length, 1)
        assert.equal(store.events(bot.id).query({ type: 'BotProcedureLearned' }).length, 1)
        assert.match(await readFile(join(store.skillDirectory(bot.id), 'controlled-method', 'SKILL.md'), 'utf8'), new RegExp(source.id))
      } else if (note) {
        assert.equal(store.events(bot.id).query({ type: 'BotNoteChanged' }).length, 2, 'One creation plus one native mutation, without retry duplication')
        if (name === 'forget') assert.equal(store.notes(bot.id).length, 0)
        else { const current = store.notes(bot.id)[0]!; assert.equal(current.id, note.id); assert.equal(current.version, 2); assert.equal(current.content, 'Current convention'); assert.match(current.source, new RegExp(run.id)) }
      } else {
        assert.equal(store.routines(bot.id).length, 1)
        assert.equal(store.events(bot.id).query({ type: 'BotRoutineCreated' }).length, 1)
      }
    }
    console.log(`Passed real Agent control: ${name}, ${holdMs}ms SQLite lock`)
  } finally {
    clearTimeout(deadline); await writeFile(gate, '')
    if (writer?.exitCode === null) writer.kill()
    if (writer) await writer.exited
    if (worker.exitCode === null) worker.kill()
    await worker.exited; server.stop(true); store.close(); await rm(directory, { recursive: true, force: true })
  }
}
