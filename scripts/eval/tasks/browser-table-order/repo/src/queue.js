/** Returns the tickets from lowest score to highest. */
export function sortQueue(rows) {
  return [...rows].sort((a, b) => String(a.score).localeCompare(String(b.score)))
}
