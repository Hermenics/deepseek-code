/** Finds the delivery estimate selected by its option value. */
export function estimateDays(options, selectedId) {
  return options.find(option => option.label === selectedId)?.days ?? null
}
