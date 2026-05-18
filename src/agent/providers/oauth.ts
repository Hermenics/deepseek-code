import { join } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { chromium } from 'playwright'

export const OAUTH_STORAGE_PATH = join(homedir(), '.deepseek', 'oauth-storage.json')

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
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('https://chat.deepseek.com')

  try {
    await page.waitForFunction(
      () => !window.location.pathname.includes('sign_in') && !!document.querySelector('textarea'),
      { timeout: 300_000 }
    )
  } catch {
    await browser.close()
    throw new Error('Login timeout — please try again')
  }

  await page.waitForTimeout(3000)

  const storageDir = join(homedir(), '.deepseek')
  if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true })
  const storageState = await context.storageState()
  writeFileSync(OAUTH_STORAGE_PATH, JSON.stringify(storageState, null, 2))

  await browser.close()
}

export async function startProxy(proxyApiKey: string): Promise<void> {
  process.env.STORAGE_STATE_PATH = OAUTH_STORAGE_PATH
  process.env.PROXY_API_KEY = proxyApiKey
  process.env.PORT = '3000'
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
