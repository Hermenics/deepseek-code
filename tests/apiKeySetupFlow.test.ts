import { describe, expect, it } from 'bun:test'
import { afterKeyCheck } from '../src/ui/setup/deepseekHealth.js'

describe('API key setup after the official check', () => {
  it('finishes without asking for a base URL when the key works', () => {
    expect(afterKeyCheck('ok')).toEqual({ next: 'complete' })
  })

  it('asks for a base URL instead of blocking when the official API rejects the key', () => {
    const result = afterKeyCheck('auth-error')
    expect(result.next).toBe('baseUrl')
    expect(result.next === 'baseUrl' && result.required).toBe(true)
  })

  it('asks for a base URL when the official API cannot be reached', () => {
    expect(afterKeyCheck('unreachable')).toMatchObject({ next: 'baseUrl', required: false })
  })

  it('reports a service error without moving on', () => {
    expect(afterKeyCheck('service-error').next).toBe('error')
  })
})
