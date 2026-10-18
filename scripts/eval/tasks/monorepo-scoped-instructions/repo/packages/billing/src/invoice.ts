import { formatAccountId } from "./accountId.js"

export interface Invoice {
  accountId: string
  amountCents: number
}

export function buildInvoice(accountId: string, amountCents: number): Invoice {
  return { accountId: formatAccountId(String(Number(accountId))), amountCents }
}
