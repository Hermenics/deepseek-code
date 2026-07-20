export interface DiffSegment {
  text: string
  type: 'same' | 'added' | 'removed'
}

// Split text into word tokens, keeping whitespace as separate tokens
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter(t => t.length > 0)
}

// O(nm) LCS on token arrays
function lcs(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp
}

function backtrack(dp: number[][], a: string[], b: string[], i: number, j: number): { removed: DiffSegment[]; added: DiffSegment[] } {
  if (i === 0 && j === 0) return { removed: [], added: [] }
  if (i === 0) {
    const rest = backtrack(dp, a, b, 0, j - 1)
    rest.added.push({ text: b[j - 1], type: 'added' })
    return rest
  }
  if (j === 0) {
    const rest = backtrack(dp, a, b, i - 1, 0)
    rest.removed.push({ text: a[i - 1], type: 'removed' })
    return rest
  }
  if (a[i - 1] === b[j - 1]) {
    const rest = backtrack(dp, a, b, i - 1, j - 1)
    rest.removed.push({ text: a[i - 1], type: 'same' })
    rest.added.push({ text: b[j - 1], type: 'same' })
    return rest
  }
  if (dp[i - 1][j] >= dp[i][j - 1]) {
    const rest = backtrack(dp, a, b, i - 1, j)
    rest.removed.push({ text: a[i - 1], type: 'removed' })
    return rest
  }
  const rest = backtrack(dp, a, b, i, j - 1)
  rest.added.push({ text: b[j - 1], type: 'added' })
  return rest
}

export function computeWordDiff(oldText: string, newText: string): { removed: DiffSegment[]; added: DiffSegment[] } {
  const a = tokenize(oldText)
  const b = tokenize(newText)
  if (a.length === 0 && b.length === 0) return { removed: [], added: [] }
  if (a.length === 0) return { removed: [], added: b.map(t => ({ text: t, type: 'added' })) }
  if (b.length === 0) return { removed: a.map(t => ({ text: t, type: 'removed' })), added: [] }
  const dp = lcs(a, b)
  return backtrack(dp, a, b, a.length, b.length)
}
