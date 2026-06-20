export type { InlineGhostText } from './types.js'
export { getCommandGhost } from './commandGhost.js'
export { getHistoryGhost } from './historyGhost.js'

import type { InlineGhostText } from './types.js'
import { getCommandGhost } from './commandGhost.js'
import { getHistoryGhost } from './historyGhost.js'
import { getArgumentHint } from './argumentHints.js'

export function computeGhostText(
  value: string,
  cursorOffset: number,
  commands: string[],
  history: string[],
): InlineGhostText | null {
  if (cursorOffset !== value.length) return null
  if (value.length === 0) return null

  if (value.startsWith('/')) {
    const ghost = getCommandGhost(value, commands)
    if (ghost) return ghost
  }

  const argHint = getArgumentHint(value)
  if (argHint) return argHint

  return getHistoryGhost(value, history)
}
