import { expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureProcess, observeProcess, parseLinuxProcessStat, type ProcessObservation } from '../src/orchestration/processIdentity.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import { TaskRegistry } from '../src/orchestration/TaskRegistry.js'
import { TaskRuntimeError } from '../src/orchestration/lifecycle.js'
import { validateRestoredTaskRecord } from '../src/orchestration/schema.js'
import { scrubbedEnv } from '../src/utils/platform.js'

const linux = it.skipIf(process.platform !== 'linux')

function signalObservedProcessGroup(observation: ProcessObservation | undefined, signal: NodeJS.Signals): void {
  const identity = observation?.identity
  if (!identity || observation.scope !== 'process-group' || identity.processGroupId !== identity.pid) return
  const fresh = observeProcess(observation)
  const current = fresh.identity
  if (!current || current.pid !== identity.pid || current.bootId !== identity.bootId
    || current.pidNamespace !== identity.pidNamespace || current.startTimeTicks !== identity.startTimeTicks
    || current.sessionId !== identity.sessionId || current.processGroupId !== identity.processGroupId
    || fresh.status === 'unknown' || fresh.status === 'identity-mismatch'
    || fresh.processGroup?.id !== identity.pid || fresh.processGroup.status !== 'alive') return
  try { process.kill(-identity.pid, signal) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
}

it('marks a failed child spawn as exited when no process ID was assigned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-spawn-failure-'))
  const registry = new TaskRegistry({ projectRoot: root })
  try {
    const handle = registry.spawn({ taskId: 'missing-command' }, async context => {
      const child = new EventEmitter() as unknown as ChildProcess
      child.on('error', () => {})
      const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
      context.trackProcess(child)
      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('missing executable'), { code: 'ENOENT' }))
        child.emit('close', -2, null)
      })
      await closed
      return 'settled'
    })
    const result = await handle.awaitResult()
    expect(result.status).toBe('done')
    expect(registry.getStatus('missing-command').process).toMatchObject({ status: 'exited', provenance: 'child-event', reason: 'spawn-failed' })
  } finally {
    await registry.awaitIdle()
    await rm(root, { recursive: true, force: true })
  }
})

it('parses process identity after names containing spaces, parentheses and newlines', () => {
  const fields = ['S', ...Array.from({ length: 18 }, () => '0'), '123456']
  fields[2] = '42'
  fields[3] = '24'
  expect(parseLinuxProcessStat(`42 (name ) with (\nparentheses)) ${fields.join(' ')}`, 42)).toEqual({ state: 'S', processGroupId: 42, sessionId: 24, startTimeTicks: '123456' })
  for (const value of ['42 bad fields', '43 (name) '+fields.join(' '), '42 (name) S 0']) expect(() => parseLinuxProcessStat(value, 42)).toThrow()
})

linux('revalidates a real owned process by boot, PID namespace and start time without treating liveness as progress', async () => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');process.stdin.resume()"], { env: scrubbedEnv(), stdio: ['pipe', 'pipe', 'ignore'] })
  const exited = once(child, 'exit')
  try {
    await once(child.stdout!, 'data')
    const observation = captureProcess(child)
    expect(observation.status).toBe('alive')
    expect(observation.scope).toBe('leader-only')
    expect(observation.progress).toBe('not-measured')
    expect(observation.identity?.pid).toBe(child.pid)
    const identity = observation.identity!
    for (const modified of [
      { identity: { ...identity, startTimeTicks: identity.startTimeTicks + '1' }, expected: 'identity-mismatch' as const },
      { identity: { ...identity, bootId: '00000000-0000-0000-0000-000000000000' }, expected: 'identity-mismatch' as const },
      { identity: { ...identity, sessionId: identity.sessionId! + 1 }, expected: 'identity-mismatch' as const },
      { identity: { ...identity, pidNamespace: 'pid:[0]' }, expected: 'unknown' as const },
    ]) expect(observeProcess({ ...observation, identity: modified.identity }).status).toBe(modified.expected)
    child.stdin!.end()
    await exited
    const ended = observeProcess(observation)
    expect(ended.status).toBe('exited')
    expect(ended.exitCode).toBeUndefined()
    expect(ended.provenance).toBe('kernel')
    expect(observeProcess({ ...observation, identity: undefined }).status).toBe('unknown')
  } finally { child.kill('SIGKILL'); await exited }
})

