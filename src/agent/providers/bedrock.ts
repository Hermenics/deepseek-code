import { fromIni, fromEnv } from '@aws-sdk/credential-providers'
import { SignatureV4 } from '@smithy/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { Sha256 } from '@aws-crypto/sha256-js'
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'

function resolveCredentials(profile: string) {
  // Use env vars when full credentials are avaiable (ex: temporary STSs)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return fromEnv()
  return fromIni({ profile })
}

export async function listBedrockDeepSeekModels(region: string, profile: string): Promise<string[]> {
  const client = new BedrockClient({
    region,
    credentials: resolveCredentials(profile),
  })

  try {
    const response = await client.send(new ListFoundationModelsCommand({}))
    const models = response.modelSummaries ?? []
    return models
      .filter((m) => m.modelId?.toLowerCase().includes('deepseek'))
      .map((m) => m.modelId ?? '')
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
  const credentialProvider = resolveCredentials(profile)

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
      signal: init?.signal,
    })

    if (!res.ok) {
      const errText = await res.text()
      process.stderr.write(`[bedrock-mantle] HTTP ${res.status}: ${errText}\n`)
      return res
    }

    return res
  }) as typeof globalThis.fetch
}

// ── AWS event stream → SSE bridge ────────────────────────────────────────────
// invoke-with-response-stream answers in binary AWS event-stream framing,
// which the OpenAI SDK cannot parse. We decode the frames and re-emit them as
// standard OpenAI SSE chunks so the normal streaming path just works.

/**
 * Extracts complete frame payloads from an accumulating event-stream buffer.
 * Frame layout: [4B total len][4B headers len][4B prelude CRC][headers][payload][4B CRC].
 * ponytail: CRCs not validated — TLS already guarantees integrity on this hop.
 */
export function extractEventStreamPayloads(buf: Uint8Array): { payloads: string[]; rest: Uint8Array } {
  const payloads: string[] = []
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let offset = 0
  while (buf.byteLength - offset >= 16) {
    const totalLen = view.getUint32(offset)
    if (totalLen < 16 || buf.byteLength - offset < totalLen) break
    const headersLen = view.getUint32(offset + 4)
    const payloadStart = offset + 12 + headersLen
    const payloadEnd = offset + totalLen - 4
    if (payloadEnd > payloadStart) {
      payloads.push(new TextDecoder().decode(buf.subarray(payloadStart, payloadEnd)))
    }
    offset += totalLen
  }
  return { payloads, rest: buf.subarray(offset) }
}

/**
 * Maps one decoded Bedrock chunk to an OpenAI streaming chunk.
 * Tolerant to the shapes Bedrock models emit: OpenAI delta (passthrough),
 * chat message, native `text`, or `generation`. Returns null for
 * unrecognized housekeeping payloads.
 */
export function bedrockChunkToOpenAiChunk(payload: string, model: string): Record<string, unknown> | null {
  let outer: Record<string, unknown>
  try { outer = JSON.parse(payload) } catch { return null }

  // Exception event payloads carry a bare `message`
  if (typeof outer.message === 'string' && !outer.bytes && !outer.choices) {
    throw new Error(`Bedrock stream exception: ${outer.message}`)
  }

  let decoded: Record<string, unknown> = outer
  if (typeof outer.bytes === 'string') {
    try { decoded = JSON.parse(Buffer.from(outer.bytes, 'base64').toString('utf8')) } catch { return null }
  }

  const choice = (decoded.choices as Array<Record<string, unknown>>)?.[0]
  const metrics = decoded['amazon-bedrock-invocationMetrics'] as Record<string, number> | undefined
  const usage = metrics
    ? {
        prompt_tokens: metrics.inputTokenCount ?? 0,
        completion_tokens: metrics.outputTokenCount ?? 0,
        total_tokens: (metrics.inputTokenCount ?? 0) + (metrics.outputTokenCount ?? 0),
      }
    : undefined

  if (choice?.delta) {
    if (usage) (decoded as Record<string, unknown>).usage = usage
    return decoded
  }

  let delta: Record<string, unknown> | null = null
  const msg = choice?.message as Record<string, unknown> | undefined
  if (msg) {
    delta = { content: msg.content ?? '' }
    if (msg.reasoning_content) delta.reasoning_content = msg.reasoning_content
  } else if (typeof choice?.text === 'string') {
    delta = { content: choice.text }
  } else if (typeof decoded.generation === 'string') {
    delta = { content: decoded.generation }
  }
  if (!delta && !usage) return null

  const finish = (choice?.stop_reason ?? choice?.finish_reason ?? null) as string | null
  return {
    id: 'bedrock-stream',
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta: delta ?? {}, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  }
}

/** Converts a binary event-stream body into an OpenAI SSE body. */
export function eventStreamToSse(body: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const reader = body.getReader()
  let buffer: Uint8Array = new Uint8Array(0)

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Loop until something is enqueued: a read may end mid-frame, and a
        // pull that enqueues nothing would stall the stream.
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            if (buffer.byteLength > 0) {
              process.stderr.write(`[bedrock] discarded ${buffer.byteLength} bytes of an incomplete event-stream frame\n`)
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          }
          const merged = new Uint8Array(buffer.byteLength + value.byteLength)
          merged.set(buffer)
          merged.set(value, buffer.byteLength)
          const { payloads, rest } = extractEventStreamPayloads(merged)
          buffer = rest
          let emitted = false
          for (const payload of payloads) {
            const chunk = bedrockChunkToOpenAiChunk(payload, model)
            if (chunk) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
              emitted = true
            }
          }
          if (emitted) return
        }
      } catch (err) {
        // Release the upstream body, then fail the stream with the original
        // error so the consumer sees the real message (e.g. a throttle).
        await reader.cancel(err).catch(() => {})
        throw err
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/**
 * Creates a fetch wrapper for the native Bedrock InvokeModel endpoint.
 * Used for DeepSeek R1 which does NOT support Chat Completions.
 * Tools are stripped (handled via prompt-based injection in agent.ts).
 */
export function createBedrockFetch(region: string, profile: string): typeof globalThis.fetch {
  const credentialProvider = resolveCredentials(profile)

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
    const { model: _m, stream: _s, stream_options: _so, tools: _t, tool_choice: _tc, max_completion_tokens, ...rest } = parsed
    const bedrockBody: Record<string, unknown> = { ...rest }
    if (max_completion_tokens && !bedrockBody.max_tokens) bedrockBody.max_tokens = max_completion_tokens
    if (!bedrockBody.max_tokens) bedrockBody.max_tokens = 32768
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
      signal: init?.signal,
    })

    if (!res.ok) {
      const errText = await res.text()
      process.stderr.write(`[bedrock] HTTP ${res.status}: ${errText}\n`)
      return res
    }

    // Streaming: bridge the binary AWS event stream to OpenAI SSE
    if (isStream && res.body) {
      return new Response(eventStreamToSse(res.body, modelId), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }

    return res
  }) as typeof globalThis.fetch
}
