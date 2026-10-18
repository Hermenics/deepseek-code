import { describe, expect, it } from 'bun:test'
import { checkOfficialDeepSeekApi, checkProviderModelCatalogConnectivity } from '../src/ui/setup/deepseekHealth.js'
import type { ProviderConfig } from '../src/types/provider.js'

describe('official DeepSeek health check', () => {
  it('sends the API key and accepts a healthy response', async () => {
    let authorization = ''
    const result = await checkOfficialDeepSeekApi('secret-key', async (_input, init) => {
      authorization = String(new Headers(init?.headers).get('authorization'))
      return new Response('{}', { status: 200 })
    })
    expect(result).toBe('ok')
    expect(authorization).toBe('Bearer secret-key')
  })

  it('distinguishes invalid credentials from an unreachable endpoint', async () => {
    expect(await checkOfficialDeepSeekApi('bad', async () => new Response('', { status: 401 }))).toBe('auth-error')
    expect(await checkOfficialDeepSeekApi('forbidden', async () => new Response('', { status: 403 }))).toBe('auth-error')
    expect(await checkOfficialDeepSeekApi('offline', async () => { throw new Error('offline') })).toBe('unreachable')
  })

  it.each([402, 429, 500, 503])('classifies HTTP %i as a service error', async (status) => {
    expect(await checkOfficialDeepSeekApi('service-failure', async () => new Response('', { status }))).toBe('service-error')
  })
})

describe('first-run model-catalog connectivity', () => {
  it('accepts Bedrock only after its model probe returns an available model', async () => {
    const config = { provider: 'bedrock' as const, awsRegion: 'us-east-1', awsProfile: 'fixture-profile' }
    const probe = async (received: ProviderConfig) => {
      expect(received).toEqual(config)
      return ['us.deepseek.r1-v1:0']
    }

    await expect(checkProviderModelCatalogConnectivity(config, { probes: { bedrock: probe } }))
      .resolves.toEqual(['us.deepseek.r1-v1:0'])
  })

  it('accepts Vertex only after its model probe returns an available model', async () => {
    const config = {
      provider: 'vertex' as const,
      gcpProject: 'fixture-project',
      gcpLocation: 'us-central1',
      gcpCredentials: '/fixture/service-account.json',
    }
    const probe = async (received: ProviderConfig) => {
      expect(received).toEqual(config)
      return ['deepseek-ai/deepseek-r1']
    }

    await expect(checkProviderModelCatalogConnectivity(config, { probes: { vertex: probe } }))
      .resolves.toEqual(['deepseek-ai/deepseek-r1'])
  })

  it('accepts a local endpoint only after its model probe returns an available model', async () => {
    const config = { provider: 'local' as const, localBaseUrl: 'http://127.0.0.1:11434/v1', localModel: 'llama3' }
    const probe = async (received: ProviderConfig) => {
      expect(received).toEqual(config)
      return ['llama3']
    }

    await expect(checkProviderModelCatalogConnectivity(config, { probes: { local: probe } }))
      .resolves.toEqual(['llama3'])
  })

  it('rejects a local endpoint whose catalog omits the configured model', async () => {
    await expect(checkProviderModelCatalogConnectivity(
      { provider: 'local', localBaseUrl: 'http://127.0.0.1:11434/v1', localModel: 'llama3' },
      { probes: { local: async () => ['mistral'] } },
    )).rejects.toThrow('Configured local model "llama3" was not returned')
  })

  it('rejects an empty model catalog for every supported provider', async () => {
    await expect(checkProviderModelCatalogConnectivity(
      { provider: 'bedrock', awsRegion: 'us-east-1' },
      { probes: { bedrock: async () => [] } },
    )).rejects.toThrow('No models were returned')
    await expect(checkProviderModelCatalogConnectivity(
      { provider: 'vertex', gcpProject: 'fixture-project', gcpLocation: 'us-central1', gcpCredentials: '/fixture/sa.json' },
      { probes: { vertex: async () => [] } },
    )).rejects.toThrow('No models were returned')
    await expect(checkProviderModelCatalogConnectivity(
      { provider: 'local', localBaseUrl: 'http://127.0.0.1:11434/v1', localModel: 'llama3' },
      { probes: { local: async () => [] } },
    )).rejects.toThrow('No models were returned')
  })

  it('rejects incomplete provider configuration before invoking a probe', async () => {
    let called = false
    await expect(checkProviderModelCatalogConnectivity(
      { provider: 'vertex', gcpProject: 'fixture-project' },
      { probes: { vertex: async () => { called = true; return ['deepseek-ai/deepseek-r1'] } } },
    )).rejects.toThrow('configuration is incomplete')
    expect(called).toBe(false)
  })

  it('aborts a timed-out probe and reports the GoogleAuth cancellation limit for Vertex', async () => {
    let signal: AbortSignal | undefined
    await expect(checkProviderModelCatalogConnectivity(
      { provider: 'vertex', gcpProject: 'fixture-project', gcpLocation: 'us-central1', gcpCredentials: '/fixture/sa.json' },
      { timeoutMs: 1, probes: { vertex: async (_config, receivedSignal) => {
        signal = receivedSignal
        return await new Promise<string[]>(() => {})
      } } },
    )).rejects.toThrow('GoogleAuth token acquisition cannot be cancelled')
    expect(signal?.aborted).toBe(true)
  })
})
