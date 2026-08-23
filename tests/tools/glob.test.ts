import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { Glob } from '../../src/tools/Glob/Glob.js'

const roots: string[] = []

async function temp(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Glob workspace boundary', () => {
  it('does not return ../ matches or symlinks outside the workspace', async () => {
    const workspace = await temp('dsk-glob-workspace-')
    const outside = await temp('dsk-glob-outside-')
    await mkdir(join(workspace, 'src'))
    await writeFile(join(workspace, 'src', 'inside.ts'), 'inside')
    await writeFile(join(outside, 'outside.ts'), 'outside')
    const context = {
      sessionId: 'glob-test',
      workspacePath: workspace,
      projectRoot: workspace,
      permissionProfile: 'researcher-readonly' as const,
    }

    const traversal = await Glob.execute({
      pattern: relative(workspace, join(outside, 'outside.ts')),
      cwd: workspace,
    }, context)
    expect(traversal).toBe('No matches')

    if (process.platform === 'win32') return
    await symlink(outside, join(workspace, 'linked-outside'))
    await symlink(join(outside, 'outside.ts'), join(workspace, 'linked-outside.ts'))
    const result = await Glob.execute({ pattern: '**/*', cwd: workspace }, context)
    expect(result).toContain('src/inside.ts')
    expect(result).not.toContain('outside.ts')
  })
})
