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

export async function initOAuthSession(): Promise<void> {
  await initPlaywright(true)
}

export function isOAuthReady(): boolean {
  return existsSync(OAUTH_STORAGE_PATH)
}
