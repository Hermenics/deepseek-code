export type { InlineGhostText } from './types.js'
export { getCommandGhost } from './commandGhost.js'
export { getHistoryGhost } from './historyGhost.js'

import type { InlineGhostText } from './types.js'
import { getArgumentHint } from './argumentHints.js'

/**
 * Returns display-only argument placeholders. Command completion remains in
 * CommandDropdown, while ordinary history/inline completion is intentionally
 * not rendered in the input line.
 */
export function computeGhostText(value: string, cursorOffset: number): InlineGhostText | null {
  if (cursorOffset !== value.length) return null
  if (value.length === 0) return null

  return getArgumentHint(value)
}

export function getSuggestedReplyGhost(value: string, suggestion: string | undefined): InlineGhostText | null {
  if (value.length > 0 || !suggestion?.trim()) return null
  const text = suggestion.trim()
  return { text, fullCommand: text, insertPosition: 0 }
}
