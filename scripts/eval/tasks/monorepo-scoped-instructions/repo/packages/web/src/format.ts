export function formatForDisplay(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}
