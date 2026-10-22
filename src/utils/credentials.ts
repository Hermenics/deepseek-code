import { homedir } from 'os'
import { join, dirname, resolve } from 'path'
import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { readJson } from './fs'
import { acquireFileLease } from '../orchestration/fileLease.js'
import { removeProviderProfiles } from './providerProfiles.js'

// ─── Paths ──────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.deepseek')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
const LEGACY_ENV_PATH = join(CONFIG_DIR, '.env')

// Legacy keys that should be removed entirely
const LEGACY_KEYS = new Set([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
])

// ─── Config I/O (everything in config.json) ─────────────────────

export async function loadFullConfig(
  configPath: string = CONFIG_PATH,
): Promise<Record<string, string>> {
  try {
    return await readJson<Record<string, string>>(configPath)
  } catch {
    return {}
  }
}

async function withConfigLock<T>(configPath: string, action: () => Promise<T>): Promise<T> {
  const lease = await acquireFileLease(`credentials-config:${resolve(configPath)}`)
  try { return await action() }
  finally { await lease.release() }
}

/** Atomically replaces the private config file (0600) through a temp file and rename. Callers must hold the config lease. */
async function writeFullConfig(data: Record<string, unknown>, configPath: string): Promise<void> {
  const dir = dirname(configPath)
  await mkdir(dir, { recursive: true })
  const temporary = `${configPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, configPath)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Atomically replaces the private config file (0600) while excluding concurrent config updates. */
export async function saveFullConfig(
  data: Record<string, string>,
  configPath: string = CONFIG_PATH,
): Promise<void> {
  await withConfigLock(configPath, () => writeFullConfig(data, configPath))
}

/** Read-modify-write config.json under the same cross-process lease used by replacements. */
export async function updateFullConfig(
  update: (config: Record<string, unknown>) => Record<string, unknown>,
  configPath: string = CONFIG_PATH,
): Promise<void> {
  await withConfigLock(configPath, async () => {
    const current = await loadFullConfig(configPath) as Record<string, unknown>
    const next = update(current)
    await writeFullConfig(next, configPath)
  })
}

// ─── Migration ──────────────────────────────────────────────────

export async function migrateConfigIfNeeded(
  configPath: string = CONFIG_PATH,
  envPath: string = LEGACY_ENV_PATH,
): Promise<void> {
  await withConfigLock(configPath, async () => {
    let config: Record<string, string>
    try {
      config = await readJson<Record<string, string>>(configPath)
    } catch {
      config = {}
    }

    // Migrate from legacy .env file into config.json
    let changed = false
    let envLoaded = false
    try {
      const { readFile } = await import('fs/promises')
      const envText = await readFile(envPath, 'utf-8')
      envLoaded = true
      for (const line of envText.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIndex = trimmed.indexOf('=')
        if (eqIndex === -1) continue
        const key = trimmed.slice(0, eqIndex).trim()
        const value = trimmed.slice(eqIndex + 1).trim()
        if (!LEGACY_KEYS.has(key) && value) {
          config[key] = value
          changed = true
        }
      }
    } catch {
      // .env doesn't exist — nothing to migrate from it
    }

    // Remove legacy keys from config
    for (const key of LEGACY_KEYS) {
      if (key in config) {
        delete config[key]
        changed = true
      }
    }

    if (changed) await writeFullConfig(config, configPath)
    // Keep the source credentials until the replacement file has committed.
    if (envLoaded) await rm(envPath).catch(() => {})
  })
}

// ─── Logout ─────────────────────────────────────────────────────

export async function logout(
  configPath: string = CONFIG_PATH,
): Promise<string[]> {
  const deleted: string[] = []
  const configDir = dirname(configPath)
  const legacyEnvPath = join(configDir, '.env')

  await withConfigLock(configPath, async () => {
    for (const filePath of [configPath, legacyEnvPath]) {
      try {
        await rm(filePath)
        deleted.push(filePath)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
    const profilePath = join(configDir, 'provider-profiles.json')
    if (await removeProviderProfiles(profilePath)) deleted.push(profilePath)
  })

  return deleted
}
