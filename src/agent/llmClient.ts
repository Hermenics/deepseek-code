import OpenAI from 'openai'
import type { ProviderConfig } from '../types/provider.js'
import { createBedrockFetch, createBedrockMantleFetch, modelSupportsChatCompletions } from './providers/bedrock.js'
import { createVertexFetch } from './providers/vertex.js'
import { logForDebugging } from '../utils/debug.js'

/**
 * DeepSeek's own API answers at the host root. It is the exception, and the
 * reason a bare host cannot simply be assumed to need a version segment.
 */
const DEEPSEEK_API_HOSTS = new Set(['api.deepseek.com'])

/**
 * Give a base URL the path the OpenAI client expects to find.
 *
 * The client appends `/chat/completions` to whatever it is handed, so the
 * version segment has to already be part of the base. DeepSeek's native API
 * serves at the host root and needs none; every OpenAI-compatible server —
 * vLLM, llama.cpp, LM Studio, Ollama, LiteLLM, and the hand-rolled proxies
 * people put in front of other vendors — serves under `/v1`. A host typed
 * with no path is therefore nearly always one of the latter, and leaving it
 * bare produces a bodyless 404 that says nothing about what went wrong.
 *
 * A base URL that already carries a path is left exactly as written, because
 * at that point the person has said where to go.
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return trimmed
  // People leave the scheme off far more often than they mean plain HTTP.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    // Not something we can reason about; hand it over untouched rather than
    // mangling an input we do not understand.
    return withScheme
  }

  const path = url.pathname.replace(/\/+$/, '')
  if (path !== '') return `${url.origin}${path}${url.search}`
  if (DEEPSEEK_API_HOSTS.has(url.hostname)) return `${url.origin}${url.search}`

  const normalized = `${url.origin}/v1${url.search}`
  logForDebugging(`Base URL "${trimmed}" has no path; assuming an OpenAI-compatible server and using "${normalized}"`)
  return normalized
}

/**
 * Returns an OpenAI-compatible client configured for the given provider.
 *
 * - deepseek  → api.deepseek.com (native)
 * - bedrock   → AWS Bedrock (mantle for V3.2/V3.1, InvokeModel for R1)
 * - vertex    → Google Vertex AI OpenAI-compatible endpoint
 * - local     → any OpenAI-compatible local endpoint (Ollama, LM Studio, etc.)
 */
export function createLLMClient(cfg: ProviderConfig, model?: string): OpenAI {
  switch (cfg.provider) {
    case 'bedrock': {
      const region = cfg.awsRegion ?? 'us-east-1'
      const profile = cfg.awsProfile ?? 'default'
      const resolvedModel = model ?? defaultModel('bedrock')

      // V3.2/V3.1: use bedrock-mantle (OpenAI Chat Completions with native tool calling)
      if (modelSupportsChatCompletions(resolvedModel)) {
        return new OpenAI({
          apiKey: 'bedrock',
          baseURL: `https://bedrock-mantle.${region}.api.aws/v1`,
          fetch: createBedrockMantleFetch(region, profile),
        })
      }

      // R1: use native InvokeModel (no tool calling support)
      return new OpenAI({
        apiKey: 'bedrock',
        baseURL: `https://bedrock-runtime.${region}.amazonaws.com/v1`,
        fetch: createBedrockFetch(region, profile),
      })
    }
    case 'vertex': {
      const project  = cfg.gcpProject  ?? ''
      const location = cfg.gcpLocation ?? 'us-central1'
      const credentialsPath = cfg.gcpCredentials ?? ''
      if (!credentialsPath) {
        throw new Error('Vertex AI requires a service account JSON path (GCP_CREDENTIALS)')
      }
      return new OpenAI({
        apiKey: 'vertex',
        baseURL: `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/endpoints/openapi`,
        fetch: createVertexFetch(credentialsPath),
      })
    }
    case 'local': {
      return new OpenAI({
        apiKey: 'local',
        baseURL: normalizeBaseUrl(cfg.localBaseUrl ?? 'http://localhost:11434/v1'),
      })
    }
    default: // deepseek
      return new OpenAI({
        apiKey: cfg.apiKey ?? process.env.DEEPSEEK_API_KEY,
        baseURL: normalizeBaseUrl(cfg.baseURL ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'),
      })
  }
}

/** Default model name per provider */
export function defaultModel(provider: ProviderConfig['provider']): string {
  switch (provider) {
    case 'bedrock': return 'us.deepseek.r1-v1:0'
    case 'vertex':  return 'deepseek-ai/deepseek-r1'
    case 'local':   return 'llama3'
    default:        return 'deepseek-flash'
  }
}
