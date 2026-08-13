import { spawnSync } from 'child_process'
import type { DeepSeekSettings } from '../settings/types.js'
import { isEnvTruthy } from './envUtils.js'

export type FullscreenReason =
  | 'no-tty'
  | 'ci'
  | 'dumb-term'
  | 'screen-reader'
  | 'env-off'
  | 'env-on'
  | 'tmux-control-mode'
  | 'windows-ssh'
  | 'settings-on'
  | 'settings-off'
  | 'default-on'

export interface FullscreenDecision {
  enabled: boolean
  reason: FullscreenReason
  /** Set when an environment gate overrode an explicit user preference. */
  note?: string
}

/** Injectable environment probe, so the cascade is testable without a real TTY. */
export interface FullscreenEnv {
  isTTY: boolean
  platform: string
  vars: Record<string, string | undefined>
  /** True when running under tmux in control mode (iTerm2 integration). */
  tmuxControlMode: () => boolean
}

/**
 * Detect `tmux -CC` (control mode). tmux multiplexes the pane through iTerm2
 * instead of drawing it, and the alternate screen renders as garbage there.
 *
 * The probe spawns tmux, so it is guarded: only when TMUX is set and
 * TERM_PROGRAM is absent (iTerm2 integration clears TERM_PROGRAM inside the
 * control-mode client). In every other case this costs nothing.
 */
export function probeTmuxControlMode(
  vars: Record<string, string | undefined> = process.env,
): boolean {
  if (!vars.TMUX) return false
  if (vars.TERM_PROGRAM) return false
  try {
    const result = spawnSync('tmux', ['display-message', '-p', '#{client_control_mode}'], {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true,
    })
    if (result.status !== 0) return false
    return result.stdout.trim() === '1'
  } catch {
    return false
  }
}

export function currentFullscreenEnv(): FullscreenEnv {
  let cached: boolean | undefined
  return {
    isTTY: Boolean(process.stdout.isTTY),
    platform: process.platform,
    vars: process.env as Record<string, string | undefined>,
    tmuxControlMode: () => (cached ??= probeTmuxControlMode()),
  }
}

function isEnvFalsy(value: string | undefined): boolean {
  return value === '0' || value === 'false'
}

/**
 * Decide whether the TUI should run in the terminal's alternate screen buffer.
 *
 * Order matters. Environments where the alternate screen is actively broken
 * (no TTY, dumb terminal, screen reader, tmux control mode, Windows over SSH)
 * win over the user's stored preference — a setting the user cannot see the
 * effect of is worse than an override they can read about in /doctor.
 * `DEEPSEEK_FULLSCREEN` is the escape hatch that beats the auto-detection.
 */
export function resolveFullscreen(
  settings: DeepSeekSettings | undefined,
  probe: FullscreenEnv = currentFullscreenEnv(),
): FullscreenDecision {
  const { vars } = probe
  const preference = settings?.interface?.alternateScreen
  const explicit = typeof preference === 'boolean'
  const overrides = (note: string) => (explicit && preference ? { note } : {})

  if (!probe.isTTY) return { enabled: false, reason: 'no-tty' }
  if (isEnvTruthy(vars.CI)) return { enabled: false, reason: 'ci' }
  if (!vars.TERM || vars.TERM === 'dumb') return { enabled: false, reason: 'dumb-term' }

  if (isEnvTruthy(vars.DEEPSEEK_SCREEN_READER)) {
    return {
      enabled: false,
      reason: 'screen-reader',
      ...overrides('fullscreen disabled: screen reader mode is on'),
    }
  }

  if (isEnvTruthy(vars.DEEPSEEK_DISABLE_ALTERNATE_SCREEN) || isEnvFalsy(vars.DEEPSEEK_FULLSCREEN)) {
    return { enabled: false, reason: 'env-off' }
  }
  if (isEnvTruthy(vars.DEEPSEEK_FULLSCREEN)) return { enabled: true, reason: 'env-on' }

  if (probe.tmuxControlMode()) {
    return {
      enabled: false,
      reason: 'tmux-control-mode',
      ...overrides(
        'fullscreen disabled: tmux -CC (iTerm2 integration) detected · set DEEPSEEK_FULLSCREEN=1 to override',
      ),
    }
  }

  const overSSH = Boolean(vars.SSH_CONNECTION || vars.SSH_CLIENT || vars.SSH_TTY)
  if (probe.platform === 'win32' && overSSH) {
    return {
      enabled: false,
      reason: 'windows-ssh',
      ...overrides(
        'fullscreen disabled: Windows over SSH (ConPTY re-rendering) detected · set DEEPSEEK_FULLSCREEN=1 to override',
      ),
    }
  }

  if (explicit) return { enabled: preference, reason: preference ? 'settings-on' : 'settings-off' }
  return { enabled: true, reason: 'default-on' }
}

let active = false

/** Set once at startup from {@link resolveFullscreen}. */
export function setFullscreenActive(value: boolean): void {
  active = value
}

export function isFullscreenActive(): boolean {
  return active
}

export function isFullscreenEnvEnabled(): boolean {
  return isEnvTruthy(process.env.DEEPSEEK_FULLSCREEN)
}

/**
 * Mouse clicks only reach the app while the alternate screen has SGR mouse
 * tracking enabled, so click handling follows fullscreen.
 */
export function isMouseClicksDisabled(): boolean {
  return !active
}
