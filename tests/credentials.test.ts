import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadFullConfig,
  saveFullConfig,
  migrateConfigIfNeeded,
} from '../src/utils/credentials'

let tempDir: string
let configDir: string
let configPath: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepseek-cred-test-'))
  configDir = join(tempDir, '.deepseek')
  await mkdir(configDir, { recursive: true })
  configPath = join(configDir, 'config.json')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ─── loadFullConfig ─────────────────────────────────────────────

describe('loadFullConfig', () => {
  it('should load all keys from config.json', async () => {
    await Bun.write(configPath, JSON.stringify({
      PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-abc123',
      DEEPSEEK_BASE_URL: 'https://proxy.example.com/v1',
      THEME: 'dark',
    }))

    const result = await loadFullConfig(configPath)

    expect(result).toEqual({
      PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-abc123',
      DEEPSEEK_BASE_URL: 'https://proxy.example.com/v1',
      THEME: 'dark',
    })
  })

  it('should return {} if config.json does not exist', async () => {
    const result = await loadFullConfig(join(configDir, 'nonexistent.json'))
    expect(result).toEqual({})
  })
})

// ─── saveFullConfig ─────────────────────────────────────────────

describe('saveFullConfig', () => {
  it('should save all keys to config.json', async () => {
    const data = {
      PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'sk-split',
      GCP_CREDENTIALS: 'gcp-split',
      THEME: 'dark',
    }

    await saveFullConfig(data, configPath)

    const content = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(content).toEqual(data)
  })

  it('should create directory if it does not exist', async () => {
    const nestedPath = join(tempDir, 'nested', 'dir', 'config.json')

    await saveFullConfig({ PROVIDER: 'local' }, nestedPath)

    const content = JSON.parse(await readFile(nestedPath, 'utf-8'))
    expect(content).toEqual({ PROVIDER: 'local' })
  })
})

// ─── migrateConfigIfNeeded ──────────────────────────────────────

describe('migrateConfigIfNeeded', () => {
  it('should migrate keys from legacy .env into config.json', async () => {
    const envPath = join(configDir, '.env')
    await Bun.write(configPath, JSON.stringify({ PROVIDER: 'deepseek', THEME: 'dark' }))
    await Bun.write(envPath, 'DEEPSEEK_API_KEY=sk-migrate\nDEEPSEEK_BASE_URL=https://proxy.com/v1\n')

    await migrateConfigIfNeeded(configPath, envPath)

    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config.DEEPSEEK_API_KEY).toBe('sk-migrate')
    expect(config.DEEPSEEK_BASE_URL).toBe('https://proxy.com/v1')
    expect(config.PROVIDER).toBe('deepseek')
    expect(config.THEME).toBe('dark')

    // .env should be deleted
    const envExists = await Bun.file(envPath).exists()
    expect(envExists).toBe(false)
  })

  it('should remove legacy AWS keys without migrating', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        PROVIDER: 'bedrock',
        AWS_ACCESS_KEY_ID: 'AKIA-old',
        AWS_SECRET_ACCESS_KEY: 'secret-old',
        AWS_REGION: 'us-east-1',
      }),
    )

    await migrateConfigIfNeeded(configPath)

    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config).not.toHaveProperty('AWS_ACCESS_KEY_ID')
    expect(config).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(config.AWS_REGION).toBe('us-east-1')
  })

  it('should be idempotent (running twice produces same result)', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({ PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-idem' }),
    )

    await migrateConfigIfNeeded(configPath)
    await migrateConfigIfNeeded(configPath)

    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config.DEEPSEEK_API_KEY).toBe('sk-idem')
  })

  it('should work if config.json does not exist', async () => {
    await migrateConfigIfNeeded(configPath)

    const exists = await Bun.file(configPath).exists()
    expect(exists).toBe(false)
  })
})
