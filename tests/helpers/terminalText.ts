import instances from '../../src/ink/instances.js'
import type { Frame } from '../../src/ink/frame.js'
import { cellAt } from '../../src/ink/screen.js'

/** Read the current screen: terminal output contains incremental patches, not complete frames. */
export function terminalText(stdout: NodeJS.WriteStream): string {
  const ink = instances.get(stdout) as unknown as { frontFrame: Frame } | undefined
  if (!ink) return ''
  const screen = ink.frontFrame.screen
  return Array.from({ length: screen.height }, (_, y) =>
    Array.from({ length: screen.width }, (_, x) => cellAt(screen, x, y)?.char ?? ' ').join('').trimEnd(),
  ).join('\n')
}
