export function normalizeWebSearchQuery(query: string): string {
  return query.trim().slice(0, 300)
}
