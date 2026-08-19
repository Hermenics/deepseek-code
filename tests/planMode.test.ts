import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildPlanModeInjection, newPlanPath } from '../src/agent/planMode.js'

describe('newPlanPath', () => {
  it('creates plans under the active workspace', () => {
    const workspace = join(tmpdir(), 'deepseek-active-workspace')
    expect(newPlanPath('Inspect files', workspace)).toStartWith(join(workspace, '.plans', 'inspect-files-'))
  })

  it('documents the dedicated plan writer and read-only exceptions', () => {
    const prompt = buildPlanModeInjection('Inspect files', join(tmpdir(), 'plan.md'))
    expect(prompt).toContain('write_plan')
    expect(prompt).toContain('git (status, diff, log only)')
    expect(prompt).toContain('todo (list only), memory (list only)')
    expect(prompt).toContain('You MUST NOT use: shell, write_file, patch_file, edit_file')
  })
})
