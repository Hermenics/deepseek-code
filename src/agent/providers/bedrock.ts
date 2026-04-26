import { fromIni } from '@aws-sdk/credential-providers'
import { SignatureV4 } from '@smithy/signature-v4'
import { HttpRequest } from '@smithy/protocol-http'
import { Sha256 } from '@aws-crypto/sha256-js'

/**
 * Cria um fetch wrapper que assina requests com AWS SigV4.
 * Usado para autenticar com o endpoint OpenAI-compatible do Bedrock:
 * https://bedrock-runtime.{region}.amazonaws.com/v1
 *
 * @param region - AWS region (ex: us-east-1)
 * @param profile - AWS profile name de ~/.aws/credentials (ex: default)
 * @returns fetch function que assina automaticamente cada request
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
    // Normaliza input para extrair URL, method, headers e body
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
      // Body precisa ser string para o signing calcular o hash corretamente
      if (init?.body != null) {
        body = typeof init.body === 'string' ? init.body : String(init.body)
      }
    }

    // Monta o HttpRequest que o SignatureV4 espera
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

    // Assina — o SigV4 adiciona Authorization, X-Amz-Date, etc.
    const signed = await signer.sign(httpRequest)

    // Reconstrói o fetch request com os headers assinados
    return globalThis.fetch(url.toString(), {
      method: signed.method,
      headers: signed.headers,
      body: signed.body,
    })
  }) as typeof globalThis.fetch
}
