import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import pkg from '../../package.json' with { type: 'json' }

export const _getVersion = () => pkg.version

const COOLDOWN_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000
const DEEPSEEK_DIR = join(homedir(), '.deepseek')
const COOLDOWN_PATH = join(DEEPSEEK_DIR, 'update-cooldown')
const DISMISSED_PATH = join(DEEPSEEK_DIR, 'dismissed-update-version')

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const [main, pre] = v.split('-', 2)
    const parts = (main ?? '').split('.').map(Number)
    return { parts, pre: pre ?? null }
  }
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    if ((a.parts[i] ?? 0) > (b.parts[i] ?? 0)) return true
    if ((a.parts[i] ?? 0) < (b.parts[i] ?? 0)) return false
  }
  // Same numeric version: stable > prerelease (e.g. 1.2.3 > 1.2.3-beta.1)
  if (b.pre !== null && a.pre === null) return true
  return false
}

export async function checkForUpdate(): Promise<{ current: string; latest: string } | null> {
  try {
    const content = readFileSync(COOLDOWN_PATH, 'utf-8').trim()
    const lastCheck = parseInt(content, 10)
    if (!isNaN(lastCheck) && Date.now() - lastCheck < COOLDOWN_MS) return null
  } catch {
    // no cooldown file — proceed
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    let res: Response
    try {
      res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }

    if (!res.ok) {
      saveCooldown()
      return null
    }

    const data = (await res.json()) as { version: string }
    saveCooldown()

    const current = _getVersion()
    if (!isNewer(data.version, current)) return null

    return { current, latest: data.version }
  } catch {
    saveCooldown()
    return null
  }
}

function saveCooldown(): void {
  try {
    mkdirSync(DEEPSEEK_DIR, { recursive: true })
    writeFileSync(COOLDOWN_PATH, String(Date.now()))
  } catch {
    // ignore
  }
}

export function dismissVersion(version: string): void {
  try {
    mkdirSync(DEEPSEEK_DIR, { recursive: true })
    writeFileSync(DISMISSED_PATH, version)
  } catch {
    // ignore
  }
}

export function isDismissed(version: string): boolean {
  try {
    return readFileSync(DISMISSED_PATH, 'utf-8').trim() === version
  } catch {
    return false
  }
}