linux('emits periodic liveness observations for a tracked Linux child', async () => {
  const registry = new TaskRegistry({ projectRoot: process.cwd() })
  let child: ReturnType<typeof spawn> | undefined
  let childEnded: Promise<unknown[]> | undefined
  let ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  const handle = registry.spawn({ taskId: 'heartbeat' }, async context => {
    child = spawn(process.execPath, ['-e', "process.stdout.write('ready');process.stdin.resume()"], { env: scrubbedEnv(), stdio: ['pipe', 'pipe', 'ignore'] })
    childEnded = once(child, 'exit')
    context.trackProcess(child)
    await once(child.stdout!, 'data')
    ready()
    await childEnded
    return 'done'
  })
  try {
    await started
    const initial = registry.getStatus('heartbeat')
    const initialUpdatedAt = initial.updatedAt
    await Bun.sleep(5_200)
    const observations = registry.events.list('heartbeat')
      .filter(event => event.type === 'process_observed')
      .map(event => event.payload.process as { status: string; observedAt: string; provenance: string })
    expect(observations.length).toBeGreaterThan(1)
    expect(observations.at(-1)).toMatchObject({ status: 'alive', provenance: 'kernel' })
    expect(Date.parse(observations.at(-1)!.observedAt)).toBeGreaterThan(Date.parse(initial.process!.observedAt))
    expect(Date.parse(registry.getStatus('heartbeat').updatedAt)).toBeGreaterThan(Date.parse(initialUpdatedAt))
    child!.stdin!.end()
    expect((await handle.awaitResult()).status).toBe('done')
  } finally {
    child?.kill('SIGKILL')
    await childEnded
    await registry.awaitIdle()
  }
}, 10_000)

