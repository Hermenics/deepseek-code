import { expect, it } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BotStore, isSqliteBusy } from '../src/bots/store.js'
import { botControl } from '../src/bots/control.js'
import { procedureGuard } from '../src/bots/procedures.js'
import { removeTempDirectory } from './helpers/removeTempDirectory.js'
import { waitForChildFile } from './helpers/waitForChildFile.js'

function demonstration(store: BotStore, botId: string) {
  const source = store.enqueue(botId, 'Observe the demonstrated procedure')
  store.claim(botId, 'demonstrator')
  store.recordBrowserStep(source.id, 'demonstrator', { action: 'navigate', url: 'https://example.com/task' })
  store.recordBrowserStep(source.id, 'demonstrator', { action: 'expect', text: 'Done' })
  store.checkpoint(source.id, 'demonstrator', [])
  store.finish(source.id, 'demonstrator', 'completed', 'Observed'); store.acknowledgeStop(source.id, 'demonstrator')
  return source
}

for (const action of ['remember', 'update_note', 'forget', 'send', 'schedule', 'disable_routine', 'learn']) it(`fences ${action} inside the actual bot-control mutation`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-control-fence-')), path = join(directory, 'state.db')
  const store = new BotStore({ path })
  try {
    const bot = store.createBot({ name: 'controls', projectRoot: directory, instructions: 'Owned fixture' })
    const recipient = store.createBot({ name: 'recipient', projectRoot: directory, instructions: 'Owned fixture' })
    const source = demonstration(store, bot.id)
    const note = store.addNote(bot.id, 'Keep the project conventions', 'fixture')
    const routine = store.addRoutine(bot.id, { name: 'Existing', prompt: 'Existing work', schedule: { kind: 'event', topic: 'fixture' } })
    const run = store.enqueue(bot.id, 'Use bot controls'), claimed = store.claim(bot.id, 'former-owner')!
    const tool = botControl(store, () => claimed)
    store.store.run('UPDATE bot_runs SET lease_until=? WHERE id=?', Date.now() - 1, run.id)
    const args = { action, content: 'A stale owner cannot add this note', source: 'fixture', id: ['forget','update_note'].includes(action) ? note.id : routine.id, version: note.version,
      bot: recipient.id, prompt: 'New work', name: 'new-method', runId: source.id, messageId: 'control-id', schedule: { kind: 'event', topic: 'new-work' } }
    await expect(tool.execute(args)).rejects.toThrow('ownership')
    expect(store.notes(bot.id)).toHaveLength(1)
    expect(store.routines(bot.id)).toHaveLength(1)
    expect(store.routines(bot.id)[0]!.enabled).toBe(true)
    expect(store.listRuns(recipient.id)).toHaveLength(0)
    expect(store.procedures(bot.id)).toHaveLength(0)
    expect(existsSync(join(store.skillDirectory(bot.id), 'new-method', 'SKILL.md'))).toBe(false)
  } finally { store.close(); await removeTempDirectory(directory) }
})

