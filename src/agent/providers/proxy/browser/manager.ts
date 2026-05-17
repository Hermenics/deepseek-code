import { chromium, type BrowserContext, type Browser } from 'playwright'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { loadCookies } from './cookie-store.js'
import { log } from '../config.js'

const CONFIG_DIR = join(homedir(), '.deepsproxy')
const STORAGE_PATH = process.env.STORAGE_STATE_PATH ?? join(CONFIG_DIR, 'storage-state.json')

let browser: Browser | null = null
let context: BrowserContext | null = null

export async function initBrowser(): Promise<void> {
  browser = await chromium.launch({ headless: true })

  if (existsSync(STORAGE_PATH)) {
    context = await browser.newContext({ storageState: STORAGE_PATH })
    log('info', 'Loaded storage state (cookies + localStorage)')
  } else {
    context = await browser.newContext()
    const cookies = loadCookies()
    if (cookies.length > 0) {
      await context.addCookies(cookies as Parameters<BrowserContext['addCookies']>[0])
      log('info', `Loaded ${cookies.length} cookies (legacy mode)`)
    } else {
      log('warn', 'No auth state found — requests will likely fail')
    }
  }
}

export function getBrowserContext(): BrowserContext {
  if (!context) throw new Error('Browser not initialized. Call initBrowser() first.')
  return context
}

export async function closeBrowser(): Promise<void> {
  if (context) await context.close()
  if (browser) await browser.close()
  context = null
  browser = null
}
