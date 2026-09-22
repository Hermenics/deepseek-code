import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { PromptImage, PromptImageMediaType } from '../types/input.js'

/**
 * Cross-platform helpers. Everything the tools need that differs between
 * Linux, macOS and Windows lives here so call sites stay platform-blind.
 */

export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

const binaryCache = new Map<string, boolean>()
let sandboxCapability: boolean | undefined

/**
 * True when `name` is runnable from PATH. Cached — a missing binary stays
 * missing for the life of the process, and probing is not free.
 */
export function hasBinary(name: string): boolean {
  const cached = binaryCache.get(name)
  if (cached !== undefined) return cached
  let found = false
  try {
    found = Bun.which(name) !== null
  } catch {
    found = false
  }
  binaryCache.set(name, found)
  return found
}

/** Test seam — drops the probe cache. */
export function clearBinaryCache(): void {
  binaryCache.clear()
  sandboxCapability = undefined
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

const CLIPBOARD_IMAGE_MAX_BYTES = 32 * 1024 * 1024
const CLIPBOARD_IMAGE_TYPES: PromptImageMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Identifies PNG, JPEG, GIF or WebP from magic bytes; other formats return null. */
function detectImageType(data: Uint8Array): PromptImageMediaType | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 6 && (new TextDecoder().decode(data.slice(0, 6)) === 'GIF87a' || new TextDecoder().decode(data.slice(0, 6)) === 'GIF89a')) return 'image/gif'
  if (data.length >= 12 && new TextDecoder().decode(data.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(data.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

/** Converts clipboard bytes to the content shape accepted by DeepSeek vision. */
export function clipboardImageFromBytes(data: Uint8Array): PromptImage | null {
  if (data.length === 0 || data.length > CLIPBOARD_IMAGE_MAX_BYTES) return null
  const mediaType = detectImageType(data)
  return mediaType ? { mediaType, data: Buffer.from(data).toString('base64') } : null
}

/** Runs a clipboard reader and returns its raw stdout, or null if the binary is missing or the command fails. */
function readClipboardBinary(command: string, args: string[]): Buffer | null {
  if (!hasBinary(command)) return null
  try {
    const result = execFileSync(command, args, {
      encoding: 'buffer',
      timeout: 2500,
      maxBuffer: CLIPBOARD_IMAGE_MAX_BYTES + 1024,
      windowsHide: true,
    })
    return Buffer.isBuffer(result) ? result : Buffer.from(result)
  } catch {
    return null
  }
}

/** Runs a clipboard helper and returns trimmed text output, or null if the binary is missing or the command fails. */
function readClipboardText(command: string, args: string[]): string | null {
  if (!hasBinary(command)) return null
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      timeout: 2500,
      maxBuffer: CLIPBOARD_IMAGE_MAX_BYTES * 2,
      windowsHide: true,
    }).trim()
  } catch {
    return null
  }
}

/** Tries xclip, wl-paste and xsel in turn, asking only for image MIME types the clipboard advertises when the tool can list them. */
function readLinuxClipboardImage(): PromptImage | null {
  const readers: Array<{ command: string; args: (mime: string) => string[] }> = [
    { command: 'xclip', args: (mime) => ['-selection', 'clipboard', '-t', mime, '-o'] },
    { command: 'wl-paste', args: (mime) => ['--type', mime] },
    { command: 'xsel', args: (mime) => ['--clipboard', '--output', '--mime-type', mime] },
  ]
  for (const reader of readers) {
    if (!hasBinary(reader.command)) continue
    const available = reader.command === 'xclip'
      ? readClipboardText(reader.command, ['-selection', 'clipboard', '-t', 'TARGETS', '-o'])
      : reader.command === 'wl-paste'
        ? readClipboardText(reader.command, ['--list-types'])
        : null
    const types = available
      ? CLIPBOARD_IMAGE_TYPES.filter((mime) => available.includes(mime))
      : CLIPBOARD_IMAGE_TYPES
    for (const mime of types) {
      const image = clipboardImageFromBytes(readClipboardBinary(reader.command, reader.args(mime)) ?? new Uint8Array())
      if (image) return image
    }
  }
  return null
}

/** Uses `pngpaste` when installed, otherwise has AppleScript dump the clipboard as PNG into a temp file that is always cleaned up. */
function readMacClipboardImage(): PromptImage | null {
  const direct = clipboardImageFromBytes(readClipboardBinary('pngpaste', ['-']) ?? new Uint8Array())
  if (direct) return direct
  if (!hasBinary('osascript')) return null

  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepseek-clipboard-'))
  const target = path.join(dir, 'clipboard.png')
  const script = [
    'on run argv',
    'set outputPath to item 1 of argv',
    'set imageData to the clipboard as «class PNGf»',
    'set fileRef to open for access POSIX file outputPath with write permission',
    'write imageData to fileRef',
    'close access fileRef',
    'end run',
  ].join('\n')
  try {
    execFileSync('osascript', ['-e', script, target], { stdio: 'ignore', timeout: 2500 })
    return clipboardImageFromBytes(readFileSync(target))
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Reads the clipboard image via PowerShell (Windows PowerShell, then pwsh) as base64-encoded PNG. */
function readWindowsClipboardImage(): PromptImage | null {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$image = [Windows.Forms.Clipboard]::GetImage()',
    'if ($null -eq $image) { exit 1 }',
    '$stream = New-Object System.IO.MemoryStream',
    '$image.Save($stream, [Drawing.Imaging.ImageFormat]::Png)',
    '[Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))',
  ].join(';')
  for (const command of ['powershell', 'pwsh']) {
    const encoded = readClipboardText(command, ['-NoProfile', '-NonInteractive', '-STA', '-Command', script])
    if (!encoded) continue
    const image = clipboardImageFromBytes(Buffer.from(encoded, 'base64'))
    if (image) return image
  }
  return null
}

/** Reads the first supported raster image currently in the system clipboard. */
export function readClipboardImageSync(): PromptImage | null {
  try {
    if (isMac) return readMacClipboardImage()
    if (isWindows) return readWindowsClipboardImage()
    return readLinuxClipboardImage()
  } catch {
    return null
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
 * Arguments that run `command` through defaultShell(). cmd.exe parses its own raw command line, so on
 * Windows spawn with `windowsVerbatimArguments: isWindows`: the command goes inside one pair of quotes
 * that /s strips, as Node's `shell: true` does. Default argument escaping turns the command's own
 * quotes into \" and cmd.exe runs a mangled command.
 */
export function shellCommandArgs(command: string): string[] {
  return isWindows ? ['/d', '/s', '/c', `"${command}"`] : ['-c', command]
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
  if (!isLinux || !hasBinary('bwrap')) return false
  if (sandboxCapability !== undefined) return sandboxCapability
  try {
    execFileSync('bwrap', [
      '--die-with-parent', '--new-session',
      '--ro-bind', '/usr', '/usr',
      '--ro-bind-try', '/bin', '/bin', '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
      '--dev', '/dev', '--proc', '/proc', '--unshare-net', '--', '/usr/bin/true',
    ], { stdio: 'ignore', timeout: 3000 })
    sandboxCapability = true
  } catch {
    sandboxCapability = false
  }
  return sandboxCapability
}
