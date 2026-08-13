import { describe, expect, it } from 'bun:test'
import { resolveFullscreen, type FullscreenEnv } from '../src/utils/fullscreen.js'
import type { DeepSeekSettings } from '../src/settings/types.js'

function probe(overrides: Partial<FullscreenEnv> = {}): FullscreenEnv {
  return {
    isTTY: true,
    platform: 'linux',
    vars: { TERM: 'xterm-256color' },
    tmuxControlMode: () => false,
    ...overrides,
  }
}

const on: DeepSeekSettings = { interface: { alternateScreen: true } }
const off: DeepSeekSettings = { interface: { alternateScreen: false } }

describe('resolveFullscreen', () => {
  it('defaults to fullscreen on a plain TTY', () => {
    expect(resolveFullscreen(undefined, probe())).toMatchObject({
      enabled: true,
      reason: 'default-on',
    })
  })

  it('honours an explicit opt-out from /config', () => {
    expect(resolveFullscreen(off, probe())).toMatchObject({
      enabled: false,
      reason: 'settings-off',
    })
  })

  it('refuses to enter the alt screen without a TTY', () => {
    expect(resolveFullscreen(on, probe({ isTTY: false }))).toMatchObject({
      enabled: false,
      reason: 'no-tty',
    })
  })

  it('stays off in CI and on dumb terminals', () => {
    const ci = probe({ vars: { TERM: 'xterm-256color', CI: 'true' } })
    expect(resolveFullscreen(on, ci).reason).toBe('ci')
    expect(resolveFullscreen(on, probe({ vars: { TERM: 'dumb' } })).reason).toBe('dumb-term')
    expect(resolveFullscreen(on, probe({ vars: {} })).reason).toBe('dumb-term')
  })

  it('auto-disables where the alt screen is broken, and explains why', () => {
    const tmux = resolveFullscreen(on, probe({ tmuxControlMode: () => true }))
    expect(tmux.enabled).toBe(false)
    expect(tmux.reason).toBe('tmux-control-mode')
    expect(tmux.note).toContain('tmux -CC')

    const winSSH = resolveFullscreen(
      on,
      probe({ platform: 'win32', vars: { TERM: 'xterm-256color', SSH_TTY: '/dev/pts/0' } }),
    )
    expect(winSSH.enabled).toBe(false)
    expect(winSSH.reason).toBe('windows-ssh')

    const reader = resolveFullscreen(
      on,
      probe({ vars: { TERM: 'xterm-256color', DEEPSEEK_SCREEN_READER: '1' } }),
    )
    expect(reader.enabled).toBe(false)
    expect(reader.reason).toBe('screen-reader')
  })

  it('does not nag when the auto-disable matches what the user already chose', () => {
    const tmux = resolveFullscreen(off, probe({ tmuxControlMode: () => true }))
    expect(tmux.enabled).toBe(false)
    expect(tmux.note).toBeUndefined()
  })

  it('lets DEEPSEEK_FULLSCREEN override auto-detection in both directions', () => {
    const forcedOn = probe({
      tmuxControlMode: () => true,
      vars: { TERM: 'xterm-256color', DEEPSEEK_FULLSCREEN: '1' },
    })
    expect(resolveFullscreen(off, forcedOn)).toMatchObject({ enabled: true, reason: 'env-on' })

    const forcedOff = probe({ vars: { TERM: 'xterm-256color', DEEPSEEK_FULLSCREEN: '0' } })
    expect(resolveFullscreen(on, forcedOff)).toMatchObject({ enabled: false, reason: 'env-off' })

    const disabled = probe({
      vars: { TERM: 'xterm-256color', DEEPSEEK_DISABLE_ALTERNATE_SCREEN: '1' },
    })
    expect(resolveFullscreen(on, disabled).enabled).toBe(false)
  })

  it('never lets a broken environment be overridden by a hard gate', () => {
    // env-on must not resurrect fullscreen when there is no TTY at all.
    const headless = probe({ isTTY: false, vars: { TERM: 'xterm-256color', DEEPSEEK_FULLSCREEN: '1' } })
    expect(resolveFullscreen(on, headless).enabled).toBe(false)
  })
})
