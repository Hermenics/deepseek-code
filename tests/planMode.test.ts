import { describe, expect, it } from 'bun:test'
import { buildPlanModeInjection, newPlanPath } from '../src/agent/planMode.js'

describe('newPlanPath', () => {
  it('creates plans under the active workspace', () => {
    expect(newPlanPath('Inspect files', '/tmp/deepseek-active-workspace')).toStartWith('/tmp/deepseek-active-workspace/.plans/inspect-files-')
  })

  it('documents the dedicated plan writer and read-only exceptions', () => {
    const prompt = buildPlanModeInjection('Inspect files', '/tmp/plan.md')
    expect(prompt).toContain('write_plan')
    expect(prompt).toContain('git (status, diff, log only)')
    expect(prompt).toContain('todo (list only), memory (list only)')
    expect(prompt).toContain('You MUST NOT use: shell, write_file, patch_file, edit_file')
  })
})
