import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile, chmod, stat, mkdir, open, type FileHandle } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ToolExecutionContext } from '../src/orchestration/types.js'
import { atomicWriteFile } from '../src/tools/shared/pathSafety.js'

let testDir: string
let testSessionId: string
let previousHome: string | undefined

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dsk-filecheckpoint-test-'))
  previousHome = process.env.HOME
  process.env.HOME = testDir
  testSessionId = `test-session-${Date.now()}`
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  await rm(testDir, { recursive: true, force: true })
})

async function getModule() { return import('../src/agent/fileCheckpoint.js') }
function version(content: string, exists = true) {
  return { exists, hash: createHash('sha256').update(content).digest('hex') }
}
function context(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: testSessionId, workspacePath: testDir, projectRoot: testDir, permissionProfile: 'coordinator-integrator', signal }
}
async function checkpointWrite(path: string, before: string | null, after: string) {
  const { createFileCheckpoint, markFileCheckpointWritten } = await getModule()
  if (before !== null) await writeFile(path, before)
  const id = await createFileCheckpoint(testSessionId, path, 'write_file')
  await writeFile(path, after)
  await markFileCheckpointWritten(testSessionId, id, version(after))
  return id
}

describe('fileCheckpoint', () => {
  it('syncs backup and manifest contents before syncing their directory entries', async () => {
    const { createFileCheckpoint } = await getModule()
    const path = join(testDir, 'sync-order.ts')
    await writeFile(path, 'before')

    const probe = await open(testDir, 'r')
    const fileHandlePrototype = Object.getPrototypeOf(probe) as Pick<FileHandle, 'sync'>
    await probe.close()
    const originalSync = fileHandlePrototype.sync
    const events: Array<'file' | 'directory'> = []
    const syncSpy = spyOn(fileHandlePrototype, 'sync').mockImplementation(async function (this: FileHandle) {
      events.push((await this.stat()).isDirectory() ? 'directory' : 'file')
      await originalSync.call(this)
    })

    try {
      await createFileCheckpoint(testSessionId, path, 'write_file')
      expect(events.slice(-4)).toEqual(['file', 'directory', 'file', 'directory'])
    } finally {
      syncSpy.mockRestore()
    }
  })

  it('propagates manifest directory-sync failure after rename and preserves the backup', async () => {
    const { createFileCheckpoint, listFileCheckpoints } = await getModule()
    const path = join(testDir, 'manifest-sync-failure.ts')
    await writeFile(path, 'before')

    const probe = await open(testDir, 'r')
    const fileHandlePrototype = Object.getPrototypeOf(probe) as Pick<FileHandle, 'sync'>
    await probe.close()
    const originalSync = fileHandlePrototype.sync
    let syncedFiles = 0
    const syncSpy = spyOn(fileHandlePrototype, 'sync').mockImplementation(async function (this: FileHandle) {
      if (!(await this.stat()).isDirectory()) {
        syncedFiles += 1
      } else if (syncedFiles >= 2) {
        throw new Error('injected manifest directory sync failure')
      }
      await originalSync.call(this)
    })

    try {
      await expect(createFileCheckpoint(testSessionId, path, 'write_file'))
        .rejects.toThrow('injected manifest directory sync failure')
    } finally {
      syncSpy.mockRestore()
    }

    const entries = await listFileCheckpoints(testSessionId)
    expect(entries).toHaveLength(1)
    expect(await readFile(join(testDir, '.deepseek-code', 'checkpoints', testSessionId, 'files', entries[0]!.backupFile), 'utf8'))
      .toBe('before')
  })

  it('distinguishes an existing empty file from a missing file on rollback', async () => {
    const { createFileCheckpoint, markFileCheckpointWritten, rollbackLast } = await getModule()
    const empty = join(testDir, 'empty.ts')
    const missing = join(testDir, 'new.ts')
    await writeFile(empty, '')
    const emptyId = await createFileCheckpoint(testSessionId, empty, 'write_file')
    await writeFile(empty, 'added')
    await markFileCheckpointWritten(testSessionId, emptyId, version('added'))
    expect(await rollbackLast(testSessionId, context())).toContain('Restored')
    expect(await readFile(empty, 'utf8')).toBe('')

    const missingId = await createFileCheckpoint(testSessionId, missing, 'write_file')
    await writeFile(missing, 'created')
    await markFileCheckpointWritten(testSessionId, missingId, version('created'))
    expect(await rollbackLast(testSessionId, context())).toContain('Restored')
    await expect(readFile(missing, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to overwrite a later human edit and keeps the checkpoint', async () => {
    const { rollbackLast, listFileCheckpoints } = await getModule()
    const path = join(testDir, 'human.ts')
    await checkpointWrite(path, 'before', 'agent')
    await writeFile(path, 'human')
    expect(await rollbackLast(testSessionId, context())).toContain('File changed since it was read')
    expect(await readFile(path, 'utf8')).toBe('human')
    expect(await listFileCheckpoints(testSessionId)).toHaveLength(1)
  })

  it('awaits durable post-write checkpointing before returning from the committed write', async () => {
    const { createFileCheckpoint, listFileCheckpoints, rollbackLast } = await getModule()
    const path = join(testDir, 'awaited-commit.ts')
    await writeFile(path, 'before')
    const id = await createFileCheckpoint(testSessionId, path, 'write_file')
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const callbackStarted = new Promise<void>(resolve => { started = resolve })
    let settled = false
    const pending = atomicWriteFile(path, 'after', {
      ...context(),
      expectedFileVersion: version('before'),
      onFileWriteCommitted: async (committedPath, postVersion) => {
        expect(await readFile(committedPath, 'utf8')).toBe('after')
        started()
        await gate
        await (await getModule()).markFileCheckpointWritten(testSessionId, id, postVersion)
      },
    }).then(() => { settled = true })
    await callbackStarted
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    release()
    await pending
    expect((await listFileCheckpoints(testSessionId))[0]?.postHash).toBe(version('after').hash)
    expect(await rollbackLast(testSessionId, context())).toContain('Restored')
    expect(await readFile(path, 'utf8')).toBe('before')
  })

  it('fails when the checkpoint entry disappeared before its post-write version was saved', async () => {
    const { createFileCheckpoint, discardFileCheckpoint, markFileCheckpointWritten } = await getModule()
    const path = join(testDir, 'missing-checkpoint-entry.ts')
    await writeFile(path, 'before')
    const id = await createFileCheckpoint(testSessionId, path, 'write_file')
    await discardFileCheckpoint(testSessionId, id)

    await expect(markFileCheckpointWritten(testSessionId, id, version('after')))
      .rejects.toThrow('file checkpoint entry was not found')
  })

  it('retains the backup and refuses rollback when post-write checkpoint persistence fails', async () => {
    const { createFileCheckpoint, listFileCheckpoints, rollbackLast } = await getModule()
    const path = join(testDir, 'uncertain-commit.ts')
    await writeFile(path, 'before')
    await createFileCheckpoint(testSessionId, path, 'write_file')
    await expect(atomicWriteFile(path, 'after', {
      ...context(),
      expectedFileVersion: version('before'),
      onFileWriteCommitted: async () => { throw new Error('injected checkpoint persistence failure') },
    })).rejects.toThrow('injected checkpoint persistence failure')
    expect(await readFile(path, 'utf8')).toBe('after')
    expect(await listFileCheckpoints(testSessionId)).toHaveLength(1)
    expect(await rollbackLast(testSessionId, context())).toContain('no recorded post-write version')
    expect(await readFile(path, 'utf8')).toBe('after')
  })

  it('restores multiple edits to the same file in LIFO order', async () => {
    const { createFileCheckpoint, markFileCheckpointWritten, rollbackLast } = await getModule()
    const path = join(testDir, 'stack.ts')
    await checkpointWrite(path, 'v1', 'v2')
    const id = await createFileCheckpoint(testSessionId, path, 'patch_file')
    await writeFile(path, 'v3')
    await markFileCheckpointWritten(testSessionId, id, version('v3'))
    expect(await rollbackLast(testSessionId, context())).toContain('Restored')
    expect(await readFile(path, 'utf8')).toBe('v2')
    expect(await rollbackLast(testSessionId, context())).toContain('Restored')
    expect(await readFile(path, 'utf8')).toBe('v1')
  })

  it('serializes concurrent creates without losing manifest entries', async () => {
    const { createFileCheckpoint, listFileCheckpoints } = await getModule()
    const paths = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const path = join(testDir, `parallel-${i}.ts`)
      await writeFile(path, String(i))
      return path
    }))
    await Promise.all(paths.map(path => createFileCheckpoint(testSessionId, path, 'write_file')))
    expect(await listFileCheckpoints(testSessionId)).toHaveLength(paths.length)
  })

  it('rolls back committed checkpoints newest-first and preserves failed entries', async () => {
    const { rollbackAll, listFileCheckpoints } = await getModule()
    const first = join(testDir, 'first.ts')
    const second = join(testDir, 'second.ts')
    await checkpointWrite(first, 'before-1', 'after-1')
    await checkpointWrite(second, 'before-2', 'after-2')
    const result = await rollbackAll(testSessionId, context())
    expect(result).toContain('Restored 2 file(s)')
    expect(await readFile(first, 'utf8')).toBe('before-1')
    expect(await readFile(second, 'utf8')).toBe('before-2')
    expect(await listFileCheckpoints(testSessionId)).toHaveLength(0)
  })

  it('rejects corrupt manifests and unsafe backup references without mutating files', async () => {
    const { createFileCheckpoint, listFileCheckpoints, rollbackLast } = await getModule()
    const path = join(testDir, 'safe.ts')
    await writeFile(path, 'original')
    await createFileCheckpoint(testSessionId, path, 'write_file')
    const manifestPath = join(testDir, '.deepseek-code', 'checkpoints', testSessionId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.entries[0].backupFile = '../../outside'
    await writeFile(manifestPath, JSON.stringify(manifest))
    await expect(listFileCheckpoints(testSessionId)).rejects.toThrow('malformed')
    await expect(rollbackLast(testSessionId, context())).rejects.toThrow('malformed')
    expect(await readFile(path, 'utf8')).toBe('original')
  })

  it('fails closed when backup bytes are corrupted', async () => {
    const { rollbackLast } = await getModule()
    const path = join(testDir, 'corrupt.ts')
    await checkpointWrite(path, 'before', 'after')
    const entry = (await (await getModule()).listFileCheckpoints(testSessionId))[0]!
    await writeFile(join(testDir, '.deepseek-code', 'checkpoints', testSessionId, 'files', entry.backupFile), 'tampered')
    expect(await rollbackLast(testSessionId, context())).toContain('backup hash mismatch')
    expect(await readFile(path, 'utf8')).toBe('after')
  })

  it('requires permission context and honors cancellation before restore', async () => {
    const { rollbackLast } = await getModule()
    const path = join(testDir, 'cancel.ts')
    await checkpointWrite(path, 'before', 'after')
    expect(await rollbackLast(testSessionId)).toContain('active path permission context')
    const controller = new AbortController()
    controller.abort(new Error('cancel requested'))
    await expect(rollbackLast(testSessionId, context(controller.signal))).rejects.toThrow('cancel requested')
    expect(await readFile(path, 'utf8')).toBe('after')
  })

  it('does not restore outside the active workspace permission scope', async () => {
    const { rollbackLast } = await getModule()
    const path = join(testDir, 'permission.ts')
    await checkpointWrite(path, 'before', 'after')
    const elsewhere = join(testDir, 'elsewhere')
    await mkdir(elsewhere)
    const denied = { ...context(), workspacePath: elsewhere, projectRoot: elsewhere }
    expect(await rollbackLast(testSessionId, denied)).toContain('outside the working directory')
    expect(await readFile(path, 'utf8')).toBe('after')
  })

  it('returns a useful error for a legacy checkpoint without a committed version', async () => {
    const { createFileCheckpoint, rollbackLast } = await getModule()
    const path = join(testDir, 'legacy.ts')
    await writeFile(path, 'before')
    await createFileCheckpoint(testSessionId, path, 'write_file')
    await writeFile(path, 'after')
    expect(await rollbackLast(testSessionId, context())).toContain('no recorded post-write version')
    expect(await readFile(path, 'utf8')).toBe('after')
  })

  it('fails closed for legacy entries with unknown existence metadata', async () => {
    const { createFileCheckpoint, rollbackLast } = await getModule()
    const path = join(testDir, 'legacy-existence.ts')
    await writeFile(path, 'before')
    await createFileCheckpoint(testSessionId, path, 'write_file')
    const manifestPath = join(testDir, '.deepseek-code', 'checkpoints', testSessionId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.entries[0].existed
    delete manifest.entries[0].backupHash
    manifest.entries[0].postExisted = true
    manifest.entries[0].postHash = version('after').hash
    await writeFile(path, 'after')
    await writeFile(manifestPath, JSON.stringify(manifest))
    expect(await rollbackLast(testSessionId, context())).toContain('predates safe existence metadata')
    expect(await readFile(path, 'utf8')).toBe('after')
  })

  it('rejects session IDs that could escape the checkpoint directory', async () => {
    const { listFileCheckpoints } = await getModule()
    await expect(listFileCheckpoints('../outside')).rejects.toThrow('invalid checkpoint session ID')
  })

  it('keeps checkpoint directories and files private, repairing existing directory modes', async () => {
    const { createFileCheckpoint } = await getModule()
    const baseDirectory = join(testDir, '.deepseek-code', 'checkpoints')
    const sessionDirectory = join(baseDirectory, testSessionId)
    const filesDirectory = join(sessionDirectory, 'files')
    await mkdir(filesDirectory, { recursive: true, mode: 0o777 })
    await chmod(baseDirectory, 0o755)
    await chmod(sessionDirectory, 0o755)
    await chmod(filesDirectory, 0o755)

    const target = join(testDir, 'private-checkpoint.ts')
    await writeFile(target, 'sensitive source')
    const id = await createFileCheckpoint(testSessionId, target, 'write_file')

    expect((await stat(baseDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(sessionDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(filesDirectory)).mode & 0o777).toBe(0o700)
    expect((await stat(join(sessionDirectory, 'manifest.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(filesDirectory, `${id}.bak`))).mode & 0o777).toBe(0o600)
  })

  it('deletes only the selected session checkpoint directory', async () => {
    const { createFileCheckpoint, deleteFileCheckpoints, listFileCheckpoints } = await getModule()
    const otherSessionId = `${testSessionId}-other`
    const first = join(testDir, 'first-session.ts')
    const second = join(testDir, 'other-session.ts')
    await writeFile(first, 'first')
    await writeFile(second, 'second')
    await createFileCheckpoint(testSessionId, first, 'write_file')
    await createFileCheckpoint(otherSessionId, second, 'write_file')

    await deleteFileCheckpoints(testSessionId)

    await expect(stat(join(testDir, '.deepseek-code', 'checkpoints', testSessionId))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await listFileCheckpoints(testSessionId)).toHaveLength(0)
    expect(await listFileCheckpoints(otherSessionId)).toHaveLength(1)
  })

  it('preserves existing file mode when writing its checkpoint restore', async () => {
    const { rollbackLast } = await getModule()
    const path = join(testDir, 'mode.ts')
    await checkpointWrite(path, 'before', 'after')
    await chmod(path, 0o640)
    // The later chmod is user-owned state and does not invalidate content preconditions.
    const modeBefore = (await stat(path)).mode & 0o777
    await rollbackLast(testSessionId, context())
    expect((await stat(path)).mode & 0o777).toBe(modeBefore)
  })
})
