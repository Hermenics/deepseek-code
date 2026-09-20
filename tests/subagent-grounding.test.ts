import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execa } from 'execa'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirtyPaths, groundResult } from '../src/tools/SubAgent/grounding.js'
import type { SubAgentResult } from '../src/tools/SubAgent/contracts.js'

function result(overrides: Partial<SubAgentResult> = {}): SubAgentResult {
  return { summary: 'done', confidence: 0.9, filesRead: [], filesChanged: [], issuesFound: [], suggestions: [], metadata: {}, ...overrides }
}

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'grounding-'))
  await execa('git', ['init', '-q'], { cwd: workspace })
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace })
  await execa('git', ['config', 'user.name', 'test'], { cwd: workspace })
  await writeFile(join(workspace, 'tracked.ts'), 'export const a = 1\n')
  await execa('git', ['add', '-A'], { cwd: workspace })
  await execa('git', ['commit', '-qm', 'init'], { cwd: workspace })
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('mechanical grounding', () => {
  it('refutes an edit the agent never declared', async () => {
    const baseline = await dirtyPaths(workspace)
    await writeFile(join(workspace, 'tracked.ts'), 'export const a = 2\n')
    await writeFile(join(workspace, 'sneaky.ts'), 'export const b = 1\n')

    const report = await groundResult({
      workspace, baseline, result: result({ filesChanged: ['tracked.ts'] }),
    })

    expect(report.refuted).toBe(true)
    expect(report.issues.join(' ')).toContain('sneaky.ts')
  })

  it('catches an agent that declares nothing at all and still wrote', async () => {
    // The bypass this module exists to close. An agent reporting no files
    // changed, no issues found and high confidence is exactly the one that
    // must not be taken at its word, and every field in that sentence is
    // written by the agent.
    const baseline = await dirtyPaths(workspace)
    await writeFile(join(workspace, 'tracked.ts'), 'export const a = 2\n')

    const report = await groundResult({
      workspace, baseline,
      result: result({ confidence: 1, filesChanged: [], issuesFound: [] }),
    })

    expect(report.refuted).toBe(true)
    expect(report.issues.join(' ')).toContain('tracked.ts')
  })

  it('refutes a file the agent claims to have changed but did not', async () => {
    const baseline = await dirtyPaths(workspace)

    const report = await groundResult({
      workspace, baseline, result: result({ filesChanged: ['tracked.ts'] }),
    })

    expect(report.refuted).toBe(true)
    expect(report.issues.join(' ')).toContain('no change')
  })

  it('refutes a path the agent claims to have read that does not exist', async () => {
    const baseline = await dirtyPaths(workspace)

    const report = await groundResult({
      workspace, baseline, result: result({ filesRead: ['imaginary.ts'] }),
    })

    expect(report.refuted).toBe(true)
    expect(report.issues.join(' ')).toContain('imaginary.ts')
  })

  it('accepts an honest result', async () => {
    const baseline = await dirtyPaths(workspace)
    await writeFile(join(workspace, 'tracked.ts'), 'export const a = 2\n')

    const report = await groundResult({
      workspace, baseline, result: result({ filesRead: ['tracked.ts'], filesChanged: ['tracked.ts'] }),
    })

    expect(report.refuted).toBe(false)
    expect(report.issues).toEqual([])
  })

  // Without the baseline every edit someone already had in progress would be
  // charged to the agent, and the check would cry wolf on every real repo.
  it('does not blame the agent for edits that predate it', async () => {
    await writeFile(join(workspace, 'tracked.ts'), 'export const a = 99\n')
    const baseline = await dirtyPaths(workspace)
    await writeFile(join(workspace, 'mine.ts'), 'export const c = 1\n')

    const report = await groundResult({
      workspace, baseline, result: result({ filesChanged: ['mine.ts'] }),
    })

    expect(report.refuted).toBe(false)
  })

  it('refutes when the configured project check fails, without asking a model', async () => {
    const baseline = await dirtyPaths(workspace)
    await writeFile(join(workspace, 'tracked.ts'), 'export const a = 2\n')

    const report = await groundResult({
      workspace, baseline, result: result({ filesChanged: ['tracked.ts'] }),
      verifyCommand: 'exit 3',
    })

    expect(report.refuted).toBe(true)
    expect(report.issues.join(' ')).toContain('exited 3')
  })

  it('says so when no project check is configured, rather than implying one ran', async () => {
    const baseline = await dirtyPaths(workspace)
    const report = await groundResult({ workspace, baseline, result: result() })

    expect(report.refuted).toBe(false)
    expect(report.evidence.join(' ')).toContain('verifyCommand')
  })

  it('handles paths with spaces, which the quoted porcelain format mangles', async () => {
    const baseline = await dirtyPaths(workspace)
    await writeFile(join(workspace, 'a file.ts'), 'export const d = 1\n')

    const after = await dirtyPaths(workspace)
    expect(after?.has('a file.ts')).toBe(true)

    const report = await groundResult({
      workspace, baseline, result: result({ filesChanged: ['a file.ts'] }),
    })
    expect(report.refuted).toBe(false)
  })

  it('reports git as unavailable instead of silently passing', async () => {
    const notARepo = await mkdtemp(join(tmpdir(), 'plain-'))
    try {
      expect(await dirtyPaths(notARepo)).toBeNull()
      const report = await groundResult({ workspace: notARepo, baseline: null, result: result() })
      expect(report.evidence.join(' ')).toContain('cannot be ruled out')
    } finally {
      await rm(notARepo, { recursive: true, force: true })
    }
  })
})
