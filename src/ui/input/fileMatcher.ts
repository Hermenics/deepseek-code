/**
 * Detects an @word token ending at cursorOffset in text.
 * Returns the query and the complete token bounds, or null outside an @word.
 */
export function getAtMention(
  text: string,
  cursorOffset: number,
): { query: string; atStart: number; atEnd: number } | null {
  // Walk backwards from cursorOffset to find the start of the current token
  let i = cursorOffset - 1
  while (i >= 0 && !/\s/.test(text[i]!)) {
    i--
  }
  const tokenStart = i + 1
  if (text[tokenStart] !== '@') return null

  let tokenEnd = cursorOffset
  while (tokenEnd < text.length && !/\s/.test(text[tokenEnd]!)) tokenEnd++

  return {
    query: text.slice(tokenStart + 1, cursorOffset),
    atStart: tokenStart,
    atEnd: tokenEnd,
  }
}

const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', '.deepseek', 'build', 'coverage', '.next']

/**
 * Searches files matching query under cwd.
 * Returns relative paths, max maxResults (default 8).
 */
export async function searchFiles(
  query: string,
  cwd: string,
  maxResults = 8,
  fuzzy = true,
): Promise<string[]> {
  try {
    // fast-glob is a production dependency. Keep user input out of shell commands.
    const fg = await import('fast-glob')
    const results = await fg.default('**/*', {
      cwd,
      ignore: EXCLUDE_DIRS.map(d => `**/${d}/**`).concat(['**/*.lock', '**/*.lockb']),
      onlyFiles: true,
      caseSensitiveMatch: false,
      dot: false,
    })
    const normalizedQuery = query.toLocaleLowerCase()
    return results
      .filter((file) => {
        const normalizedFile = file.toLocaleLowerCase()
        if (!fuzzy) return normalizedFile.includes(normalizedQuery)

        let from = 0
        for (const char of normalizedQuery) {
          from = normalizedFile.indexOf(char, from)
          if (from === -1) return false
          from++
        }
        return true
      })
      .sort((a, b) => a.length - b.length)
      .slice(0, maxResults)
  } catch {
    return []
  }
}
