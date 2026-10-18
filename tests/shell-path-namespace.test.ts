import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Shell, findIgnoredShellPath } from '../src/tools/Shell/Shell.js'
import { ReadFile } from '../src/tools/ReadFile/ReadFile.js'
import { resolvePathForContext, resolveSafePath } from '../src/tools/shared/pathSafety.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const linuxTest = it.skipIf(process.platform !== 'linux')
const sandboxTest = it.skipIf(!sandboxAvailable())

describe('shell workspace namespace', () => {
  linuxTest('translates only the complete /mnt prefix in the active context', () => {
    const context = { sessionId: 'namespace-test', permissionProfile: 'coordinator-integrator' as const, workspacePath: '/tmp/task-workspace', projectRoot: '/tmp/project' }
    expect(resolvePathForContext('/mnt/src/main.ts', context)).toBe('/tmp/task-workspace/src/main.ts')
    expect(resolvePathForContext('/mnt', context)).toBe('/tmp/task-workspace')
    expect(resolvePathForContext('/mnt-other/file', context)).toBe('/mnt-other/file')
    expect(resolvePathForContext('/mnt/../outside', context)).toBe('/outside')
    expect(resolvePathForContext('/mnt/file')).toBe('/mnt/file')
    expect(resolvePathForContext('/mnt/actual/file', { ...context, workspacePath: '/mnt/actual' })).toBe('/mnt/actual/file')
  })

  linuxTest('validates translated symlinks, credentials and traversal before file access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-namespace-'))
    const outside = await mkdtemp(join(tmpdir(), 'deepseek-namespace-private-'))
    try {
      await writeFile(join(root, 'source.txt'), 'workspace source')
      await writeFile(join(root, '.env'), 'PRIVATE=test')
      await writeFile(join(outside, 'private.txt'), 'outside source')
      await symlink(join(root, 'source.txt'), join(root, 'inside.txt'))
      await symlink(join(outside, 'private.txt'), join(root, 'outside.txt'))
      const context = { sessionId: 'namespace-test', permissionProfile: 'coordinator-integrator' as const, workspacePath: root, projectRoot: root }
      expect(findIgnoredShellPath('cat /mnt/.env', root, context)).toBe('/mnt/.env')
      expect(await Shell.execute({ command: 'cat /mnt/.env' }, context)).toContain('credential-like file')
      expect(await ReadFile.execute({ path: '/mnt/inside.txt' }, context)).toContain('workspace source')
      await expect(resolveSafePath('/mnt/outside.txt', context)).rejects.toThrow('symlink')
      await expect(resolveSafePath('/mnt/.env', context)).rejects.toThrow('sensitive')
      await expect(resolveSafePath('/mnt/../outside', context)).rejects.toThrow('outside')
    } finally {
      await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
    }
  })

  sandboxTest('accepts host absolute paths and maps shell diagnostics back to file tools without exposing siblings', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'deepseek-namespace-host-'))
    const root = join(parent, 'workspace with spaces')
    await mkdir(root)
    try {
      await writeFile(join(root, 'source.txt'), 'original')
      await writeFile(join(parent, 'private.txt'), 'host-private')
      const context = { sessionId: 'namespace-test', shellOutputRoot: parent, workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
      const result = await Shell.execute({ command: `cat ${quote(join(root, 'source.txt'))}; printf '\\n/mnt/source.txt:1\\n'; test ! -e ${quote(join(parent, 'private.txt'))}` }, context)
      expect(result).toContain('original')
      expect(result).toContain('/mnt/source.txt:1')
      expect(result).not.toStartWith('Error:')
      expect(await ReadFile.execute({ path: '/mnt/source.txt' }, context)).toContain('original')
      await Shell.execute({ command: `printf changed > ${quote(join(root, 'source.txt'))}` }, context)
      expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('changed')
      const denied = await Shell.execute({ command: `printf overwritten > ${quote(join(root, 'source.txt'))}` }, { ...context, permissionProfile: 'tester' })
      expect(denied).toStartWith('Error:')
      expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('changed')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
