import { afterEach, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BotStore, isSqliteBusy } from '../src/bots/store.js'

const stores: BotStore[] = []
const fixture = () => {
  const store = new BotStore({ memory: true }); stores.push(store)
  const bot = store.createBot({ name: 'steering', projectRoot: process.cwd(), instructions: 'Follow current user guidance.' })
  const run = store.enqueue(bot.id, 'Original work'); store.claim(bot.id, 'worker')
  return { store, bot, run }
}
afterEach(() => { for (const store of stores.splice(0)) store.close() })

it('adds guidance to the same occurrence and cancels stale pending or answered decisions', () => {
  const { store, bot, run } = fixture()
  const first = store.requestDecision(run.id, 'worker', 'permission', { tool: 'shell', args: { command: 'old' } })
  const correction = store.steer(run.id, 'Use the revised output path', 'message-one')
  expect(store.getDecision(first.id).status).toBe('cancelled')
  expect(store.getRun(run.id).status).toBe('running')
  expect(store.steer(run.id, correction.content, correction.id)).toEqual(correction)
  expect(store.steeringMessages(run.id)).toEqual([correction])
  expect(store.listRuns(bot.id)).toHaveLength(1)
  expect(store.events(bot.id).query({ type: 'BotRunSteered' })).toHaveLength(1)
  const second = store.requestDecision(run.id, 'worker', 'permission', { tool: 'shell', args: { command: 'still-old' } })
  store.answerDecision(second.id, second.fingerprint, 'once')
  store.steer(run.id, 'Also inspect the current sources', 'message-two')
  expect(store.getDecision(second.id).status).toBe('cancelled')
  expect(() => store.consumeDecision(second.id, 'worker')).toThrow('not answered')
})

it('rejects changed message IDs, credentials and inactive or expired targets', () => {
  const { store, run } = fixture()
  store.steer(run.id, 'Current guidance', 'same-id')
  expect(() => store.steer(run.id, 'Different guidance', 'same-id')).toThrow('collision')
  expect(() => store.steer(run.id, 'password=fixture-only-secret', 'secret')).toThrow('credentials')
  expect(() => store.steer(run.id, 'Safe guidance', 'token=fixture-only-secret')).toThrow('credentials')
  store.store.run('UPDATE bot_runs SET lease_until=? WHERE id=?', Date.now() - 1, run.id)
  expect(() => store.steer(run.id, 'Too late', 'late')).toThrow('active')
  expect(store.steeringMessages(run.id)).toHaveLength(1)
})

it('fences old actions inside the admission transaction without creating uncertain effects', () => {
  const { store, run } = fixture()
  const message = store.steer(run.id, 'Change the proposed action', 'revision')
  expect(store.admitAction(run.id, 'worker', 'shell', { command: 'old' }, false, 0)).toBeNull()
  expect(store.hasUncertainActions(run.id)).toBe(false)
  const action = store.admitAction(run.id, 'worker', 'shell', { command: 'new' }, false, message.sequence)
  expect(typeof action).toBe('string')
  expect(store.hasUncertainActions(run.id)).toBe(true)
  expect(() => store.admitAction(run.id, 'other', 'shell', {}, false, message.sequence)).toThrow('ownership')
})

it('checkpoints guidance atomically and cannot seal work with pending corrections', () => {
  const { store, bot, run } = fixture()
  const message = store.steer(run.id, 'Current guidance', 'revision')
  expect(store.sealRun(run.id, 'worker')).toBe(false)
  store.checkpoint(run.id, 'worker', [{ role: 'user', content: message.content }], 'Current progress', undefined, message.sequence)
  expect(store.getRun(run.id).steeringCursor).toBe(message.sequence)
  expect(store.transcript(bot.id)).toEqual([{ role: 'user', content: message.content }])
  expect(store.sealRun(run.id, 'worker')).toBe(true)
  expect(() => store.steer(run.id, 'After cleanup started', 'late')).toThrow('active')
  expect(store.steer(run.id, message.content, message.id)).toEqual(message)
  store.finish(run.id, 'worker', 'completed', 'Done')
})

it('rolls back accepted guidance when its durable event fails', () => {
  const { store, run } = fixture()
  const decision = store.requestDecision(run.id, 'worker', 'permission', { tool: 'shell' })
  store.store.exec(`CREATE TRIGGER reject_guidance BEFORE INSERT ON events WHEN NEW.type='BotRunSteered'
    BEGIN SELECT RAISE(ABORT,'native guidance rejected'); END;`)
  expect(() => store.steer(run.id, 'Must roll back', 'rollback')).toThrow('native guidance rejected')
  expect(store.steeringMessages(run.id)).toHaveLength(0)
  expect(store.getRun(run.id).status).toBe('waiting')
  expect(store.getDecision(decision.id).status).toBe('pending')
})