for (const action of ['remember', 'update_note', 'forget', 'send', 'schedule', 'disable_routine', 'learn']) it(`commits ${action} once after a real SQLite writer releases`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-control-write-')), path = join(directory, 'state.db')
  const store = new BotStore({ path, busyTimeoutMs: 0 })
  let writer: ReturnType<typeof Bun.spawn> | undefined, attempt: Promise<string> | undefined
  try {
    const bot = store.createBot({ name: 'controls', projectRoot: directory, instructions: 'Owned fixture' })
    const recipient = store.createBot({ name: 'recipient', projectRoot: directory, instructions: 'Owned fixture' })
    const source = demonstration(store, bot.id), note = store.addNote(bot.id, 'Keep the project conventions', 'fixture')
    const routine = store.addRoutine(bot.id, { name: 'Existing', prompt: 'Existing work', schedule: { kind: 'event', topic: 'fixture' } })
    store.enqueue(bot.id, 'Use bot controls'); const claimed = store.claim(bot.id, 'owner')!, tool = botControl(store, () => claimed)
    let locked!: () => void
    const holding = new Promise<void>(done => { locked = done })
    const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_CONTROL_PATH);
      db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},1000)`
    writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_CONTROL_PATH: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its lock') })])
    const args = { action, content: 'Use current project conventions', source: 'fixture', id: ['forget','update_note'].includes(action) ? note.id : routine.id, version: note.version,
      bot: recipient.id, prompt: 'New work', name: 'new-method', runId: source.id, messageId: 'control-id', schedule: { kind: 'event', topic: 'new-work' } }
    let settled = false
    attempt = tool.execute(args).finally(() => { settled = true }); void attempt.catch(() => undefined)
    await Bun.sleep(100)
    expect(settled).toBe(false)
    expect(writer.exitCode).toBeNull()
    expect(existsSync(join(store.skillDirectory(bot.id), 'new-method', 'SKILL.md'))).toBe(false)
    expect(await writer.exited).toBe(0)
    await attempt; await tool.execute(args)
    expect(store.notes(bot.id)).toHaveLength(action === 'remember' ? 2 : action === 'forget' ? 0 : 1)
    expect(store.routines(bot.id)).toHaveLength(action === 'schedule' ? 2 : 1)
    expect(store.routines(bot.id).find(r => r.id === routine.id)!.enabled).toBe(action !== 'disable_routine')
    expect(store.listRuns(recipient.id)).toHaveLength(action === 'send' ? 1 : 0)
    expect(store.procedures(bot.id)).toHaveLength(action === 'learn' ? 1 : 0)
    expect(existsSync(join(store.skillDirectory(bot.id), 'new-method', 'SKILL.md'))).toBe(action === 'learn')
    expect(store.events(bot.id).query({ type: 'BotProcedureLearned' })).toHaveLength(action === 'learn' ? 1 : 0)
    expect(store.events(bot.id).query({ type: 'BotRoutineCreated' })).toHaveLength(action === 'schedule' ? 2 : 1)
  } finally {
    if (writer?.exitCode === null) writer.kill()
    if (writer) await writer.exited
    await attempt?.catch(() => undefined); store.close(); await removeTempDirectory(directory)
  }
}, 5000)

for (const reason of ['cancel', 'context-cancel', 'expire']) it(`stops a contended control write on ${reason} without admitting its mutation`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-control-stop-')), path = join(directory, 'state.db')
  const store = new BotStore({ path, busyTimeoutMs: 0 }), controller = new AbortController()
  let writer: ReturnType<typeof Bun.spawn> | undefined, attempt: Promise<string> | undefined
  try {
    const bot = store.createBot({ name: 'controls', projectRoot: directory, instructions: 'Owned fixture' })
    const run = store.enqueue(bot.id, 'Use bot controls'), claimed = store.claim(bot.id, 'owner')!
    if (reason === 'expire') store.store.run('UPDATE bot_runs SET lease_until=? WHERE id=?', Date.now() + 300, run.id)
    const tool = botControl(store, () => claimed, reason === 'context-cancel' ? undefined : controller.signal)
    let locked!: () => void
    const holding = new Promise<void>(done => { locked = done })
    const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_CONTROL_PATH);
      db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},1200)`
    writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_CONTROL_PATH: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its lock') })])
    attempt = tool.execute({ action: 'remember', content: 'Must not be retained', source: 'fixture' }, reason === 'context-cancel' ? {
      signal: controller.signal, sessionId: 'fixture', workspacePath: directory, projectRoot: directory, permissionProfile: 'coordinator-integrator',
    } : undefined)
    void attempt.catch(() => undefined)
    if (reason !== 'expire') { await Bun.sleep(100); controller.abort(new Error('stopping fixture')) }
    await expect(attempt).rejects.toThrow(reason === 'expire' ? 'ownership' : 'operation was aborted')
    expect(writer.exitCode).toBeNull()
    expect(await writer.exited).toBe(0)
    expect(store.notes(bot.id)).toHaveLength(0)
  } finally {
    controller.abort()
    if (writer?.exitCode === null) writer.kill()
    if (writer) await writer.exited
    await attempt?.catch(() => undefined); store.close(); await removeTempDirectory(directory)
  }
}, 5000)

