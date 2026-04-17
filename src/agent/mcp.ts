import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { join } from 'path'
import type { Tool } from '../tools/types.js'
import { readJson } from '../utils/fs.js'

interface StdioServer {
  transport: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface HttpServer {
  transport: 'http'
  url: string
}

type McpServerConfig = StdioServer | HttpServer

interface McpConfig {
  servers: Record<string, McpServerConfig>
}

async function loadConfig(): Promise<McpConfig | null> {
  const path = join(process.cwd(), '.deepseek', 'mcp.json')
  try {
    return await readJson<McpConfig>(path)
  } catch {
    return null
  }
}

export async function loadMcpTools(): Promise<{ tools: Tool[]; errors: string[] }> {
  const config = await loadConfig()
  if (!config?.servers) return { tools: [], errors: [] }

  const tools: Tool[] = []
  const errors: string[] = []

  for (const [serverName, serverConfig] of Object.entries(config.servers)) {
    try {
      const client = new Client({ name: 'deepseek-code', version: '0.1.0' })

      const transport = serverConfig.transport === 'stdio'
        ? new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args ?? [],
            env: { ...process.env, ...serverConfig.env } as Record<string, string>,
          })
        : new StreamableHTTPClientTransport(new URL(serverConfig.url))

      await client.connect(transport)

      const { tools: mcpTools } = await client.listTools()

      for (const mcpTool of mcpTools) {
        tools.push({
          name: `${serverName}__${mcpTool.name}`,
          description: `[MCP:${serverName}] ${mcpTool.description ?? ''}`,
          parameters: mcpTool.inputSchema as object,
          async execute(args) {
            const result = await client.callTool({ name: mcpTool.name, arguments: args })
            const content = result.content as { type: string; text?: string }[]
            return content
              .filter((c) => c.type === 'text' && c.text)
              .map((c) => c.text!)
              .join('\n')
          },
        })
      }
    } catch (e) {
      const msg = `MCP server '${serverName}': ${(e as Error).message}`
      errors.push(msg)
    }
  }

  return { tools, errors }
}
