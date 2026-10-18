import { afterEach, describe, expect, it } from 'bun:test'
import { unlinkSync } from 'node:fs'
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
    expect(traversal).toBe('Search scope: .\nNo matches')

    if (process.platform === 'win32') return
    await symlink(outside, join(workspace, 'linked-outside'))
    await symlink(join(outside, 'outside.ts'), join(workspace, 'linked-outside.ts'))
    const result = await Glob.execute({ pattern: '**/*', cwd: workspace }, context)
    expect(result).toContain('Search scope: .')
    expect(result).toContain('src/inside.ts')
    expect(result).not.toContain('outside.ts')
  })

  it('reports match validation failures instead of returning an incomplete no-match result', async () => {
    for (const includeValidMatch of [true, false]) {
      const workspace = await temp('dsk-glob-validation-failure-')
      const staleMatch = join(workspace, 'stale.ts')
      await writeFile(staleMatch, 'stale')
      if (includeValidMatch) await writeFile(join(workspace, 'valid.ts'), 'valid')
      let protectedPathReads = 0
      const context = {
        sessionId: 'glob-validation-failure-test',
        workspacePath: workspace,
        projectRoot: workspace,
        permissionProfile: 'researcher-readonly' as const,
        get protectedPaths() {
          if (++protectedPathReads === 2) unlinkSync(staleMatch)
          return []
        },
      }

      const result = JSON.parse(await Glob.execute({ pattern: '*.ts', cwd: workspace }, context))
      expect(result).toMatchObject({
        schemaVersion: 1,
        status: includeValidMatch ? 'partial' : 'error',
        error: { code: includeValidMatch ? 'GLOB_PARTIAL' : 'GLOB_FAILED' },
      })
      if (includeValidMatch) expect(result.partial.output).toContain('valid.ts')
      else expect(JSON.stringify(result)).not.toContain('No matches')
    }
  })
})
