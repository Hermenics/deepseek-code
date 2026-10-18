export function replaceObservedContract(source: string, observed: string, replacement: string): string {
  if (!source.includes(observed)) throw new Error('Observed contract is stale; reread before patching')
  return source.replace(observed, replacement)
}
