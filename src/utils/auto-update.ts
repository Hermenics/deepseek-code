import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import pkg from '../../package.json' with { type: 'json' }

export interface UpdateResult {
  updated: boolean
  from?: string
  to?: string
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

export async function checkAndUpdate(): Promise<UpdateResult> {
  try {
    if (!shouldCheck()) return { updated: false }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      saveCooldown()
      return { updated: false }
    }

    const data = (await res.json()) as { version: string }
    const latest = data.version
    const current = pkg.version

    saveCooldown()

    if (latest === current) return { updated: false }

    // Detect package manager
    const isBun = typeof Bun !== 'undefined' || process.versions?.bun != null
    const pm = isBun ? 'bun' : 'npm'

    execSync(`${pm} install -g ${pkg.name}@${latest}`, {
      stdio: 'ignore',
      timeout: 30000,
    })

    return { updated: true, from: current, to: latest }
  } catch {
    saveCooldown()
    return { updated: false }
  }
}
