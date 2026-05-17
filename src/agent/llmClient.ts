import OpenAI from 'openai'
import type { ProviderConfig } from '../ui/setup/ApiKeySetup.js'
import { createBedrockFetch, createBedrockMantleFetch, modelSupportsChatCompletions } from './providers/bedrock.js'
import { createVertexFetch } from './providers/vertex.js'

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
      const rawUrl = cfg.localBaseUrl ?? 'http://localhost:11434/v1'
      // Ensure the URL has a scheme — users often omit http://
      const baseURL = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`
      return new OpenAI({
        apiKey: 'local',
        baseURL,
      })
    }
    case 'oauth': {
      if (!cfg.proxyApiKey) throw new Error('OAuth mode requires a proxy API key. Run deepseek logout and log in again.')
      return new OpenAI({
        apiKey: cfg.proxyApiKey,
        baseURL: 'http://127.0.0.1:3000/v1',
      })
    }
    default: // deepseek
      return new OpenAI({
        apiKey: cfg.apiKey ?? process.env.DEEPSEEK_API_KEY,
        baseURL: cfg.baseURL ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      })
  }
}

/** Default model name per provider */
export function defaultModel(provider: ProviderConfig['provider']): string {
  switch (provider) {
    case 'bedrock': return 'deepseek.deepseek-r1-v1:0'
    case 'vertex':  return 'deepseek-ai/deepseek-r1'
    case 'local':   return 'llama3'
    case 'oauth':   return 'deepseek-v4-flash'
    default:        return 'deepseek-v4-flash'
  }
}
