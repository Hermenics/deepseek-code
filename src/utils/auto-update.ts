import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import pkg from '../../package.json' with { type: 'json' }

export interface UpdateResult {
  updateAvailable: boolean
  current: string
  latest?: string
  message?: string
}

const COOLDOWN_MS = 60 * 60 * 1000 // 1 hour
const FETCH_TIMEOUT_MS = 5000

function getCooldownPath(): string {
  return join(homedir(), '.deepseek', 'last-update-check')
}

function shouldCheck(): boolean {
  try {
    const content = readFileSync(getCooldownPath(), 'utf-8').trim()
    const lastCheck = parseInt(content, 10)
    if (isNaN(lastCheck)) return true
    return Date.now() - lastCheck >= COOLDOWN_MS
  } catch {
    return true // file doesn't exist = never checked
  }
}

function saveCooldown(): void {
  try {
    const dir = join(homedir(), '.deepseek')
    mkdirSync(dir, { recursive: true })
    writeFileSync(getCooldownPath(), String(Date.now()))
  } catch {
    // ignore
  }
}

export async function checkForUpdate(): Promise<UpdateResult> {
  const current = pkg.version

  try {
    if (!shouldCheck()) return { updateAvailable: false, current }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      saveCooldown()
      return { updateAvailable: false, current }
    }

    const data = (await res.json()) as { version: string }
    const latest = data.version

    saveCooldown()

    if (latest === current) return { updateAvailable: false, current, latest }

    return {
      updateAvailable: true,
      current,
      latest,
      message: `Update available: v${latest}. Run 'npm install -g ${pkg.name}@${latest}' to update.`,
    }
  } catch {
    saveCooldown()
    return { updateAvailable: false, current }
  }
}
