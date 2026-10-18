import { expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ReadFolder } from '../src/tools/ReadFolder/ReadFolder.js'
import { validateToolArguments } from '../src/orchestration/schema.js'
import type { ToolExecutionContext } from '../src/orchestration/types.js'

async function withWorkspace(run: (root: string, context: ToolExecutionContext) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-read-folder-'))
  const context: ToolExecutionContext = {
    sessionId: 'read-folder-partial-test',
    workspacePath: root,
    projectRoot: root,
    permissionProfile: 'coordinator-integrator',
  }
  try { await run(root, context) } finally { await rm(root, { recursive: true, force: true }) }
}

it('requires exactly one path selector in the schema', () => {
  expect(validateToolArguments(ReadFolder.parameters, { path: '.' }).valid).toBe(true)
  expect(validateToolArguments(ReadFolder.parameters, { paths: ['.'] }).valid).toBe(true)
  expect(validateToolArguments(ReadFolder.parameters, { path: '.', paths: ['.'] }).valid).toBe(false)
  expect(validateToolArguments(ReadFolder.parameters, { path: ' \t\n' }).valid).toBe(false)
  expect(validateToolArguments(ReadFolder.parameters, { paths: ['.', '\t '] }).valid).toBe(false)
})

it('returns a typed validation error when both path selectors reach the executor', async () => {
  await withWorkspace(async (_root, context) => {
    const result = JSON.parse(await ReadFolder.execute({ path: '.', paths: ['missing'] }, context))
    expect(result).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'validation', code: 'INVALID_ARGUMENTS', message: 'read_folder cannot include both path and paths' },
    })
  })
})

it('preserves readable directories and reports failed paths in a typed partial result', async () => {
  await withWorkspace(async (root, context) => {
    await mkdir(join(root, 'available'))
    await writeFile(join(root, 'available', 'item.txt'), 'content')

    const result = JSON.parse(await ReadFolder.execute({ paths: ['available', 'missing'] }, context))

    expect(result.schemaVersion).toBe(1)
    expect(result.status).toBe('partial')
    expect(result.error.code).toBe('READ_FOLDER_PARTIAL')
    expect(result.partial.output).toContain('### available')
    expect(result.partial.output).toContain('item.txt')
    expect(result.partial.failures[0]).toContain('missing')
  })
})

it('caps mixed multi-directory envelopes and fails when every requested path is unreadable', async () => {
  await withWorkspace(async (root, context) => {
    await mkdir(join(root, 'bulk'))
    await Promise.all(Array.from({ length: 300 }, (_, index) =>
      writeFile(join(root, 'bulk', `${String(index).padStart(3, '0')}-${'x'.repeat(80)}`), '')))

    const mixed = JSON.parse(await ReadFolder.execute({ paths: ['bulk', 'missing'] }, context))
    expect(JSON.stringify(mixed).length).toBeLessThanOrEqual(20_000)
    expect(mixed.status).toBe('partial')
    expect(mixed.partial.failures[0]).toContain('missing')

    const failed = JSON.parse(await ReadFolder.execute({ paths: ['missing-one', 'missing-two'] }, context))
    expect(failed).toMatchObject({ schemaVersion: 1, status: 'error', error: { code: 'READ_FOLDER_FAILED' } })
    expect(failed.error.message).toContain('missing-one')
    expect(failed.error.message).toContain('missing-two')
  })
})

it('rejects directory batches above the declared limit', async () => {
  await withWorkspace(async (_root, context) => {
    const result = await ReadFolder.execute({ paths: Array.from({ length: 33 }, () => '.') }, context)
    expect(result).toContain('between 1 and 32')
  })
})

it('rejects a multibyte directory path above the UTF-8 byte limit before filesystem access', async () => {
  await withWorkspace(async (_root, context) => {
    const path = '界'.repeat(1366)
    const realpathSpy = spyOn(fs, 'realpath')
    const readdirSpy = spyOn(fs, 'readdir')
    const lstatSpy = spyOn(fs, 'lstat')
    const readlinkSpy = spyOn(fs, 'readlink')

    try {
      expect(validateToolArguments(ReadFolder.parameters, { path }).valid).toBe(true)

      const result = await ReadFolder.execute({ path }, context)

      expect(result).toContain('path exceeds 4096 UTF-8 bytes')
      expect(realpathSpy).not.toHaveBeenCalled()
      expect(readdirSpy).not.toHaveBeenCalled()
      expect(lstatSpy).not.toHaveBeenCalled()
      expect(readlinkSpy).not.toHaveBeenCalled()
    } finally {
      realpathSpy.mockRestore()
      readdirSpy.mockRestore()
      lstatSpy.mockRestore()
      readlinkSpy.mockRestore()
    }
  })
})

