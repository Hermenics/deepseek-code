export function formatTotalCents(value: number): string {
  return `${(value / 100).toFixed(2)}`
}
