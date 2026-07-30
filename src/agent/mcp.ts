import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { join } from 'path'
import type { Tool } from '../tools/types.js'
import { readJson } from '../utils/fs.js'
import { auditLog, type AuditEvent } from './auditLog.js'
import pkg from '../../package.json' with { type: 'json' }

// Environment variables that cannot be overwritten by MCP servers
const CRITICAL_ENV_VARS = new Set([
  'PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'HOME',
  'USER',
  'SHELL',
  'PYTHONPATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'BUN_INSTALL',
])

// Prohibited shell injection patterns in the command field
const SHELL_INJECTION_RE = /[;|`<>]|&&|\|\||\$\(|>>|<</
const PATH_TRAVERSAL_RE = /\.\.[/\\]/

export interface McpLoadOptions {
  enabled?: boolean
  environment?: Record<string, string | undefined>
}

/** The only inherited process values MCP stdio servers need by default. */
export function createMcpEnvironment(environment: Record<string, string | undefined> = process.env): Record<string, string> {
  return {
    PATH: environment.PATH || '/usr/local/bin:/usr/bin:/bin',
    TMPDIR: environment.TMPDIR || '/tmp',
    ...(environment.LANG ? { LANG: environment.LANG } : {}),
  }
}

/**
 * Merges `base` with `override` while blocking overwrite of critical
 * environment variables. Critical vars absent from `base` are also not injected.
 */
export function sanitizeMcpEnv(
  base: Record<string, string>,
  override: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (CRITICAL_ENV_VARS.has(key)) continue
    result[key] = value
  }
  return result
}

/**
 * Valida o campo `command` de um servidor MCP stdio.
 * Lança erro se o comando for vazio, contiver path traversal ou injeção de shell.
 */
export function validateMcpCommand(command: string): void {
  if (command.trim() === '') {
    throw new Error('MCP command cannot be empty')
  }
  if (PATH_TRAVERSAL_RE.test(command)) {
    throw new Error(`MCP command contains path traversal: ${command}`)
  }
  if (SHELL_INJECTION_RE.test(command)) {
    throw new Error(`MCP command contains shell injection characters: ${command}`)
  }
}

/**
 * Builds an audit event for the loading of an MCP server.
 */
export function buildMcpLoadEvent(serverName: string, transport: string): AuditEvent {
  return { type: 'mcp_server_load', serverName, transport }
}

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

async function loadConfig(cwd: string): Promise<McpConfig | null> {
  const path = join(cwd, '.deepseek', 'mcp.json')
  try {
    return await readJson<McpConfig>(path)
  } catch {
    return null
  }
}

export async function loadMcpTools(cwd = process.cwd(), options: McpLoadOptions = {}): Promise<{ tools: Tool[]; errors: string[] }> {
  if (!options.enabled) return { tools: [], errors: [] }
  const config = await loadConfig(cwd)
  if (!config?.servers) return { tools: [], errors: [] }

  const tools: Tool[] = []
  const errors: string[] = []

  for (const [serverName, serverConfig] of Object.entries(config.servers)) {
    try {
      // Validate command before creating transport (stdio only)
      if (serverConfig.transport === 'stdio') {
        validateMcpCommand(serverConfig.command)
      }

      const client = new Client({ name: 'deepseek-code', version: pkg.version })

      const transport = serverConfig.transport === 'stdio'
        ? new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args ?? [],
            env: sanitizeMcpEnv(
              createMcpEnvironment(options.environment),
              serverConfig.env ?? {},
            ),
          })
        : new StreamableHTTPClientTransport(new URL(serverConfig.url))

      await client.connect(transport)

      // Log audit event after successful connection
      await auditLog(buildMcpLoadEvent(serverName, serverConfig.transport))

      const { tools: mcpTools } = await client.listTools()

      for (const mcpTool of mcpTools) {
        tools.push({
          name: `${serverName}__${mcpTool.name}`,
          description: `[MCP:${serverName}] ${mcpTool.description ?? ''}`,
          parameters: mcpTool.inputSchema as object,
          async execute(args) {
            // Add timeout to prevent hanging on unresponsive MCP servers
            const timeoutMs = 30_000
            const result = await Promise.race([
              client.callTool({ name: mcpTool.name, arguments: args }),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error(`MCP tool '${mcpTool.name}' timed out after ${timeoutMs / 1000}s`)),
                  timeoutMs,
                ),
              ),
            ]) as Awaited<ReturnType<typeof client.callTool>>
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
