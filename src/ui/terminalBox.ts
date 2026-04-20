/**
 * Terminal box drawing utility using cli-boxes, strip-ansi, and wrap-ansi.
 * Provides consistent box rendering across all UI components.
 */
import cliBoxes from 'cli-boxes'
import stripAnsi from 'strip-ansi'
import wrapAnsi from 'wrap-ansi'

export type BoxStyle = keyof typeof cliBoxes

/** Returns the terminal width (columns), defaulting to 80 */
export function termWidth(): number {
  return process.stdout.columns ?? 80
}

/** Visible length of a string (strips ANSI escape codes) */
export function visibleLength(str: string): number {
  return stripAnsi(str).length
}

/** Pads a string to a visible width, respecting ANSI codes */
export function padVisible(str: string, width: number): string {
  const diff = width - visibleLength(str)
  return diff > 0 ? str + ' '.repeat(diff) : str
}

/** Truncates a string to maxLen visible chars, adding ellipsis if needed */
export function truncateVisible(str: string, maxLen: number): string {
  const plain = stripAnsi(str)
  if (plain.length <= maxLen) return str
  // For ANSI strings, we need to walk char by char
  // Simple approach: if no ANSI, just slice
  if (plain === str) return str.slice(0, maxLen - 1) + '…'
  // Has ANSI — strip and truncate plain, lose colors (safe fallback)
  return plain.slice(0, maxLen - 1) + '…'
}

/** Wraps text respecting ANSI codes, to fit within the given width */
export function wrapText(text: string, width?: number): string {
  const w = width ?? Math.max(termWidth() - 4, 40)
  return wrapAnsi(text, w, { hard: true })
}

/**
 * Draws a box around content lines using cli-boxes border characters.
 *
 * @param lines - Array of content lines (can contain ANSI)
 * @param style - Box style from cli-boxes (round, single, double, etc.)
 * @param color - Optional chalk color function to apply to border chars
 * @param padding - Horizontal padding inside the box (default 1)
 */
export function drawBox(
  lines: string[],
  style: BoxStyle = 'round',
  color?: (s: string) => string,
  padding = 1,
): string {
  const box = cliBoxes[style]
  const maxContentWidth = Math.max(...lines.map(visibleLength), 0)
  const innerWidth = maxContentWidth + padding * 2
  const c = color ?? ((s: string) => s)

  const top = c(box.topLeft + box.top.repeat(innerWidth) + box.topRight)
  const bottom = c(box.bottomLeft + box.bottom.repeat(innerWidth) + box.bottomRight)
  const pad = ' '.repeat(padding)

  const body = lines.map((line) => {
    const rightPad = ' '.repeat(Math.max(0, maxContentWidth - visibleLength(line)))
    return c(box.left) + pad + line + rightPad + pad + c(box.right)
  })

  return [top, ...body, bottom].join('\n')
}
