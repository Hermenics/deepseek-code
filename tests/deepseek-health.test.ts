import { describe, expect, it } from 'bun:test'
import { checkOfficialDeepSeekApi } from '../src/ui/setup/deepseekHealth.js'

describe('official DeepSeek health check', () => {
  it('sends the API key and accepts a healthy response', async () => {
    let authorization = ''
    const result = await checkOfficialDeepSeekApi('secret-key', async (_input, init) => {
      authorization = String(new Headers(init?.headers).get('authorization'))
      return new Response('{}', { status: 200 })
    })
    expect(result).toBe('ok')
    expect(authorization).toBe('Bearer secret-key')
  })

  it('distinguishes invalid credentials from an unreachable endpoint', async () => {
    expect(await checkOfficialDeepSeekApi('bad', async () => new Response('', { status: 401 }))).toBe('auth-error')
    expect(await checkOfficialDeepSeekApi('forbidden', async () => new Response('', { status: 403 }))).toBe('auth-error')
    expect(await checkOfficialDeepSeekApi('offline', async () => { throw new Error('offline') })).toBe('unreachable')
  })

  it.each([402, 429, 500, 503])('classifies HTTP %i as a service error', async (status) => {
    expect(await checkOfficialDeepSeekApi('service-failure', async () => new Response('', { status }))).toBe('service-error')
  })
})
