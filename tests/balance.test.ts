import { describe, expect, it, mock } from 'bun:test'
import { fetchDeepSeekBalance, formatBalance } from '../src/agent/balance.js'

const reply = (status: number, body: unknown) => mock(async () => new Response(JSON.stringify(body), { status }))

describe('fetchDeepSeekBalance', () => {
  it('reads the USD balance from the configured base URL', async () => {
    const fetchImpl = reply(200, {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '30.00' }, { currency: 'USD', total_balance: '4.74' }],
    })

    const balance = await fetchDeepSeekBalance('sk-test', 'https://api.deepseek.com/v1/', fetchImpl as unknown as typeof fetch)

    expect(balance).toEqual({ currency: 'USD', total: 4.74 })
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('https://api.deepseek.com/v1/user/balance')
  })

  it('returns undefined without a key, on HTTP errors, unexpected bodies and network failures', async () => {
    const offline = mock(async () => { throw new Error('offline') })
    expect(await fetchDeepSeekBalance(undefined, undefined, reply(200, {}) as unknown as typeof fetch)).toBeUndefined()
    expect(await fetchDeepSeekBalance('sk', undefined, reply(401, { error: 'bad key' }) as unknown as typeof fetch)).toBeUndefined()
    expect(await fetchDeepSeekBalance('sk', undefined, reply(200, { balance_infos: [] }) as unknown as typeof fetch)).toBeUndefined()
    expect(await fetchDeepSeekBalance('sk', undefined, offline as unknown as typeof fetch)).toBeUndefined()
  })

  it('formats USD and other currencies', () => {
    expect(formatBalance({ currency: 'USD', total: 4.7 })).toBe('$4.70')
    expect(formatBalance({ currency: 'CNY', total: 30 })).toBe('30.00 CNY')
  })
})