it('cannot re-enable a procedure routine using a readiness check from before invalidation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-enable-race-')), path = join(directory, 'state.db')
  const store = new BotStore({ path, busyTimeoutMs: 0 })
  let child: ReturnType<typeof Bun.spawn> | undefined
  try {
    const bot = store.createBot({ name: 'routine-race', projectRoot: directory, instructions: 'Owned fixture' })
    const source = demonstration(store, bot.id), procedure = store.learnProcedure(bot.id, source.id, 'observed-method')
    const routine = store.addRoutine(bot.id, { name: 'Observed', prompt: 'Use the observed method', schedule: { kind: 'event', topic: 'fixture' }, procedureId: procedure.id, procedureInputs: { expectedText2: 'Done' } })
    store.setRoutineEnabled(routine.id, false)
    const ready = join(directory, 'ready'), release = join(directory, 'release')
    const sourcePath = fileURLToPath(new URL('../src/bots/store.ts', import.meta.url))
    const code = `import { existsSync, writeFileSync } from 'node:fs';import { BotStore } from ${JSON.stringify(sourcePath)};
      const store=new BotStore({path:process.env.DEEPSEEK_CONTROL_PATH}), original=store.getProcedure.bind(store);
      store.getProcedure=(...args)=>{const value=original(...args);writeFileSync(process.env.DEEPSEEK_CONTROL_READY,'');const end=Date.now()+10000;
        while(!existsSync(process.env.DEEPSEEK_CONTROL_RELEASE)){if(Date.now()>end)throw Error('Routine barrier timed out');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10)}return value};
      try{store.setRoutineEnabled(process.env.DEEPSEEK_CONTROL_ROUTINE,true)}finally{store.close()}`
    const started = Bun.spawn([process.execPath, '-e', code], {
      env: { ...process.env, DEEPSEEK_CONTROL_PATH: path, DEEPSEEK_CONTROL_RELEASE: release, DEEPSEEK_CONTROL_READY: ready, DEEPSEEK_CONTROL_ROUTINE: routine.id },
      stdin: 'ignore', stdout: 'ignore', stderr: 'pipe',
    })
    child = started
    const errors = new Response(started.stderr).text()
    await waitForChildFile(ready, child, errors, 10000)
    let invalidated = false
    try { store.invalidateProcedure(bot.id, procedure.id, 'Observed page changed'); invalidated = true }
    catch (error) { if (!isSqliteBusy(error)) throw error }
    await writeFile(release, '')
    const exit = await child.exited, error = await errors
    expect(exit === 0 || exit === 1 && error.includes('fresh demonstration')).toBe(true)
    if (!invalidated) store.invalidateProcedure(bot.id, procedure.id, 'Observed page changed')
    expect(store.getProcedure(bot.id, procedure.id).status).toBe('needs_review')
    expect(store.routines(bot.id)[0]!.enabled).toBe(false)
    expect(store.dispatchEvent('fixture', 'after-race', {})).toHaveLength(0)
  } finally {
    if (child?.exitCode === null) child.kill()
    if (child) await child.exited
    store.close(); await removeTempDirectory(directory)
  }
}, 15000)

for (const phase of ['before', 'completion']) it(`persists ${phase} procedure rejection through a real writer lock`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-procedure-busy-')), path = join(directory, 'state.db')
  const store = new BotStore({ path, busyTimeoutMs: 0 })
  let writer: ReturnType<typeof Bun.spawn> | undefined, attempt: Promise<unknown> | undefined
  try {
    const bot = store.createBot({ name: 'procedure-guard', projectRoot: directory, instructions: 'Owned fixture' })
    const source = demonstration(store, bot.id), procedure = store.learnProcedure(bot.id, source.id, 'observed-method')
    store.addRoutine(bot.id, { name: 'Observed', prompt: 'Use observed work', schedule: { kind: 'event', topic: 'fixture' }, procedureId: procedure.id, procedureInputs: { expectedText2: 'Done' } })
    store.dispatchEvent('fixture', 'one', {})
    const claimed = store.claim(bot.id, 'owner')!, guard = procedureGuard(store, claimed, 'owner')
    let locked!: () => void
    const holding = new Promise<void>(done => { locked = done })
    const code = `import { Database } from 'bun:sqlite';const db=new Database(process.env.DEEPSEEK_CONTROL_PATH);
      db.exec('BEGIN IMMEDIATE');process.send('locked');setTimeout(()=>{db.exec('COMMIT');db.close();process.exit(0)},1000)`
    writer = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, DEEPSEEK_CONTROL_PATH: path }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', ipc(message) { if (message === 'locked') locked() } })
    await Promise.race([holding, writer.exited.then(() => { throw Error('Writer exited before its lock') })])
    let settled = false
    attempt = Promise.resolve().then(() => phase === 'before' ? guard.before({ action: 'click', ref: 'e1' }) : guard.assertComplete())
      .then(() => { settled = true; return new Error('Unexpected procedure acceptance') }, error => { settled = true; return error })
    await Bun.sleep(100)
    expect(settled).toBe(false)
    expect(writer.exitCode).toBeNull()
    expect(await writer.exited).toBe(0)
    const error = await attempt as Error
    expect(error.message).toContain(phase === 'before' ? 'requires navigate' : 'did not finish')
    expect(store.getProcedure(bot.id, procedure.id).status).toBe('needs_review')
    expect(store.routines(bot.id)[0]!.enabled).toBe(false)
    expect(existsSync(join(store.skillDirectory(bot.id), procedure.name, 'SKILL.md'))).toBe(false)
    expect(store.events(bot.id).query({ type: 'BotProcedureNeedsReview' })).toHaveLength(1)
    expect(store.getRun(claimed.id).procedureCursor).toBe(0)
  } finally {
    if (writer?.exitCode === null) writer.kill()
    if (writer) await writer.exited
    await attempt; store.close(); await removeTempDirectory(directory)
  }
}, 5000)
