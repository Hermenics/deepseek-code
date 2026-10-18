export function formatId(value: string): string {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 99_999_999) {
    throw new Error('Invalid ID')
  }
  return String(numeric)
}
