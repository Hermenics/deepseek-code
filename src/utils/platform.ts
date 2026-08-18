import { execFileSync, execSync } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Cross-platform helpers. Everything the tools need that differs between
 * Linux, macOS and Windows lives here so call sites stay platform-blind.
 */

export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

const binaryCache = new Map<string, boolean>()

/**
 * True when `name` is runnable from PATH. Cached — a missing binary stays
 * missing for the life of the process, and probing is not free.
 */
export function hasBinary(name: string): boolean {
  const cached = binaryCache.get(name)
  if (cached !== undefined) return cached
  let found = false
  try {
    // `where` on Windows, `which` elsewhere: both exit non-zero when absent.
    if (isWindows) execFileSync('where', [name], { stdio: 'ignore', timeout: 3000 })
    else execFileSync('which', [name], { stdio: 'ignore', timeout: 3000 })
    found = true
  } catch {
    found = false
  }
  binaryCache.set(name, found)
  return found
}

/** Test seam — drops the probe cache. */
export function clearBinaryCache(): void {
  binaryCache.clear()
}

/**
 * Reads the system clipboard. Returns '' when no clipboard tool is available
 * (headless Linux, locked-down Windows) rather than throwing — a failed paste
 * should be a no-op, never a crash.
 *
 * Kept synchronous because both call sites run inside a keypress handler.
 */
export function readClipboardSync(): string {
  try {
    if (isMac) {
      return execSync('pbpaste', { encoding: 'utf-8', timeout: 2000 })
    }
    if (isWindows) {
      // -Raw keeps newlines instead of returning an array of lines.
      return execSync(
        'powershell -NoProfile -NonInteractive -Command "Get-Clipboard -Raw"',
        { encoding: 'utf-8', timeout: 5000, windowsHide: true },
      )
    }
    // Linux/BSD: X11 first, then Wayland.
    return execSync(
      'xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null || wl-paste 2>/dev/null',
      { encoding: 'utf-8', timeout: 2000 },
    )
  } catch {
    return ''
  }
}

/**
 * Per-user state directory, following each platform's convention:
 * %LOCALAPPDATA% on Windows, ~/Library/Application Support on macOS,
 * $XDG_STATE_HOME (or ~/.local/state) on Linux.
 */
export function userStateDir(appName: string): string {
  const home = os.homedir()
  if (isWindows) return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), appName)
  if (isMac) return path.join(home, 'Library', 'Application Support', appName)
  return path.join(process.env.XDG_STATE_HOME || path.join(home, '.local', 'state'), appName)
}

/**
 * Shell used to run user-supplied commands. Windows has no POSIX shell, so
 * commands run through cmd.exe unless the user points SHELL/COMSPEC elsewhere.
 */
export function defaultShell(): string {
  if (isWindows) return process.env.COMSPEC || 'cmd.exe'
  return process.env.SHELL || '/bin/sh'
}

/**
 * Environment variables safe to pass to a sandboxless child process.
 * Allow-list, not deny-list: a new provider key must never leak by default.
 */
const ENV_ALLOWLIST_POSIX = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'TMPDIR', 'USER', 'SHELL']
const ENV_ALLOWLIST_WINDOWS = [
  'PATH', 'SystemRoot', 'windir', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS', 'OS', 'PROCESSOR_ARCHITECTURE',
]

/**
 * A minimal environment for running untrusted commands when no OS sandbox is
 * available. Preserves the sandbox's "no inherited secrets" guarantee even
 * where its network and filesystem isolation cannot be reproduced.
 */
export function scrubbedEnv(): NodeJS.ProcessEnv {
  const allowed = isWindows ? ENV_ALLOWLIST_WINDOWS : ENV_ALLOWLIST_POSIX
  const env: NodeJS.ProcessEnv = {}
  for (const key of allowed) {
    // Windows env lookups are case-insensitive in cmd but not in process.env.
    const value = process.env[key] ?? (isWindows
      ? Object.entries(process.env).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]
      : undefined)
    if (value !== undefined) env[key] = value
  }
  return env
}

/**
 * True when bubblewrap OS-level sandboxing can be used. Linux only —
 * macOS `sandbox-exec` is deprecated and Windows has no equivalent.
 */
export function sandboxAvailable(): boolean {
  return isLinux && hasBinary('bwrap')
}
