import { homedir } from 'os'
import { join, dirname } from 'path'
import { chmod, mkdir, readFile, rm } from 'fs/promises'
import { readJson, writeRaw } from './fs'

// ─── Paths ──────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.deepseek')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
const ENV_PATH = join(CONFIG_DIR, '.env')

// ─── Sensitive keys ─────────────────────────────────────────────

export const SENSITIVE_KEYS = new Set([
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'GCP_CREDENTIALS',
])

// Legacy keys that should be removed without migrating to .env
const LEGACY_KEYS = new Set([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
])

// ─── .env file I/O ──────────────────────────────────────────────

export async function loadEnvFile(envPath: string = ENV_PATH): Promise<Record<string, string>> {
  try {
    const text = await readFile(envPath, 'utf-8')
    const result: Record<string, string> = {}

    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex)
      const value = trimmed.slice(eqIndex + 1)
      result[key] = value
    }

    return result
  } catch {
    // File does not exist or cannot be read
    return {}
  }
}

export async function saveEnvFile(envPath: string = ENV_PATH, data: Record<string, string>): Promise<void> {
  const dir = dirname(envPath)
  await mkdir(dir, { recursive: true })

  const lines = Object.entries(data).map(([k, v]) => `${k}=${v}`)
  const content = lines.join('\n') + '\n'

  await writeRaw(envPath, content)
  await chmod(envPath, 0o600)
}

// ─── Full config (config.json + .env) ───────────────────────────

export async function loadFullConfig(
  configPath: string = CONFIG_PATH,
  envPath: string = ENV_PATH,
): Promise<Record<string, string>> {
  let jsonData: Record<string, string> = {}
  try {
    jsonData = await readJson<Record<string, string>>(configPath)
  } catch {
    // config.json does not exist
  }

  const envData = await loadEnvFile(envPath)
  return { ...jsonData, ...envData }
}

export async function saveFullConfig(
  data: Record<string, string>,
  configPath: string = CONFIG_PATH,
  envPath: string = ENV_PATH,
): Promise<void> {
  const sensitive: Record<string, string> = {}
  const plain: Record<string, string> = {}

  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key)) {
      sensitive[key] = value
    } else {
      plain[key] = value
    }
  }

  await saveEnvFile(envPath, sensitive)

  const dir = dirname(configPath)
  await mkdir(dir, { recursive: true })
  await writeRaw(configPath, JSON.stringify(plain, null, 2))
}

// ─── Migration ──────────────────────────────────────────────────

export async function migrateConfigIfNeeded(
  configPath: string = CONFIG_PATH,
  envPath: string = ENV_PATH,
): Promise<void> {
  let config: Record<string, string>
  try {
    config = await readJson<Record<string, string>>(configPath)
  } catch {
    // config.json does not exist — nothing to migrate
    return
  }

  const toEnv: Record<string, string> = {}
  let changed = false

  for (const key of Object.keys(config)) {
    if (LEGACY_KEYS.has(key)) {
      // Remove without migrating
      delete config[key]
      changed = true
    } else if (SENSITIVE_KEYS.has(key)) {
      // Move to .env
      toEnv[key] = config[key]
      delete config[key]
      changed = true
    }
  }

  if (!changed) return

  // Load existing .env for merge (idempotency)
  const existingEnv = await loadEnvFile(envPath)
  const mergedEnv = { ...existingEnv, ...toEnv }

  // Write .env first, then config.json
  await saveEnvFile(envPath, mergedEnv)
  await writeRaw(configPath, JSON.stringify(config, null, 2))
}

// ─── Logout ─────────────────────────────────────────────────────

export async function logout(
  configPath: string = CONFIG_PATH,
  envPath: string = ENV_PATH,
): Promise<string[]> {
  const deleted: string[] = []

  for (const filePath of [configPath, envPath]) {
    try {
      await rm(filePath)
      deleted.push(filePath)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  return deleted
}
