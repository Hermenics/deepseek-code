// Real completed Agent/worker cleanup: bun tests/bot-stop-check.ts [complete|cancel|schema-error|missing-provider]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { BotStore } from '../src/bots/store.js'

const selected = process.argv[2], cases = ['complete', 'cancel', 'schema-error', 'missing-provider']
if (selected && !cases.includes(selected)) throw Error('Unknown cleanup check')
for (const name of selected ? [selected] : cases) {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-stop-check-')), path = join(directory, 'state.db')
  const store = new BotStore({ path }), bot = store.createBot({ name: 'stop-fixture', projectRoot: directory, instructions: 'Report the observed completion.' })
  const run = store.enqueue(bot.id, 'Native stop acknowledgement'), gate = join(directory, 'release-stop')
  const lease = join(tmpdir(), 'deepseek-code-leases-v1', createHash('sha256').update(`bot-actor:${path}:${bot.id}`).digest('hex'))
  let requests = 0, paused!: () => void, writer: ReturnType<typeof Bun.spawn> | undefined
  const stopped = new Promise<void>(done => { paused = done })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests++; await request.json()
    return Response.json({ id: 'stop-response', object: 'chat.completion', created: 1, model: 'bot-check',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Observed completion retained.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
  } })
  const env: NodeJS.ProcessEnv = { ...process.env, BOT_CHECK_PROVIDER_URL: server.url.href + 'v1', BOT_CHECK_STOP_GATE: gate }
  if (name === 'missing-provider') env.BOT_CHECK_NO_PROVIDER = '1'
  delete env.DEEPSEEK_BOTS_TOKEN
  const worker = Bun.spawn([process.execPath, resolve(import.meta.dir, 'bot-runtime-check.ts'), '--bot-worker', path, bot.id], {
    env, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message?.type === 'stop-barrier') paused() },
  })
  const errors = new Response(worker.stderr).text()
  const deadline = new AbortController()
  const finish = (process: ReturnType<typeof Bun.spawn>, ms: number) => Promise.race([
    process.exited, delay(ms, undefined, { signal: deadline.signal }).then(() => { throw Error(`${name}: cleanup exceeded its deadline`) }),
  ])
  try {
    await Promise.race([stopped, worker.exited.then(async () => { throw Error(await errors) })])
    const completed = store.getRun(run.id)
    const expectedStatus = name === 'missing-provider' ? 'failed' : 'completed', expectedRequests = name === 'missing-provider' ? 0 : 1
    assert.equal(completed.status, expectedStatus); assert.equal(requests, expectedRequests)
    assert.ok(completed.owner?.startsWith(`${worker.pid}:`))
    if (name === 'schema-error') store.store.exec('ALTER TABLE bot_runs RENAME TO missing_runs')
    else {
      let locked!: () => void
      const holding = new Promise<void>(done => { locked = done })
      const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_STOP_DATABASE);
        db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},8000)`
      writer = Bun.spawn([process.execPath, '-e', code], {
        env: { ...process.env, DEEPSEEK_STOP_DATABASE: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() },
      })
      await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its lock') })])
    }
    await writeFile(gate, '')
    if (name === 'cancel') {
      await delay(250); worker.kill('SIGTERM')
      assert.equal(await finish(worker, 2000), 0, await errorsIfExited())
      assert.equal(writer!.exitCode, null, 'Stop must remain responsive while the writer is held')
      assert.equal(existsSync(lease), false)
      // An exited handle permits recovery of terminal ownership after the writer releases.
      assert.equal(await finish(writer!, 12000), 0)
      store.recover()
    } else if (name === 'schema-error') {
      assert.equal(await finish(worker, 3000), 1)
      assert.match(await errors, /no such table: bot_runs/)
      store.store.exec('ALTER TABLE missing_runs RENAME TO bot_runs')
      store.recover()
    } else {
      assert.equal(await finish(writer!, 12000), 0)
      assert.equal(await finish(worker, 15000), 0, await errors)
    }
    const result = store.getRun(run.id)
    assert.equal(result.status, expectedStatus)
    assert.equal(result.output, name === 'missing-provider' ? '' : 'Observed completion retained.')
    if (name === 'missing-provider') assert.match(result.error!, /Configure a provider/)
    assert.equal(result.owner, null); assert.equal(result.attempt, 1); assert.equal(requests, expectedRequests)
    assert.equal(existsSync(lease), false)
    console.log(`Passed real worker stop acknowledgement: ${name}`)
  } finally {
    deadline.abort()
    for (const process of [worker, writer]) if (process?.exitCode === null) process.kill('SIGKILL')
    await Promise.all([worker.exited, writer?.exited]); server.stop(true); store.close()
    await rm(directory, { recursive: true, force: true })
  }
  async function errorsIfExited() { return worker.exitCode === null ? 'Worker failed while stopping' : await errors }
}
