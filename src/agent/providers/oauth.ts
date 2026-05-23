import { join } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { initPlaywright, closePlaywright, getActivePage } from './proxy/browser/playwright.js'

export const OAUTH_STORAGE_PATH = join(homedir(), '.deepseek', 'browser-profile')

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

export async function startProxy(proxyApiKey: string): Promise<void> {
  process.env.STORAGE_STATE_PATH = OAUTH_STORAGE_PATH
  process.env.PROXY_API_KEY = proxyApiKey
  process.env.PORT = '29483'
  process.env.HOST = '127.0.0.1'
  process.env.LOG_LEVEL = 'debug'

  const { startProxyServer } = await import('./proxy/index.js')
  await startProxyServer()
}

export async function waitForProxy(timeout = 150000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:3000/health')
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

export function isOAuthReady(): boolean {
  return existsSync(OAUTH_STORAGE_PATH)
}
