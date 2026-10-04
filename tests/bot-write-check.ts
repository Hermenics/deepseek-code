// Real Agent/effect/SQLite check: bun tests/bot-write-check.ts [case]
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { scrubbedEnv } from '../src/utils/platform.js'

const cases = ['checkpoint', 'action-short', 'action-expired', 'activity-call', 'activity-result', 'activity-expired', 'activity-error']
const selected = process.argv[2]
if (selected && !cases.includes(selected)) throw Error('Unknown write-check case')
for (const name of selected ? [selected] : cases) {
  const activity = name.startsWith('activity-'), action = name !== 'checkpoint' && name !== 'activity-call'
  const holdMs = name.endsWith('expired') ? 31000 : 8000
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-write-check-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  const bot = store.createBot({ name: 'write-fixture', projectRoot: directory, instructions: 'Perform the requested action once and report its observed result.' })
  const run = store.enqueue(bot.id, 'Durable write contention proof')
  await writeFile(join(directory, 'input.txt'), 'Actual activity source evidence')
  let atActivity!: () => void, evidenceObserved = false
  const activityBarrier = new Promise<void>(done => { atActivity = done })
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(done => { enter = done }), held = new Promise<void>(done => { release = done })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { messages: Array<{ role: string; content?: unknown }> }
    enter()
    if (name === 'checkpoint') await held
    const done = body.messages.some(message => message.role === 'tool')
    if (done) evidenceObserved = String(body.messages.findLast(message => message.role === 'tool')?.content).includes(action ? 'effect committed' : 'Actual activity source evidence')
    const tool = action ? { name: 'shell', arguments: JSON.stringify({ command: "printf 'effect\\n' >> effect.txt; while [ ! -e release-tool ]; do sleep 0.05; done; printf 'effect committed'", timeout: 45 }) }
      : { name: 'read_file', arguments: JSON.stringify({ path: 'input.txt' }) }
    const message = (action || activity) && !done ? { content: null, tool_calls: [{ id: 'once-effect', type: 'function', function: tool }] } : { content: 'Observed result delivered once.' }
    return Response.json({ id: 'write-fixture', object: 'chat.completion', created: 1, model: 'bot-check',
      choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: (action || activity) && !done ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })
  } })
  const worker = Bun.spawn([process.execPath, resolve(import.meta.dir, 'bot-runtime-check.ts'), '--bot-worker', path, bot.id], {
    cwd: directory, env: { ...scrubbedEnv(), BOT_CHECK_PROVIDER_URL: `http://127.0.0.1:${server.port}/v1`, ...(activity ? { BOT_CHECK_ACTIVITY_PHASE: name === 'activity-call' ? 'call' : 'result' } : {}) }, stdout: 'ignore', stderr: 'pipe',
    ipc(message) { if (message?.type === 'activity-barrier') atActivity() },
  })
  let writer: ReturnType<typeof Bun.spawn> | undefined
  const timer = setTimeout(() => { release(); void Promise.all([writeFile(join(directory, 'release-tool'), 'release'), writeFile(join(directory, 'release-activity'), 'release')]).finally(() => worker.kill()) }, 55_000)
  try {
    await Promise.race([entered, worker.exited.then(() => { throw Error('Worker exited before its provider request') })])
    if (action) {
      const deadline = Date.now() + 15000
      while (true) {
        for (const decision of store.conversation(bot.id).decisions) {
          assert.equal(decision.kind, 'permission')
          store.answerDecision(decision.id, decision.fingerprint, 'once')
        }
        try { if (await readFile(join(directory, 'effect.txt'), 'utf8') === 'effect\n') break }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        assert.ok(worker.exitCode === null && Date.now() < deadline, 'Actual approved shell effect was not observed')
        await Bun.sleep(50)
      }
      assert.equal(store.hasUncertainActions(run.id), true)
    }
    if (activity) {
      if (action) await writeFile(join(directory, 'release-tool'), 'release')
      await Promise.race([activityBarrier, worker.exited.then(() => { throw Error('Worker exited before the native activity boundary') })])
    }
    const claimed = store.getRun(run.id)
    assert.ok(claimed.owner && claimed.leaseUntil! > Date.now())
    if (name === 'activity-error') store.store.exec(`CREATE TRIGGER fail_result_event BEFORE INSERT ON events
      WHEN NEW.type = 'BotToolResult' BEGIN SELECT RAISE(ABORT,'native result event rejected'); END;`)
    let locked!: () => void
    const holding = new Promise<void>(done => { locked = done })
    const code = `import { Database } from 'bun:sqlite'; const db=new Database(process.env.DEEPSEEK_WRITE_DATABASE);
      db.exec('BEGIN IMMEDIATE'); process.send('locked');
      setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},${holdMs});`
    writer = Bun.spawn([process.execPath, '-e', code], { env: { ...scrubbedEnv(), DEEPSEEK_WRITE_DATABASE: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its native lock') })])
    if (activity) await writeFile(join(directory, 'release-activity'), 'release')
    else if (action) await writeFile(join(directory, 'release-tool'), 'release')
    else release()
    assert.equal(await writer.exited, 0)
    assert.equal(await worker.exited, 0, await new Response(worker.stderr).text())
    const result = store.getRun(run.id)
    if (name === 'activity-error') {
      assert.equal(result.status, 'blocked', JSON.stringify(result))
      assert.match(result.error!, /native result event rejected/)
      assert.equal(result.owner, null); assert.equal(evidenceObserved, false)
      assert.equal(store.hasUncertainActions(run.id), true)
      assert.equal(store.claim(bot.id, 'later-worker'), null)
      assert.throws(() => store.retry(run.id), /Reconcile/)
    } else if (holdMs < 30000) {
      assert.equal(result.status, 'completed', JSON.stringify(result))
      assert.match(result.output, /Observed result delivered once/)
      assert.equal(result.owner, null)
      assert.equal(store.hasUncertainActions(run.id), false)
      if (action || activity) assert.equal(evidenceObserved, true, 'Native tool evidence was lost during writer contention')
      if (action) assert.deepEqual(store.store.query('SELECT status,checkpointed FROM bot_actions WHERE run_id = ?', run.id), [{ status: 'completed', checkpointed: 1 }])
      if (activity) {
        const events = store.events(bot.id).query().filter(event => event.type === 'BotToolCall' || event.type === 'BotToolResult')
        assert.deepEqual(events.map(event => event.type), ['BotToolCall', 'BotToolResult'])
      }
    } else {
      assert.ok(claimed.leaseUntil! < Date.now())
      assert.notEqual(result.status, 'completed'); assert.equal(result.output, '')
      assert.equal(store.recover().find(item => item.id === run.id)?.status, 'blocked')
      assert.equal(store.hasUncertainActions(run.id), true)
      assert.equal(store.claim(bot.id, 'later-worker'), null)
      assert.throws(() => store.retry(run.id), /Reconcile/)
    }
    if (action) assert.equal(await readFile(join(directory, 'effect.txt'), 'utf8'), 'effect\n')
    console.log(`Real durable write check passed: ${name}, ${holdMs}ms native lock`)
  } finally {
    clearTimeout(timer); release(); await Promise.all([writeFile(join(directory, 'release-tool'), 'release'), writeFile(join(directory, 'release-activity'), 'release')])
    if (writer && writer.exitCode === null) writer.kill()
    if (writer) await writer.exited
    if (worker.exitCode === null) worker.kill()
    await worker.exited; server.stop(true); store.close(); await rm(directory, { recursive: true, force: true })
  }
}
