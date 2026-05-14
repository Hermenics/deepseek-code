import { fromIni } from '@aws-sdk/credential-providers'
import { SignatureV4 } from '@smithy/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { Sha256 } from '@aws-crypto/sha256-js'
import { BedrockClient, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock'

export async function listBedrockDeepSeekModels(region: string, profile: string): Promise<string[]> {
  const client = new BedrockClient({
    region,
    credentials: fromIni({ profile }),
  })

  try {
    const response = await client.send(new ListInferenceProfilesCommand({}))
    const profiles = response.inferenceProfileSummaries ?? []
    return profiles
      .filter((p) => p.status === 'ACTIVE' && p.inferenceProfileId?.toLowerCase().includes('deepseek'))
      .map((p) => p.inferenceProfileId ?? '')
      .filter(Boolean)
      .sort()
  } catch (err) {
    process.stderr.write(`[bedrock] listBedrockDeepSeekModels error: ${(err as Error).message ?? err}\n`)
    return []
  }
}

/**
 * Returns true if the model supports Chat Completions via bedrock-mantle.
 * DeepSeek V3.2 and V3.1 support it; R1 does NOT.
 */
export function modelSupportsChatCompletions(model: string): boolean {
  const lower = model.toLowerCase()
  return lower.includes('v3') && !lower.includes('r1')
}

/**
 * Returns the bedrock-mantle model ID for Chat Completions endpoint.
 * Maps inference profile IDs to the mantle model IDs.
 */
function getMantleModelId(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes('v3.2') || lower.includes('v3-2')) return 'deepseek.v3.2'
  if (lower.includes('v3.1') || lower.includes('v3-v1') || lower.includes('v3-1')) return 'deepseek.v3.1'
  // Fallback: pass as-is
  return model
}

/**
 * Creates a SigV4-signed fetch for the bedrock-mantle Chat Completions endpoint.
 * This endpoint is OpenAI-compatible and supports tools natively for V3.2/V3.1.
 */
export function createBedrockMantleFetch(region: string, profile: string): typeof globalThis.fetch {
  const credentialProvider = fromIni({ profile })

  const signer = new SignatureV4({
    service: 'bedrock',
    region,
    credentials: credentialProvider,
    sha256: Sha256,
  })

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let body: string | undefined
    if (init?.body != null) {
      body = typeof init.body === 'string' ? init.body : String(init.body)
    } else if (input instanceof Request && !input.bodyUsed) {
      body = await input.text()
    }

    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(body ?? '{}') } catch { }

    // Rewrite model to mantle ID
    parsed.model = getMantleModelId((parsed.model as string) ?? '')

    const mantleHost = `bedrock-mantle.${region}.api.aws`
    const mantleUrl = new URL(`https://${mantleHost}/v1/chat/completions`)
    const mantleBody = JSON.stringify(parsed)

    const httpRequest = new HttpRequest({
      method: 'POST',
      protocol: 'https:',
      hostname: mantleHost,
      path: '/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        host: mantleHost,
      },
      body: mantleBody,
    })

    const signed = await signer.sign(httpRequest)

    const res = await globalThis.fetch(mantleUrl.toString(), {
      method: signed.method,
      headers: signed.headers,
      body: signed.body,
    })

    if (!res.ok) {
      const errText = await res.text()
      process.stderr.write(`[bedrock-mantle] HTTP ${res.status}: ${errText}\n`)
      return res
    }

    return res
  }) as typeof globalThis.fetch
}

/**
 * Creates a fetch wrapper for the native Bedrock InvokeModel endpoint.
 * Used for DeepSeek R1 which does NOT support Chat Completions.
 * Tools are stripped (handled via prompt-based injection in agent.ts).
 */
export function createBedrockFetch(region: string, profile: string): typeof globalThis.fetch {
  const credentialProvider = fromIni({ profile })

  const signer = new SignatureV4({
    service: 'bedrock',
    region,
    credentials: credentialProvider,
    sha256: Sha256,
  })

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let body: string | undefined
    if (init?.body != null) {
      body = typeof init.body === 'string' ? init.body : String(init.body)
    } else if (input instanceof Request && !input.bodyUsed) {
      body = await input.text()
    }

    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(body ?? '{}') } catch { }

    const modelId = (parsed.model as string) ?? 'us.deepseek.r1-v1:0'
    const isStream = parsed.stream === true

    const operation = isStream ? 'invoke-with-response-stream' : 'invoke'
    const nativeUrl = new URL(
      `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/${operation}`
    )

    // Strip fields not supported by native Bedrock DeepSeek R1
    const { model: _m, stream: _s, tools: _t, tool_choice: _tc, max_completion_tokens, ...rest } = parsed
    const bedrockBody: Record<string, unknown> = { ...rest }
    if (max_completion_tokens && !bedrockBody.max_tokens) bedrockBody.max_tokens = max_completion_tokens
    const nativeBody = JSON.stringify(bedrockBody)

    const httpRequest = new HttpRequest({
      method: 'POST',
      protocol: nativeUrl.protocol,
      hostname: nativeUrl.hostname,
      path: nativeUrl.pathname,
      headers: {
        'content-type': 'application/json',
        host: nativeUrl.hostname,
      },
      body: nativeBody,
    })

    const signed = await signer.sign(httpRequest)

    const res = await globalThis.fetch(nativeUrl.toString(), {
      method: signed.method,
      headers: signed.headers,
      body: signed.body,
    })

    if (!res.ok) {
      const errText = await res.text()
      process.stderr.write(`[bedrock] HTTP ${res.status}: ${errText}\n`)
      return res
    }

    return res
  }) as typeof globalThis.fetch
}
