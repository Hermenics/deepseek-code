export type DeepSeekHealth = 'ok' | 'auth-error' | 'service-error' | 'unreachable'
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

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
