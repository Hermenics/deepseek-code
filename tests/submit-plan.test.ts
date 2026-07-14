import { describe, it, expect } from 'bun:test'
import { SubmitPlan } from '../src/tools/SubmitPlan/SubmitPlan.js'

describe('SubmitPlan', () => {
  it('returns submitted: true with path', async () => {
    const result = await SubmitPlan.execute({ path: '/tmp/test-plan.md' })
    const parsed = JSON.parse(result)
    expect(parsed.submitted).toBe(true)
    expect(parsed.path).toBe('/tmp/test-plan.md')
  })

  it('requires path parameter', () => {
    const params = SubmitPlan.parameters as any
    expect(params.required).toContain('path')
  })
})
