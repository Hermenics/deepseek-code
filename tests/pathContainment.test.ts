import { describe, expect, it } from 'bun:test'
import { link, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { escapesRoot } from '../src/utils/pathContainment.js'
import { resolveSafePath } from '../src/tools/shared/pathSafety.js'
import { ReadFile } from '../src/tools/ReadFile/ReadFile.js'
import { ReadFolder } from '../src/tools/ReadFolder/ReadFolder.js'
import { Grep } from '../src/tools/Grep/Grep.js'
import { Glob } from '../src/tools/Glob/Glob.js'
import type { ToolExecutionContext } from '../src/orchestration/types.js'

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

  it('keeps runtime state private even inside the workspace or an approved directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsk-private-state-'))
    try {
      const state = join(dir, 'actors')
      await mkdir(state)
      await writeFile(join(state, 'session.json'), 'private-runtime-marker')
      await writeFile(join(dir, 'public.txt'), 'public-source-marker')
      await symlink(join(state, 'session.json'), join(dir, 'alias.txt'))
      const context = { workspacePath: dir, projectRoot: dir, protectedPaths: [state], approvedExternalPaths: [dir] } as unknown as ToolExecutionContext
      await expect(resolveSafePath('actors/session.json', context)).rejects.toThrow('runtime state')
      await expect(resolveSafePath('actors/new.json', context)).rejects.toThrow('runtime state')
      await expect(resolveSafePath('alias.txt', context)).rejects.toThrow('runtime state')
      expect(await ReadFile.execute({ path: 'actors/session.json' }, context)).toContain('runtime state')
      expect(await ReadFolder.execute({ path: '.', recursive: true }, context)).not.toContain('actors')
      expect(await Glob.execute({ pattern: '**/*' }, context)).not.toContain('session.json')
      expect(await Grep.execute({ pattern: 'marker', path: '.' }, context)).not.toContain('private-runtime-marker')
      expect(await Grep.execute({ pattern: 'marker', path: '.' }, context)).toContain('public-source-marker')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('keeps a protected external file private through a workspace hard link and enumeration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-protected-hardlink-'))
    try {
      const workspace = join(root, 'workspace')
      const runtimeState = join(root, 'runtime-state')
      const protectedFile = join(runtimeState, 'session.json')
      const alias = join(workspace, 'session-copy.json')
      await mkdir(workspace)
      await mkdir(runtimeState)
      await writeFile(protectedFile, 'external-private-hardlink-marker')
      await link(protectedFile, alias)
      const context = { workspacePath: workspace, projectRoot: workspace, protectedPaths: [protectedFile], approvedExternalPaths: [root] } as unknown as ToolExecutionContext

      await expect(resolveSafePath(alias, context)).rejects.toThrow('runtime state')
      expect(await ReadFolder.execute({ path: '.', recursive: true }, context)).not.toContain('session-copy.json')
      expect(await Glob.execute({ pattern: '**/*' }, context)).not.toContain('session-copy.json')
      expect(await Grep.execute({ pattern: 'marker', path: '.' }, context)).not.toContain('external-private-hardlink-marker')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
