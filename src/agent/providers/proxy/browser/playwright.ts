import { chromium, type BrowserContext, type Page } from 'playwright'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'

export const BROWSER_PROFILE_PATH: string = join(homedir(), '.deepseek', 'browser-profile')

let context: BrowserContext | null = null
let activePage: Page | null = null

export async function initPlaywright(headless: boolean = true): Promise<void> {
  if (context) {
    return
  }

  await mkdir(BROWSER_PROFILE_PATH, { recursive: true })

  context = await chromium.launchPersistentContext(BROWSER_PROFILE_PATH, {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--exclude-switches=enable-automation',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })

  // Stealth: override browser fingerprint signals to avoid WAF bot detection
  await context.addInitScript(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false })

    // Fake plugins array (empty = bot signal)
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ],
    })

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en', 'pt-BR'],
    })

    // Fake window.chrome object
    ;(window as any).chrome = {
      runtime: {
        onMessage: { addListener: () => {}, removeListener: () => {} },
        sendMessage: () => {},
      },
    }
  })

  activePage = context.pages()[0] ?? (await context.newPage())
}

export async function closePlaywright(): Promise<void> {
  if (!context) {
    activePage = null
    return
  }

  await context.close()
  context = null
  activePage = null
}

export function getActivePage(): Page | null {
  return activePage
}

export function getContext(): BrowserContext | null {
  return context
}
