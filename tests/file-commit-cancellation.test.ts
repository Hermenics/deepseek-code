import { expect, it, spyOn } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdirSync, type PathLike } from 'node:fs'
import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicDeleteFile, atomicWriteFile } from '../src/tools/shared/pathSafety.js'
import { EditFile } from '../src/tools/EditFile/EditFile.js'
import { PatchFile } from '../src/tools/PatchFile/PatchFile.js'
import { WriteFile } from '../src/tools/WriteFile/WriteFile.js'

for (const operation of ['write', 'delete'] as const) {
  it(`checks cancellation after the final content-version await before ${operation} commit`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-file-cancel-'))
    const file = join(root, 'source.txt')
    const original = 'Original file contents\n'
    const digest = createHash('sha256').update(original).digest('hex')
    const controller = new AbortController()
    let comparisons = 0
    let staged = false
    let committed = 0
    const context = {
      sessionId: 'commit-cancellation', projectRoot: root, workspacePath: root,
      permissionProfile: 'coordinator-integrator' as const, signal: controller.signal,
      expectedFileVersion: {
        exists: true,
        get hash() {
          // Deliver cancellation at the completed hash comparison, after write staging, without timing or module mocks.
          comparisons++
          staged = readdirSync(root).some(name => name.endsWith('.tmp'))
          controller.abort(new Error('Cancelled at the final version boundary'))
          return digest
        },
      },
      onFileWriteCommitted() { committed++ },
    }
    try {
      await writeFile(file, original)
      const pending = operation === 'write' ? atomicWriteFile(file, 'Replacement contents\n', context) : atomicDeleteFile(file, context)
      await expect(pending).rejects.toThrow('Cancelled at the final version boundary')
      expect(comparisons).toBe(1)
      expect(staged).toBe(operation === 'write')
      expect(await readFile(file, 'utf8')).toBe(original)
      expect(committed).toBe(0)
      expect(await readdir(root)).toEqual(['source.txt'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

it('records a delegated file effect only after the atomic commit and preserves unknown on receipt failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-delegated-file-effect-'))
  const file = join(root, 'source.txt')
  const content = 'Delegated write contents\n'
  const outcomes: Array<{ effectId: string; state: string; evidence: string }> = []
  const order: string[] = []
  const context = {
    sessionId: 'delegated-file-effect', taskId: 'task-1', projectRoot: root, workspacePath: root,
    permissionProfile: 'coordinator-integrator' as const,
    effectId: 'effect-1', expectedFileVersion: { exists: false, hash: createHash('sha256').update('').digest('hex') },
    onFileWriteCommitted() { order.push('checkpoint') },
    async markEffectOutcome(effectId: string, state: 'no-effect' | 'effect-observed', evidence: string) {
      order.push('outcome')
      outcomes.push({ effectId, state, evidence })
    },
  }
  try {
    await WriteFile.execute({ path: file, content }, context)
    const pathHash = createHash('sha256').update(file).digest('hex')
    const contentHash = createHash('sha256').update(content).digest('hex')
    expect(order).toEqual(['checkpoint', 'outcome'])
    expect(outcomes).toEqual([{ effectId: 'effect-1', state: 'effect-observed', evidence: `file-write:${pathHash}:${contentHash}` }])
    expect(await readFile(file, 'utf8')).toBe(content)

    await expect(atomicWriteFile(file, 'stale write\n', {
      ...context, effectId: 'effect-2', expectedFileVersion: { exists: true, hash: '0'.repeat(64) },
    })).rejects.toThrow('File changed since it was read')
    expect(outcomes).toHaveLength(1)

    const primaryOutcomes: string[] = []
    const primaryFile = join(root, 'primary.txt')
    await WriteFile.execute({ path: primaryFile, content }, {
      sessionId: 'primary-file-effect', projectRoot: root, workspacePath: root,
      permissionProfile: 'coordinator-integrator', effectId: 'primary-call',
      markEffectOutcome: async () => { primaryOutcomes.push('unexpected') },
    })
    expect(primaryOutcomes).toEqual([])

    const receiptFailureFile = join(root, 'receipt-failure.txt')
    await expect(WriteFile.execute({ path: receiptFailureFile, content }, {
      ...context,
      taskId: 'task-2', effectId: 'effect-3',
      expectedFileVersion: { exists: false, hash: createHash('sha256').update('').digest('hex') },
      async markEffectOutcome() { throw new Error('task snapshot unavailable') },
    })).rejects.toMatchObject({
      code: 'FILE_EFFECT_RECEIPT_PERSIST_FAILED',
      partial: { state: 'effect-observed', receipt: 'not-persisted' },
    })
    expect(await readFile(receiptFailureFile, 'utf8')).toBe(content)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('does not replace a file created by an external writer after an absence check', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-file-create-race-'))
  const file = join(root, 'new.txt')
  const external = 'Created by an external writer\n'
  const realLink = fs.link.bind(fs)
  const linkSpy = spyOn(fs, 'link').mockImplementation(async (source: PathLike, target: PathLike) => {
    if (target === file) await writeFile(file, external)
    return realLink(source, target)
  })
  try {
    await expect(WriteFile.execute({ path: file, content: 'Agent content\n' }, {
      sessionId: 'create-race', projectRoot: root, workspacePath: root,
      permissionProfile: 'coordinator-integrator',
    })).rejects.toThrow('File changed since it was read')
    expect(linkSpy).toHaveBeenCalledTimes(1)
    expect(await readFile(file, 'utf8')).toBe(external)
    expect((await readdir(root)).sort()).toEqual(['new.txt'])
  } finally {
    linkSpy.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

for (const operation of ['write', 'delete'] as const) {
  it(`preserves an external update that races the final version revalidation before ${operation}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-file-external-version-race-'))
    const file = join(root, 'source.txt')
    const preserved = join(root, 'previous.txt')
    const original = 'Original contents\n'
    const external = 'External writer changed the file\n'
    const realStat = fs.stat.bind(fs)
    let targetStatCalls = 0
    const statSpy = spyOn(fs, 'stat').mockImplementation((async (path: PathLike, ...args: any[]) => {
      if (String(path) === file && ++targetStatCalls === (operation === 'write' ? 2 : 1)) {
        if (operation === 'write') await fs.rename(file, preserved)
        await fs.writeFile(file, external, 'utf8')
      }
      return (realStat as any)(path, ...args)
    }) as any)
    try {
      await writeFile(file, original)
      const context = {
        sessionId: `external-${operation}-version-race`, projectRoot: root, workspacePath: root,
        permissionProfile: 'coordinator-integrator' as const,
        expectedFileVersion: { exists: true, hash: createHash('sha256').update(original).digest('hex') },
      }
      const commit = operation === 'write'
        ? atomicWriteFile(file, 'Agent replacement\n', context)
        : atomicDeleteFile(file, context)
      await expect(commit).rejects.toThrow('File changed since it was read')
      expect(targetStatCalls).toBe(operation === 'write' ? 2 : 1)
      expect(await readFile(file, 'utf8')).toBe(external)
      if (operation === 'write') expect(await readFile(preserved, 'utf8')).toBe(original)
      expect((await readdir(root)).sort()).toEqual(operation === 'write' ? ['previous.txt', 'source.txt'] : ['source.txt'])
    } finally {
      statSpy.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })
}

it('creates a previously missing file through the exclusive publish path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-file-create-'))
  const file = join(root, 'new.txt')
  try {
    await WriteFile.execute({ path: file, content: 'Agent content\n' }, {
      sessionId: 'create-file', projectRoot: root, workspacePath: root,
      permissionProfile: 'coordinator-integrator',
    })
    expect(await readFile(file, 'utf8')).toBe('Agent content\n')
    expect(await readdir(root)).toEqual(['new.txt'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const operation of ['write', 'delete'] as const) {
  it(`awaits asynchronous commit callbacks and surfaces their failure after ${operation} commits`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-file-commit-callback-'))
    const file = join(root, 'existing.txt')
    const original = 'Initial contents\n'
    const replacement = 'Committed contents\n'
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const callbackStarted = new Promise<void>(resolve => { started = resolve })
    let settled = false
    try {
      await writeFile(file, original)
      const context = {
        sessionId: 'commit-callback', projectRoot: root, workspacePath: root,
        permissionProfile: 'coordinator-integrator' as const,
        expectedFileVersion: { exists: true, hash: createHash('sha256').update(original).digest('hex') },
        async onFileWriteCommitted(committedPath: string) {
          if (operation === 'write') expect(await readFile(committedPath, 'utf8')).toBe(replacement)
          else await expect(readFile(committedPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
          started()
          await gate
          throw new Error('injected checkpoint persistence failure')
        },
      }
      const pending = operation === 'write'
        ? atomicWriteFile(file, replacement, context)
        : atomicDeleteFile(file, context)
      void pending.finally(() => { settled = true }).catch(() => {})
      await callbackStarted
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(settled).toBe(false)
      release()
      await expect(pending).rejects.toThrow('injected checkpoint persistence failure')
      expect(settled).toBe(true)
      if (operation === 'write') expect(await readFile(file, 'utf8')).toBe(replacement)
      else await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await readdir(root)).sort()).toEqual(operation === 'write' ? ['existing.txt'] : [])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

it('refuses an existing-file write when the file changes after WriteFile reads it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-file-rewrite-race-'))
  const file = join(root, 'existing.txt')
  const original = 'Initial contents\n'
  const external = 'External update\n'
  const realWriteFile = fs.writeFile.bind(fs)
  const writeSpy = spyOn(fs, 'writeFile').mockImplementation(async (path: any, data: any, options?: any) => {
    if (String(path).endsWith('.tmp')) await realWriteFile(file, external, 'utf8')
    return realWriteFile(path, data, options)
  })
  try {
    await writeFile(file, original)
    await expect(WriteFile.execute({ path: file, content: 'Agent replacement\n' }, {
      sessionId: 'rewrite-race', projectRoot: root, workspacePath: root,
      permissionProfile: 'coordinator-integrator',
    })).rejects.toThrow('File changed since it was read')
    expect(writeSpy).toHaveBeenCalled()
    expect(await readFile(file, 'utf8')).toBe(external)
    expect((await readdir(root)).sort()).toEqual(['existing.txt'])
  } finally {
    writeSpy.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

for (const { name, tool, args } of [
  { name: 'edit_file', tool: EditFile, args: (file: string) => ({ path: file, edits: [{ line: 1, old: ['original'], new: ['agent'] }] }) },
  { name: 'patch_file', tool: PatchFile, args: (file: string) => ({ path: file, old_content: 'original', new_content: 'agent' }) },
]) {
  it(`${name} preserves a competing write after reading the target`, async () => {
    const root = await mkdtemp(join(tmpdir(), `deepseek-${name}-race-`))
    const file = join(root, 'source.txt')
    const external = 'external update\n'
    const realWriteFile = fs.writeFile.bind(fs)
    const writeSpy = spyOn(fs, 'writeFile').mockImplementation(async (path: any, data: any, options?: any) => {
      if (String(path).endsWith('.tmp')) await realWriteFile(file, external, 'utf8')
      return realWriteFile(path, data, options)
    })
    try {
      await writeFile(file, 'original\n')
      await expect(tool.execute(args(file), {
        sessionId: `${name}-race`, projectRoot: root, workspacePath: root,
        permissionProfile: 'coordinator-integrator',
      })).rejects.toThrow('File changed since it was read')
      expect(await readFile(file, 'utf8')).toBe(external)
    } finally {
      writeSpy.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })
}

it('refuses an atomic write without an expected file version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-file-unversioned-'))
  const file = join(root, 'source.txt')
  try {
    await expect(atomicWriteFile(file, 'unversioned\n', {
      sessionId: 'unversioned-write', projectRoot: root, workspacePath: root,
      permissionProfile: 'coordinator-integrator',
    })).rejects.toThrow('Write requires an expected file version')
    expect(await readdir(root)).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
