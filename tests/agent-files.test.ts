import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAgentFiles } from '../src/agent/files.js'

const roots: string[] = []
async function temp(prefix: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), prefix))
  roots.push(value)
  return value
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('agent file context boundary', () => {
  it('loads only project-contained, non-sensitive files with a total budget', async () => {
    const root = await temp('deepseek-agent-files-')
    await writeFile(join(root, 'guide.md'), 'safe guide')
    const output = await resolveAgentFiles(['*.md'], root)
    expect(output).toContain('// File: guide.md')
    expect(output).toContain('safe guide')
  })

  it('rejects traversal, absolute paths, secrets and symlink escapes', async () => {
    const root = await temp('deepseek-agent-files-')
    const outside = await temp('deepseek-agent-outside-')
    await writeFile(join(root, '.env'), 'TOKEN=secret')
    await writeFile(join(outside, 'secret.md'), 'outside')
    await symlink(join(outside, 'secret.md'), join(root, 'linked.md'))
    await expect(resolveAgentFiles(['../*'], root)).rejects.toThrow('inside the project')
    await expect(resolveAgentFiles([join(outside, '*.md')], root)).rejects.toThrow('inside the project')
    await expect(resolveAgentFiles(['.env'], root)).rejects.toThrow('sensitive')
    expect(await resolveAgentFiles(['linked.md'], root)).toBe('')
  })
})
