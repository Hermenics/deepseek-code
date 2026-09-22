export interface Account {
  id: string
  owner: string
  /** Integer cents; never negative. */
  balanceCents: number
  frozen: boolean
}

export class AccountStore {
  private accounts = new Map<string, Account>()

  constructor(initial: Account[] = []) {
    for (const account of initial) this.accounts.set(account.id, { ...account })
  }

  /** A copy of the account, or undefined. */
  find(id: string): Account | undefined {
    const account = this.accounts.get(id)
    return account ? { ...account } : undefined
  }

  /** Stores a copy of the account. */
  save(account: Account): void {
    this.accounts.set(account.id, { ...account })
  }
}
