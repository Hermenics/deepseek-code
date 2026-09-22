import { expect, it } from 'bun:test'
import { silentLogger } from '../src/logger'
import { AccountService } from '../src/services/accounts'
import { AccountStore } from '../src/store'

/** Service over one account holding $100. */
const service = () => new AccountService(new AccountStore([
  { id: 'a', owner: 'Ana', balanceCents: 10_000, frozen: false },
]), silentLogger)

it('deposits and withdraws', () => {
  const s = service()
  expect(s.deposit('a', 500)).toMatchObject({ ok: true })
  expect(s.withdraw('a', 20_000)).toEqual({ ok: false, error: 'INSUFFICIENT_FUNDS' })
  expect(s.balance('a')).toEqual({ ok: true, value: 10_500 })
})
