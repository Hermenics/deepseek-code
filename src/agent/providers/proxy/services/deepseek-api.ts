import { getDeepSeekHeaders } from '../browser/headers.js'

export interface DeepSeekStreamOptions {
  prompt: string
  enableThinking: boolean
  isProModel?: boolean
  forcedParentId?: number | null
}

export interface DeepSeekStreamResult {
  stream: ReadableStream
  chatSessionId: string
  parentMessageId: number | null
}

export function buildPayload(
  options: DeepSeekStreamOptions,
  chatSessionId: string,
  parentMessageId: number | null,
): Record<string, unknown> {
  return {
    chat_session_id: chatSessionId || undefined,
    parent_message_id: parentMessageId,
    model_type: options.isProModel ? 'expert' : null,
    prompt: options.prompt,
    ref_file_ids: [],
    thinking_enabled: true,
    search_enabled: true,
    preempt: false,
  }
}

export async function createDeepSeekStream(
  options: DeepSeekStreamOptions,
): Promise<DeepSeekStreamResult> {
  const { headers, chatSessionId, parentMessageId } = await getDeepSeekHeaders(
    options.forcedParentId === null,
  )
  const effectiveParentId =
    options.forcedParentId !== undefined ? options.forcedParentId : parentMessageId
  const payload = buildPayload(options, chatSessionId, effectiveParentId)

  const response = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'authorization': headers['authorization'] || '',
      'content-type': 'application/json',
      'origin': 'https://chat.deepseek.com',
      'referer': 'https://chat.deepseek.com/',
      'x-ds-pow-response': headers['x-ds-pow-response'] || '',
      'x-hif-dliq': headers['x-hif-dliq'] || '',
      'x-hif-leim': headers['x-hif-leim'] || '',
      'x-app-version': '2.0.0',
      'x-client-locale': 'pt_BR',
      'x-client-platform': 'web',
      'x-client-version': '2.0.0',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status}`)
  }

  return {
    stream: response.body as ReadableStream,
    chatSessionId,
    parentMessageId: effectiveParentId,
  }
}
