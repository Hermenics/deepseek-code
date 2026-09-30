/** Formats cents as dollars, e.g. 1234 → "$12.34". */
export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`
}

/** Total of the cart in cents. */
export function cartTotal(items) {
  let total = 0
  for (const item of items) total += item.priceCents
  return total
}
