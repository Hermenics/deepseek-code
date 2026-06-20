/**
 * Testes de readiness de provider para loadSavedConfig()
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveFullConfig, loadFullConfig } from '../src/utils/credentials.js'

let tempDir: string
let configDir: string
let configPath: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepseek-readiness-test-'))
  configDir = join(tempDir, '.deepseek')
  await mkdir(configDir, { recursive: true })
  configPath = join(configDir, 'config.json')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function loadSavedConfigFromPath(
  cfgPath: string,
): Promise<{ providerConfig: import('../src/ui/setup/ApiKeySetup.js').ProviderConfig | null; theme: string; language: string | null }> {
  const cfg = await loadFullConfig(cfgPath)
  const provider = (cfg.PROVIDER ?? 'deepseek') as import('../src/ui/setup/ApiKeySetup.js').ProviderName
  const providerConfig: import('../src/ui/setup/ApiKeySetup.js').ProviderConfig = { provider }

  if (provider === 'deepseek' && cfg.DEEPSEEK_API_KEY) providerConfig.apiKey = cfg.DEEPSEEK_API_KEY
  if (provider === 'bedrock') {
    providerConfig.awsRegion = cfg.AWS_REGION
    providerConfig.awsProfile = cfg.AWS_PROFILE
  }
  if (provider === 'vertex') {
    providerConfig.gcpProject = cfg.GCP_PROJECT
    providerConfig.gcpLocation = cfg.GCP_LOCATION
    providerConfig.gcpCredentials = cfg.GCP_CREDENTIALS
  }
  if (provider === 'local') {
    providerConfig.localBaseUrl = cfg.LOCAL_BASE_URL
    providerConfig.localModel = cfg.LOCAL_MODEL
  }

  const isReady =
    (provider === 'deepseek' && !!providerConfig.apiKey) ||
    (provider === 'bedrock' && !!providerConfig.awsRegion) ||
    (provider === 'vertex' && !!providerConfig.gcpProject && !!providerConfig.gcpCredentials) ||
    (provider === 'local' && !!providerConfig.localBaseUrl) ||
    // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
    ((provider as string) === 'oauth')

  return {
    providerConfig: isReady ? providerConfig : null,
    theme: (cfg.THEME ?? 'dark'),
    language: cfg.LANGUAGE ?? null,
  }
}

describe('loadSavedConfig — readiness de provider', () => {

  describe('Bedrock', () => {
    it('deve ser ready com apenas AWS_REGION', async () => {
      await saveFullConfig({ PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.provider).toBe('bedrock')
      expect(result.providerConfig?.awsRegion).toBe('us-east-1')
    })

    it('deve ser ready com AWS_REGION e AWS_PROFILE', async () => {
      await saveFullConfig({ PROVIDER: 'bedrock', AWS_REGION: 'eu-west-1', AWS_PROFILE: 'meu-perfil' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.awsProfile).toBe('meu-perfil')
    })

    it('deve retornar null sem AWS_REGION', async () => {
      await saveFullConfig({ PROVIDER: 'bedrock' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('Vertex', () => {
    it('deve ser ready com GCP_PROJECT e GCP_CREDENTIALS', async () => {
      await saveFullConfig({
        PROVIDER: 'vertex',
        GCP_PROJECT: 'meu-projeto',
        GCP_LOCATION: 'us-central1',
        GCP_CREDENTIALS: '/tmp/sa.json',
      }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.gcpCredentials).toBe('/tmp/sa.json')
    })

    it('deve retornar null com GCP_PROJECT mas SEM GCP_CREDENTIALS', async () => {
      await saveFullConfig({
        PROVIDER: 'vertex',
        GCP_PROJECT: 'meu-projeto',
        GCP_LOCATION: 'us-central1',
      }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })

    it('deve retornar null sem GCP_PROJECT', async () => {
      await saveFullConfig({
        PROVIDER: 'vertex',
        GCP_CREDENTIALS: '/tmp/sa.json',
      }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('DeepSeek', () => {
    it('deve ser ready com DEEPSEEK_API_KEY', async () => {
      await saveFullConfig({ PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-test' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.apiKey).toBe('sk-test')
    })

    it('deve retornar null sem DEEPSEEK_API_KEY', async () => {
      await saveFullConfig({ PROVIDER: 'deepseek' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('Local', () => {
    it('deve ser ready com LOCAL_BASE_URL', async () => {
      await saveFullConfig({
        PROVIDER: 'local',
        LOCAL_BASE_URL: 'http://localhost:11434/v1',
        LOCAL_MODEL: 'llama3',
      }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.localBaseUrl).toBe('http://localhost:11434/v1')
    })

    it('deve retornar null sem LOCAL_BASE_URL', async () => {
      await saveFullConfig({ PROVIDER: 'local' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('OAuth', () => {
    it('deve ser ready quando provider é oauth', async () => {
      await saveFullConfig({ PROVIDER: 'oauth' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      expect(result.providerConfig?.provider as string).toBe('oauth')
    })
  })
})

// ─── Testes de mensagem de erro de chat ──────────────────────────────────────

describe('formatChatError — mensagem de erro específica por provider', () => {
  async function importFormatChatError() {
    const mod = await import('../src/utils/chatError.js')
    return mod.formatChatError
  }

  it('deve retornar mensagem genérica para provider deepseek', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('401 Unauthorized'), 'deepseek')
    expect(msg).toContain('401 Unauthorized')
    expect(msg).not.toContain('credentials')
  })

  it('deve retornar mensagem específica para Bedrock com erro de auth', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('UnrecognizedClientException'), 'bedrock')
    expect(msg).toContain('AWS')
    expect(msg).toContain('credentials')
  })

  it('deve retornar mensagem específica para Vertex sem credenciais', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('GCP_CREDENTIALS'), 'vertex')
    expect(msg).toContain('GCP_CREDENTIALS')
    expect(msg).toContain('/models')
  })

  it('deve retornar mensagem genérica para provider local', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('Connection refused'), 'local')
    expect(msg).toContain('Connection refused')
  })
})
