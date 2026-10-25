/** Local lexical retrieval: Unicode words, exact identifiers, and deterministic BM25 ranking. */
export function memoryTerms(text: string): string[] {
  return [...new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 64)
}

export function rankMemoryText<T>(items: readonly T[], query: string, textOf: (item: T) => string): Array<{ item: T; score: number }> {
  const terms = memoryTerms(query)
  if (!terms.length || !items.length) return []
  const documents = items.map(item => ({ item, words: (textOf(item).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) as string[] }))
  const average = documents.reduce((total, doc) => total + doc.words.length, 0) / documents.length || 1
  const frequencies = new Map(terms.map(term => [term, documents.filter(doc => doc.words.includes(term)).length]))
  return documents.map(({ item, words }) => ({
    item,
    score: terms.reduce((score, term) => {
      const frequency = words.filter(word => word === term).length
      const idf = Math.log(1 + (documents.length - frequencies.get(term)! + 0.5) / (frequencies.get(term)! + 0.5))
      return score + idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * words.length / average))
    }, 0),
  })).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score)
}
