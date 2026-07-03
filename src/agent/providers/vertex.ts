import { GoogleAuth } from 'google-auth-library'

// Internal cache — avoids recreating GoogleAuth and unnecessary token refetches
let cachedAuth: { token: string; expiresAt: number; credentialsPath: string } | null = null
let cachedGoogleAuth: { auth: GoogleAuth; credentialsPath: string } | null = null

/** 5-minute buffer before actual expiry for proactive refresh */
const REFRESH_BUFFER_MS = 5 * 60 * 1000

/** Default OAuth token lifetime (1 hour) */
const TOKEN_LIFETIME_MS = 3600 * 1000

/**
 * Gets an OAuth access token for Vertex AI.
 * Uses cache with refresh 5 minutes before expiry.
 * Automatically invalidates cache if credentialsPath changes.
 */
export async function getVertexAccessToken(
  credentialsPath: string,
): Promise<string> {
  const now = Date.now()

  if (
    cachedAuth &&
    cachedAuth.credentialsPath === credentialsPath &&
    now < cachedAuth.expiresAt - REFRESH_BUFFER_MS
  ) {
    return cachedAuth.token
  }

  // Reuse GoogleAuth if path hasn't changed
  if (!cachedGoogleAuth || cachedGoogleAuth.credentialsPath !== credentialsPath) {
    cachedGoogleAuth = {
      auth: new GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      }),
      credentialsPath,
    }
  }

  const client = await cachedGoogleAuth.auth.getClient()
  const { token } = await client.getAccessToken()

  if (!token) {
    throw new Error('Failed to obtain Vertex AI access token')
  }

  cachedAuth = {
    token,
    expiresAt: now + TOKEN_LIFETIME_MS,
    credentialsPath,
  }

  return token
}

/**
 * Creates a fetch wrapper that injects the Authorization header with a Bearer token.
 * Replaces the dummy header set by the OpenAI SDK (Bearer vertex).
 */
export function createVertexFetch(
  credentialsPath: string,
): typeof globalThis.fetch {
  const vertexFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = await getVertexAccessToken(credentialsPath)

    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${token}`)

    return globalThis.fetch(input, {
      ...init,
      headers,
    })
  }

  // OpenAI SDK expects fetch with .preconnect — delegate to original
  vertexFetch.preconnect = globalThis.fetch.preconnect?.bind(globalThis.fetch)

  return vertexFetch as typeof globalThis.fetch
}

/**
 * Lists only the DeepSeek models available in the Vertex AI project.
 * Uses the Model Garden REST API filtering by "deepseek" in the name.
 */
export async function listVertexDeepSeekModels(
  _project: string,
  location: string,
  credentialsPath: string,
): Promise<string[]> {
  try {
    const token = await getVertexAccessToken(credentialsPath)
    const url = `https://${location}-aiplatform.googleapis.com/v1/publishers/deepseek-ai/models`
    const res = await globalThis.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json() as { publisherModels?: { name?: string }[] }
    return (data.publisherModels ?? [])
      .map((m) => {
        // name is something like "publishers/deepseek-ai/models/deepseek-r1"
        // The ID the Vertex OpenAI endpoint expects is "deepseek-ai/deepseek-r1"
        const parts = m.name?.split('/') ?? []
        if (parts.length >= 4) return `${parts[1]}/${parts[3]}`
        return m.name ?? ''
      })
      .filter(Boolean)
      .sort()
  } catch {
    return []
  }
}

/**
 * Clears the token cache (useful for tests and forced rotation).
 */
export function clearTokenCache(): void {
  cachedAuth = null
  cachedGoogleAuth = null
}
