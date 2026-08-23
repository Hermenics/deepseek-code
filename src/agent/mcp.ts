import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFile } from 'node:fs/promises'
import { join } from 'path'
import { tmpdir } from 'node:os'
import type { Tool } from '../tools/types.js'
import { auditLog, type AuditEvent } from './auditLog.js'
import { canonicalPath, hashTrustedContent, hashTrustedFile, WorkspaceTrustStore, type TrustedArtifact } from '../settings/trust.js'
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
  trustFile?: string
  initialTimeoutMs?: number
}

export type McpApprovalRequest = TrustedArtifact

export const MCP_INITIAL_TIMEOUT_MS = 10_000

/**
 * The only inherited process values MCP stdio servers need by default.
 *
 * Windows servers additionally need SystemRoot/COMSPEC/PATHEXT — without them
 * most executables fail to start — and use TEMP/TMP rather than TMPDIR.
 */
export function createMcpEnvironment(environment: Record<string, string | undefined> = process.env): Record<string, string> {
  const base: Record<string, string> = {
    PATH: environment.PATH || defaultBinPath(),
    ...(environment.LANG ? { LANG: environment.LANG } : {}),
  }
  if (process.platform === 'win32') {
    const temp = environment.TEMP || environment.TMP || tmpdir()
    return {
      ...base,
      TEMP: temp,
      TMP: temp,
      ...(environment.SystemRoot ? { SystemRoot: environment.SystemRoot } : {}),
      ...(environment.COMSPEC ? { COMSPEC: environment.COMSPEC } : {}),
      ...(environment.PATHEXT ? { PATHEXT: environment.PATHEXT } : {}),
    }
  }
  return { ...base, TMPDIR: environment.TMPDIR || '/tmp' }
}

function defaultBinPath(): string {
  return process.platform === 'win32'
    ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32`
    : '/usr/local/bin:/usr/bin:/bin'
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
 * Produces the environment that is actually handed to the MCP SDK. The SDK
 * merges its own process environment back in, so these safe values deliberately
 * override HOME/USER/SHELL/LOGNAME/TERM after the user-supplied config is
 * sanitized.
 */
export function createMcpProcessEnvironment(
  environment: Record<string, string | undefined> = process.env,
  override: Record<string, string> = {},
): Record<string, string> {
  const safe = sanitizeMcpEnv(createMcpEnvironment(environment), override)
  return {
    ...safe,
    HOME: tmpdir(),
    USER: 'deepseek-mcp',
    LOGNAME: 'deepseek-mcp',
    SHELL: process.platform === 'win32' ? (environment.COMSPEC ?? 'cmd.exe') : '/bin/sh',
    TERM: 'dumb',
  }
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

async function loadConfig(cwd: string): Promise<{ config: McpConfig; artifact: TrustedArtifact } | null> {
  const path = join(cwd, '.deepseek', 'mcp.json')
  try {
    const content = await readFile(path, 'utf8')
    const config = JSON.parse(content) as McpConfig
    if (!config || typeof config !== 'object' || !config.servers || typeof config.servers !== 'object') return null
    return { config, artifact: { canonicalPath: await canonicalPath(path), hash: hashTrustedContent(content) } }
  } catch {
    return null
  }
}

async function closeClient(client: Client | undefined, transport: StdioClientTransport | StreamableHTTPClientTransport | undefined): Promise<void> {
  try { await client?.close() } catch {
    await transport?.close().catch(() => undefined)
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    operation.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

export async function approveMcpConfig(cwd: string, approval: McpApprovalRequest, trustFile?: string): Promise<void> {
  const current = await hashTrustedFile(join(cwd, '.deepseek', 'mcp.json'))
  if (current.canonicalPath !== approval.canonicalPath || current.hash !== approval.hash) {
    throw new Error('MCP configuration changed while approval was pending; review it again.')
  }
  await new WorkspaceTrustStore(cwd, trustFile).approveMcp(current)
}

export interface McpLoadResult {
  tools: Tool[]
  errors: string[]
  approval?: McpApprovalRequest
  cleanup?: () => Promise<void>
}

export async function loadMcpTools(cwd = process.cwd(), options: McpLoadOptions = {}): Promise<McpLoadResult> {
  if (!options.enabled) return { tools: [], errors: [] }
  const loaded = await loadConfig(cwd)
  if (!loaded?.config.servers) return { tools: [], errors: [] }
  const trust = new WorkspaceTrustStore(cwd, options.trustFile)
  if (!await trust.isMcpApproved(loaded.artifact)) return { tools: [], errors: [], approval: loaded.artifact }

  const tools: Tool[] = []
  const errors: string[] = []
  const cleanups: Array<() => Promise<void>> = []
  const initialTimeoutMs = Math.max(100, Math.min(options.initialTimeoutMs ?? MCP_INITIAL_TIMEOUT_MS, 60_000))

  for (const [serverName, serverConfig] of Object.entries(loaded.config.servers)) {
    let client: Client | undefined
    let transport: StdioClientTransport | StreamableHTTPClientTransport | undefined
    try {
      // Validate command before creating transport (stdio only)
      if (serverConfig.transport === 'stdio') {
        validateMcpCommand(serverConfig.command)
      }

      const connectedClient = new Client({ name: 'deepseek-code', version: pkg.version })
      client = connectedClient

      transport = serverConfig.transport === 'stdio'
        ? new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args ?? [],
            cwd,
            env: createMcpProcessEnvironment(options.environment, serverConfig.env ?? {}),
          })
        : new StreamableHTTPClientTransport(new URL(serverConfig.url))

      await withTimeout(connectedClient.connect(transport), initialTimeoutMs, `MCP server '${serverName}' connection timed out after ${initialTimeoutMs}ms`)

      // Log audit event after successful connection
      await auditLog(buildMcpLoadEvent(serverName, serverConfig.transport))

      const { tools: mcpTools } = await connectedClient.listTools()

      for (const mcpTool of mcpTools) {
        tools.push({
          name: `${serverName}__${mcpTool.name}`,
          description: `[MCP:${serverName}] ${mcpTool.description ?? ''}`,
          parameters: mcpTool.inputSchema as object,
          async execute(args) {
            // Add timeout to prevent hanging on unresponsive MCP servers
            const timeoutMs = 30_000
            const result = await withTimeout(
              connectedClient.callTool({ name: mcpTool.name, arguments: args }),
              timeoutMs,
              `MCP tool '${mcpTool.name}' timed out after ${timeoutMs / 1000}s`,
            ) as Awaited<ReturnType<typeof connectedClient.callTool>>
            const content = result.content as { type: string; text?: string }[]
            return content
              .filter((c) => c.type === 'text' && c.text)
              .map((c) => c.text!)
              .join('\n')
          },
        })
      }
      cleanups.push(() => closeClient(client, transport))
    } catch (e) {
      await closeClient(client, transport)
      const msg = `MCP server '${serverName}': ${(e as Error).message}`
      errors.push(msg)
    }
  }

  return {
    tools,
    errors,
    ...(cleanups.length ? { cleanup: async () => { await Promise.allSettled(cleanups.map(cleanup => cleanup())) } } : {}),
  }
}