linux('does not complete a task while descendants remain in its owned process group', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-process-group-'))
  const marker = join(root, 'descendant-started')
  const descendant = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`
  const leader = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});const deadline=Date.now()+3000;const poll=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(marker)})){clearInterval(poll);process.stdout.write('leader-ready');process.exit(0)}if(Date.now()>deadline){clearInterval(poll);process.exit(2)}},5)`
  const registry = new TaskRegistry({ projectRoot: root })
  let child: ReturnType<typeof spawn> | undefined
  let ended: Promise<unknown[]> | undefined
  const handle = registry.spawn({ taskId: 'process-group' }, async context => {
    child = spawn(process.execPath, ['-e', leader], { env: scrubbedEnv(), detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    ended = once(child, 'exit')
    context.trackProcess(child)
    await once(child.stdout!, 'data')
    await ended
    return 'leader finished'
  })
  try {
    const result = await handle.awaitResult()
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('PROCESS_STILL_ACTIVE')
    const observation = registry.getStatus('process-group').process!
    expect(observation).toMatchObject({ status: 'exited', scope: 'process-group', processGroup: { status: 'alive' } })
    expect(observation.processGroup?.memberCount).toBeGreaterThan(0)
    const priorObservations = registry.events.list('process-group').filter(event => event.type === 'process_observed').length
    await Bun.sleep(5_200)
    const processEvents = registry.events.list('process-group').filter(event => event.type === 'process_observed')
    expect(processEvents.length).toBeGreaterThan(priorObservations)
    expect(processEvents.at(-1)?.payload.process).toMatchObject({ status: 'exited', processGroup: { status: 'alive' } })
  } finally {
    signalObservedProcessGroup(registry.getStatus('process-group').process, 'SIGKILL')
    await ended
    const deadline = Date.now() + 3000
    while (registry.getStatus('process-group').process?.processGroup?.status === 'alive') {
      if (Date.now() > deadline) throw new Error('Owned process group did not stop during fixture cleanup')
      await Bun.sleep(10)
    }
    await registry.awaitIdle()
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)

linux('restores real process handles as interrupted attempts with current liveness, without replay or fabricated exit results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-process-recovery-'))
  const snapshotFile = join(root, 'tasks.json')
  const original = new OrchestratorSession({ sessionId: 'owned-process', projectRoot: root, settings: { memory: { enabled: false } }, snapshotFile, logFile: null })
  let restored: OrchestratorSession | undefined
  let child: ReturnType<typeof spawn> | undefined
  let childEnded: Promise<unknown[]> | undefined
  let ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  try {
    const handle = original.spawn({ taskId: 'process', type: 'shell', maxRetries: 3 }, async context => {
      child = spawn(process.execPath, ['-e', "process.stdout.write('ready');process.stdin.resume()"], { env: scrubbedEnv(), stdio: ['pipe', 'pipe', 'ignore'] })
      childEnded = once(child, 'exit')
      context.trackProcess(child)
      await once(child.stdout!, 'data')
      ready()
      const [code] = await childEnded
      return `native exit ${code}`
    })
    await started
    await original.flush()
    expect(JSON.parse(await readFile(snapshotFile, 'utf8')).tasks[0].process.identity.pid).toBe(child!.pid)
    let executions = 0
    restored = await OrchestratorSession.restore({ projectRoot: root, snapshotFile, logFile: null, runnerResolver: () => async () => { executions++; return 'duplicate' } })
    const status = restored.registry.getStatus('process')
    expect(status.state).toBe('failed')
    expect(status.error?.code).toBe('INTERRUPTED')
    expect(status.error?.message).not.toContain('Process stopped')
    expect(status.error?.retryable).toBe(false)
    expect(status.process?.status).toBe('alive')
    expect(status.process?.identity?.pid).toBe(child!.pid)
    expect(validateRestoredTaskRecord(status, 'owned-process').valid).toBe(true)
    expect(() => restored!.registry.resume('process')).toThrow('reconcile effects')
    expect(executions).toBe(0)
    expect(restored.registry.getResult('process')?.value).toBeUndefined()
    child!.stdin!.end()
    await childEnded
    await handle.awaitResult()
    const liveExit = original.registry.getStatus('process').process!
    const recoveredExit = restored.registry.getStatus('process').process!
    expect(liveExit.exitCode).toBe(0)
    expect(liveExit.provenance).toBe('child-event')
    expect(recoveredExit.status).toBe('exited')
    expect(recoveredExit.exitCode).toBeUndefined()
    expect(recoveredExit.scope).toBe('leader-only')
    expect(() => restored!.registry.resume('process')).toThrow(TaskRuntimeError)
    expect(executions).toBe(0)
  } finally {
    child?.kill('SIGKILL')
    await childEnded
    await Promise.all([original.shutdown(), restored?.shutdown()])
    await original.registry.awaitIdle()
    await rm(root, { recursive: true, force: true })
  }
})

