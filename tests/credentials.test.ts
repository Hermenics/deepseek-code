import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, readFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadEnvFile,
  saveEnvFile,
  loadFullConfig,
  saveFullConfig,
  migrateConfigIfNeeded,
  SENSITIVE_KEYS,
} from '../src/utils/credentials'

let tempDir: string
let configDir: string
let configPath: string
let envPath: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepseek-cred-test-'))
  configDir = join(tempDir, '.deepseek')
  await mkdir(configDir, { recursive: true })
  configPath = join(configDir, 'config.json')
  envPath = join(configDir, '.env')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ─── DEEPSEEK_BASE_URL como chave sensível ───────────────────────

describe('SENSITIVE_KEYS', () => {
  it('deve conter DEEPSEEK_BASE_URL', () => {
    expect(SENSITIVE_KEYS.has('DEEPSEEK_BASE_URL')).toBe(true)
  })

  it('DEEPSEEK_BASE_URL deve ser salvo no .env, não no config.json', async () => {
    const data = {
      DEEPSEEK_API_KEY: 'sk-test',
      DEEPSEEK_BASE_URL: 'https://success.ai/v1',
      theme: 'dark',
    }

    await saveFullConfig(data, configPath, envPath)

    const envContent = await readFile(envPath, 'utf-8')
    expect(envContent).toContain('DEEPSEEK_BASE_URL=https://success.ai/v1')

    const configContent = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(configContent).not.toHaveProperty('DEEPSEEK_BASE_URL')
  })

  it('DEEPSEEK_BASE_URL deve ser carregado via loadFullConfig', async () => {
    await Bun.write(envPath, 'DEEPSEEK_API_KEY=sk-abc\nDEEPSEEK_BASE_URL=https://proxy.example.com/v1\n')

    const cfg = await loadFullConfig(configPath, envPath)
    expect(cfg.DEEPSEEK_BASE_URL).toBe('https://proxy.example.com/v1')
  })

  it('DEEPSEEK_BASE_URL deve ser migrado do config.json para .env', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        theme: 'dark',
        DEEPSEEK_BASE_URL: 'https://migrate.example.com/v1',
      }),
    )

    await migrateConfigIfNeeded(configPath, envPath)

    const envContent = await readFile(envPath, 'utf-8')
    expect(envContent).toContain('DEEPSEEK_BASE_URL=https://migrate.example.com/v1')

    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config).not.toHaveProperty('DEEPSEEK_BASE_URL')
  })
})

// ─── loadEnvFile ────────────────────────────────────────────────

describe('loadEnvFile', () => {
  it('should parse KEY=VALUE correctly', async () => {
    await Bun.write(envPath, 'DEEPSEEK_API_KEY=sk-abc123\nGCP_CREDENTIALS=gcp-xyz\n')

    const result = await loadEnvFile(envPath)

    expect(result).toEqual({
      DEEPSEEK_API_KEY: 'sk-abc123',
      GCP_CREDENTIALS: 'gcp-xyz',
    })
  })

  it('should ignore empty lines and comments (#)', async () => {
    await Bun.write(envPath, '# This is a comment\n\nDEEPSEEK_API_KEY=sk-abc\n\n# Another comment\n')

    const result = await loadEnvFile(envPath)

    expect(result).toEqual({ DEEPSEEK_API_KEY: 'sk-abc' })
  })

  it('should return {} if file does not exist', async () => {
    const result = await loadEnvFile(join(configDir, 'nonexistent.env'))

    expect(result).toEqual({})
  })
})

// ─── saveEnvFile ────────────────────────────────────────────────

describe('saveEnvFile', () => {
  it('should write KEY=VALUE format correctly', async () => {
    const data = { DEEPSEEK_API_KEY: 'sk-test', GCP_CREDENTIALS: 'gcp-123' }

    await saveEnvFile(envPath, data)

    const content = await readFile(envPath, 'utf-8')
    expect(content).toContain('DEEPSEEK_API_KEY=sk-test')
    expect(content).toContain('GCP_CREDENTIALS=gcp-123')
  })

  it('should set file permission to 0600', async () => {
    const data = { DEEPSEEK_API_KEY: 'sk-test' }

    await saveEnvFile(envPath, data)

    const fileStat = await stat(envPath)
    const mode = (fileStat.mode & 0o777).toString(8)
    expect(mode).toBe('600')
  })
})

