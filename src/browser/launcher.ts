import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { onExit } from 'signal-exit'
import { findChromium, scrubbedEnv } from '../utils/platform.js'
import { CdpConnection, pipeTransport } from './cdp.js'
import type { EgressLaunchOptions } from './egress.js'

export interface LaunchOptions extends Partial<EgressLaunchOptions> {
  /** Open a real window the user can watch and take over (needs a display); headless otherwise. */
  visible?: boolean
  /** Browser binary; defaults to the detected Chrome/Chromium/Edge/Brave. */
  executablePath?: string
  /** Explicit bot-owned Codimium profile. Ordinary sessions keep using throwaway profiles. */
  profileDirectory?: string
}

export interface LaunchedBrowser {
  connection: CdpConnection
  pid: number
  visible: boolean
  /** Resolves with the exit code when the browser process ends for any reason. */
  exited: Promise<number>
  /** Kills the browser and deletes its throwaway profile, synchronously. Idempotent. */
  kill(): void
  /** Persistent profiles need a graceful close so Chrome flushes its cookie/storage databases. */
  close?(): Promise<void>
}

/** Display variables a visible window needs; scrubbedEnv() drops them on purpose for everything else. */
const DISPLAY_ENV = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR']

/** Chrome switches: debugging over a pipe (no TCP port), an isolated profile, no background chatter. */
export function chromeArgs(profileDir: string, visible: boolean, network?: EgressLaunchOptions): string[] {
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
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    ...(network ? [
      '--enable-automation',
      `--proxy-server=${network.proxyServer}`,
      `--proxy-bypass-list=${network.proxyBypassList}`,
      `--ignore-certificate-errors-spki-list=${network.certificateSPKI}`,
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ] : []),
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--mute-audio',
    '--window-size=1280,800',
    'about:blank',
  ]
}

/**
 * Starts a browser for the agent. It gets a minimal environment (never the project's variables),
 * its own profile (never the user's browser), and is killed synchronously when this
 * process exits — closing the pipe alone does not stop Chrome.
 */
export function launchBrowser(options: LaunchOptions = {}): LaunchedBrowser {
  if (process.platform === 'win32') throw new Error('The browser tool is not supported on Windows yet.')
  const executable = options.executablePath ?? findChromium()
  if (!executable) throw new Error('No Chrome, Chromium, Edge or Brave found. Install one to use the browser tool.')
  const visible = options.visible === true
  const env = scrubbedEnv()
  if (visible) for (const key of DISPLAY_ENV) if (process.env[key]) env[key] = process.env[key]

  const persistent = options.profileDirectory !== undefined
  const profileDir = persistent ? resolve(options.profileDirectory!) : mkdtempSync(join(tmpdir(), 'deepseek-browser-'))
  if (persistent) {
    mkdirSync(profileDir, { recursive: true, mode: 0o700 })
    if (lstatSync(profileDir).isSymbolicLink()) throw new Error('Codimium profile cannot be a symbolic link')
    chmodSync(profileDir, 0o700)
  }
  let proc: ReturnType<typeof Bun.spawn>
  try {
    const network = options.proxyServer && options.proxyBypassList && options.certificateSPKI ? { proxyServer: options.proxyServer, proxyBypassList: options.proxyBypassList, certificateSPKI: options.certificateSPKI } : undefined
    proc = Bun.spawn([executable, ...chromeArgs(profileDir, visible, network)], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env })
  } catch (error) {
    if (!persistent) rmSync(profileDir, { recursive: true, force: true })
    throw new Error(`Could not start ${executable}: ${(error as Error).message}`)
  }
  const [writeFd, readFd] = [proc.stdio[3], proc.stdio[4]]
  let killed = false
  let removeExitHook = (): void => {}
  const kill = (): void => {
    if (killed) return
    killed = true
    removeExitHook()
    // The exit hook is synchronous. Persistent callers use close() to flush before normal exit.
    try { proc.kill('SIGKILL') } catch { /* already gone */ }
    if (!persistent) try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
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
    if (!persistent) try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ }
    return code
  })
  const close = persistent ? async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      void connection.send('Browser.close').catch(() => {})
      await Promise.race([exited, new Promise<void>(done => { timer = setTimeout(done, 5000) })])
    } finally { clearTimeout(timer); kill(); await exited }
  } : undefined
  return { connection, pid: proc.pid, visible, exited, kill, close }
}
