import type { Tool } from '../../../../src/tools/types.js'
import { discoverTools } from '../../../../src/agent/toolDiscovery.js'

const INVOICE_ID = 'INV-1048'

export interface ToolDiscoveryExecution {
  name: string
  args: Record<string, unknown>
}

export interface ToolDiscoveryFixture {
  tools: Tool[]
  names: Set<string>
  catalogBytes: number
  catalogFingerprint: string
  state: {
    invoice: { id: string; status: string; amount: number; currency: string } | null
    converted: { amount: number; currency: string } | null
    refundsIssued: number
    executions: ToolDiscoveryExecution[]
  }
}

/** Builds a repeatable oversized MCP catalog with useful, ambiguous, and irrelevant candidates. */
export function createToolDiscoveryFixture(): ToolDiscoveryFixture {
  const state: ToolDiscoveryFixture['state'] = { invoice: null, converted: null, refundsIssued: 0, executions: [] }
  const record = (name: string, args: Record<string, unknown>) => state.executions.push({ name, args: structuredClone(args) })
  const tools: Tool[] = [
    {
      name: 'billing__get_invoice_status',
      description: 'Look up the current payment status and total for one invoice by its invoice ID.',
      parameters: {
        type: 'object', properties: { invoice_id: { type: 'string', description: 'Exact invoice ID.' } },
        required: ['invoice_id'], additionalProperties: false,
      },
      async execute(args) {
        record('billing__get_invoice_status', args)
        if (args.invoice_id !== INVOICE_ID) return JSON.stringify({ error: 'Invoice not found' })
        state.invoice = { id: INVOICE_ID, status: 'paid', amount: 125.5, currency: 'USD' }
        return JSON.stringify(state.invoice)
      },
    },
    {
      name: 'billing__convert_currency',
      description: 'Convert an amount from its source currency into a caller-specified target currency.',
      parameters: {
        type: 'object', properties: {
          amount: { type: 'number' }, from_currency: { type: 'string' }, target_currency: { type: 'string' },
        }, required: ['amount', 'from_currency', 'target_currency'], additionalProperties: false,
      },
      async execute(args) {
        record('billing__convert_currency', args)
        state.converted = { amount: Number(args.amount), currency: String(args.target_currency) }
        return JSON.stringify(state.converted)
      },
    },
    {
      name: 'billing__issue_refund',
      description: 'Issue a refund for an invoice after explicit authorization.',
      parameters: {
        type: 'object', properties: { invoice_id: { type: 'string' } },
        required: ['invoice_id'], additionalProperties: false,
      },
      async execute(args) {
        record('billing__issue_refund', args)
        state.refundsIssued++
        return JSON.stringify({ refunded: args.invoice_id })
      },
    },
  ]

  for (let index = 0; index < 80; index++) {
    const suffix = index.toString().padStart(3, '0')
    tools.push({
      name: `billing__invoice_archive_${suffix}`,
      description: `Search historical invoice archive records by invoice ID. This read-only tool returns archived document references, never current payment state. ${'Historical document metadata search. '.repeat(8)}`,
      parameters: {
        type: 'object', properties: { invoice_id: { type: 'string' } },
        required: ['invoice_id'], additionalProperties: false,
      },
      async execute(args) {
        record(`billing__invoice_archive_${suffix}`, args)
        return JSON.stringify({ archived: true, invoice_id: args.invoice_id })
      },
    })
  }

  const descriptors = tools.map(({ name, description, parameters }) => ({ name, description, parameters }))
  return {
    tools, names: new Set(tools.map(tool => tool.name)),
    catalogBytes: Buffer.byteLength(JSON.stringify(descriptors), 'utf8'),
    catalogFingerprint: discoverTools(descriptors, '').catalogFingerprint,
    state,
  }
}
