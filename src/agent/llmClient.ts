import OpenAI from 'openai'
import type { ProviderConfig } from '../ui/setup/ApiKeySetup.js'

/**
 * Returns an OpenAI-compatible client configured for the given provider.
 *
 * - deepseek  → api.deepseek.com (native)
 * - bedrock   → AWS Bedrock OpenAI-compatible endpoint
 * - vertex    → Google Vertex AI OpenAI-compatible endpoint
 * - local     → any OpenAI-compatible local endpoint (Ollama, LM Studio, etc.)
 */
export function createLLMClient(cfg: ProviderConfig): OpenAI {
  switch (cfg.provider) {
    case 'bedrock': {
      const region = cfg.awsRegion ?? 'us-east-1'
      return new OpenAI({
        apiKey: cfg.awsAccessKeyId ?? 'bedrock',
        baseURL: `https://bedrock-runtime.${region}.amazonaws.com/model`,
        defaultHeaders: cfg.awsSecretAccessKey
          ? { 'X-Amz-Secret-Access-Key': cfg.awsSecretAccessKey }
          : undefined,
      })
    }
    case 'vertex': {
      const project  = cfg.gcpProject  ?? ''
      const location = cfg.gcpLocation ?? 'us-central1'
      return new OpenAI({
        apiKey: 'vertex',
        baseURL: `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/endpoints/openapi`,
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
    default: // deepseek
      return new OpenAI({
        apiKey: cfg.apiKey ?? process.env.DEEPSEEK_API_KEY,
        baseURL: 'https://api.deepseek.com',
      })
  }
}

/** Default model name per provider */
export function defaultModel(provider: ProviderConfig['provider']): string {
  switch (provider) {
    case 'bedrock': return 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    case 'vertex':  return 'google/gemini-2.0-flash-001'
    case 'local':   return 'llama3'
    default:        return 'deepseek-v4-flash'
  }
}
