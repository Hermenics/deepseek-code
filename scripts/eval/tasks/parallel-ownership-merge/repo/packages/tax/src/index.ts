export function calculateTax(subtotalCents: number): number {
  return Math.floor(subtotalCents * 0.08)
}
