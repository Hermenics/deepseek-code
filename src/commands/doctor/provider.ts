import { isIP } from 'node:net'
import type { ProviderConfig } from '../../types/provider.js'
import { fromEnv, fromIni } from '@aws-sdk/credential-providers'
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'
import { getVertexAccessToken } from '../../agent/providers/vertex.js'
import { checkProviderModelCatalogConnectivity, type ProviderCatalogProbes } from '../../ui/setup/deepseekHealth.js'
import { loadMergedSettings } from '../../settings/index.js'
import { loadFullConfig } from '../../utils/credentials.js'
import { loadProviderProfiles, migrateLegacyProviderProfile, type ProviderProfile } from '../../utils/providerProfiles.js'

export type ProviderProbeStatus = 'ok' | 'network-error' | 'authentication-error' | 'timeout' | 'service-error' | 'configuration-error'

export interface ProviderProbeResult {
  provider: string
  status: ProviderProbeStatus | 'not-configured'
  modelCount?: number
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type VertexTokenProvider = typeof getVertexAccessToken

export interface DoctorProviderProbeOptions {
  timeoutMs?: number
  fetchImpl?: FetchLike
  /** Replaces a provider probe for deterministic tests. */
  probes?: ProviderCatalogProbes
  /** Replaces Vertex token acquisition for deterministic tests. */
  vertexTokenProvider?: VertexTokenProvider
}

/** Resolves the selected profile, using the first saved profile only when no selection exists. */
export function selectDoctorProviderProfile(profiles: readonly ProviderProfile[], activeId?: string): ProviderProfile | null {
  if (!activeId) return profiles[0] ?? null
  const activeProfile = profiles.find(profile => profile.id === activeId)
  if (!activeProfile) throw new Error('Active provider profile is unavailable')
  return activeProfile
}

/** Reads the active provider selection without migrating or changing saved configuration. */
export async function loadDoctorProviderConfig(cwd = process.cwd()): Promise<ProviderConfig | null> {
  const [settings, credentials, profiles] = await Promise.all([
    loadMergedSettings(cwd),
    loadFullConfig(),
    loadProviderProfiles(),
  ])
  const activeId = settings.provider?.activeProfileId
  const profile = selectDoctorProviderProfile(profiles, activeId)
  if (profile) return { ...profile, profileId: profile.id }
  return migrateLegacyProviderProfile(settings, credentials)
}

/** Checks model-catalog access. A successful listing does not prove inference permission. */
export async function probeProviderCatalog(
  config: ProviderConfig | null,
  options: DoctorProviderProbeOptions = {},
): Promise<ProviderProbeResult> {
  if (!config) return { provider: 'Provider', status: 'not-configured' }
  const provider = config.provider
  const timeoutMs = options.timeoutMs ?? 10_000

  try {
    const modelCount = provider === 'deepseek'
      ? await probeDeepSeekCatalog(config, options.fetchImpl ?? globalThis.fetch, timeoutMs)
      : (await checkProviderModelCatalogConnectivity(config, {
          timeoutMs,
          probes: {
            ...options.probes,
            bedrock: options.probes?.bedrock ?? probeBedrockCatalog,
            vertex: options.probes?.vertex ?? ((value, signal) => probeVertexCatalog(
              value,
              signal,
              options.fetchImpl ?? globalThis.fetch,
              options.vertexTokenProvider ?? getVertexAccessToken,
            )),
          },
        })).length
    return { provider, status: 'ok', modelCount }
  } catch (error) {
    return { provider, status: classifyProviderError(error) }
  }
}

async function probeBedrockCatalog(config: ProviderConfig, signal: AbortSignal): Promise<string[]> {
  const credentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? fromEnv()
    : fromIni({ profile: config.awsProfile || 'default' })
  const client = new BedrockClient({ region: config.awsRegion!, credentials })
  try {
    const response = await client.send(new ListFoundationModelsCommand({}), { abortSignal: signal })
    return (response.modelSummaries ?? [])
      .map(model => model.modelId ?? '')
      .filter(model => model.toLowerCase().includes('deepseek'))
  } finally {
    client.destroy()
  }
}

async function probeVertexCatalog(
  config: ProviderConfig,
  signal: AbortSignal,
  fetchImpl: FetchLike,
  tokenProvider: VertexTokenProvider,
): Promise<string[]> {
  const location = config.gcpLocation!.trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(location)) throw new Error('Vertex configuration is incomplete')
  const normalizedLocation = location.toLowerCase()
  const token = await tokenProvider(config.gcpCredentials!, signal)
  signal.throwIfAborted()
  const host = normalizedLocation === 'global' ? 'aiplatform.googleapis.com' : `${normalizedLocation}-aiplatform.googleapis.com`
  const url = new URL('/v1beta1/publishers/deepseek-ai/models', `https://${host}`)
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) throw Object.assign(new Error('provider catalog request failed'), { status: response.status })
  const body = await response.json() as { publisherModels?: Array<{ name?: unknown }> }
  return (Array.isArray(body.publisherModels) ? body.publisherModels : [])
    .map(model => {
      if (typeof model?.name !== 'string') return ''
      const parts = model.name.split('/')
      return parts.length >= 4 ? `${parts[1]}/${parts[3]}` : model.name
    })
    .filter(Boolean)
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true
  if (isIP(normalized) === 4) return normalized.split('.')[0] === '127'
  return normalized === '::1'
}

