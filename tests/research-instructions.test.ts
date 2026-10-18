import { describe, it, expect } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadApplicableAgentsMd } from '../src/agent/steering.js'

describe('target-scoped AGENTS.md loading', () => {
  it('loads filesystem ancestors, workspace and target directory in order, scoped to target and fresh per call', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsk-instructions-test-'))
    try {
      const workspace = join(parent, 'workspace')
      const app = join(workspace, 'packages', 'app')
      const other = join(workspace, 'packages', 'other')
      await mkdir(app, { recursive: true })
      await mkdir(other, { recursive: true })
      await writeFile(join(parent, 'AGENTS.md'), 'ancestor rule')
      await writeFile(join(workspace, 'AGENTS.md'), 'workspace rule v1')
      await writeFile(join(workspace, 'packages', 'AGENTS.md'), 'packages rule')
      await writeFile(join(app, 'AGENTS.md'), 'app rule')
      await writeFile(join(other, 'AGENTS.md'), 'other-only rule')
      const target = join(app, 'source.ts')
      await writeFile(target, 'export {}')

      const first = await loadApplicableAgentsMd(workspace, target)
      const expectedPaths = [
        join(parent, 'AGENTS.md'),
        join(workspace, 'AGENTS.md'),
        join(workspace, 'packages', 'AGENTS.md'),
        join(app, 'AGENTS.md'),
      ]
      const selected = first.filter(entry => expectedPaths.includes(entry.filePath))
      expect(selected.map(entry => entry.filePath)).toEqual(expectedPaths)
      expect(selected.map(entry => entry.content)).toEqual(['ancestor rule', 'workspace rule v1', 'packages rule', 'app rule'])
      expect(first.some(entry => entry.filePath === join(other, 'AGENTS.md'))).toBe(false)

      await writeFile(join(workspace, 'AGENTS.md'), 'workspace rule v2')
      const second = await loadApplicableAgentsMd(workspace, target)
      expect(second.find(entry => entry.filePath === join(workspace, 'AGENTS.md'))?.content).toBe('workspace rule v2')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('does not apply workspace instructions to a target outside the workspace', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsk-instructions-scope-'))
    try {
      const workspace = join(parent, 'workspace')
      const sibling = join(parent, 'sibling')
      await mkdir(workspace)
      await mkdir(sibling)
      await writeFile(join(workspace, 'AGENTS.md'), 'workspace only')
      await writeFile(join(sibling, 'target.ts'), 'export {}')
      expect(await loadApplicableAgentsMd(workspace, join(sibling, 'target.ts'))).toEqual([])
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
