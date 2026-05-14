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
 * Creates a fetch wrapper that intercepts OpenAI SDK calls and translates them
 * to native Bedrock /model/{id}/invoke or /model/{id}/invoke-with-response-stream.
 * The OpenAI-compat /v1/chat/completions endpoint is NOT supported by Bedrock.
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
    // Parse body — OpenAI SDK always passes body in init, not in the Request object
    let body: string | undefined
    if (init?.body != null) {
      body = typeof init.body === 'string' ? init.body : String(init.body)
    } else if (input instanceof Request && !input.bodyUsed) {
      body = await input.text()
    }

    // Extract model and stream flag from the OpenAI-format body
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(body ?? '{}') } catch { }

    const modelId = (parsed.model as string) ?? 'us.deepseek.r1-v1:0'
    const isStream = parsed.stream === true

    // Translate to native Bedrock endpoint
    const operation = isStream ? 'invoke-with-response-stream' : 'invoke'
    const nativeUrl = new URL(
      `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/${operation}`
    )

    // Bedrock native body: strip fields not supported by Bedrock DeepSeek
    // - "model" and "stream": handled via URL
    // - "tools" and "tool_choice": not supported by DeepSeek on Bedrock
    // - "max_completion_tokens": Bedrock uses "max_tokens" instead
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

    // Bedrock native response is already OpenAI-compatible JSON — return as-is
    return res
  }) as typeof globalThis.fetch
}
