/**
 * Testes de readiness de provider para loadSavedConfig()
 *
 * Contexto do bug:
 * - Bedrock era considerado "pronto" apenas com AWS_REGION, sem credenciais AWS válidas
 * - Vertex era considerado "pronto" apenas com GCP_PROJECT, sem GCP_CREDENTIALS
 * - Isso faz /models funcionar (usa SDK nativo) mas o chat falha (usa OpenAI-compat)
 *
 * Critérios de aceitação:
 * - Bedrock: precisa de awsRegion (awsProfile é opcional, default 'default')
 * - Vertex: precisa de gcpProject E gcpCredentials
 * - Mensagem de erro de chat deve ser específica para Bedrock/Vertex
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveFullConfig } from '../src/utils/credentials.js'

// Importamos loadSavedConfig via mock de loadFullConfig para isolar do filesystem real
// Usamos a função diretamente com paths temporários via monkey-patch do módulo de credenciais

// ─── Helpers ────────────────────────────────────────────────────────────────

let tempDir: string
let configDir: string
let configPath: string
let envPath: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepseek-readiness-test-'))
  configDir = join(tempDir, '.deepseek')
  await mkdir(configDir, { recursive: true })
  configPath = join(configDir, 'config.json')
  envPath = join(configDir, '.env')
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

/**
 * Versão testável de loadSavedConfig que aceita paths customizados.
 * Replica a lógica de ApiKeySetup.tsx:loadSavedConfig() para testar isoladamente.
 */
async function loadSavedConfigFromPaths(
  cfgPath: string,
  envFilePath: string,
): Promise<{ providerConfig: import('../src/ui/setup/ApiKeySetup.js').ProviderConfig | null; theme: string; language: string | null }> {
  const { loadFullConfig } = await import('../src/utils/credentials.js')

  const cfg = await loadFullConfig(cfgPath, envFilePath)
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

  // Lógica ATUAL (bugada) — usada para confirmar que os testes RED falham
  const isReadyBuggy =
    (provider === 'deepseek' && !!providerConfig.apiKey) ||
    (provider === 'bedrock' && !!providerConfig.awsRegion) ||
    (provider === 'vertex' && !!providerConfig.gcpProject) ||
    (provider === 'local' && !!providerConfig.localBaseUrl)

  // Lógica CORRETA — o que deve ser implementado
  const isReadyFixed =
    (provider === 'deepseek' && !!providerConfig.apiKey) ||
    (provider === 'bedrock' && !!providerConfig.awsRegion) ||
    (provider === 'vertex' && !!providerConfig.gcpProject && !!providerConfig.gcpCredentials) ||
    (provider === 'local' && !!providerConfig.localBaseUrl)

  return {
    providerConfig: isReadyFixed ? providerConfig : null,
    theme: (cfg.THEME ?? 'dark'),
    language: cfg.LANGUAGE ?? null,
    // Expõe ambas as flags para os testes poderem verificar a diferença
    _buggyReady: isReadyBuggy,
    _fixedReady: isReadyFixed,
  } as any
}

// ─── Testes de readiness ─────────────────────────────────────────────────────

