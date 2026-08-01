import { describe, expect, it } from 'bun:test'
import { buildBedrockToolsPrompt } from '../src/agent/agent.js'
import type { Tool } from '../src/tools/types.js'

const mcpTool: Tool = {
  name: 'fixture__echo',
  description: 'Echoes MCP test input',
  parameters: { type: 'object', properties: {} },
  async execute() { return 'ok' },
}

describe('Agent MCP tools on Bedrock R1', () => {
  it('adds enabled MCP tools to the prompt-based tool definition', () => {
    expect(buildBedrockToolsPrompt([mcpTool])).toContain('<tool name="fixture__echo">')
  })
})