function probeUrl(config: ProviderConfig): URL {
  const raw = config.baseURL ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
  const value = raw.trim()
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
  // Match the application's existing base-URL interpretation, then refuse
  // credentialed probes if that interpretation would use remote plaintext.
  const url = new URL(hasScheme ? value : `http://${value}`)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
    throw new Error('Provider configuration is incomplete: remote catalog endpoints must use HTTPS')
  }
  const path = url.pathname.replace(/\/+$/, '')
  if (!path && url.hostname !== 'api.deepseek.com') url.pathname = '/v1'
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`
  return url
}

async function probeDeepSeekCatalog(config: ProviderConfig, fetchImpl: FetchLike, timeoutMs: number): Promise<number> {
  const url = probeUrl(config)
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const apiKey = config.apiKey?.trim() ? config.apiKey : process.env.DEEPSEEK_API_KEY
    const response = await fetchImpl(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    })
    if (response.status === 401 || response.status === 403) throw Object.assign(new Error('provider authentication rejected'), { status: response.status })
    if (response.status === 408 || response.status === 504) throw Object.assign(new Error('provider request timed out'), { status: response.status })
    if (!response.ok) throw Object.assign(new Error('provider catalog request failed'), { status: response.status })
    const body = await response.json() as { data?: Array<{ id?: unknown }> }
    const count = Array.isArray(body.data) ? body.data.filter(item => typeof item?.id === 'string' && item.id.length > 0).length : 0
    if (count === 0) throw new Error('provider returned no model catalog entries')
    return count
  } catch (error) {
    if (timedOut) throw Object.assign(new Error('provider catalog request timed out'), { code: 'ETIMEDOUT' })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function classifyProviderError(error: unknown): ProviderProbeStatus {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const metadata = value.$metadata && typeof value.$metadata === 'object' ? value.$metadata as Record<string, unknown> : {}
  const cause = value.cause && typeof value.cause === 'object' ? value.cause as Record<string, unknown> : {}
  const status = Number(value.status ?? value.statusCode ?? metadata.httpStatusCode)
  const code = String(value.code ?? cause.code ?? value.name ?? '').toUpperCase()
  const message = error instanceof Error ? error.message : String(error)

  if (/configuration is incomplete|requires a service account|invalid url|configured local model .* was not returned|credentialsprovidererror|could not load credentials|profile .* (?:not found|could not be found|does not exist)/i.test(`${code} ${message}`) || ['ENOENT', 'EACCES', 'EISDIR'].includes(code)) return 'configuration-error'
  if ([401, 403].includes(status) || /unauthori[sz]ed|forbidden|authentication|invalid credentials?|invalid_grant|invalid_client|invalid_credential|credential(?:s)? (?:were|was|are|is) (?:rejected|invalid|expired)|access denied|accessdenied|unrecognizedclient|expiredtoken|invalidsignature|security token/i.test(`${code} ${message}`)) return 'authentication-error'
  if ([408, 504].includes(status) || /timed?\s*out|timeout|deadline exceeded|aborterror/i.test(`${code} ${message}`) || /ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/.test(code)) return 'timeout'
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNABORTED', 'UND_ERR_CONNECT'].includes(code) || /fetch failed|network error|socket hang up/i.test(message)) return 'network-error'
  if (status >= 500 || status === 429 || /no model catalog/i.test(message)) return 'service-error'
  return 'service-error'
}

/** Produces safe user-facing text; never includes a key, URL, credential path, response body or raw provider error. */
export function formatProviderProbe(result: ProviderProbeResult): { ok: boolean; detail: string } {
  if (result.status === 'ok') {
    return {
      ok: true,
      detail: `${result.provider} model catalog reachable (${result.modelCount} model${result.modelCount === 1 ? '' : 's'}); this does not confirm inference permission`,
    }
  }
  if (result.status === 'not-configured') return { ok: false, detail: 'No provider profile is configured' }
  const labels: Record<ProviderProbeStatus, string> = {
    ok: 'catalog reachable',
    'network-error': 'network connection failed',
    'authentication-error': 'provider rejected authentication',
    timeout: 'provider catalog request timed out',
    'service-error': 'provider catalog request failed',
    'configuration-error': 'provider configuration is incomplete',
  }
  return { ok: false, detail: `${result.provider}: ${labels[result.status]}` }
}
