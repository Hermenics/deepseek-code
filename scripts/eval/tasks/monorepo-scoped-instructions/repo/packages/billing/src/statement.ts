import { formatAccountId } from "./accountId.js"

export interface Statement {
  accountId: string
  period: string
}

export function buildStatement(accountId: string, period: string): Statement {
  return { accountId: formatAccountId(Number(accountId).toString()), period }
}
