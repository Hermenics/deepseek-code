import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onExit } from 'signal-exit'
import { findChromium, scrubbedEnv } from '../utils/platform.js'
import { CdpConnection, pipeTransport } from './cdp.js'

export interface LaunchOptions {
  /** Open a real window the user can watch and take over (needs a display); headless otherwise. */
  visible?: boolean
  /** Browser binary; defaults to the detected Chrome/Chromium/Edge/Brave. */
  executablePath?: string
}

export interface LaunchedBrowser {
  connection: CdpConnection
  pid: number
  visible: boolean
  /** Resolves with the exit code when the browser process ends for any reason. */
  exited: Promise<number>
  /** Kills the browser and deletes its throwaway profile, synchronously. Idempotent. */
  kill(): void
}

/** Display variables a visible window needs; scrubbedEnv() drops them on purpose for everything else. */
const DISPLAY_ENV = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR']

/** Chrome switches: debugging over a pipe (no TCP port), fresh throwaway profile, no background chatter. */
export function chromeArgs(profileDir: string, visible: boolean): string[] {
  return [
    ...(visible ? [] : ['--headless']),
    '--remote-debugging-pipe',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--mute-audio',
    '--window-size=1280,800',
    'about:blank',
  ]
}

/**
 * Starts a browser for the agent. It gets a minimal environment (never the project's variables),
 * its own temporary profile (never the user's cookies), and is killed synchronously when this
 * process exits — closing the pipe alone does not stop Chrome.
 */
export function launchBrowser(options: LaunchOptions = {}): LaunchedBrowser {
  const executable = options.executablePath ?? findChromium()
  if (!executable) throw new Error('No Chrome, Chromium, Edge or Brave found. Install one to use the browser tool.')
  const visible = options.visible === true
  const env = scrubbedEnv()
  if (visible) for (const key of DISPLAY_ENV) if (process.env[key]) env[key] = process.env[key]

  const profileDir = mkdtempSync(join(tmpdir(), 'deepseek-browser-'))
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([executable, ...chromeArgs(profileDir, visible)], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env })
  } catch (error) {
    rmSync(profileDir, { recursive: true, force: true })
    throw new Error(`Could not start ${executable}: ${(error as Error).message}`)
  }
  const [writeFd, readFd] = [proc.stdio[3], proc.stdio[4]]
  let killed = false
  let removeExitHook = (): void => {}
  const kill = (): void => {
    if (killed) return
    killed = true
    removeExitHook()
    // ponytail: SIGKILL, not a graceful Browser.close — the profile is throwaway and this must also run inside a sync exit hook.
    try { proc.kill('SIGKILL') } catch { /* already gone */ }
    try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  removeExitHook = onExit(() => kill())
  if (typeof writeFd !== 'number' || typeof readFd !== 'number') {
    kill()
    throw new Error(`This Bun version (${Bun.version}) cannot open the browser debugging pipe; update Bun.`)
  }
  const connection = new CdpConnection(pipeTransport(writeFd, readFd))
  const exited = proc.exited.then(code => {
    connection.close(`browser exited with code ${code}`)
    kill()
    // Helper processes can still write to the profile between SIGKILL and exit; delete it again.
    try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
    return code
  })
  return { connection, pid: proc.pid, visible, exited, kill }
}
