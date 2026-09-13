/** Formats an amount in cents as Brazilian reais, e.g. 123456 -> "R$ 1234,56". */
export function fmt(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}
