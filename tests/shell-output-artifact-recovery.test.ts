import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { mkdtemp, mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, spyOn } from 'bun:test'
import { readShellOutput, readShellOutputContent, saveShellOutput, shellOutputDirectory, shellOutputEmergencyDirectory, withShellOutputArtifactLease } from '../src/tools/Shell/outputArtifact.js'
import { shellSupervisorCanReattach, waitForShellSupervisor, type ShellSupervisorRequest } from '../src/tools/Shell/supervisor.js'

it('bounds memory-only recovery across sessions when every disk store fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-recovery-'))
  const primaryFile = join(root, 'primary-file')
  const recoveryFile = join(root, 'recovery-file')
  const emergencyFile = join(root, 'emergency-file')
  await Promise.all([primaryFile, recoveryFile, emergencyFile].map(path => writeFile(path, 'not a directory')))

  try {
    const saved = []
    for (let index = 0; index < 11; index++) {
      const sessionId = `memory-quota-${process.pid}-${Date.now()}-${index}`
      const artifact = await saveShellOutput(sessionId, `session-${index}`, 9, primaryFile, undefined, recoveryFile, emergencyFile)
      expect(artifact.metadata.storage).toBe('memory')
      saved.push({ sessionId, id: artifact.id })
    }

    const oldest = saved[0]!
    const newest = saved.at(-1)!
    expect(await readShellOutput(oldest.sessionId, oldest.id, 0, 512, primaryFile, recoveryFile, emergencyFile)).toContain('missing or expired')
    expect(await readShellOutput(newest.sessionId, newest.id, 0, 512, primaryFile, recoveryFile, emergencyFile)).toContain('session-10')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it.skipIf(process.platform !== 'linux')('preserves outputs referenced by durable supervisor states without exceeding disk quotas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-pinned-'))
  const recoveryRoot = join(root, 'recovery')
  const emergencyRoot = join(root, 'emergency')
  const sessionId = `pinned-${process.pid}-${Date.now()}`
  const fingerprint = 'a'.repeat(64)
  const identity = {
    platform: 'linux' as const, pid: process.pid, bootId: 'test-boot', pidNamespace: 'pid:[1]',
    startTimeTicks: '1', sessionId: process.pid, processGroupId: process.pid,
  }
  const primaryDirectory = shellOutputDirectory(sessionId, root)
  const recoveryDirectory = join(recoveryRoot, createHash('sha256').update(sessionId).digest('hex'))
  const primaryArtifacts: Awaited<ReturnType<typeof saveShellOutput>>[] = []

  async function persistReference(outputId: string, taskId: string, reserved = false): Promise<ShellSupervisorRequest> {
    const supervisorsDirectory = join(primaryDirectory, 'supervisors')
    await mkdir(supervisorsDirectory, { recursive: true, mode: 0o700 })
    await writeFile(join(supervisorsDirectory, `${createHash('sha256').update(taskId).digest('hex')}.json`), JSON.stringify({
      schema: 'shell_supervisor_v1', sessionId, taskId, fingerprint, state: reserved ? 'running' : 'done', identity,
      startedAt: new Date().toISOString(), processGroupSettled: reserved ? 'unknown' : 'settled',
      ...(reserved ? { reservedOutputId: outputId } : { outputId }),
    }), { mode: 0o600 })
    return { sessionId, taskId, storageRoot: root, recoveryRoot, fingerprint, executable: '/bin/sh', args: [], cwd: process.cwd(), timeoutMs: 1_000 }
  }

  try {
    for (let index = 0; index < 10; index++) {
      primaryArtifacts.push(await saveShellOutput(sessionId, `artifact-${index}`, 10, root, undefined, recoveryRoot, emergencyRoot))
    }
    const primaryPaths = primaryArtifacts.map(artifact => join(primaryDirectory, artifact.id))
    const recoveryPaths = primaryArtifacts.map(artifact => join(recoveryDirectory, artifact.id))
    await Promise.all([...primaryPaths, ...recoveryPaths].map(async (path, index) => {
      const time = new Date(1_000_000 + index * 1_000)
      await utimes(path, time, time)
    }))

    const firstRequest = await persistReference(primaryArtifacts[0]!.id, 'pinned-first-task', true)
    expect(shellSupervisorCanReattach(firstRequest, {
      identity, status: 'alive', observedAt: new Date().toISOString(), provenance: 'kernel',
      scope: 'process-group', progress: 'not-measured',
    })).toBe(true)

    const eleventh = await saveShellOutput(sessionId, 'artifact-10', 10, root, undefined, recoveryRoot, emergencyRoot)
    primaryArtifacts.push(eleventh)
    expect(await readShellOutput(sessionId, primaryArtifacts[0]!.id, 0, 512, root, recoveryRoot, emergencyRoot)).toContain('artifact-0')
    expect(await readShellOutput(sessionId, primaryArtifacts[1]!.id, 0, 512, root, recoveryRoot, emergencyRoot)).toContain('missing or expired')

    const referenced = await readdir(primaryDirectory)
    for (const id of referenced.filter(value => /^[0-9a-f-]{36}$/i.test(value))) {
      await persistReference(id, `pinned-${id}`)
    }
    const twelfth = await saveShellOutput(sessionId, 'artifact-11', 10, root, undefined, recoveryRoot, emergencyRoot)
    expect(twelfth.metadata.storage).toBe('emergency-disk')

    for (const directory of [primaryDirectory, recoveryDirectory]) {
      const ids = (await readdir(directory)).filter(value => /^[0-9a-f-]{36}$/i.test(value))
      expect(ids).toHaveLength(10)
      const bytes = (await Promise.all(ids.map(id => stat(join(directory, id))))).reduce((sum, info) => sum + info.size, 0)
      expect(bytes).toBeLessThanOrEqual(20 * 1024 * 1024)
    }
    expect(await readShellOutput(sessionId, twelfth.id, 0, 512, root, recoveryRoot, emergencyRoot)).toContain('artifact-11')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('serializes cross-process supervisor output reservations with quota pruning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-reservation-'))
  const recoveryRoot = join(root, 'recovery')
  const emergencyRoot = join(root, 'emergency')
  const sessionId = `reservation-${process.pid}-${Date.now()}`
  const fingerprint = 'c'.repeat(64)
  const identity = {
    platform: 'linux' as const, pid: process.pid, bootId: 'test-boot', pidNamespace: 'pid:[1]',
    startTimeTicks: '1', sessionId: process.pid, processGroupId: process.pid,
  }
  const primaryDirectory = shellOutputDirectory(sessionId, root)
  const recoveryDirectory = join(recoveryRoot, createHash('sha256').update(sessionId).digest('hex'))
  const artifacts: Awaited<ReturnType<typeof saveShellOutput>>[] = []
  const reservedId = randomUUID()
  const taskId = 'reserved-task'
  const reservationPath = join(primaryDirectory, 'supervisors', `${createHash('sha256').update(taskId).digest('hex')}.json`)
  const leaseBlockedPath = join(root, 'child-lease-blocked')
  const resultPath = join(root, 'child-result')
  const moduleUrl = new URL('../src/tools/Shell/outputArtifact.ts', import.meta.url).href
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined

  try {
    await expect(saveShellOutput(sessionId, 'invalid ID', 10, root, undefined, recoveryRoot, emergencyRoot, '../invalid'))
      .rejects.toThrow('Invalid shell output ID')
    for (let index = 0; index < 10; index++) {
      artifacts.push(await saveShellOutput(sessionId, `artifact-${index}`, 10, root, undefined, recoveryRoot, emergencyRoot))
    }

    const supervisorsDirectory = join(primaryDirectory, 'supervisors')
    await mkdir(supervisorsDirectory, { recursive: true, mode: 0o700 })
    for (let index = 0; index < 9; index++) {
      await writeFile(join(supervisorsDirectory, `${createHash('sha256').update(`pinned-${index}`).digest('hex')}.json`), JSON.stringify({
        schema: 'shell_supervisor_v1', sessionId, taskId: `pinned-${index}`, fingerprint, state: 'done', identity,
        startedAt: new Date().toISOString(), processGroupSettled: 'settled', outputId: artifacts[index]!.id,
      }), { mode: 0o600 })
    }

    const primaryPaths = artifacts.map(artifact => join(primaryDirectory, artifact.id))
    const recoveryPaths = artifacts.map(artifact => join(recoveryDirectory, artifact.id))
    await Promise.all([...primaryPaths, ...recoveryPaths].map(async (path, index) => {
      const time = new Date(1_000_000 + index * 1_000)
      await utimes(path, time, time)
    }))

    const pruneId = randomUUID()
    const prunePath = join(primaryDirectory, pruneId)
    const originalWriteFile = fs.writeFile
    let releasePrune = () => {}
    let signalPruneWrite = () => {}
    const pruneGate = new Promise<void>(resolve => { releasePrune = resolve })
    const pruneWriteStarted = new Promise<void>(resolve => { signalPruneWrite = resolve })
    const writeSpy = spyOn(fs, 'writeFile').mockImplementation(async (path: any, data: any, options?: any) => {
      const result = await originalWriteFile(path, data, options)
      if (String(path) === prunePath) {
        signalPruneWrite()
        await pruneGate
      }
      return result
    })
    const pruningSave = saveShellOutput(sessionId, 'quota pruner', 12, root, undefined, recoveryRoot, emergencyRoot, pruneId)
    try {
      await pruneWriteStarted
      const childConfig = { sessionId, storageRoot: root, recoveryRoot, emergencyRoot, reservationPath, leaseBlockedPath, resultPath, reservedId, taskId, fingerprint }
      const childSource = `
        import { writeFileSync } from 'node:fs';
        import { writeFile } from 'node:fs/promises';
        const { sessionId, storageRoot, recoveryRoot, emergencyRoot, reservationPath, leaseBlockedPath, resultPath, reservedId, taskId, fingerprint } = ${JSON.stringify(childConfig)};
        const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
        let reportedLeaseContention = false;
        globalThis.setTimeout = (callback, milliseconds, ...args) => {
          if (!reportedLeaseContention && milliseconds === 25) {
            reportedLeaseContention = true;
            writeFileSync(leaseBlockedPath, 'blocked');
          }
          return originalSetTimeout(callback, milliseconds, ...args);
        };
        const { withShellOutputArtifactLease } = await import(${JSON.stringify(moduleUrl)});
        await withShellOutputArtifactLease(sessionId, storageRoot, async save => {
          await writeFile(reservationPath, JSON.stringify({ schema: 'shell_supervisor_v1', sessionId, taskId, fingerprint, state: 'running', reservedOutputId: reservedId }));
          const saved = await save('reserved output', 15, undefined, recoveryRoot, emergencyRoot, reservedId);
          await writeFile(resultPath, JSON.stringify(saved));
        });
      `
      child = Bun.spawn([process.execPath, '-e', childSource], {
        stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      })

      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        if (await fs.stat(leaseBlockedPath).then(() => true, () => false)) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(await fs.stat(leaseBlockedPath).then(() => true, () => false)).toBe(true)
      expect(await fs.stat(reservationPath).then(() => true, () => false)).toBe(false)
      expect(await fs.stat(join(primaryDirectory, reservedId)).then(() => true, () => false)).toBe(false)

      releasePrune()
      await pruningSave
      const [exitCode, childOutput, childError] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(exitCode, `${childError}\n${childOutput}`).toBe(0)
      expect(JSON.parse(await fs.readFile(reservationPath, 'utf8'))).toMatchObject({ state: 'running', reservedOutputId: reservedId })
      expect(JSON.parse(await fs.readFile(resultPath, 'utf8'))).toMatchObject({ id: reservedId, metadata: { storage: 'disk' } })
      await expect(readShellOutputContent(sessionId, reservedId, root, recoveryRoot, emergencyRoot)).resolves.toMatchObject({ content: 'reserved output' })
    } finally {
      releasePrune()
      writeSpy.mockRestore()
      await pruningSave.catch(() => {})
      if (child && child.exitCode === null) child.kill()
      await child?.exited
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it.skipIf(process.platform !== 'linux')('persists a restored memory artifact reference before the next quota prune', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-restored-'))
  const recoveryRoot = join(root, 'recovery')
  const emergencyRoot = join(root, 'emergency')
  const sessionId = `restored-${process.pid}-${Date.now()}`
  const fingerprint = 'd'.repeat(64)
  const identity = {
    platform: 'linux' as const, pid: process.pid, bootId: 'stale-test-boot', pidNamespace: 'pid:[stale]',
    startTimeTicks: '1', sessionId: process.pid, processGroupId: process.pid,
  }
  const primaryDirectory = shellOutputDirectory(sessionId, root)
  const recoveryDirectory = join(recoveryRoot, createHash('sha256').update(sessionId).digest('hex'))
  const artifacts: Array<Awaited<ReturnType<typeof saveShellOutput>>> = []
  const supervisorsDirectory = join(primaryDirectory, 'supervisors')
  const taskId = 'restore-memory-fallback'
  const statePath = join(supervisorsDirectory, `${createHash('sha256').update(taskId).digest('hex')}.json`)
  const missingId = randomUUID()
  const request: ShellSupervisorRequest = {
    sessionId, taskId, storageRoot: root, recoveryRoot, fingerprint,
    executable: '/bin/sh', args: [], cwd: process.cwd(), timeoutMs: 1_000,
  }

  try {
    for (let index = 0; index < 10; index++) {
      artifacts.push(await saveShellOutput(sessionId, `artifact-${index}`, 10, root, undefined, recoveryRoot, emergencyRoot))
    }
    await mkdir(supervisorsDirectory, { recursive: true, mode: 0o700 })
    for (let index = 0; index < 8; index++) {
      const pinnedTaskId = `restored-pin-${index}`
      await writeFile(join(supervisorsDirectory, `${createHash('sha256').update(pinnedTaskId).digest('hex')}.json`), JSON.stringify({
        schema: 'shell_supervisor_v1', sessionId, taskId: pinnedTaskId, fingerprint, state: 'done', identity,
        startedAt: new Date().toISOString(), processGroupSettled: 'settled', outputId: artifacts[index]!.id,
      }), { mode: 0o600 })
    }
    await Promise.all(artifacts.flatMap(({ id }, index) => [
      join(primaryDirectory, id), join(recoveryDirectory, id),
    ].map(async path => {
      const time = new Date(1_000_000 + index * 1_000)
      await utimes(path, time, time)
    })))
    const memoryContent = 'restored supervisor output'
    await writeFile(statePath, JSON.stringify({
      schema: 'shell_supervisor_v1', sessionId, taskId, fingerprint, state: 'done', identity,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), processGroupSettled: 'settled',
      outputId: missingId,
      outputMetadata: { totalChars: memoryContent.length, storedChars: memoryContent.length, truncated: false, storage: 'memory' },
      totalChars: memoryContent.length, memoryContent,
    }), { mode: 0o600 })

    const restored = await waitForShellSupervisor(request)
    expect(restored.content).toBe(memoryContent)
    expect(restored.outputId).not.toBe(missingId)
    const persisted = JSON.parse(await fs.readFile(statePath, 'utf8'))
    expect(persisted).toMatchObject({
      state: 'done', outputId: restored.outputId,
      outputMetadata: { storage: 'disk' },
    })
    expect(persisted.reservedOutputId).toBeUndefined()

    await saveShellOutput(sessionId, 'next quota prune', 16, root, undefined, recoveryRoot, emergencyRoot)
    await expect(readShellOutputContent(sessionId, restored.outputId!, root, recoveryRoot, emergencyRoot))
      .resolves.toMatchObject({ content: memoryContent })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it.skipIf(process.platform !== 'linux')('does not evict memory artifacts pinned by durable supervisor states', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-memory-pinned-'))
  const storageRoot = join(root, 'primary')
  const recoveryRoot = join(root, 'recovery')
  const emergencyRoot = join(root, 'emergency')
  const sessionPrefix = `memory-pinned-${process.pid}-${Date.now()}`
  const fingerprint = 'b'.repeat(64)
  const identity = {
    platform: 'linux' as const, pid: process.pid, bootId: 'test-boot', pidNamespace: 'pid:[1]',
    startTimeTicks: '1', sessionId: process.pid, processGroupId: process.pid,
  }
  const originalWriteFile = fs.writeFile
  const writeSpy = spyOn(fs, 'writeFile').mockImplementation(async (path: any, data: any, options?: any) => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(path).split('/').at(-1) ?? '')) {
      throw Object.assign(new Error('injected disk write failure'), { code: 'EIO' })
    }
    return originalWriteFile(path, data, options)
  })

  try {
    const saved: Array<{ sessionId: string; id: string; taskId: string; content: string }> = []
    for (let index = 0; index < 10; index++) {
      const sessionId = `${sessionPrefix}-${index}`
      const content = `memory-${index}`
      const artifact = await saveShellOutput(sessionId, content, content.length, storageRoot, undefined, recoveryRoot, emergencyRoot)
      expect(artifact.metadata.storage).toBe('memory')
      const taskId = `memory-pinned-task-${index}`
      const supervisorDirectory = join(shellOutputDirectory(sessionId, storageRoot), 'supervisors')
      await mkdir(supervisorDirectory, { recursive: true, mode: 0o700 })
      await originalWriteFile(join(supervisorDirectory, `${createHash('sha256').update(taskId).digest('hex')}.json`), JSON.stringify({
        schema: 'shell_supervisor_v1', sessionId, taskId, fingerprint, state: 'done', identity,
        startedAt: new Date().toISOString(), processGroupSettled: 'settled', outputId: artifact.id,
        totalChars: content.length, outputMetadata: { totalChars: content.length, storedChars: content.length, truncated: false, storage: 'memory' },
        memoryContent: content,
      }), { mode: 0o600 })
      saved.push({ sessionId, id: artifact.id, taskId, content })
    }

    await expect(saveShellOutput(`${sessionPrefix}-overflow`, 'memory-over-quota', 18, storageRoot, undefined, recoveryRoot, emergencyRoot))
      .rejects.toMatchObject({ code: 'EIO' })
    for (const artifact of saved) {
      await expect(readShellOutputContent(artifact.sessionId, artifact.id, storageRoot, recoveryRoot, emergencyRoot)).resolves.toMatchObject({ content: artifact.content })
    }
  } finally {
    writeSpy.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
