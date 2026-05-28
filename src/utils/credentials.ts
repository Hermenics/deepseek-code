import { homedir } from 'os'
import { join, dirname } from 'path'
import { mkdir, rm } from 'fs/promises'
import { randomBytes } from 'crypto'
import { readJson, writeRaw } from './fs'

// ─── Paths ──────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.deepseek')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
const LEGACY_ENV_PATH = join(CONFIG_DIR, '.env')
const OAUTH_STORAGE = join(CONFIG_DIR, 'oauth-storage.json')

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

export async function saveFullConfig(
  data: Record<string, string>,
  configPath: string = CONFIG_PATH,
): Promise<void> {
  const dir = dirname(configPath)
  await mkdir(dir, { recursive: true })
  await writeRaw(configPath, JSON.stringify(data, null, 2))
}

// ─── Migration ──────────────────────────────────────────────────

export async function migrateConfigIfNeeded(
  configPath: string = CONFIG_PATH,
  envPath: string = LEGACY_ENV_PATH,
): Promise<void> {
  let config: Record<string, string>
  try {
    config = await readJson<Record<string, string>>(configPath)
  } catch {
    config = {}
  }

  // Migrate from legacy .env file into config.json
  let changed = false
  try {
    const { readFile } = await import('fs/promises')
    const envText = await readFile(envPath, 'utf-8')
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
    // Delete the old .env after migrating
    await rm(envPath).catch(() => {})
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

  if (changed) {
    await saveFullConfig(config, configPath)
  }
}

// ─── Proxy API Key ──────────────────────────────────────────────

export function generateProxyApiKey(): string {
  return randomBytes(32).toString('hex')
}

export async function getOrCreateProxyApiKey(
  configPath: string = CONFIG_PATH,
): Promise<string> {
  const config = await loadFullConfig(configPath)
  if (config.PROXY_API_KEY) return config.PROXY_API_KEY
  const key = generateProxyApiKey()
  await saveFullConfig({ ...config, PROXY_API_KEY: key }, configPath)
  return key
}

// ─── Logout ─────────────────────────────────────────────────────

export async function logout(
  configPath: string = CONFIG_PATH,
): Promise<string[]> {
  const deleted: string[] = []
  const configDir = dirname(configPath)
  const legacyEnvPath = join(configDir, '.env')
  const oauthStoragePath = join(configDir, 'oauth-storage.json')
  const browserProfilePath = join(homedir(), '.deepseek', 'browser-profile')

  for (const filePath of [configPath, legacyEnvPath, oauthStoragePath]) {
    try {
      await rm(filePath)
      deleted.push(filePath)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  try {
    await rm(browserProfilePath, { recursive: true })
    deleted.push(browserProfilePath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  return deleted
}
