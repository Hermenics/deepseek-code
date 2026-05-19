import type { Page } from 'playwright'
import { log } from '../config.js'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEBUG_DIR = join(homedir(), '.deepsproxy')

export async function selectModel(page: Page, uiName: string): Promise<void> {
  const modelType = uiName === 'Expert' ? 'expert' : 'default'
  const pill = page.locator(`[role="radio"][data-model-type="${modelType}"]`).first()

  if (!(await pill.isVisible({ timeout: 2000 }).catch(() => false))) {
    log('debug', `Model pill "${uiName}" not visible, using default`)
    return
  }

  const alreadyChecked = await pill.getAttribute('aria-checked').catch(() => 'false')
  if (alreadyChecked === 'true') {
    log('debug', `Model "${uiName}" already selected`)
    return
  }

  await pill.click()
  log('debug', `Model selected: "${uiName}"`)
}

export async function typeMessage(page: Page, text: string): Promise<void> {
  const textarea = page.locator('textarea').first()
  await textarea.click()
  await textarea.fill(text)
  await textarea.evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

export async function submitMessage(page: Page): Promise<void> {
  const sendBtn = page.locator('[role="button"][aria-disabled="false"].bd74640a').first()
  if (await sendBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await sendBtn.click()
    log('debug', 'Submitted via send button')
    return
  }

  const sent = await page.evaluate(() => {
    const textarea = document.querySelector('textarea')
    if (!textarea) return false
    let container: Element | null = textarea
    for (let i = 0; i < 5; i++) {
      container = container?.parentElement ?? null
      if (!container) break
      const btns = Array.from(container.querySelectorAll('[role="button"]'))
      const sendable = btns.filter((b) => {
        const text = (b.textContent || '').trim().toLowerCase()
        return !text.includes('deepthink') && !text.includes('search') &&
               b.getAttribute('aria-disabled') !== 'true' &&
               (b as HTMLElement).getBoundingClientRect().width > 0
      })
      if (sendable.length > 0) {
        (sendable[sendable.length - 1] as HTMLElement).click()
        return true
      }
    }
    return false
  })

  if (sent) {
    log('debug', 'Submitted via DOM fallback')
    return
  }

  log('debug', 'No send button found, pressing Enter')
  await page.keyboard.press('Enter')
}

export async function startNewChat(page: Page): Promise<void> {
  await page.waitForTimeout(300)

  const newChatLocator = page.getByText('New chat', { exact: true }).first()
  if (await newChatLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
    await newChatLocator.click()
    log('debug', 'New chat via getByText')
    await page.waitForTimeout(500)
    return
  }

  const textVariants = ['New chat', 'New Chat', 'Nova conversa']
  for (const text of textVariants) {
    const btn = page.locator(`[role="button"]:has-text("${text}")`).first()
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click()
      log('debug', `New chat via role=button text: "${text}"`)
      await page.waitForTimeout(500)
      return
    }
  }

  const found = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('a[href="/"], [role="button"], button'))
    for (const el of candidates) {
      const rect = (el as HTMLElement).getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0 || rect.left > 300) continue
      const svg = el.querySelector('svg')
      if (!svg) continue
      const text = (el.textContent || '').toLowerCase()
      if (text.includes('new') || text.includes('nov') || el.getAttribute('href') === '/') {
        (el as HTMLElement).click()
        return true
      }
    }
    const homeLink = document.querySelector('a[href="/"]') as HTMLElement
    if (homeLink && homeLink.getBoundingClientRect().width > 0) {
      homeLink.click()
      return true
    }
    return false
  })

  if (found) {
    log('debug', 'New chat via DOM icon/link detection')
    await page.waitForTimeout(500)
    return
  }

  try {
    await page.keyboard.press('Control+Shift+O')
    const hasTextarea = await page.locator('textarea').isVisible({ timeout: 2000 }).catch(() => false)
    if (hasTextarea) {
      log('debug', 'New chat via keyboard shortcut Ctrl+Shift+O')
      return
    }
  } catch {}

  log('debug', 'All button strategies failed, navigating via JS')
  await page.evaluate(() => {
    window.history.pushState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  const hasTextarea = await page.locator('textarea').isVisible({ timeout: 2000 }).catch(() => false)
  if (!hasTextarea) {
    log('debug', 'JS navigation failed, doing soft reload')
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 15000 })
  }
}

export async function saveDebugScreenshot(page: Page, name: string, logLevel: string): Promise<void> {
  if (logLevel !== 'debug') return
  try {
    const path = join(DEBUG_DIR, `debug-${name}.png`)
    await page.screenshot({ path })
    log('debug', `Screenshot saved: ${path}`)
  } catch {}
}
