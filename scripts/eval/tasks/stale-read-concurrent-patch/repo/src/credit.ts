// Updated by the billing team after the first read.
export function mayExtendCredit(balance: number): boolean {
  return balance < 1000
}
