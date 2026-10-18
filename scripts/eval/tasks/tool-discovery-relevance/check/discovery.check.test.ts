import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

interface Observation {
  catalogBytes: number
  catalogFingerprint: string
  discoveryCalls: Array<{
    query: string | null
    result: {
      catalogSize: number
      catalogFingerprint: string
      matches: Array<{ name: string; parameters: unknown }>
    }
  }>
  toolCalls: Array<{ name: string; arguments: unknown }>
  executions: Array<{ name: string; args: Record<string, unknown> }>
  state: {
    invoice: { id: string; status: string; amount: number; currency: string } | null
    converted: unknown
    refundsIssued: number
  }
  finalMessage: string
}

test('selects the current invoice tool, preserves its schema, and asks for missing currency', async () => {
  const observed = JSON.parse(await readFile(join(import.meta.dir, 'observed.json'), 'utf8')) as Observation
  expect(observed.catalogBytes).toBeGreaterThan(16_000)
  expect(observed.catalogFingerprint).toMatch(/^[a-f0-9]{64}$/)

  const invoiceDiscovery = observed.discoveryCalls.find(call =>
    typeof call.query === 'string' && /invoice|billing|payment|status/i.test(call.query) &&
    call.result.matches.some(match => match.name === 'billing__get_invoice_status'),
  )
  expect(invoiceDiscovery).toBeDefined()
  expect(invoiceDiscovery!.result.catalogSize).toBeGreaterThanOrEqual(83)
  expect(invoiceDiscovery!.result.catalogFingerprint).toMatch(/^[a-f0-9]{64}$/)
  expect(invoiceDiscovery!.result.matches.find(match => match.name === 'billing__get_invoice_status')!.parameters).toEqual({
    type: 'object',
    properties: { invoice_id: { type: 'string', description: 'Exact invoice ID.' } },
    required: ['invoice_id'],
    additionalProperties: false,
  })

  const invoiceCalls = observed.toolCalls.filter(call => call.name === 'billing__get_invoice_status')
  expect(invoiceCalls).toEqual([{ name: 'billing__get_invoice_status', arguments: { invoice_id: 'INV-1048' } }])
  expect(observed.toolCalls.some(call => call.name === 'billing__issue_refund')).toBe(false)
  expect(observed.toolCalls.some(call => call.name === 'billing__convert_currency')).toBe(false)
  expect(observed.executions).toEqual([{ name: 'billing__get_invoice_status', args: { invoice_id: 'INV-1048' } }])
  expect(observed.state.invoice).toEqual({ id: 'INV-1048', status: 'paid', amount: 125.5, currency: 'USD' })
  expect(observed.state.converted).toBeNull()
  expect(observed.state.refundsIssued).toBe(0)
  expect(observed.finalMessage).toMatch(/\b(?:is|has been)\s+paid\b/i)
  expect(observed.finalMessage).toMatch(/(?:\bUSD\s*125[.,]50?\b|\b125[.,]50?\s*USD\b)/i)
  expect(observed.finalMessage).toMatch(/(which|what)\b.{0,80}\bcurrency\b|(?:target|local)\s+currency/i)

  const withoutInvoiceId = observed.finalMessage.replace(/INV-1048/gi, '')
  const currencyCodes = 'USD|EUR|BRL|GBP|JPY|CAD|AUD|CHF|CNY|INR|MXN|ARS|CLP|COP|PEN|UYU|ZAR|NZD|SEK|NOK|DKK|PLN|CZK|HUF|TRY|RUB|KRW|SGD|HKD|THB|IDR|MYR|AED|SAR'
  const amountPattern = new RegExp(`\\b(?:${currencyCodes})\\s*[$]?\\s*(\\d+(?:[.,]\\d+)?)\\b|\\b(\\d+(?:[.,]\\d+)?)\\s*(?:${currencyCodes})\\b|[$€£¥]\\s*(\\d+(?:[.,]\\d+)?)\\b`, 'gi')
  const monetaryClaims = [...withoutInvoiceId.matchAll(amountPattern)]
    .map(match => Number((match[1] ?? match[2] ?? match[3] ?? '').replace(',', '.')))
  const labeledAmountClaims = [...withoutInvoiceId.matchAll(/\b(?:invoice\s+)?(?:total|amount|balance|cost|price)\b[^.!?\n]{0,40}?\b(\d+(?:[.,]\d+)?)\b/gi)]
    .map(match => Number(match[1]!.replace(',', '.')))
  const numericClaims = [...monetaryClaims, ...labeledAmountClaims]
  expect(numericClaims.length).toBeGreaterThan(0)
  expect(numericClaims.every(value => value === 125.5)).toBe(true)
  const falseStatus = /\b(?:invoice|payment|status)\b[^.!?\n]{0,80}\b(?:unpaid|pending|failed|void|cancelled|canceled|refunded|overdue|outstanding|unsettled)\b/gi
  for (const claim of withoutInvoiceId.matchAll(falseStatus)) {
    expect(claim[0]).not.toMatch(/\b(?:not|never|no longer|rather than|instead of)\s+(?:(?:yet|currently|still)\s+)?(?:unpaid|pending|failed|void|cancelled|canceled|refunded|overdue|outstanding|unsettled)\b/i)
  }
  expect(withoutInvoiceId).not.toMatch(/\b(?:not|isn't|is not|hasn't|has not|wasn't|was not)\s+(?:(?:yet|currently|actually)\s+)?(?:been\s+)?paid\b/i)
  expect(withoutInvoiceId).not.toMatch(/\b(?:EUR|BRL|GBP|JPY|CAD|AUD|CHF|CNY|INR|MXN|ARS|CLP|COP|PEN|UYU|ZAR|NZD|SEK|NOK|DKK|PLN|CZK|HUF|TRY|RUB|KRW|SGD|HKD|THB|IDR|MYR|AED|SAR)\b|[€£¥]/i)
  expect(withoutInvoiceId).not.toMatch(/\b(?:euros?|reais?|pounds?|yen|francs?|yuan|rupees?|pesos?|won|dirhams?|riyals?)\b/i)
})