linux('signals a live reattached process group and keeps interrupted effects unreconciled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-process-stop-'))
  const original = new TaskRegistry({ projectRoot: root, sessionId: 'reattached-process-stop' })
  const restored = new TaskRegistry({ projectRoot: root, sessionId: 'reattached-process-stop' })
  let child: ReturnType<typeof spawn> | undefined
  let childEnded: Promise<unknown[]> | undefined
  let ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  const handle = original.spawn({ taskId: 'worker', type: 'shell' }, async context => {
    child = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], { env: scrubbedEnv(), detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    childEnded = once(child, 'exit')
    context.trackProcess(child)
    await once(child.stdout!, 'data')
    ready()
    await childEnded
    return 'finished'
  })
  try {
    await started
    restored.restoreTasks(original.listTasks())
    expect(restored.getStatus('worker')).toMatchObject({ state: 'failed', error: { code: 'INTERRUPTED' }, process: { status: 'alive', scope: 'process-group' } })
    expect(await restored.requestInterruptedProcessTermination('worker')).toBe('stopped')
    const [, signal] = await childEnded!
    expect(signal).toBe('SIGTERM')
    expect(await restored.requestInterruptedProcessTermination('worker')).toBe('not-active')
    expect(restored.getStatus('worker')).toMatchObject({ state: 'failed', error: { code: 'INTERRUPTED' }, process: { status: 'exited', processGroup: { status: 'exited' } } })
    expect(() => restored.resume('worker')).toThrow('reconcile effects')
    expect((await handle.awaitResult()).status).toBe('done')
  } finally {
    signalObservedProcessGroup(original.getStatus('worker').process, 'SIGKILL')
    await childEnded
    await Promise.all([original.awaitIdle(), restored.awaitIdle()])
    await rm(root, { recursive: true, force: true })
  }
})

linux('refuses to signal a process group when the restored leader identity mismatches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-process-identity-mismatch-'))
  const signalMarker = join(root, 'sigterm-received')
  const registry = new TaskRegistry({ projectRoot: root, sessionId: 'identity-mismatch-stop' })
  const restored = new TaskRegistry({ projectRoot: root, sessionId: 'identity-mismatch-stop' })
  let child: ReturnType<typeof spawn> | undefined
  let childEnded: Promise<unknown[]> | undefined
  let ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  const handle = registry.spawn({ taskId: 'worker', type: 'shell' }, async context => {
    const source = `process.stdout.write('ready');process.on('SIGTERM',()=>require('node:fs').writeFileSync(${JSON.stringify(signalMarker)},'received'));setInterval(()=>{},1000)`
    child = spawn(process.execPath, ['-e', source], { env: scrubbedEnv(), detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    childEnded = once(child, 'exit')
    context.trackProcess(child)
    await once(child.stdout!, 'data')
    ready()
    await childEnded
    return 'finished'
  })
  try {
    await started
    const snapshot = registry.listTasks()
    snapshot[0]!.process!.identity!.startTimeTicks += '1'
    restored.restoreTasks(snapshot)
    expect(restored.getStatus('worker').process?.status).toBe('identity-mismatch')
    expect(restored.getStatus('worker').process?.processGroup?.status).toBe('alive')
    expect(await restored.requestInterruptedProcessTermination('worker')).toBe('not-safe')
    await Bun.sleep(50)
    expect(await readFile(signalMarker, 'utf8').catch(() => '')).toBe('')
    expect(() => process.kill(child!.pid!, 0)).not.toThrow()
  } finally {
    signalObservedProcessGroup(registry.getStatus('worker').process, 'SIGKILL')
    await childEnded
    await Promise.all([registry.awaitIdle(), restored.awaitIdle()])
    await rm(root, { recursive: true, force: true })
  }
})

linux('never auto-retries a tracked process failure even when a runner labels it retryable', async () => {
  const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 1 } })
  let attempts = 0
  const handle = registry.spawn({ maxRetries: 3 }, async context => {
    attempts++
    const child = spawn(process.execPath, ['-e', 'process.exit(2)'], { env: scrubbedEnv(), stdio: 'ignore' })
    const ended = once(child, 'exit')
    context.trackProcess(child)
    await ended
    throw new TaskRuntimeError('RETRYABLE_PROCESS_FAILURE', 'May have changed external state', true)
  })
  const failed = await handle.awaitResult()
  expect(failed.status).toBe('failed')
  expect(failed.error?.retryable).toBe(false)
  await registry.awaitIdle()
  expect(attempts).toBe(1)
  expect(() => handle.resume()).toThrow('reconcile effects')
})

