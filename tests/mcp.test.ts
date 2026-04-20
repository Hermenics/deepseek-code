import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'

const MCP_DIR = join(process.cwd(), '.deepseek')
const MCP_PATH = join(MCP_DIR, 'mcp.json')

describe('MCP config', () => {
  it('loadMcpTools returns empty tools when no mcp.json exists', async () => {
    // Ensure no mcp.json
    await rm(MCP_PATH, { force: true })
    const { loadMcpTools } = await import('../src/agent/mcp.js')
    const result = await loadMcpTools()
    expect(result.tools).toBeArray()
    expect(result.tools.length).toBe(0)
  })

  it('loadMcpTools returns empty tools for empty servers config', async () => {
    await mkdir(MCP_DIR, { recursive: true })
    await Bun.write(MCP_PATH, JSON.stringify({ servers: {} }))
    // Re-import to get fresh module
    const { loadMcpTools } = await import('../src/agent/mcp.js')
    const result = await loadMcpTools()
    expect(result.tools).toBeArray()
    expect(result.tools.length).toBe(0)
    await rm(MCP_PATH, { force: true })
  })

  it('loadMcpTools returns errors array', async () => {
    await rm(MCP_PATH, { force: true })
    const { loadMcpTools } = await import('../src/agent/mcp.js')
    const result = await loadMcpTools()
    expect(result.errors).toBeArray()
  })
})
