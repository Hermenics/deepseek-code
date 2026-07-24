import { describe, expect, it } from 'bun:test'
import { newPlanPath } from '../src/agent/planMode.js'

describe('newPlanPath', () => {
  it('creates plans under the active workspace', () => {
    expect(newPlanPath('Inspect files', '/tmp/deepseek-active-workspace')).toStartWith('/tmp/deepseek-active-workspace/.plans/inspect-files-')
  })
})