it('rejects a multibyte directory batch above the aggregate UTF-8 byte limit before filesystem access', async () => {
  await withWorkspace(async (_root, context) => {
    const paths = Array.from({ length: 32 }, (_, index) => `${'界'.repeat(700)}-${index}`)
    const realpathSpy = spyOn(fs, 'realpath')
    const readdirSpy = spyOn(fs, 'readdir')
    const lstatSpy = spyOn(fs, 'lstat')
    const readlinkSpy = spyOn(fs, 'readlink')

    try {
      expect(validateToolArguments(ReadFolder.parameters, { paths }).valid).toBe(true)

      const result = await ReadFolder.execute({ paths }, context)

      expect(result).toContain('combined directory paths exceed 65536 UTF-8 bytes')
      expect(realpathSpy).not.toHaveBeenCalled()
      expect(readdirSpy).not.toHaveBeenCalled()
      expect(lstatSpy).not.toHaveBeenCalled()
      expect(readlinkSpy).not.toHaveBeenCalled()
    } finally {
      realpathSpy.mockRestore()
      readdirSpy.mockRestore()
      lstatSpy.mockRestore()
      readlinkSpy.mockRestore()
    }
  })
})

for (const code of ['EACCES', 'EPERM'] as const) {
  it(`returns a typed error for an unreadable requested root (${code})`, async () => {
    await withWorkspace(async (root, context) => {
      const restrictedPath = join(root, 'restricted')
      await mkdir(restrictedPath)

      const realReaddir = fs.readdir.bind(fs)
      const readdirImplementation = async (directory: Parameters<typeof fs.readdir>[0]) => {
        if (String(directory) === restrictedPath) throw Object.assign(new Error('permission denied'), { code })
        return realReaddir(String(directory), { withFileTypes: true })
      }
      const readdirSpy = spyOn(fs, 'readdir').mockImplementation(readdirImplementation as unknown as typeof fs.readdir)

      try {
        const result = JSON.parse(await ReadFolder.execute({ path: 'restricted' }, context))
        expect(result).toMatchObject({
          schemaVersion: 1,
          status: 'error',
          error: { kind: 'tool', code: 'READ_FOLDER_FAILED' },
        })

        await mkdir(join(root, 'available'))
        await writeFile(join(root, 'available', 'item.txt'), 'content')
        const mixed = JSON.parse(await ReadFolder.execute({ paths: ['available', 'restricted'] }, context))
        expect(mixed).toMatchObject({
          schemaVersion: 1,
          status: 'partial',
          error: { code: 'READ_FOLDER_PARTIAL' },
        })
        expect(mixed.partial.output).toContain('item.txt')
        expect(mixed.partial.failures[0]).toContain('restricted')
      } finally {
        readdirSpy.mockRestore()
      }
    })
  })

  it(`returns a typed partial result for an unreadable recursive child (${code})`, async () => {
    await withWorkspace(async (root, context) => {
      await mkdir(join(root, 'available'))
      await writeFile(join(root, 'available', 'item.txt'), 'content')
      await mkdir(join(root, 'restricted'))
      await writeFile(join(root, 'restricted', 'secret.txt'), 'hidden')

      const restrictedPath = join(root, 'restricted')
      const realReaddir = fs.readdir.bind(fs)
      const readdirImplementation = async (directory: Parameters<typeof fs.readdir>[0]) => {
        if (String(directory) === restrictedPath) {
          throw Object.assign(new Error('permission denied'), { code })
        }
        return realReaddir(String(directory), { withFileTypes: true })
      }
      const readdirSpy = spyOn(fs, 'readdir').mockImplementation(readdirImplementation as unknown as typeof fs.readdir)

      try {
        const raw = await ReadFolder.execute({ path: '.', recursive: true }, context)
        const result = JSON.parse(raw)

        expect(result).toMatchObject({
          schemaVersion: 1,
          status: 'partial',
          error: { code: 'READ_FOLDER_PARTIAL' },
        })
        expect(result.partial.output).toContain('available/item.txt')
        expect(result.partial.unreadableDirectories).toContain('restricted')
        expect(result.partial.omittedUnreadableDirectories).toBe(0)
        expect(result.partial.output).not.toContain('[permission denied]')
        expect(raw.length).toBeLessThanOrEqual(20_000)
      } finally {
        readdirSpy.mockRestore()
      }
    })
  })
}

