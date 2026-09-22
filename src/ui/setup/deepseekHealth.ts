export type DeepSeekHealth = 'ok' | 'auth-error' | 'service-error' | 'unreachable'
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

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
