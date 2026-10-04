// Real workers and SQLite writers: bun tests/bot-startup-check.ts
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { BotStore } from '../src/bots/store.js'

for (const scenario of ['upgrade', 'claim', 'cancel', 'schema-error']) {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-worker-startup-')), path = join(directory, 'state.db')
  const store = new BotStore({ path })
  const bot = store.createBot({ name: 'startup-fixture', projectRoot: directory, instructions: 'Report the requested fixture completion.' })
  const run = store.enqueue(bot.id, 'Startup fixture completion')
  store.store.run('DELETE FROM _schema_version WHERE version=12')
  if (scenario === 'schema-error') store.store.exec('DROP TABLE bot_routines')
  const lease = join(tmpdir(), 'deepseek-code-leases-v1', createHash('sha256').update(`bot-actor:${path}:${bot.id}`).digest('hex'))
  let requests = 0, writer: ReturnType<typeof Bun.spawn> | undefined, worker: ReturnType<typeof Bun.spawn> | undefined
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    assert.equal(request.method, 'POST'); requests++; await request.json()
    return Response.json({ id: 'startup-response', object: 'chat.completion', created: 1, model: 'bot-check',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Startup fixture completed.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
  } })
  const finish = async (child: ReturnType<typeof Bun.spawn>, timeout: number) => {
    const controller = new AbortController()
    try { return await Promise.race([child.exited, delay(timeout, undefined, { signal: controller.signal }).then(() => { throw Error(`${scenario}: process did not exit`) })]) }
    finally { controller.abort() }
  }
  const lockWriter = async () => {
      let locked!: () => void
      const holding = new Promise<void>(done => { locked = done })
      const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_STARTUP_DATABASE);
        db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},8000)`
      writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_STARTUP_DATABASE: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
      await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its lock') })])
  }
  try {
    if (scenario !== 'schema-error' && scenario !== 'claim') await lockWriter()
    const env: NodeJS.ProcessEnv = { ...process.env, BOT_CHECK_PROVIDER_URL: server.url.href + 'v1' }
    delete env.DEEPSEEK_BOTS_TOKEN
    const claimGate = join(directory, 'release-claim')
    if (scenario === 'claim') env.BOT_CHECK_CLAIM_GATE = claimGate
    let announceClaim!: () => void
    const claiming = new Promise<void>(done => { announceClaim = done })
    const started = Bun.spawn([process.execPath, resolve(import.meta.dir, 'bot-runtime-check.ts'), '--bot-worker', path, bot.id], {
      env, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe',
      ipc(message) { if (message?.type === 'claim-barrier') announceClaim() },
    })
    worker = started
    const errors = new Response(started.stderr).text()
    if (scenario === 'claim') {
      await Promise.race([claiming, worker.exited.then(async () => { throw Error(await errors) })])
      await lockWriter(); await writeFile(claimGate, '')
    }
    if (scenario === 'schema-error') {
      assert.equal(await finish(worker, 5000), 1)
      assert.match(await errors, /no such table: bot_routines/)
    } else {
      const deadline = Date.now() + 5000
      while (!existsSync(lease)) {
        assert.equal(worker.exitCode, null, await errorsIfExited(worker, errors))
        assert.ok(Date.now() < deadline, 'Worker never acquired its actor lease')
        await delay(25)
      }
      await delay(250)
      assert.equal(requests, 0, 'No provider work can precede the pending migration')
      assert.equal(writer!.exitCode, null)
      if (scenario === 'cancel') {
        worker.kill('SIGTERM')
        assert.equal(await finish(worker, 2000), 0, await errorsIfExited(worker, errors))
        assert.equal(writer!.exitCode, null, 'Cancellation must not wait for the writer')
        assert.equal(store.getRun(run.id).status, 'queued')
        assert.equal(store.store.query('SELECT version FROM _schema_version WHERE version=12').length, 0)
      } else {
        assert.equal(await finish(writer!, 12000), 0)
        assert.equal(await finish(worker, 15000), 0, await errors)
        assert.equal(requests, 1)
        assert.equal(store.getRun(run.id).status, 'completed')
        assert.equal(store.getRun(run.id).output, 'Startup fixture completed.')
        assert.equal(store.store.query('SELECT version FROM _schema_version WHERE version=12').length, 1)
      }
    }
    assert.equal(existsSync(lease), false, 'Startup failure/cancellation must release actor ownership')
    if (scenario === 'cancel' || scenario === 'schema-error') { assert.equal(requests, 0); assert.equal(store.getRun(run.id).attempt, 0) }
    else assert.equal(store.getRun(run.id).attempt, 1)
    console.log(`Passed real worker startup: ${scenario}`)
  } finally {
    for (const child of [worker, writer]) if (child?.exitCode === null) child.kill('SIGKILL')
    await Promise.all([worker?.exited, writer?.exited])
    server.stop(true); store.close(); await rm(directory, { recursive: true, force: true })
  }
}

async function errorsIfExited(child: ReturnType<typeof Bun.spawn>, errors: Promise<string>): Promise<string> {
  return child.exitCode === null ? 'Worker exited unexpectedly' : await errors
}
