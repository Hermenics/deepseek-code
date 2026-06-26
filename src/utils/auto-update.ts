import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import pkg from '../../package.json' with { type: 'json' }

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

// Fire-and-forget: checks for a newer version and installs it silently.
// Never throws, never notifies the user — next launch picks up the update.
export async function silentAutoUpdate(): Promise<void> {
  try {
    if (!shouldCheck()) return

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) { saveCooldown(); return }

    const data = (await res.json()) as { version: string }
    saveCooldown()

    if (data.version === pkg.version) return

    // ponytail: always npm — bun is the runtime, not the package manager used for global install
    const pm = 'npm'
    const { execa } = await import('execa')
    await execa(pm, ['install', '-g', `${pkg.name}@${data.version}`], { reject: false })
  } catch {
    // ponytail: swallow all errors — this runs in background, a failure is not fatal
  }
}
