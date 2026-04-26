import { GoogleAuth } from 'google-auth-library'

// Cache interno — evita recriar GoogleAuth e refetch desnecessário de token
let cachedAuth: { token: string; expiresAt: number; credentialsPath: string } | null = null
let cachedGoogleAuth: { auth: GoogleAuth; credentialsPath: string } | null = null

/** Buffer de 5 minutos antes da expiração real para refresh antecipado */
const REFRESH_BUFFER_MS = 5 * 60 * 1000

/** Duração padrão do token OAuth (1 hora) */
const TOKEN_LIFETIME_MS = 3600 * 1000

/**
 * Obtém um access token OAuth para Vertex AI.
 * Usa cache com refresh 5 minutos antes de expirar.
 * Invalida cache automaticamente se credentialsPath mudar.
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

  // Reutiliza GoogleAuth se o path nao mudou
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
    throw new Error('Falha ao obter access token do Vertex AI')
  }

  cachedAuth = {
    token,
    expiresAt: now + TOKEN_LIFETIME_MS,
    credentialsPath,
  }

  return token
}

/**
 * Cria um fetch wrapper que injeta o Authorization header com Bearer token.
 * Substitui o header dummy que o OpenAI SDK seta (Bearer vertex).
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

  // OpenAI SDK espera fetch com .preconnect — delegamos ao original
  vertexFetch.preconnect = globalThis.fetch.preconnect?.bind(globalThis.fetch)

  return vertexFetch as typeof globalThis.fetch
}

/**
 * Limpa o cache de token (útil para testes e rotação forçada).
 */
export function clearTokenCache(): void {
  cachedAuth = null
  cachedGoogleAuth = null
}