linux('does not re-enqueue legacy queued snapshots carrying an earlier process identity', async () => {
  const registry = new TaskRegistry({ projectRoot: process.cwd(), sessionId: 'queued-recovery' })
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');process.stdin.resume()"], { env: scrubbedEnv(), stdio: ['pipe', 'pipe', 'ignore'] })
  const ready = once(child.stdout!, 'data'), ended = once(child, 'exit')
  const handle = registry.spawn({ taskId: 'owned' }, async context => { context.trackProcess(child); await ended; return 'done' })
  try {
    await ready
    const records = registry.listTasks()
    records[0]!.state = 'queued'
    let attempts = 0
    const restored = new TaskRegistry({ projectRoot: process.cwd(), sessionId: 'queued-recovery' })
    restored.restoreTasks(records, () => async () => { attempts++; return 'replayed' })
    await restored.awaitIdle()
    expect(restored.getStatus('owned').state).toBe('failed')
    expect(restored.getStatus('owned').process?.status).toBe('alive')
    expect(attempts).toBe(0)
    expect(() => restored.resume('owned')).toThrow('reconcile effects')
  } finally { child.stdin!.end(); await ended; await handle.awaitResult() }
})

linux('revalidates an owned process group after its leader and controller process exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-controller-restart-'))
  const snapshotFile = join(root, 'tasks.json'), release = join(root, 'release')
  const descendantReady = join(root, 'descendant-ready')
  const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(descendantReady)},'ready');const deadline=Date.now()+10000;const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})||Date.now()>deadline){clearInterval(timer);process.exit(0)}},10);`
  const worker = `const fs=require('node:fs');const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});const deadline=Date.now()+3000;const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(descendantReady)})){clearInterval(timer);fs.writeFileSync(${JSON.stringify(join(root, 'starts'))},'start');process.exit(0)}if(Date.now()>deadline){clearInterval(timer);process.exit(2)}},5);`
  const source = new URL('../src/orchestration/OrchestratorSession.ts', import.meta.url).pathname
  const controllerCode = `import { spawn } from 'node:child_process'; import { OrchestratorSession } from ${JSON.stringify(source)};
    const session=new OrchestratorSession({sessionId:'controller-restart',projectRoot:${JSON.stringify(root)},snapshotFile:${JSON.stringify(snapshotFile)},logFile:null,settings:{memory:{enabled:false}}});
    session.spawn({taskId:'worker',type:'shell'},async context=>{const worker=spawn(process.execPath,['-e',${JSON.stringify(worker)}],{detached:true,stdio:'ignore'});context.trackProcess(worker);worker.unref();await session.flush();process.stdout.write('persisted');process.exit(0)});`
  const controller = spawn(process.execPath, ['-e', controllerCode], { env: scrubbedEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
  const controllerExit = once(controller, 'exit')
  let diagnostics = ''
  controller.stderr!.on('data', value => { diagnostics += value })
  let restored: OrchestratorSession | undefined
  try {
    const [code] = await controllerExit
    expect(diagnostics).toBe('')
    expect(code).toBe(0)
    const startDeadline = Date.now() + 3000
    while (!await readFile(join(root, 'starts'), 'utf8').catch(() => '')) {
      if (Date.now() > startDeadline) throw new Error('Detached worker did not leave a live group member')
      await Bun.sleep(5)
    }
    restored = await OrchestratorSession.restore({ projectRoot: root, snapshotFile, logFile: null })
    const observation = restored.registry.getStatus('worker')
    expect(observation.state).toBe('failed')
    expect(observation.process).toMatchObject({ status: 'exited', scope: 'process-group', processGroup: { status: 'alive' } })
    expect(observation.process?.processGroup?.memberCount).toBeGreaterThan(0)
    const savedRecord = JSON.parse(await readFile(snapshotFile, 'utf8')).tasks[0]
    expect(validateRestoredTaskRecord(savedRecord, 'controller-restart').valid).toBe(true)
    const legacyRecord = structuredClone(savedRecord)
    delete legacyRecord.process.identity.sessionId
    expect(validateRestoredTaskRecord(legacyRecord, 'controller-restart').valid).toBe(true)
    const legacyRegistry = new TaskRegistry({ projectRoot: root, sessionId: 'controller-restart' })
    legacyRegistry.restoreTasks([legacyRecord])
    expect(await legacyRegistry.requestInterruptedProcessTermination('worker')).toBe('not-safe')
    for (const tamper of [
      (record: any) => { delete record.process.processGroup },
      (record: any) => { record.process.processGroup.id++ },
      (record: any) => { record.process.scope = 'leader-only' },
      (record: any) => { record.process.identity.sessionId = 0 },
    ]) {
      const modified = structuredClone(savedRecord)
      tamper(modified)
      expect(validateRestoredTaskRecord(modified, 'controller-restart').valid).toBe(false)
    }
    expect(observation.process?.identity?.pid).not.toBe(controller.pid)
    expect(restored.registry.getResult('worker')?.value).toBeUndefined()
    expect(() => restored!.registry.resume('worker')).toThrow('reconcile effects')
    const heartbeatDeadline = Date.now() + 7_000
    let processEvents = restored.events.list('worker').filter(event => event.type === 'process_observed')
    while (processEvents.length < 2) {
      if (Date.now() > heartbeatDeadline) throw new Error('Restored task did not emit a periodic process observation')
      await Bun.sleep(20)
      processEvents = restored.events.list('worker').filter(event => event.type === 'process_observed')
    }
    const restoredObservation = processEvents.at(-1)!.payload.process as { status: string; observedAt: string; processGroup?: { status: string } }
    expect(restoredObservation).toMatchObject({ status: 'exited', processGroup: { status: 'alive' } })
    expect(Date.parse(restoredObservation.observedAt)).toBeGreaterThan(Date.parse((processEvents[0]!.payload.process as { observedAt: string }).observedAt))
    await restored.flush()
    const savedObservation = JSON.parse(await readFile(snapshotFile, 'utf8')).tasks[0].process
    expect(Date.parse(savedObservation.observedAt)).toBeGreaterThanOrEqual(Date.parse(restoredObservation.observedAt))
    expect(restored.registry.getStatus('worker').process?.identity?.sessionId).toBeGreaterThan(0)
    expect(await restored.registry.requestInterruptedProcessTermination('worker')).toBe('stopped')
    const exitDeadline = Date.now() + 3000
    while (restored.registry.getStatus('worker').process?.processGroup?.status === 'alive') {
      if (Date.now() > exitDeadline) throw new Error('Detached process group did not exit after SIGTERM')
      await Bun.sleep(5)
    }
    expect(restored.registry.getStatus('worker').process).toMatchObject({ status: 'exited', processGroup: { status: 'exited' } })
    expect(restored.registry.getStatus('worker').process?.exitCode).toBeUndefined()
    expect(restored.registry.getStatus('worker')).toMatchObject({ state: 'failed', error: { code: 'INTERRUPTED' } })
    expect(() => restored!.registry.resume('worker')).toThrow('reconcile effects')
    expect(await readFile(join(root, 'starts'), 'utf8')).toBe('start')
  } finally {
    await writeFile(release, 'release')
    controller.kill('SIGKILL'); await controllerExit
    const observation: ProcessObservation | undefined = restored?.registry.getStatus('worker').process ?? await readFile(snapshotFile, 'utf8').then(value => JSON.parse(value).tasks[0]?.process as ProcessObservation | undefined, () => undefined)
    const cleanupDeadline = Date.now() + 11_000
    while (observation && observeProcess(observation).scope === 'process-group' && observeProcess(observation).processGroup?.status === 'alive') {
      if (Date.now() >= cleanupDeadline) throw new Error('Detached fixture worker did not release its resources')
      await Bun.sleep(10)
    }
    signalObservedProcessGroup(observation, 'SIGKILL')
    await restored?.shutdown()
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
