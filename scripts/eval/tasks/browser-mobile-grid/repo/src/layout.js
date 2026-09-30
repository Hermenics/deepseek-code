/** Chooses the number of card columns for the current viewport width. */
export function columnsForWidth(width) {
  return width < 360 ? 1 : width < 900 ? 2 : 3
}
