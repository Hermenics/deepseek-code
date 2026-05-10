import { fromIni } from '@aws-sdk/credential-providers'
import { SignatureV4 } from '@smithy/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { Sha256 } from '@aws-crypto/sha256-js'
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'

/**
 * Lists only the DeepSeek models available in Bedrock for the account/region.
 * Filters by "deepseek" in modelId to stay consistent with the app's purpose.
 */
export async function listBedrockDeepSeekModels(region: string, profile: string): Promise<string[]> {
  const client = new BedrockClient({
    region,
    credentials: fromIni({ profile }),
  })

  try {
    const response = await client.send(new ListFoundationModelsCommand({}))
    const models = response.modelSummaries ?? []
    return models
      .map((m) => m.modelId ?? '')
      .filter((id) => id.toLowerCase().includes('deepseek'))
      .sort()
  } catch {
    return []
  }
}

/**
 * Creates a fetch wrapper that signs requests with AWS SigV4.
 * Used to authenticate with the Bedrock OpenAI-compatible endpoint:
 * https://bedrock-runtime.{region}.amazonaws.com/v1
 *
 * @param region - AWS region (e.g. us-east-1)
 * @param profile - AWS profile name from ~/.aws/credentials (e.g. default)
 * @returns fetch function that automatically signs each request
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
    // Normalize input to extract URL, method, headers and body
    let url: URL
    let method: string
    let headers: Record<string, string> = {}
    let body: string | undefined

    if (input instanceof Request) {
      url = new URL(input.url)
      method = input.method
      input.headers.forEach((value, key) => { headers[key] = value })
      body = await input.text()
    } else {
      url = new URL(input.toString())
      method = init?.method ?? 'GET'
      if (init?.headers) {
        const h = new Headers(init.headers)
        h.forEach((value, key) => { headers[key] = value })
      }
      // Body must be a string so the signer can compute the hash correctly
      if (init?.body != null) {
        body = typeof init.body === 'string' ? init.body : String(init.body)
      }
    }

    // Build the HttpRequest that SignatureV4 expects
    const httpRequest = new HttpRequest({
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: {
        ...headers,
        host: url.hostname,
      },
      body,
    })

    // Sign — SigV4 adds Authorization, X-Amz-Date, etc.
    const signed = await signer.sign(httpRequest)

    // Rebuild the fetch request with the signed headers
    return globalThis.fetch(url.toString(), {
      method: signed.method,
      headers: signed.headers,
      body: signed.body,
    })
  }) as typeof globalThis.fetch
}
