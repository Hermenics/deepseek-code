import type { ProviderName } from '../ui/setup/ApiKeySetup.js'

/**
 * Formats a chat error message based on the provider.
 *
 * Context: /models may work for Bedrock/Vertex (uses native SDK),
 * but the OpenAI-compatible chat endpoint may fail due to missing credentials.
 * This function makes that diagnosis explicit for the user.
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
        `AWS credentials error calling chat (${raw}).\n` +
        `Note: /models may work (uses native SDK), but the OpenAI-compatible chat endpoint ` +
        `requires valid AWS credentials in the configured profile (~/.aws/credentials).`
      )
    }

    return (
      `Chat error via Amazon Bedrock: ${raw}\n` +
      `Note: /models may work (uses native SDK), but the OpenAI-compatible chat endpoint ` +
      `may fail due to insufficient credentials or permissions.`
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
        `Google Vertex AI authentication error (${raw}).\n` +
        `Note: /models may work (uses native SDK), but the OpenAI-compatible chat endpoint ` +
        `requires GCP_CREDENTIALS (path to the service account JSON).`
      )
    }

    return (
      `Chat error via Google Vertex AI: ${raw}\n` +
      `Note: /models may work (uses native SDK), but the OpenAI-compatible chat endpoint ` +
      `may fail due to insufficient credentials or permissions.`
    )
  }

  // deepseek, local — direct message without additional context
  return raw
}
