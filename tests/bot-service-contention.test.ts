import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { serveBots } from '../src/bots/service.js'
import { runPodsCli } from '../src/bots/cli.js'

for (const pendingMigration of [false, true]) it(`opens ${pendingMigration ? 'a database with a pending migration' : 'a migrated database'} during writer contention without blocking or abandoning startup`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-startup-check-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  // Migration 12 changes data only: removing its ledger entry leaves the
  // actual previous schema, which must be upgraded while the writer is held.
  if (pendingMigration) store.store.run('DELETE FROM _schema_version WHERE version = 12')
  const controller = new AbortController(), token = 'startup-contention-check-' + 'x'.repeat(40)
  let locked!: () => void, announce!: (url: string) => void, failure: unknown
  const holding = new Promise<void>(done => { locked = done }), ready = new Promise<string>(done => { announce = done })
  const code = `import { Database } from 'bun:sqlite'; const db=new Database(process.env.DEEPSEEK_STARTUP_DATABASE);
    db.exec('BEGIN IMMEDIATE');process.send('locked');
    setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},8000);`
  const writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_STARTUP_DATABASE: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
  let running: Promise<void> | undefined
  try {
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before acquiring its startup lock') })])
    const start = Date.now()
    running = serveBots({ path, signal: controller.signal, web: { token, port: 0 }, onWebListening: announce }).catch(error => { failure = error })
    await Bun.sleep(100)
    expect(Date.now() - start).toBeLessThan(1000)
    expect(writer.exitCode).toBeNull()
    expect(await writer.exited).toBe(0)
    const url = await Promise.race([ready, running.then(() => { throw failure ?? Error('Service stopped before listening') })])
    expect(failure).toBeUndefined()
    expect((await fetch(url + '/api/bots', { headers: { authorization: 'Bearer ' + token } })).status).toBe(200)
  } finally {
    if (writer.exitCode === null) writer.kill()
    await writer.exited; controller.abort(); await running; store.close(); await rm(directory, { recursive: true, force: true })
  }
}, 25000)

it('cancels contended migration startup promptly and preserves the pending version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-startup-abort-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  store.store.run('DELETE FROM _schema_version WHERE version = 12')
  let locked!: () => void
  const holding = new Promise<void>(done => { locked = done }), controller = new AbortController()
  const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_STARTUP_DATABASE);
    db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},8000)`
  const writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_STARTUP_DATABASE: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
  let running: Promise<void> | undefined, listened = false
  try {
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its lock') })])
    const start = Date.now()
    running = serveBots({ path, signal: controller.signal, web: { token: 'abort-check-' + 'x'.repeat(40), port: 0 }, onWebListening() { listened = true } })
    await Bun.sleep(150); controller.abort(); await running
    expect(Date.now() - start).toBeLessThan(1000)
    expect(writer.exitCode).toBeNull()
    expect(listened).toBe(false)
    expect(store.store.query('SELECT version FROM _schema_version WHERE version=12')).toHaveLength(0)
  } finally {
    controller.abort(); await running
    if (writer.exitCode === null) writer.kill()
    await writer.exited; store.close(); await rm(directory, { recursive: true, force: true })
  }
}, 12000)

it('does not retry a broken pending migration or accept an invalid async busy timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-startup-schema-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  try {
    store.store.run('DELETE FROM _schema_version WHERE version=12')
    store.store.exec('DROP TABLE bot_routines')
    await expect(BotStore.open({ path })).rejects.toThrow('no such table: bot_routines')
    await expect(BotStore.open({ path, busyTimeoutMs: -1 })).rejects.toThrow('Invalid SQLite busy timeout')
    expect(store.store.query('SELECT version FROM _schema_version WHERE version=12')).toHaveLength(0)
  } finally { store.close(); await rm(directory, { recursive: true, force: true }) }
})

it('yields during pending-migration startup for terminal commands too', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-cli-startup-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  store.store.run('DELETE FROM _schema_version WHERE version=12')
  let locked!: () => void
  const holding = new Promise<void>(done => { locked = done })
  const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_STARTUP_DATABASE);
    db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},1000)`
  const writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_STARTUP_DATABASE: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
  let listing: Promise<void> | undefined
  try {
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its lock') })])
    const start = Date.now()
    listing = runPodsCli(['list', '--db', path])
    await Bun.sleep(100)
    expect(Date.now() - start).toBeLessThan(500)
    expect(writer.exitCode).toBeNull()
    await listing
    expect(await writer.exited).toBe(0)
    expect(store.store.query('SELECT version FROM _schema_version WHERE version=12')).toHaveLength(1)
  } finally {
    if (writer.exitCode === null) writer.kill()
    await writer.exited; await listing; store.close(); await rm(directory, { recursive: true, force: true })
  }
}, 5000)

