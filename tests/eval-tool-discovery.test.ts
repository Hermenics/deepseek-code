import { afterEach, expect, it, test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import { discoverTools } from '../src/agent/toolDiscovery.js'
import { extractToolDiscoveryEvidence } from '../scripts/eval/toolDiscoveryEvidence.js'
import { createToolDiscoveryFixture } from '../scripts/eval/tasks/tool-discovery-relevance/catalog.js'
import { runIsolatedChecker } from '../scripts/eval/checker.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const scratch: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())
afterEach(async () => Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true }))))

function catalogAgent() {
  return Object.assign(Object.create(Agent.prototype), {
    discoveredMcpTools: new Set(), providerConfig: { type: 'openai' }, model: 'test',
    mcpToolGenerations: new WeakMap(), options: {}, interactionMode: 'auto', allowedTools: null,
    orchestrator: { toolContext: () => ({}), registry: { recordAggregateOutputBytes: () => true } },
  }) as any
}

test('extracts discover_tools evidence by matching call IDs and ignores unrelated or malformed transcript entries', () => {
  const result = {
    catalogSize: 83,
    catalogFingerprint: 'a'.repeat(64),
    matches: [{
      name: 'billing__get_invoice_status',
      parameters: {
        type: 'object',
        properties: { invoice_id: { type: 'string', description: 'Exact invoice ID.' } },
        required: ['invoice_id'],
        additionalProperties: false,
      },
    }],
  }
  const transcript = [
    {
      role: 'assistant',
      tool_calls: [
        { id: 'discover-1', type: 'function', function: { name: 'discover_tools', arguments: '{"query":"invoice payment status"}' } },
        { id: 'read-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
        { id: 'discover-2', type: 'function', function: { name: 'discover_tools', arguments: '{invalid arguments' } },
        { id: 'discover-3', type: 'function', function: { name: 'discover_tools', arguments: '{"query":"archive tools"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'read-1', content: JSON.stringify({ matches: [{ name: 'wrong_tool' }] }) },
    { role: 'tool', tool_call_id: 'unrelated-discovery', content: JSON.stringify({ matches: [{ name: 'wrong_tool' }] }) },
    { role: 'tool', tool_call_id: 'discover-1', content: JSON.stringify(result) },
    { role: 'tool', tool_call_id: 'discover-3', content: '{malformed result' },
    { role: 'assistant', content: 'Finished.' },
  ]

  expect(extractToolDiscoveryEvidence(transcript)).toEqual([
    { query: 'invoice payment status', result },
    { query: null, result: null },
    { query: 'archive tools', result: null },
  ])
})

test('C36 uses the frozen catalog, discovers the right tool, and refuses to invent a missing currency', async () => {
  const fixture = createToolDiscoveryFixture()
  expect(fixture.catalogBytes).toBeGreaterThan(16_000)

  const agent = catalogAgent()
  agent.installMcpTools(fixture.tools)
  const initiallyAvailable = agent.getAvailableTools().map((tool: { name: string }) => tool.name)
  expect(initiallyAvailable).toContain('discover_tools')
  expect(initiallyAvailable.filter((name: string) => fixture.names.has(name))).toEqual([])

  const prematureInvoiceCall = JSON.parse(await agent.executeTool('billing__get_invoice_status', { invoice_id: 'INV-1048' }))
  expect(prematureInvoiceCall.error.code).toBe('TOOL_NOT_DISCOVERED')
  expect(fixture.state.executions).toEqual([])
  expect(fixture.state.invoice).toBeNull()

  const invoiceDiscoveryResult = JSON.parse(await agent.executeTool('discover_tools', { query: 'invoice payment status' }))
  const invoiceDiscovery = invoiceDiscoveryResult
  expect(invoiceDiscovery.catalogSize).toBe(agent.getEligibleTools().length)
  expect(invoiceDiscovery.catalogFingerprint).toBe(discoverTools(agent.getEligibleTools(), '').catalogFingerprint)
  expect(invoiceDiscovery.matches[0].name).toBe('billing__get_invoice_status')
  expect(invoiceDiscovery.matches[0].parameters.required).toEqual(['invoice_id'])
  expect(agent.getAvailableTools().map((tool: { name: string }) => tool.name)).toContain('billing__get_invoice_status')

  const invoiceResult = await agent.executeTool('billing__get_invoice_status', { invoice_id: 'INV-1048' })
  expect(invoiceResult).toContain('"status":"paid"')

  const currencyDiscovery = JSON.parse(await agent.executeTool('discover_tools', { query: 'convert currency amount' }))
  expect(currencyDiscovery.matches[0].name).toBe('billing__convert_currency')
  const incompleteConversion = await agent.executeTool('billing__convert_currency', { amount: 125.5, from_currency: 'USD' })
  expect(incompleteConversion).toContain('target_currency')

  expect(fixture.state.executions).toEqual([{ name: 'billing__get_invoice_status', args: { invoice_id: 'INV-1048' } }])
  expect(fixture.state.invoice).toEqual({ id: 'INV-1048', status: 'paid', amount: 125.5, currency: 'USD' })
  expect(fixture.state.converted).toBeNull()
  expect(fixture.state.refundsIssued).toBe(0)
})

sandboxTest('C36 checker accepts correct evidence and rejects missing discovery, contradictions, state drift, and refunds', async () => {
  const fixture = createToolDiscoveryFixture()
  const agent = catalogAgent()
  agent.installMcpTools(fixture.tools)
  const discoveryResult = JSON.parse(await agent.executeTool('discover_tools', { query: 'invoice payment status' }))
  await agent.executeTool('billing__get_invoice_status', { invoice_id: 'INV-1048' })
  const root = await mkdtemp(join(tmpdir(), 'eval-c36-reference-'))
  scratch.push(root)
  const checker = join(root, '__eval_check__')
  await cp(join(import.meta.dir, '../scripts/eval/tasks/tool-discovery-relevance/check'), checker, { recursive: true })
  const evidence = {
    catalogBytes: fixture.catalogBytes,
    catalogFingerprint: fixture.catalogFingerprint,
    discoveryCalls: [{ query: 'invoice payment status', result: discoveryResult }],
    toolCalls: [{ name: 'billing__get_invoice_status', arguments: { invoice_id: 'INV-1048' } }],
    executions: fixture.state.executions,
    state: fixture.state,
    finalMessage: 'Invoice 1048 is paid: 125.5 USD, not pending. Which local currency should I use?',
  }
  const observed = join(checker, 'observed.json')
  await writeFile(observed, JSON.stringify(evidence))

  const valid = await runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  expect(valid.exitCode).toBe(0)
  expect(valid.positiveTestEvidence).toBe(true)

  await writeFile(observed, JSON.stringify({ ...evidence, finalMessage: 'The invoice is not paid and the total is 999 EUR. Which currency?' }))
  const falseReport = await runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  expect(falseReport.exitCode).not.toBe(0)

  await writeFile(observed, JSON.stringify({
    ...evidence,
    finalMessage: 'Invoice INV-1048 is paid: 125.5 USD. The amount due is 999 USD. Which local currency?',
  }))
  const contradictoryAmount = await runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  expect(contradictoryAmount.exitCode).not.toBe(0)

  await writeFile(observed, JSON.stringify({
    ...evidence,
    finalMessage: 'Invoice INV-1048 is paid: 125.5 USD, but it is not paid. Which local currency?',
  }))
  const contradictoryStatus = await runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  expect(contradictoryStatus.exitCode).not.toBe(0)

  const { discoveryCalls: _discoveryCalls, ...withoutDiscovery } = evidence
  await writeFile(observed, JSON.stringify(withoutDiscovery))
  const missingDiscovery = await runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  expect(missingDiscovery.exitCode).not.toBe(0)

  const incompleteDiscovery = {
    ...discoveryResult,
    matches: discoveryResult.matches.map((match: { name: string; parameters: Record<string, unknown> }) => match.name === 'billing__get_invoice_status'
      ? { ...match, parameters: { ...match.parameters, required: [] } }
      : match),
  }
  await writeFile(observed, JSON.stringify({ ...evidence, discoveryCalls: [{ query: 'invoice payment status', result: incompleteDiscovery }] }))
  const missingSchemaArgument = await runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  expect(missingSchemaArgument.exitCode).not.toBe(0)

  await writeFile(observed, JSON.stringify({ ...evidence, state: { ...fixture.state, invoice: { ...fixture.state.invoice!, status: 'pending' } } }))
  const incorrectState = await runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  expect(incorrectState.exitCode).not.toBe(0)

  await writeFile(observed, JSON.stringify({ ...evidence, state: { ...fixture.state, refundsIssued: 1 } }))
  const invalid = await runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
  expect(invalid.exitCode).not.toBe(0)
})
