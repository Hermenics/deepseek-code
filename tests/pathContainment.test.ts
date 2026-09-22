import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { escapesRoot } from '../src/utils/pathContainment.js'
import { resolveSafePath } from '../src/tools/shared/pathSafety.js'

describe('escapesRoot', () => {
  it('treats only a leading `..` segment or an absolute path as outside', () => {
    expect(escapesRoot('..')).toBe(true)
    expect(escapesRoot(`..${sep}secret`)).toBe(true)
    expect(escapesRoot('../secret')).toBe(true)
    expect(escapesRoot(join(tmpdir(), 'x'))).toBe(true)
    expect(escapesRoot('..foo')).toBe(false)
    expect(escapesRoot(`..foo${sep}bar`)).toBe(false)
    expect(escapesRoot('src/a.ts')).toBe(false)
    expect(escapesRoot('')).toBe(false)
  })

  it('lets file tools reach a workspace file whose name starts with `..`', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsk-dotdot-'))
    try {
      await writeFile(join(dir, '..notes.md'), 'x')
      expect(await resolveSafePath('..notes.md', { workspacePath: dir } as never)).toBe(join(dir, '..notes.md'))
      await expect(resolveSafePath('../outside.md', { workspacePath: dir } as never)).rejects.toThrow('outside')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
