import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config.js'

const COOKIES_PATH = join(CONFIG_DIR, 'cookies.json')

export function saveCookies(cookies: unknown[]): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2))
}

export function loadCookies(): unknown[] {
  if (!existsSync(COOKIES_PATH)) return []
  try {
    return JSON.parse(readFileSync(COOKIES_PATH, 'utf-8'))
  } catch {
    return []
  }
}

export { COOKIES_PATH }
