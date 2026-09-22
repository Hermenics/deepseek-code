export interface AccountBalance {
  currency: string
  total: number
}

/**
 * Reads the account balance from DeepSeek's free `/user/balance` endpoint. Returns undefined without a
 * key, for gateways that lack the endpoint, and on network errors, so callers simply leave it out.
 */
export async function fetchDeepSeekBalance(
  apiKey: string | undefined,
  baseURL = 'https://api.deepseek.com',
  fetchImpl: typeof fetch = fetch,
): Promise<AccountBalance | undefined> {
  if (!apiKey) return undefined
  try {
    const response = await fetchImpl(`${baseURL.replace(/\/+$/, '')}/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return undefined
    const body = await response.json() as { balance_infos?: Array<{ currency?: string; total_balance?: string }> }
    const infos = body.balance_infos ?? []
    const info = infos.find((entry) => entry.currency === 'USD') ?? infos[0]
    const total = Number(info?.total_balance)
    return info?.currency && Number.isFinite(total) ? { currency: info.currency, total } : undefined
  } catch {
    return undefined
  }
}

/** Formats a balance for display: `$12.34` for USD, `12.34 CNY` style for other currencies. */
export function formatBalance({ currency, total }: AccountBalance): string {
  return currency === 'USD' ? `$${total.toFixed(2)}` : `${total.toFixed(2)} ${currency}`
}
