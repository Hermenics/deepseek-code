import OpenAI from 'openai'
import type { ProviderConfig } from '../ui/setup/ApiKeySetup.js'
import { createBedrockFetch, createBedrockMantleFetch, modelSupportsChatCompletions } from './providers/bedrock.js'
import { createVertexFetch } from './providers/vertex.js'
import { orchestrate } from './providers/proxy/services/orchestrator.js'
import { parseToolResponses } from './providers/proxy/tools/prompt-emulation.js'
import type { ProxyRequest } from './providers/proxy/types/index.js'

const TOOL_START = '<tool_call>'
const TOOL_END = '</tool_call>'

function createOAuthFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? 'GET'

    if (!url.includes('/v1/chat/completions') || method.toUpperCase() !== 'POST') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }

    const rawBody = init?.body
    const bodyText = typeof rawBody === 'string' ? rawBody : rawBody ? String(rawBody) : '{}'
    const parsed = JSON.parse(bodyText) as {
      messages?: ProxyRequest['messages']
      model?: string
      tools?: Array<{ type?: string; function?: { name: string; description?: string; parameters?: unknown }; name?: string; description?: string; input_schema?: unknown }>
    }

    // Convert OpenAI tool format {type:'function', function:{name,description,parameters}}
    // to ProxyTool format {name, description, input_schema} that buildPrompt expects
    const tools: ProxyRequest['tools'] = (parsed.tools ?? []).map((t) => {
      if (t.type === 'function' && t.function) {
        return { name: t.function.name, description: t.function.description, input_schema: t.function.parameters }
      }
      return { name: t.name ?? '', description: t.description, input_schema: t.input_schema }
    })

    const proxyRequest: ProxyRequest = {
      messages: parsed.messages ?? [],
      model: parsed.model ?? 'deepseek-v4-flash',
      stream: true,
      tools,
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const id = `chatcmpl-${Date.now()}`
        const sendChunk = (payload: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))

        // Tool call parsing state (mirrors deepsproxy/src/routes/chat.ts)
        let contentBuffer = ''   // accumulates text tokens for tool detection
        let insideTool = false   // currently inside <tool_call>...</tool_call>
        let toolCallCount = 0    // number of tool calls emitted so far
        let toolUseDetected = false // mid-stream {"tool_use" detection — stop flushing text

        const flushText = (text: string) => {
          if (!text || toolCallCount > 0 || toolUseDetected) return
          sendChunk({
            id, object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          })
        }

        const emitToolCall = (toolJson: string) => {
          try {
            const obj = JSON.parse(toolJson) as { name?: string; arguments?: unknown }
            const name = obj.name ?? ''
            const args = obj.arguments && typeof obj.arguments === 'object'
              ? obj.arguments as Record<string, unknown>
              : {}
            const toolId = `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
            sendChunk({
              id, object: 'chat.completion.chunk',
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: toolCallCount,
                    id: toolId,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                  }],
                },
                finish_reason: null,
              }],
            })
            toolCallCount++
          } catch {
            // malformed tool JSON — emit as text
            flushText(TOOL_START + toolJson + TOOL_END)
          }
        }

        // Process accumulated contentBuffer for tool tags
        const processBuffer = () => {
          while (contentBuffer.length > 0) {
            if (!insideTool) {
              // Mid-stream detection of {"tool_use" — stop flushing text
              if (!toolUseDetected) {
                const toolUseIdx = contentBuffer.indexOf('{"tool_use"')
                // Only detect if not inside a code fence
                if (toolUseIdx !== -1 && !contentBuffer.slice(0, toolUseIdx).includes('```')) {
                  toolUseDetected = true
                  // Flush any text before the JSON
                  flushText(contentBuffer.slice(0, toolUseIdx))
                  contentBuffer = contentBuffer.slice(toolUseIdx)
                  break // wait for more tokens to complete the JSON
                }
              }

              // Also detect native DeepSeek markers mid-stream
              if (!toolUseDetected) {
                const nativeIdx = contentBuffer.indexOf('<|tool_calls_begin|>')
                if (nativeIdx !== -1) {
                  toolUseDetected = true
                  flushText(contentBuffer.slice(0, nativeIdx))
                  contentBuffer = contentBuffer.slice(nativeIdx)
                  break
                }
              }

              const startIdx = contentBuffer.indexOf(TOOL_START)
              if (startIdx !== -1) {
                // emit text before the tag
                flushText(contentBuffer.slice(0, startIdx))
                insideTool = true
                contentBuffer = contentBuffer.slice(startIdx + TOOL_START.length)
              } else {
                // no tool tag — check for partial match at end, hold back
                let holdBack = 0
                for (let i = 1; i <= TOOL_START.length; i++) {
                  if (contentBuffer.endsWith(TOOL_START.slice(0, i))) {
                    holdBack = i
                    break
                  }
                }
                flushText(contentBuffer.slice(0, contentBuffer.length - holdBack))
                contentBuffer = contentBuffer.slice(contentBuffer.length - holdBack)
                break
              }
            } else {
              const endIdx = contentBuffer.indexOf(TOOL_END)
              if (endIdx !== -1) {
                emitToolCall(contentBuffer.slice(0, endIdx).trim())
                insideTool = false
                contentBuffer = contentBuffer.slice(endIdx + TOOL_END.length)
              } else {
                break // wait for more tokens
              }
            }
          }
        }

        try {
          for await (const event of orchestrate(proxyRequest, null as never, null as never)) {
            if (event.error) {
              sendChunk({
                id, object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: { content: `⚠ ${event.error}` }, finish_reason: null }],
              })
              sendChunk({
                id, object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              })
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              break
            }

            if (event.thinking) {
              sendChunk({
                id, object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: { reasoning_content: event.thinking }, finish_reason: null }],
              })
            }

            if (event.token) {
              contentBuffer += event.token
              processBuffer()
            }

            if (event.done) {
              // Fallback: if no tool calls detected via tags, try parseToolResponses on full buffer
              if (toolCallCount === 0 && contentBuffer.trim()) {
                const fallbackCalls = parseToolResponses(contentBuffer)
                if (fallbackCalls.length > 0) {
                  for (const call of fallbackCalls) {
                    const toolId = `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
                    sendChunk({
                      id, object: 'chat.completion.chunk',
                      choices: [{
                        index: 0,
                        delta: {
                          tool_calls: [{
                            index: toolCallCount,
                            id: toolId,
                            type: 'function',
                            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                          }],
                        },
                        finish_reason: null,
                      }],
                    })
                    toolCallCount++
                  }
                  contentBuffer = ''
                }
              }

              // flush remaining buffer (only if no tool calls were emitted)
              if (!insideTool && contentBuffer && toolCallCount === 0) flushText(contentBuffer)
              contentBuffer = ''

              const finishReason = toolCallCount > 0 ? 'tool_calls' : 'stop'
              sendChunk({
                id, object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
              })
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              break
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          sendChunk({
            id, object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: `⚠ OAuth error: ${msg}` }, finish_reason: null }],
          })
          sendChunk({
            id, object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    })
  }
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
      const rawUrl = cfg.localBaseUrl ?? 'http://localhost:11434/v1'
      // Ensure the URL has a scheme — users often omit http://
      const baseURL = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`
      return new OpenAI({
        apiKey: 'local',
        baseURL,
      })
    }
    case 'oauth': {
      return new OpenAI({
        apiKey: cfg.proxyApiKey ?? 'oauth',
        baseURL: 'https://chat.deepseek.com/oauth-passthrough/v1',
        fetch: createOAuthFetch(),
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
