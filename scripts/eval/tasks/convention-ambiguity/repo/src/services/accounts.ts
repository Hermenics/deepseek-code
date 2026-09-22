import type { AccountError } from '../errors'
import type { Logger } from '../logger'
import { err, ok, type Result } from '../result'
import type { Account, AccountStore } from '../store'

function validAmount(amountCents: number): boolean {
  return Number.isSafeInteger(amountCents) && amountCents > 0
}

export class AccountService {
  constructor(private store: AccountStore, private logger: Logger) {}

  balance(id: string): Result<number, AccountError> {
    const account = this.store.find(id)
    return account ? ok(account.balanceCents) : err('ACCOUNT_NOT_FOUND')
  }

  deposit(id: string, amountCents: number): Result<Account, AccountError> {
    if (!validAmount(amountCents)) return err('INVALID_AMOUNT')
    const account = this.store.find(id)
    if (!account) return err('ACCOUNT_NOT_FOUND')
    if (account.frozen) return err('ACCOUNT_FROZEN')
    const updated = { ...account, balanceCents: account.balanceCents + amountCents }
    this.store.save(updated)
    this.logger.info('account.deposit', { id, amountCents })
    return ok(updated)
  }

  withdraw(id: string, amountCents: number): Result<Account, AccountError> {
    if (!validAmount(amountCents)) return err('INVALID_AMOUNT')
    const account = this.store.find(id)
    if (!account) return err('ACCOUNT_NOT_FOUND')
    if (account.frozen) return err('ACCOUNT_FROZEN')
    if (account.balanceCents < amountCents) {
      this.logger.warn('account.withdraw.insufficient', { id, amountCents })
      return err('INSUFFICIENT_FUNDS')
    }
    const updated = { ...account, balanceCents: account.balanceCents - amountCents }
    this.store.save(updated)
    this.logger.info('account.withdraw', { id, amountCents })
    return ok(updated)
  }
}
