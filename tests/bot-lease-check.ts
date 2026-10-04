// Real Agent/HTTP/SQLite check: bun tests/bot-lease-check.ts
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { scrubbedEnv } from '../src/utils/platform.js'

for (const holdMs of [8000, 31000]) {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-lease-check-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  const bot = store.createBot({ name: 'leased-fixture', projectRoot: directory, instructions: 'Report the requested observed result.' })
  const run = store.enqueue(bot.id, 'Lease contention proof')
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(done => { enter = done })
  const held = new Promise<void>(done => { release = done })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch() {
    enter(); await held
    return Response.json({ id: 'lease-fixture', object: 'chat.completion', created: 1, model: 'bot-check',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Lease contention result delivered.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })
  } })
  const worker = Bun.spawn([process.execPath, resolve(import.meta.dir, 'bot-runtime-check.ts'), '--bot-worker', path, bot.id], {
    cwd: directory, env: { ...scrubbedEnv(), BOT_CHECK_PROVIDER_URL: `http://127.0.0.1:${server.port}/v1` }, stdout: 'ignore', stderr: 'pipe',
  })
  let writer: ReturnType<typeof Bun.spawn> | undefined
  const timer = setTimeout(() => { release(); worker.kill() }, 55_000)
  try {
    await Promise.race([entered, worker.exited.then(() => { throw Error('Worker exited before its actual provider request') })])
    const claimed = store.getRun(run.id)
    assert.equal(claimed.status, 'running'); assert.ok(claimed.owner); assert.ok(claimed.leaseUntil! > Date.now())
    let locked!: () => void
    const holding = new Promise<void>(done => { locked = done })
    const code = `import { Database } from 'bun:sqlite'; const db=new Database(process.env.DEEPSEEK_LEASE_DATABASE);
      db.exec('PRAGMA busy_timeout=5000'); db.exec('BEGIN IMMEDIATE'); process.send('locked');
      setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},${holdMs});`
    writer = Bun.spawn([process.execPath, '-e', code], { env: { ...scrubbedEnv(), DEEPSEEK_LEASE_DATABASE: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its native lock') })])
    assert.equal(await writer.exited, 0)
    release()
    assert.equal(await worker.exited, 0, await new Response(worker.stderr).text())
    const result = store.getRun(run.id)
    if (holdMs < 30_000) {
      assert.equal(result.status, 'completed', JSON.stringify(result))
      assert.match(result.output, /Lease contention result delivered/)
      assert.equal(result.owner, null)
    } else {
      assert.ok(claimed.leaseUntil! < Date.now())
      assert.notEqual(result.status, 'completed')
      assert.equal(result.output, '')
      assert.equal(store.recover().find(item => item.id === run.id)?.status, 'queued')
    }
    assert.equal(store.store.query('SELECT id FROM bot_actions WHERE run_id = ?', run.id).length, 0)
    console.log(`Real leased worker check passed: ${holdMs}ms contention, ${holdMs < 30_000 ? 'result delivered' : 'expired ownership denied'}`)
  } finally {
    clearTimeout(timer); release()
    if (writer && writer.exitCode === null) writer.kill()
    if (writer) await writer.exited
    if (worker.exitCode === null) worker.kill()
    await worker.exited; server.stop(true); store.close(); await rm(directory, { recursive: true, force: true })
  }
}
