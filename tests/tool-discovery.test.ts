import { describe, expect, test } from 'bun:test'
import { discoverTools, TOOL_DISCOVERY_MAX_RESPONSE_BYTES, TOOL_DISCOVERY_MAX_RESULTS } from '../src/agent/toolDiscovery.js'
import { Agent } from '../src/agent/agent.js'
import { DiscoverTools } from '../src/tools/DiscoverTools/DiscoverTools.js'

const tool = (index: number, description = `Search source files by token ${index}`) => ({
  name: `search_source_${index}`,
  description,
  parameters: { type: 'object', properties: { query: { type: 'string', description: `Search phrase ${index}` } }, required: ['query'], additionalProperties: false },
})

describe('deterministic installed tool discovery', () => {
  test('ranks exact names and returns full matching schemas without autoloading', () => {
    const catalog = [tool(1, 'Read source files'), tool(2, 'Write source files'), tool(3, 'Search source files')]
    const result = discoverTools(catalog, 'search_source_2')
    expect(result.matches).toEqual([catalog[1]])
    expect(result.catalogSize).toBe(3)
    expect(result.catalogFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(result.refineQuery).toBe(false)
  })

  test('caps result count and total JSON bytes while retaining complete schemas', () => {
    const catalog = Array.from({ length: 400 }, (_, i) => ({
      name: `repository_tool_${i.toString().padStart(3, '0')}`,
      description: 'repository search inspect source ' + 'x'.repeat(100),
      parameters: { type: 'object', properties: { query: { type: 'string' }, payload: { type: 'string', description: 'y'.repeat(1_500) } }, required: ['query'] },
    }))
    const result = discoverTools(catalog, 'repository search source')
    const serialized = JSON.stringify(result)
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(TOOL_DISCOVERY_MAX_RESPONSE_BYTES)
    expect(result.matches.length).toBeLessThanOrEqual(TOOL_DISCOVERY_MAX_RESULTS)
    expect(result.omitted).toBeGreaterThan(0)
    expect(result.refineQuery).toBe(true)
    for (const match of result.matches) expect(match.parameters).toEqual(catalog.find(candidate => candidate.name === match.name)!.parameters)
  })

  test('fingerprints all installed descriptors independent of input order', () => {
    const first = [tool(1), tool(2)]
    expect(discoverTools(first, 'search').catalogFingerprint).toBe(discoverTools([...first].reverse(), 'search').catalogFingerprint)
    expect(discoverTools(first, 'search').catalogFingerprint).not.toBe(discoverTools([tool(1), tool(2, 'Changed capability')], 'search').catalogFingerprint)
  })

  test('empty and unmatched queries are explicit and bounded', () => {
    const catalog = [tool(1)]
    expect(discoverTools(catalog, '  ').message).toContain('non-empty')
    const result = discoverTools(catalog, 'unrelated capability')
    expect(result.matches).toEqual([])
    expect(result.omitted).toBe(0)
    expect(result.refineQuery).toBe(false)
  })

  test('tool execution delegates only to the host discovery callback', async () => {
    let received = ''
    const execute = DiscoverTools.execute({ query: 'filesystem read' }, { discoverTools: (query: string) => { received = query; return '{"matches":[]}' } } as never)
    await expect(execute).resolves.toBe('{"matches":[]}')
    expect(received).toBe('filesystem read')
    await expect(DiscoverTools.execute({ query: 'x' }, undefined)).resolves.toContain('unavailable')
  })
})

// Exercise Agent's real catalog installation/selection and execution context without a provider client.
function catalogAgent() {
  return Object.assign(Object.create(Agent.prototype), {
    discoveredMcpTools: new Set(), providerConfig: { type: 'openai' }, model: 'test',
    mcpToolGenerations: new WeakMap(),
    options: {}, interactionMode: 'auto', allowedTools: null,
    orchestrator: { toolContext: () => ({}), registry: { recordAggregateOutputBytes: () => true } },
  }) as any
}

test('catalog installation rejects duplicate names without replacing the current lookup or discovery selection', () => {
  const agent = catalogAgent()
  const current = { ...tool(1), name: 'server__current', execute: async () => 'current' }
  agent.installMcpTools([current])
  agent.discoveredMcpTools.add(current.name)
  const tools = agent.tools, lookup = agent.toolMap
  expect(() => agent.installMcpTools([current, { ...current, description: 'different' }])).toThrow('unique')
  expect(() => agent.installMcpTools([{ ...current, name: 'shell' }])).toThrow('unique')
  agent.options.extraTools = [{ ...current, name: 'extra' }, { ...current, name: 'extra' }]
  expect(() => agent.installMcpTools([current])).toThrow('unique')
  expect(agent.tools).toBe(tools)
  expect(agent.toolMap).toBe(lookup)
  expect([...agent.discoveredMcpTools]).toEqual([current.name])
})

 test('large MCP catalogs are discovered on demand and reload invalidates selected schemas', async () => {
  const agent = catalogAgent()
  const catalog = Array.from({ length: 400 }, (_, index) => ({
    ...tool(index, `Unique capability ${index}`), name: `server__tool_${index}`,
    execute: async () => 'unused',
  }))
  agent.installMcpTools(catalog)
  const initial = agent.getAvailableTools().map((entry: any) => entry.name)
  expect(initial).toContain('read_file')
  expect(initial).toContain('discover_tools')
  expect(initial.filter((name: string) => name.startsWith('server__'))).toEqual([])
  const result = JSON.parse(await agent.executeTool('discover_tools', { query: 'server__tool_123' }))
  expect(result.matches.map((entry: any) => entry.name)).toEqual(['server__tool_123'])
  expect(agent.getAvailableTools().map((entry: any) => entry.name)).toContain('server__tool_123')
  const oldFingerprint = result.catalogFingerprint
  catalog[123]!.parameters = { type: 'object', required: ['new_field'] } as any
  agent.installMcpTools(catalog)
  expect(agent.getAvailableTools().some((entry: any) => entry.name === 'server__tool_123')).toBe(false)
  const refreshed = JSON.parse(await agent.executeTool('discover_tools', { query: 'server__tool_123' }))
  expect(refreshed.catalogFingerprint).not.toBe(oldFingerprint)
  expect(refreshed.matches[0].parameters).toEqual(catalog[123]!.parameters)
})

 test('small MCP catalogs stay visible and discovery respects mode and allowlist', async () => {
  const agent = catalogAgent()
  agent.installMcpTools([{ ...tool(1), name: 'server__search', execute: async () => 'unused' }])
  expect(agent.getAvailableTools().map((entry: any) => entry.name)).toContain('server__search')
  agent.interactionMode = 'review'
  const review = JSON.parse(await agent.executeTool('discover_tools', { query: 'server__search' }))
  expect(review.matches).toEqual([])
  agent.interactionMode = 'auto'
  agent.allowedTools = ['discover_tools', 'read_file']
  const restricted = JSON.parse(await agent.executeTool('discover_tools', { query: 'server__search' }))
  expect(restricted.matches).toEqual([])
  expect(agent.getAvailableTools().map((entry: any) => entry.name)).toEqual(['read_file', 'discover_tools'])
})