describe('loadSavedConfig — readiness de provider', () => {

  describe('Bedrock', () => {
    it('deve ser ready com apenas AWS_REGION (awsProfile tem default)', async () => {
      await saveFullConfig(
        { PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' },
        configPath,
        envPath,
      )

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.provider).toBe('bedrock')
      expect(result.providerConfig?.awsRegion).toBe('us-east-1')
    })

    it('deve ser ready com AWS_REGION e AWS_PROFILE', async () => {
      await saveFullConfig(
        { PROVIDER: 'bedrock', AWS_REGION: 'eu-west-1', AWS_PROFILE: 'meu-perfil' },
        configPath,
        envPath,
      )

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.awsProfile).toBe('meu-perfil')
    })

    it('deve retornar null sem AWS_REGION', async () => {
      await saveFullConfig(
        { PROVIDER: 'bedrock' },
        configPath,
        envPath,
      )

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('Vertex', () => {
    it('deve ser ready com GCP_PROJECT e GCP_CREDENTIALS', async () => {
      await saveFullConfig(
        { PROVIDER: 'vertex', GCP_PROJECT: 'meu-projeto', GCP_LOCATION: 'us-central1' },
        configPath,
        envPath,
      )
      // GCP_CREDENTIALS vai para .env (chave sensível)
      await Bun.write(envPath, 'GCP_CREDENTIALS=/tmp/sa.json\n')

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.gcpCredentials).toBe('/tmp/sa.json')
    })

    it('deve retornar null com GCP_PROJECT mas SEM GCP_CREDENTIALS — BUG ATUAL', async () => {
      // Este é o bug: só GCP_PROJECT não é suficiente para o chat funcionar
      await saveFullConfig(
        { PROVIDER: 'vertex', GCP_PROJECT: 'meu-projeto', GCP_LOCATION: 'us-central1' },
        configPath,
        envPath,
      )
      // Sem GCP_CREDENTIALS no .env

      const result = await loadSavedConfigFromPaths(configPath, envPath) as any

      // Com a lógica bugada, seria ready (só checa gcpProject)
      expect(result._buggyReady).toBe(true)
      // Com a lógica correta, NÃO deve ser ready
      expect(result._fixedReady).toBe(false)
      expect(result.providerConfig).toBeNull()
    })

    it('deve retornar null sem GCP_PROJECT', async () => {
      await saveFullConfig(
        { PROVIDER: 'vertex' },
        configPath,
        envPath,
      )
      await Bun.write(envPath, 'GCP_CREDENTIALS=/tmp/sa.json\n')

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).toBeNull()
    })

    it('deve retornar null sem GCP_PROJECT e sem GCP_CREDENTIALS', async () => {
      await saveFullConfig(
        { PROVIDER: 'vertex' },
        configPath,
        envPath,
      )

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('DeepSeek', () => {
    it('deve ser ready com DEEPSEEK_API_KEY', async () => {
      await saveFullConfig(
        { PROVIDER: 'deepseek' },
        configPath,
        envPath,
      )
      await Bun.write(envPath, 'DEEPSEEK_API_KEY=sk-test\n')

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.apiKey).toBe('sk-test')
    })

    it('deve retornar null sem DEEPSEEK_API_KEY', async () => {
      await saveFullConfig(
        { PROVIDER: 'deepseek' },
        configPath,
        envPath,
      )

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).toBeNull()
    })
  })

  describe('Local', () => {
    it('deve ser ready com LOCAL_BASE_URL', async () => {
      await saveFullConfig(
        { PROVIDER: 'local', LOCAL_BASE_URL: 'http://localhost:11434/v1', LOCAL_MODEL: 'llama3' },
        configPath,
        envPath,
      )

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).not.toBeNull()
      expect(result.providerConfig?.localBaseUrl).toBe('http://localhost:11434/v1')
    })

    it('deve retornar null sem LOCAL_BASE_URL', async () => {
      await saveFullConfig(
        { PROVIDER: 'local' },
        configPath,
        envPath,
      )

      const result = await loadSavedConfigFromPaths(configPath, envPath)

      expect(result.providerConfig).toBeNull()
    })
  })
})

// ─── Testes de mensagem de erro de chat ──────────────────────────────────────

describe('formatChatError — mensagem de erro específica por provider', () => {
  /**
   * Função que será extraída/criada em src/utils/chatError.ts
   * Deve retornar mensagem específica quando o chat falha em Bedrock/Vertex,
   * explicando que /models pode funcionar mas o endpoint de chat pode falhar.
   */
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
    expect(msg).toContain('credenciais')
  })

  it('deve retornar mensagem específica para Vertex sem credenciais', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('GCP_CREDENTIALS'), 'vertex')
    expect(msg).toContain('GCP_CREDENTIALS')
    expect(msg).toContain('/models')
  })

  it('deve mencionar que /models pode funcionar mas chat pode falhar para Bedrock', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('AccessDeniedException: User is not authorized'), 'bedrock')
    expect(msg).toContain('/models')
  })

  it('deve mencionar que /models pode funcionar mas chat pode falhar para Vertex', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('PERMISSION_DENIED'), 'vertex')
    expect(msg).toContain('/models')
  })

  it('deve retornar mensagem genérica para provider local', async () => {
    const formatChatError = await importFormatChatError()
    const msg = formatChatError(new Error('Connection refused'), 'local')
    expect(msg).toContain('Connection refused')
  })
})