it('caps recursive permission partial results while preserving both evidence lists', async () => {
  await withWorkspace(async (root, context) => {
    const names = Array.from({ length: 100 }, (_, index) => `unreadable-${String(index).padStart(3, '0')}-${'x'.repeat(210)}`)
    await Promise.all(names.map(name => mkdir(join(root, name))))

    const realReaddir = fs.readdir.bind(fs)
    const readdirImplementation = async (directory: Parameters<typeof fs.readdir>[0]) => {
      if (String(directory) !== root) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return realReaddir(String(directory), { withFileTypes: true })
    }
    const readdirSpy = spyOn(fs, 'readdir').mockImplementation(readdirImplementation as unknown as typeof fs.readdir)

    try {
      const raw = await ReadFolder.execute({ path: '.', recursive: true }, context)
      const result = JSON.parse(raw)

      expect(result.error.code).toBe('READ_FOLDER_PARTIAL')
      expect(raw.length).toBeLessThanOrEqual(20_000)
      expect(result.partial.outputTruncated).toBe(true)
      expect(result.partial.entriesTruncated).toBe(false)
      expect(result.partial.omittedUnreadableDirectories).toBeGreaterThan(0)
      expect(result.partial.unreadableDirectories.length).toBeGreaterThan(0)
      expect(result.partial.unreadableDirectories.some((directory: string) => result.partial.output.includes(`${directory}/`))).toBe(true)
    } finally {
      readdirSpy.mockRestore()
    }
  })
})

it('reports entry-limit incompleteness separately from response truncation when a restricted child is visited first', async () => {
  await withWorkspace(async (root, context) => {
    const restrictedPath = join(root, '000-restricted')
    await mkdir(restrictedPath)
    await Promise.all(Array.from({ length: 1_001 }, (_, index) =>
      writeFile(join(root, `file-${String(index).padStart(4, '0')}`), '')))

    const realReaddir = fs.readdir.bind(fs)
    const readdirImplementation = async (directory: Parameters<typeof fs.readdir>[0]) => {
      const resolvedDirectory = String(directory)
      if (resolvedDirectory === restrictedPath) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      const entries = await realReaddir(resolvedDirectory, { withFileTypes: true })
      return resolvedDirectory === root ? entries.sort((left, right) => left.name.localeCompare(right.name)) : entries
    }
    const readdirSpy = spyOn(fs, 'readdir').mockImplementation(readdirImplementation as unknown as typeof fs.readdir)

    try {
      const raw = await ReadFolder.execute({ path: '.', recursive: true }, context)
      const result = JSON.parse(raw)

      expect(result.error.code).toBe('READ_FOLDER_PARTIAL')
      expect(raw.length).toBeLessThanOrEqual(20_000)
      expect(result.partial.unreadableDirectories).toEqual(['000-restricted'])
      expect(result.partial.entriesTruncated).toBe(true)
      expect(result.partial.outputTruncated).toBe(false)
      expect(result.partial.output).toContain('[Truncated: exceeded 1000 entries. Use a more specific path.]')
      expect(result.partial.output.match(/file-\d{4}/g)).toHaveLength(999)
    } finally {
      readdirSpy.mockRestore()
    }
  })
})

it('returns a typed error when the requested top-level directory is unreadable', async () => {
  await withWorkspace(async (root, context) => {
    const realReaddir = fs.readdir.bind(fs)
    const readdirImplementation = async (directory: Parameters<typeof fs.readdir>[0]) => {
      if (String(directory) === root) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return realReaddir(String(directory), { withFileTypes: true })
    }
    const readdirSpy = spyOn(fs, 'readdir').mockImplementation(readdirImplementation as unknown as typeof fs.readdir)

    try {
      const result = JSON.parse(await ReadFolder.execute({ path: '.', recursive: true }, context))
      expect(result).toMatchObject({
        schemaVersion: 1,
        status: 'error',
        error: { kind: 'tool', code: 'READ_FOLDER_FAILED' },
      })
    } finally {
      readdirSpy.mockRestore()
    }
  })
})
