/**
 * Provider readiness tests for loadSavedConfig().
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

describe('loadSavedConfig — provider readiness', () => {

  describe('Bedrock', () => {
    it('should be ready with only AWS_REGION', async () => {
      await saveFullConfig({ PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.provider).toBe('bedrock')
      expect(result.providerConfig?.awsRegion).toBe('us-east-1')
    })

    it('should be ready with AWS_REGION and AWS_PROFILE', async () => {
      await saveFullConfig({ PROVIDER: 'bedrock', AWS_REGION: 'eu-west-1', AWS_PROFILE: 'my-profile' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.awsProfile).toBe('my-profile')
    })

    it('should return null without AWS_REGION', async () => {
      await saveFullConfig({ PROVIDER: 'bedrock' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('Vertex', () => {
    it('should be ready with GCP_PROJECT and GCP_CREDENTIALS', async () => {
      await saveFullConfig({
        PROVIDER: 'vertex',
        GCP_PROJECT: 'my-project',
        GCP_LOCATION: 'us-central1',
        GCP_CREDENTIALS: '/tmp/sa.json',
      }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.gcpCredentials).toBe('/tmp/sa.json')
    })

    it('should return null with GCP_PROJECT but without GCP_CREDENTIALS', async () => {
      await saveFullConfig({
        PROVIDER: 'vertex',
        GCP_PROJECT: 'my-project',
        GCP_LOCATION: 'us-central1',
      }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })

    it('should return null without GCP_PROJECT', async () => {
      await saveFullConfig({
        PROVIDER: 'vertex',
        GCP_CREDENTIALS: '/tmp/sa.json',
      }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('DeepSeek', () => {
    it('should be ready with DEEPSEEK_API_KEY', async () => {
      await saveFullConfig({ PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-test' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.apiKey).toBe('sk-test')
    })

    it('should return null without DEEPSEEK_API_KEY', async () => {
      await saveFullConfig({ PROVIDER: 'deepseek' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('Local', () => {
    it('should be ready with LOCAL_BASE_URL', async () => {
      await saveFullConfig({
        PROVIDER: 'local',
        LOCAL_BASE_URL: 'http://localhost:11434/v1',
        LOCAL_MODEL: 'llama3',
      }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.localBaseUrl).toBe('http://localhost:11434/v1')
    })

    it('should return null without LOCAL_BASE_URL', async () => {
      await saveFullConfig({ PROVIDER: 'local' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('OAuth', () => {
    it('should be ready when the provider is oauth', async () => {
      await saveFullConfig({ PROVIDER: 'oauth' }, configPath)

      const result = await loadSavedConfigFromPath(configPath)

      expect(result.providerConfig).not.toBeNull()
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      expect(result.providerConfig?.provider as string).toBe('oauth')
    })
  })
})

// ─── Chat error message tests ────────────────────────────────────────────────

describe('formatChatError — provider-specific error messages', () => {
  async function importFormatChatError() {
    const mod = await import('../src/utils/chatError.js')
    return mod.formatChatError
  }

  it('should return a generic message for the DeepSeek provider', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('401 Unauthorized'), 'deepseek')
    expect(msg).toContain('401 Unauthorized')
    expect(msg).not.toContain('credentials')
  })

  it('should return a Bedrock-specific message for an auth error', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('UnrecognizedClientException'), 'bedrock')
    expect(msg).toContain('AWS')
    expect(msg).toContain('credentials')
  })

  it('should return a Vertex-specific message without credentials', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('GCP_CREDENTIALS'), 'vertex')
    expect(msg).toContain('GCP_CREDENTIALS')
    expect(msg).toContain('/models')
  })

  it('should return a generic message for the local provider', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('Connection refused'), 'local')
    expect(msg).toContain('Connection refused')
  })
})
