import type { ProviderName } from '../ui/setup/ApiKeySetup.js'

/**
 * Formata a mensagem de erro de chat de acordo com o provider.
 *
 * Contexto: /models pode funcionar para Bedrock/Vertex (usa SDK nativo),
 * mas o endpoint de chat OpenAI-compatible pode falhar por falta de credenciais.
 * Esta função torna esse diagnóstico explícito para o usuário.
 */
export function formatChatError(error: Error, provider: ProviderName): string {
  const raw = error.message

  if (provider === 'bedrock') {
    const isAuthError =
      raw.includes('UnrecognizedClientException') ||
      raw.includes('AccessDeniedException') ||
      raw.includes('InvalidSignatureException') ||
      raw.includes('not authorized') ||
      raw.includes('credentials')

    if (isAuthError) {
      return (
        `Erro de credenciais AWS ao chamar o chat (${raw}).\n` +
        `Nota: /models pode funcionar (usa SDK nativo), mas o endpoint de chat OpenAI-compatible ` +
        `requer credenciais AWS válidas no perfil configurado (~/.aws/credentials).`
      )
    }

    return (
      `Erro no chat via Amazon Bedrock: ${raw}\n` +
      `Nota: /models pode funcionar (usa SDK nativo), mas o endpoint de chat OpenAI-compatible ` +
      `pode falhar por credenciais ou permissões insuficientes.`
    )
  }

  if (provider === 'vertex') {
    const isMissingCredentials =
      raw.includes('GCP_CREDENTIALS') ||
      raw.includes('service account') ||
      raw.includes('PERMISSION_DENIED') ||
      raw.includes('UNAUTHENTICATED')

    if (isMissingCredentials) {
      return (
        `Erro de autenticação Google Vertex AI (${raw}).\n` +
        `Nota: /models pode funcionar (usa SDK nativo), mas o endpoint de chat OpenAI-compatible ` +
        `requer GCP_CREDENTIALS (caminho para o JSON da service account).`
      )
    }

    return (
      `Erro no chat via Google Vertex AI: ${raw}\n` +
      `Nota: /models pode funcionar (usa SDK nativo), mas o endpoint de chat OpenAI-compatible ` +
      `pode falhar por credenciais ou permissões insuficientes.`
    )
  }

  // deepseek, local — mensagem direta sem contexto adicional
  return raw
}
