import type { ProviderConfig } from '../../types/provider.js'
import { createLLMClient } from '../../agent/llmClient.js'
import { listBedrockDeepSeekModels } from '../../agent/providers/bedrock.js'
import { listVertexDeepSeekModels } from '../../agent/providers/vertex.js'

export type DeepSeekHealth = 'ok' | 'auth-error' | 'service-error' | 'unreachable'
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ProviderModelProbe = (config: ProviderConfig, signal: AbortSignal) => Promise<string[]>

export interface ProviderCatalogProbes {
  bedrock?: ProviderModelProbe
  vertex?: ProviderModelProbe
  local?: ProviderModelProbe
}

/** Probes api.deepseek.com/models with the key (8s timeout) and classifies the outcome as ok, auth-error (401/403), service-error or unreachable. */
export async function checkOfficialDeepSeekApi(
  apiKey: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<DeepSeekHealth> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetchImpl('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (response.ok) return 'ok'
    if (response.status === 401 || response.status === 403) return 'auth-error'
    return 'service-error'
  } catch {
    return 'unreachable'
  } finally {
    clearTimeout(timer)
  }
}

export type KeyCheckOutcome =
  | { next: 'complete' }
  | { next: 'baseUrl'; required: boolean; notice: string }
  | { next: 'error'; message: string }

/**
 * What the setup does after checking a key against the official DeepSeek API. A working key finishes
 * setup. A rejected key may belong to a proxy or gateway, so it leads to the base URL field (required,
 * since the key is useless against the official API) instead of blocking; an unreachable API leads
 * there too, with the base URL optional.
 */
export function afterKeyCheck(health: DeepSeekHealth): KeyCheckOutcome {
  switch (health) {
    case 'ok':
      return { next: 'complete' }
    case 'auth-error':
      return { next: 'baseUrl', required: true, notice: 'The official DeepSeek API rejected this key. If it belongs to a proxy or gateway, enter its base URL.' }
    case 'unreachable':
      return { next: 'baseUrl', required: false, notice: 'The official DeepSeek API could not be reached. Enter a base URL, or leave it empty to keep api.deepseek.com.' }
    case 'service-error':
      return { next: 'error', message: 'The official DeepSeek API is unavailable right now. Try again later or check your account or billing.' }
  }
}

/** Lists models through the same native/OpenAI-compatible routes used by the model picker. */
async function listProviderModels(config: ProviderConfig, signal: AbortSignal): Promise<string[]> {
  if (config.provider === 'bedrock') {
    return listBedrockDeepSeekModels(config.awsRegion!, config.awsProfile || 'default', signal)
  }
  if (config.provider === 'vertex') {
    return listVertexDeepSeekModels(config.gcpProject!, config.gcpLocation!, config.gcpCredentials!, signal)
  }

  const client = createLLMClient(config)
  const response = await client.models.list({ signal })
  const models: string[] = []
  for await (const model of response) models.push(model.id)
  return models
}

/**
 * Checks whether the selected provider's model catalog is reachable before saving the setup profile.
 * This does not test inference permission. The probe is injectable so tests never contact a provider.
 */
export async function checkProviderModelCatalogConnectivity(
  config: ProviderConfig,
  options: { probes?: ProviderCatalogProbes; timeoutMs?: number } = {},
): Promise<string[]> {
  const provider = config.provider
  if (provider === 'deepseek') throw new Error('Use the official DeepSeek API key check for this provider.')

  const missing = provider === 'bedrock'
    ? !config.awsRegion?.trim()
    : provider === 'vertex'
      ? !config.gcpProject?.trim() || !config.gcpLocation?.trim() || !config.gcpCredentials?.trim()
      : !config.localBaseUrl?.trim() || !config.localModel?.trim()
  if (missing) throw new Error(`${provider} configuration is incomplete.`)

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 10_000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const probe = options.probes?.[provider] ?? listProviderModels
    const models = await Promise.race([
      probe(config, controller.signal),
      new Promise<string[]>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error(`${provider} model catalog connectivity check timed out after ${timeoutMs}ms.${provider === 'vertex' ? ' GoogleAuth token acquisition cannot be cancelled; if it was in progress, it may continue in the background.' : ''}`))
        }, timeoutMs)
      }),
    ])
    const available = models.filter(model => typeof model === 'string' && model.trim().length > 0)
    if (available.length === 0) {
      throw new Error(`No models were returned by ${provider}; check its connection, credentials, and catalog access.`)
    }
    if (provider === 'local' && !available.includes(config.localModel!.trim())) {
      throw new Error(`Configured local model "${config.localModel}" was not returned by the local endpoint.`)
    }
    return available
  } finally {
    if (timer) clearTimeout(timer)
  }
}