// ─── loadFullConfig ─────────────────────────────────────────────

describe('loadFullConfig', () => {
  it('should merge config.json and .env into a single Record', async () => {
    await Bun.write(configPath, JSON.stringify({ model: 'deepseek-chat' }))
    await Bun.write(envPath, 'DEEPSEEK_API_KEY=sk-merged\n')

    const result = await loadFullConfig(configPath, envPath)

    expect(result).toEqual({
      model: 'deepseek-chat',
      DEEPSEEK_API_KEY: 'sk-merged',
    })
  })
})

// ─── saveFullConfig ─────────────────────────────────────────────

describe('saveFullConfig', () => {
  it('should split sensitive keys to .env and the rest to config.json', async () => {
    const data = {
      model: 'deepseek-chat',
      DEEPSEEK_API_KEY: 'sk-split',
      GCP_CREDENTIALS: 'gcp-split',
      theme: 'dark',
    }

    await saveFullConfig(data, configPath, envPath)

    const envContent = await readFile(envPath, 'utf-8')
    expect(envContent).toContain('DEEPSEEK_API_KEY=sk-split')
    expect(envContent).toContain('GCP_CREDENTIALS=gcp-split')

    const configContent = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(configContent).toEqual({ model: 'deepseek-chat', theme: 'dark' })
    expect(configContent).not.toHaveProperty('DEEPSEEK_API_KEY')
    expect(configContent).not.toHaveProperty('GCP_CREDENTIALS')
  })
})

// ─── migrateConfigIfNeeded ──────────────────────────────────────

describe('migrateConfigIfNeeded', () => {
  it('should move sensitive keys from config.json to .env', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        model: 'deepseek-chat',
        DEEPSEEK_API_KEY: 'sk-migrate',
        GCP_CREDENTIALS: 'gcp-migrate',
      }),
    )

    await migrateConfigIfNeeded(configPath, envPath)

    const envContent = await readFile(envPath, 'utf-8')
    expect(envContent).toContain('DEEPSEEK_API_KEY=sk-migrate')
    expect(envContent).toContain('GCP_CREDENTIALS=gcp-migrate')

    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config).toEqual({ model: 'deepseek-chat' })
  })

  it('should remove legacy AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY without migrating', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        model: 'deepseek-chat',
        AWS_ACCESS_KEY_ID: 'AKIA-old',
        AWS_SECRET_ACCESS_KEY: 'secret-old',
        DEEPSEEK_API_KEY: 'sk-keep',
      }),
    )

    await migrateConfigIfNeeded(configPath, envPath)

    const envContent = await readFile(envPath, 'utf-8')
    expect(envContent).toContain('DEEPSEEK_API_KEY=sk-keep')
    expect(envContent).not.toContain('AWS_ACCESS_KEY_ID')
    expect(envContent).not.toContain('AWS_SECRET_ACCESS_KEY')

    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config).not.toHaveProperty('AWS_ACCESS_KEY_ID')
    expect(config).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
  })

  it('should be idempotent (running twice produces same result)', async () => {
    await Bun.write(
      configPath,
      JSON.stringify({
        model: 'deepseek-chat',
        DEEPSEEK_API_KEY: 'sk-idem',
      }),
    )

    await migrateConfigIfNeeded(configPath, envPath)
    await migrateConfigIfNeeded(configPath, envPath)

    const envContent = await readFile(envPath, 'utf-8')
    expect(envContent).toContain('DEEPSEEK_API_KEY=sk-idem')
    const matches = envContent.match(/DEEPSEEK_API_KEY/g)
    expect(matches?.length).toBe(1)

    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config).toEqual({ model: 'deepseek-chat' })
  })

  it('should work if config.json does not exist', async () => {
    await migrateConfigIfNeeded(configPath, envPath)

    const exists = await Bun.file(configPath).exists()
    expect(exists).toBe(false)
  })
})
