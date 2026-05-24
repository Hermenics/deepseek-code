import { join, dirname } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { initPlaywright, closePlaywright, getActivePage } from './proxy/browser/playwright.js'

export const OAUTH_STORAGE_PATH = join(homedir(), '.deepseek', 'browser-profile')
const PROXY_PORT_BASE = 19816
const PROXY_PORT_RANGE = 10
const PROXY_IDENTIFIER = 'DeepSproxy is running'

let activeProxyPort: number | null = null

export function getProxyPort(): number {
  return activeProxyPort ?? PROXY_PORT_BASE
}

export function installPlaywright(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['playwright', 'install', 'chromium'], {
      stdio: 'ignore',
      shell: true,
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Playwright install failed (exit ${code})`))))
    child.on('error', reject)
  })
}

export async function runOAuthLogin(): Promise<void> {
  await initPlaywright(false)

  const page = getActivePage()
  if (!page) {
    await closePlaywright()
    throw new Error('Failed to initialize browser page')
  }

  await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' })

  try {
    await page.waitForFunction(
      () => !window.location.pathname.includes('sign_in') && !!document.querySelector('textarea'),
      { timeout: 300_000 }
    )
    await page.waitForTimeout(3000)
  } catch {
    throw new Error('Login timeout — please try again')
  } finally {
    await closePlaywright()
  }
}

async function isOurProxy(port: number): Promise<'ours' | 'other' | 'free'> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return 'other'
    const data = await res.json() as { status?: string; message?: string }
    if (data.status === 'healthy' || data.message?.includes(PROXY_IDENTIFIER)) return 'ours'
    return 'other'
  } catch {
    return 'free'
  }
}

async function waitForPortHealth(port: number, timeout = 15000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const status = await isOurProxy(port)
    if (status === 'ours') return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function spawnProxyDaemon(port: number, proxyApiKey: string): Promise<void> {
  const startScript = join(dirname(fileURLToPath(import.meta.url)), 'proxy', 'start.ts')
  const child = spawn('bun', ['run', startScript], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      PROXY_API_KEY: proxyApiKey,
      STORAGE_STATE_PATH: OAUTH_STORAGE_PATH,
      LOG_LEVEL: 'info',
    },
  })
  child.unref()
}

async function findOrStartProxy(proxyApiKey: string): Promise<number> {
  for (let port = PROXY_PORT_BASE; port < PROXY_PORT_BASE + PROXY_PORT_RANGE; port++) {
    const status = await isOurProxy(port)
    if (status === 'ours') return port
  }

  for (let port = PROXY_PORT_BASE; port < PROXY_PORT_BASE + PROXY_PORT_RANGE; port++) {
    const status = await isOurProxy(port)
    if (status !== 'free') continue
    await spawnProxyDaemon(port, proxyApiKey)
    const ok = await waitForPortHealth(port, 15000)
    if (ok) return port
  }

  throw new Error(`No available port in range ${PROXY_PORT_BASE}-${PROXY_PORT_BASE + PROXY_PORT_RANGE - 1}`)
}

export async function startProxy(proxyApiKey: string): Promise<void> {
  activeProxyPort = await findOrStartProxy(proxyApiKey)
}

export async function waitForProxy(timeout = 15000): Promise<boolean> {
  return waitForPortHealth(getProxyPort(), timeout)
}

export function isOAuthReady(): boolean {
  return existsSync(OAUTH_STORAGE_PATH)
}
