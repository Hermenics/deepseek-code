import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import type { Logger } from '../src/logger'
import { AccountService } from '../src/services/accounts'
import { AccountStore } from '../src/store'

function setup() {
  const events: string[] = []
  const logger: Logger = { info: (e) => { events.push(e) }, warn: (e) => { events.push(e) } }
  const store = new AccountStore([
    { id: 'a', owner: 'Ana', balanceCents: 10_000, frozen: false },
    { id: 'b', owner: 'Bia', balanceCents: 500, frozen: false },
    { id: 'z', owner: 'Zed', balanceCents: 0, frozen: true },
  ])
  const service = new AccountService(store, logger) as AccountService & {
    transfer(from: string, to: string, amountCents: number): { ok: boolean; error?: string; value?: unknown }
  }
  const balances = () => ['a', 'b', 'z'].map((id) => store.find(id)!.balanceCents)
  return { service, balances, events }
}

it('moves money between two accounts', () => {
  const { service, balances } = setup()
  expect(service.transfer('a', 'b', 2_500).ok).toBe(true)
  expect(balances()).toEqual([7_500, 3_000, 0])
})

it('returns the repository error codes instead of throwing', () => {
  const { service, balances } = setup()
  const call = (from: string, to: string, amount: number) => {
    let result
    expect(() => { result = service.transfer(from, to, amount) }).not.toThrow()
    return result
  }
  expect(call('a', 'b', 20_000)).toEqual({ ok: false, error: 'INSUFFICIENT_FUNDS' })
  expect(call('a', 'nope', 100)).toEqual({ ok: false, error: 'ACCOUNT_NOT_FOUND' })
  expect(call('nope', 'a', 100)).toEqual({ ok: false, error: 'ACCOUNT_NOT_FOUND' })
  expect(call('a', 'a', 100)).toEqual({ ok: false, error: 'SAME_ACCOUNT' })
  expect(call('a', 'b', 0)).toEqual({ ok: false, error: 'INVALID_AMOUNT' })
  expect(call('a', 'b', 12.5)).toEqual({ ok: false, error: 'INVALID_AMOUNT' })
  expect(call('a', 'b', -100)).toEqual({ ok: false, error: 'INVALID_AMOUNT' })
  expect(balances()).toEqual([10_000, 500, 0])
})

it('leaves both balances untouched when either account is frozen', () => {
  const { service, balances } = setup()
  expect(service.transfer('a', 'z', 1_000)).toEqual({ ok: false, error: 'ACCOUNT_FROZEN' })
  expect(service.transfer('z', 'a', 1_000)).toEqual({ ok: false, error: 'ACCOUNT_FROZEN' })
  expect(balances()).toEqual([10_000, 500, 0])
})

it('logs through the injected logger, not the console', () => {
  const { service, events } = setup()
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info }
  const printed: unknown[] = []
  console.log = console.warn = console.error = console.info = (...args: unknown[]) => { printed.push(args) }
  try {
    service.transfer('a', 'b', 100)
    service.transfer('a', 'b', 1_000_000)
  } finally {
    Object.assign(console, original)
  }
  expect(printed).toEqual([])
  expect(events.length).toBeGreaterThan(0)
  const source = readFileSync('src/services/accounts.ts', 'utf8')
  expect(source).not.toMatch(/console\./)
})

it('adds tests for transfers', () => {
  const tests = readdirSync('.', { recursive: true }).map(String)
    .filter((f) => /\.(test|spec)\.[jt]sx?$/.test(f) && !f.includes('__eval_check__') && !f.includes('node_modules'))
    .map((f) => readFileSync(f, 'utf8')).join('\n')
  expect(tests).toMatch(/transfer/)
})
