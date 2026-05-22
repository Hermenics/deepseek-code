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
      '--exclude-switches=enable-automation',
      '--disable-infobars',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