it('rolls back the guidance cursor together with a rejected conversation checkpoint', () => {
  const { store, bot, run } = fixture()
  store.checkpoint(run.id, 'worker', [{ role: 'user', content: 'Original work' }])
  const message = store.steer(run.id, 'Current guidance', 'checkpoint-revision')
  store.store.exec(`CREATE TRIGGER reject_history BEFORE UPDATE OF transcript ON bot_runs
    BEGIN SELECT RAISE(ABORT,'native history rejected'); END;`)
  expect(() => store.checkpoint(run.id, 'worker', [{ role: 'user', content: message.content }], undefined, undefined, message.sequence)).toThrow('native history rejected')
  expect(store.getRun(run.id).steeringCursor).toBe(0)
  expect(store.transcript(bot.id)).toEqual([{ role: 'user', content: 'Original work' }])
  expect(store.sealRun(run.id, 'worker')).toBe(false)
  expect(() => store.finish(run.id, 'worker', 'completed', 'Must not drop the correction')).toThrow('pending user guidance')
  store.store.exec('DROP TRIGGER reject_history')
  store.checkpoint(run.id, 'worker', [{ role: 'user', content: message.content }], undefined, undefined, message.sequence)
  expect(store.getRun(run.id).steeringCursor).toBe(message.sequence)
  expect(() => store.checkpoint(run.id, 'worker', [], undefined, undefined, 0)).toThrow('cursor')
  expect(store.transcript(bot.id)).toEqual([{ role: 'user', content: message.content }])
})

it('upgrades existing runs and preserves accepted guidance after reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'deepseek-guidance-upgrade-')), path = join(directory, 'state.db')
  let store = new BotStore({ path })
  try {
    const bot = store.createBot({ name: 'upgrade', projectRoot: directory, instructions: 'Current guidance.' })
    const run = store.enqueue(bot.id, 'Existing work'); store.claim(bot.id, 'worker')
    store.store.exec('DROP TABLE bot_run_messages; ALTER TABLE bot_runs DROP COLUMN steering_cursor; ALTER TABLE bot_runs DROP COLUMN accepting_messages; DELETE FROM _schema_version WHERE version=14')
    store.close(); store = new BotStore({ path })
    expect(store.getRun(run.id).steeringCursor).toBe(0)
    expect(store.getRun(run.id).acceptingMessages).toBe(true)
    const message = store.steer(run.id, 'Reopened correction', 'durable-message')
    store.close(); store = new BotStore({ path })
    expect(store.steeringMessages(run.id)).toEqual([message])
    expect(store.steer(run.id, message.content, message.id)).toEqual(message)
    expect(store.events(bot.id).query({ type: 'BotRunSteered' })).toHaveLength(1)
    expect(store.sealRun(run.id, 'worker')).toBe(false)
    expect(store.store.query('SELECT version FROM _schema_version WHERE version=14')).toHaveLength(1)
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})

for (const first of ['seal', 'guide']) it(`serializes ${first} against the competing process without dropping accepted input`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'deepseek-guidance-race-')), path = join(directory, 'state.db'), release = join(directory, 'release')
  const store = new BotStore({ path, busyTimeoutMs: 0 })
  let child: ReturnType<typeof Bun.spawn> | undefined
  try {
    const bot = store.createBot({ name: 'race', projectRoot: directory, instructions: 'Current guidance.' })
    const run = store.enqueue(bot.id, 'Existing work'); store.claim(bot.id, 'worker')
    let announce!: () => void
    const ready = new Promise<void>(done => { announce = done })
    const source = fileURLToPath(new URL('../src/bots/store.ts', import.meta.url))
    const spawned = Bun.spawn([process.execPath, '-e', `import { existsSync } from 'node:fs';import { BotStore } from ${JSON.stringify(source)};
      const store=new BotStore({path:process.env.GUIDANCE_DB,busyTimeoutMs:0}), get=store.getRun.bind(store);
      // Hold the real immediate writer after reading state. The competing
      // mutation must not enter while this read/commit boundary is held.
      store.getRun=(id)=>{const result=get(id);process.send('writer');const end=Date.now()+15000;
        while(!existsSync(process.env.GUIDANCE_RELEASE)){if(Date.now()>end)throw Error('Guidance race barrier timed out');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10)}
        store.getRun=get;return result};
      try{const result=process.env.GUIDANCE_FIRST==='seal'?store.sealRun(process.env.GUIDANCE_RUN,'worker'):store.steer(process.env.GUIDANCE_RUN,'Competing correction','race-message');console.log(JSON.stringify(result))}finally{store.close()}`], {
      env: { ...process.env, GUIDANCE_DB: path, GUIDANCE_RUN: run.id, GUIDANCE_RELEASE: release, GUIDANCE_FIRST: first },
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', ipc(message) { if (message === 'writer') announce() },
    })
    child = spawned
    const output = new Response(spawned.stdout).text(), errors = new Response(spawned.stderr).text()
    await Promise.race([ready, child.exited.then(async () => { throw Error(await errors) })])
    expect(child.exitCode).toBeNull(); expect(existsSync(release)).toBe(false)
    let rejection: unknown
    try { if (first === 'seal') store.steer(run.id, 'Competing correction', 'race-message'); else store.sealRun(run.id, 'worker') }
    catch (error) { rejection = error }
    expect(isSqliteBusy(rejection)).toBe(true)
    writeFileSync(release, '')
    expect(await child.exited).toBe(0); expect(await errors).toBe('')
    const result = JSON.parse(await output)
    if (first === 'seal') {
      expect(result).toBe(true)
      expect(() => store.steer(run.id, 'Competing correction', 'race-message')).toThrow('active')
      expect(store.steeringMessages(run.id)).toHaveLength(0)
    } else {
      expect(store.steeringMessages(run.id)).toEqual([result])
      expect(store.sealRun(run.id, 'worker')).toBe(false)
      expect(() => store.finish(run.id, 'worker', 'completed', 'Must not drop input')).toThrow('pending user guidance')
    }
  } finally {
    if (child?.exitCode === null) child.kill('SIGKILL')
    if (child) await child.exited
    store.close(); rmSync(directory, { recursive: true, force: true })
  }
}, 20000)
