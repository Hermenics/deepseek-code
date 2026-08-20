import { describe, expect, it } from 'bun:test'
import { EXIT_LOGO, formatExitScreen } from '../src/utils/exitScreen.js'

describe('formatExitScreen', () => {
  it('clears the terminal, leaves alternate screen, and prints the blue logo above resume instructions', () => {
    const output = formatExitScreen('session-123', true)

    expect(output).toContain('\x1b[?1049l')
    expect(output).toContain('\x1b[2J\x1b[3J\x1b[H')
    expect(output).toContain(`\x1b[34m${EXIT_LOGO}\x1b[0m`)
    expect(EXIT_LOGO).not.toContain('\\u')
    expect(output).toContain('  To continue this session, run:\n  deepseek --resume session-123')
    expect(output.indexOf(EXIT_LOGO)).toBeLessThan(output.indexOf('To continue this session'))
  })

  it('does not emit alternate-screen escape codes when fullscreen is disabled', () => {
    expect(formatExitScreen('session-123', false)).not.toContain('\x1b[?1049l')
  })
})
