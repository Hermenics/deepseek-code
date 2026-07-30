import { describe, expect, it, mock } from 'bun:test'
import { DEFAULT_SETTINGS } from '../src/settings/repository.js'
import type { Tool } from '../src/tools/types.js'

const mcpTool: Tool = {
  name: 'fixture__echo',
  description: 'Echoes MCP test input',
  parameters: { type: 'object', properties: {} },
  async execute() { return 'ok' },
}

mock.module('../src/agent/mcp.js', () => ({
  loadMcpTools: async () => ({ tools: [mcpTool], errors: [] }),
}))
mock.module('../src/settings/index.js', () => ({
  loadMergedSettings: async () => ({ ...DEFAULT_SETTINGS, mcp: { enabled: true } }),
}))

const { Agent } = await import('../src/agent/agent.js')

describe('Agent MCP tools on Bedrock R1', () => {
  it('adds enabled MCP tools to the prompt-based tool definition', async () => {
    const agent = new Agent({ provider: 'bedrock', awsRegion: 'us-east-1' })
    await agent.readyPromise

    expect(agent.getToolNames()).toContain('fixture__echo')
    expect(agent.getSystemPrompt()).toContain('<tool name="fixture__echo">')
  })
})