it('keeps the supervisor alive across real SQLite writer contention', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-busy-check-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  const bot = store.createBot({ name: 'owned-fixture', projectRoot: directory, instructions: 'Fixture only' })
  const controller = new AbortController(), token = 'isolated-contention-check-' + 'x'.repeat(40)
  let announce!: (url: string) => void, failure: unknown
  const ready = new Promise<string>(done => { announce = done })
  const running = serveBots({ path, signal: controller.signal, web: { token, port: 0 }, onWebListening: announce }).catch(error => { failure = error })
  let writer: ReturnType<typeof Bun.spawn> | undefined
  try {
    const url = await ready
    let locked!: () => void
    const holding = new Promise<void>(done => { locked = done })
    // A different process owns the real write lock beyond the native 5s
    // busy timeout. Its own timer releases it even while our JS thread waits.
    const code = `import { Database } from 'bun:sqlite';
      const db = new Database(process.env.DEEPSEEK_CONTENTION_DATABASE);
      db.exec('PRAGMA busy_timeout=5000'); db.exec('BEGIN IMMEDIATE');
      process.send('locked');
      setTimeout(() => { db.exec('COMMIT'); db.close(); process.exit(0); }, 8000);`
    writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_CONTENTION_DATABASE: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before acquiring its lock') })])
    const start = Date.now()
    await Bun.sleep(700)
    const heldResponse = await fetch(url + '/api/bots', { headers: { authorization: 'Bearer ' + token } })
    expect(heldResponse.status).toBe(200)
    expect(Date.now() - start).toBeLessThan(2000)
    expect(writer.exitCode).toBeNull()
    const write = () => fetch(url + '/api/bots/' + bot.id + '/messages', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Contended enqueue', occurrenceId: 'held-write' }),
    })
    const blockedWrite = await write()
    expect(blockedWrite.status).toBe(503)
    expect(blockedWrite.headers.get('retry-after')).toBe('1')
    expect(await blockedWrite.json()).toEqual({ error: 'Database is busy; retry this request.', code: 'database_busy' })
    expect(store.listRuns(bot.id)).toHaveLength(0)
    expect(await writer.exited).toBe(0)
    await Bun.sleep(700)
    expect(failure).toBeUndefined()
    const response = await fetch(url + '/api/bots', { headers: { authorization: 'Bearer ' + token } })
    expect(response.status).toBe(200)
    expect(store.events('service').query({ type: 'BotServiceError' })).toHaveLength(0)
    expect(store.listRuns(bot.id)).toHaveLength(0)
    store.setEnabled(bot.id, false)
    const accepted = await write()
    expect(accepted.status).toBe(201)
    const first = await accepted.json() as { id: string }
    const retry = await write()
    expect(retry.status).toBe(201)
    expect((await retry.json() as { id: string }).id).toBe(first.id)
    expect(store.listRuns(bot.id)).toHaveLength(1)
    expect(store.events(bot.id).query({ type: 'BotRunQueued' })).toHaveLength(1)
  } finally {
    if (writer && writer.exitCode === null) writer.kill()
    if (writer) await writer.exited
    controller.abort(); await running; store.close(); await rm(directory, { recursive: true, force: true })
  }
}, 25_000)

it('still reports a real schema error instead of retrying it as writer contention', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-schema-check-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000)
  try {
    store.store.exec('DROP TABLE bot_routines')
    await expect(serveBots({ path, signal: controller.signal })).rejects.toThrow('no such table: bot_routines')
    expect(store.events('service').query({ type: 'BotServiceError' })).toHaveLength(1)
  } finally { clearTimeout(timer); controller.abort(); store.close(); await rm(directory, { recursive: true, force: true }) }
}, 5000)

it('commits queue and enable changes atomically with their durable events', () => {
  const store = new BotStore({ memory: true })
  try {
    const bot = store.createBot({ name: 'atomic-fixture', projectRoot: process.cwd(), instructions: 'Owned fixture' })
    store.store.exec(`CREATE TRIGGER fail_control_event BEFORE INSERT ON events
      WHEN NEW.type IN ('BotCreated','BotRunQueued','BotEnabled')
      BEGIN SELECT RAISE(ABORT,'fixture event rejected'); END;`)
    const creation = { name: 'atomic-created', projectRoot: process.cwd(), instructions: 'Owned fixture' }
    expect(() => store.createBot(creation)).toThrow('fixture event rejected')
    expect(store.listBots()).toHaveLength(1)
    expect(() => store.enqueue(bot.id, 'Owned request', 'user', 'atomic-enqueue')).toThrow('fixture event rejected')
    expect(() => store.setEnabled(bot.id, false)).toThrow('fixture event rejected')
    expect({ runs: store.listRuns(bot.id).length, enabled: store.getBot(bot.id).enabled }).toEqual({ runs: 0, enabled: true })
    store.store.exec('DROP TRIGGER fail_control_event')
    const created = store.createBot(creation)
    expect(store.events(created.id).query({ type: 'BotCreated' })).toHaveLength(1)
    expect(store.enqueue(bot.id, 'Owned request', 'user', 'atomic-enqueue').status).toBe('queued')
    expect(store.enqueue(bot.id, 'Owned request', 'user', 'atomic-enqueue').id).toBe(store.listRuns(bot.id)[0]!.id)
    expect(store.events(bot.id).query({ type: 'BotRunQueued' })).toHaveLength(1)
  } finally { store.close() }
})

it('starts the full run lease after acquiring a contended writer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-claim-clock-'))
  const path = join(directory, 'state.db'), store = new BotStore({ path })
  const bot = store.createBot({ name: 'claim-clock', projectRoot: directory, instructions: 'Owned fixture' })
  const run = store.enqueue(bot.id, 'Owned request')
  let locked!: () => void
  const holding = new Promise<void>(done => { locked = done })
  const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_STARTUP_DATABASE);
    db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},2000)`
  const writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_STARTUP_DATABASE: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
  try {
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its lock') })])
    const claimed = store.claim(bot.id, 'fresh-owner')!
    expect(claimed.id).toBe(run.id)
    expect(claimed.leaseUntil!).toBeGreaterThanOrEqual(Date.now() + 29500)
    expect(await writer.exited).toBe(0)
  } finally {
    if (writer.exitCode === null) writer.kill()
    await writer.exited; store.close(); await rm(directory, { recursive: true, force: true })
  }
}, 10000)
