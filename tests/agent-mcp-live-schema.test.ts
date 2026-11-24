import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import * as mcp from '../src/agent/mcp.js'
import type { Tool } from '../src/tools/types.js'

const toolName = 'trusted_server__lookup'
const schema = {
  type: 'object',
  properties: { value: { type: 'string' } },
  required: ['value'],
  additionalProperties: false,
}

function createAgent(workspacePath: string) {
  const agent = Object.assign(Object.create(Agent.prototype), {
    options: {},
    mcpToolNames: new Set<string>(),
    discoveredMcpTools: new Set<string>(),
    mcpToolGenerations: new WeakMap<Tool, object>(),
    mcpClientGenerations: new Set<object>(),
    mcpValidationPromises: new Set<Promise<unknown>>(),
    tools: [],
    toolMap: new Map(),
    interactionMode: 'auto',
    allowedTools: null,
    orchestrator: {
      toolContext: () => ({}),
      registry: { recordAggregateOutputBytes: () => true },
    },
    workspacePath,
    settings: { mcp: { enabled: true } },
    mcpReloadClosed: false,
    mcpErrors: [],
    mcpApprovalRequired: null,
    turnBudgetGroupId: undefined,
    aggregateOutputQuotaExhausted: false,
    turnObjectiveRevision: 0,
    objectiveRevision: 0,
    providerConfig: { type: 'openai' },
    provider: 'openai',
    model: 'fixture',
    workflows: {},
    pendingToolImages: [],
  }) as any
  return agent as Agent & Record<string, any>
}

function mcpTool(execute: Tool['execute'], parameters: object = schema): Tool {
  return { name: toolName, description: 'Look up a value', parameters, mcpServerName: 'trusted_server', execute }
}

function largeCatalog(selectedTool: Tool): Tool[] {
  return Array.from({ length: 400 }, (_, index) => index === 123 ? selectedTool : ({
    name: `trusted_server__catalog_${index}`,
    description: `Read catalog entry ${index} ${'x'.repeat(100)}`,
    parameters: schema,
    mcpServerName: 'trusted_server',
    execute: async () => 'unused catalog tool',
  }))
}

function exposeSelectedToolForTest(agent: Agent): void {
  ;(agent as any).discoveredMcpTools.add(toolName)
}

describe('agent MCP live schema validation', () => {
  let workspacePath: string

  afterEach(async () => {
    if (workspacePath) await rm(workspacePath, { recursive: true, force: true })
    workspacePath = ''
  })

  it('validates before first use, calls the validated client, then reuses that generation', async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'deepseek-agent-mcp-live-'))
    const agent = createAgent(workspacePath)
    const events: string[] = []
    let cachedCalls = 0
    let liveCalls = 0
    const cachedTool = mcpTool(async () => { cachedCalls++; return 'cached result' })
    const liveTool = mcpTool(async args => { events.push('execute-live'); liveCalls++; return `live:${args.value}` })
    const cachedCatalog = largeCatalog(cachedTool)
    const liveCatalog = largeCatalog(liveTool)
    const load = spyOn(mcp, 'loadMcpTools').mockImplementation(async () => {
      events.push('load-live-schema')
      return { tools: liveCatalog, errors: [], cleanup: async () => { events.push('close-live') } }
    })
    const internals = agent as any

    try {
      internals.installMcpTools(cachedCatalog, async () => { events.push('close-cached') })
      const run = internals.executeTool.bind(agent)

      exposeSelectedToolForTest(agent)
      await expect(run(toolName, { value: 'first' })).resolves.toBe('live:first')
      await expect(run(toolName, { value: 'second' })).resolves.toBe('live:second')

      expect(events).toEqual(['load-live-schema', 'close-cached', 'execute-live', 'execute-live'])
      expect(cachedCalls).toBe(0)
      expect(liveCalls).toBe(2)
      expect(load).toHaveBeenCalledTimes(1)
      expect(load).toHaveBeenCalledWith(workspacePath, {
        enabled: true,
        eager: true,
        onlyServerName: 'trusted_server',
        persistSchemaCache: false,
      })
    } finally {
      load.mockRestore()
      await Promise.all([...internals.mcpClientGenerations].map((generation: object) => internals.retireMcpClientGeneration(generation)))
    }
  })

  it('fails visibly and executes neither client when the live schema differs', async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'deepseek-agent-mcp-changed-'))
    const agent = createAgent(workspacePath)
    let cachedCalls = 0
    let liveCalls = 0
    const cachedTool = mcpTool(async () => { cachedCalls++; return 'cached result' })
    const changedTool = mcpTool(async () => { liveCalls++; return 'live result' }, {
      type: 'object', properties: { other: { type: 'number' } }, required: ['other'], additionalProperties: false,
    })
    const cachedCatalog = largeCatalog(cachedTool)
    const changedCatalog = largeCatalog(changedTool)
    const load = spyOn(mcp, 'loadMcpTools').mockResolvedValue({
      tools: changedCatalog, errors: [], cleanup: async () => {},
    })
    const internals = agent as any

    try {
      internals.installMcpTools(cachedCatalog, async () => {})
      exposeSelectedToolForTest(agent)
      const result = JSON.parse(await internals.executeTool(toolName, { value: 'first' }))

      expect(result).toMatchObject({
        schemaVersion: 1,
        status: 'error',
        error: { code: 'MCP_SCHEMA_CHANGED' },
      })
      expect(result.error.message).toContain('No MCP tool was executed')
      expect(cachedCalls).toBe(0)
      expect(liveCalls).toBe(0)
      expect(load).toHaveBeenCalledTimes(1)
    } finally {
      load.mockRestore()
      await Promise.all([...internals.mcpClientGenerations].map((generation: object) => internals.retireMcpClientGeneration(generation)))
    }
  })

  it('does not let cached schemas authorize a server that now requires approval', async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'deepseek-agent-mcp-approval-'))
    const agent = createAgent(workspacePath)
    let calls = 0
    const cachedTool = mcpTool(async () => { calls++; return 'must not run' })
    const approval = { canonicalPath: join(workspacePath, 'mcp.json'), hash: 'approval-required' }
    const load = spyOn(mcp, 'loadMcpTools').mockResolvedValue({ tools: [], errors: [], approval })
    const internals = agent as any

    try {
      internals.installMcpTools(largeCatalog(cachedTool), async () => {})
      exposeSelectedToolForTest(agent)
      const result = JSON.parse(await internals.executeTool(toolName, { value: 'first' }))

      expect(result.error.code).toBe('MCP_SCHEMA_CHANGED')
      expect(result.error.message).toContain('No MCP tool was executed')
      expect(agent.mcpApprovalRequired).toEqual(approval)
      expect(calls).toBe(0)
      expect(load).toHaveBeenCalledTimes(1)
    } finally {
      load.mockRestore()
      await Promise.all([...internals.mcpClientGenerations].map((generation: object) => internals.retireMcpClientGeneration(generation)))
    }
  })
})
