import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import type { Tool } from '../tools/types.js'
import { auditLog, type AuditEvent } from './auditLog.js'
import { canonicalPath, hashTrustedContent, hashTrustedFile, WorkspaceTrustStore, type TrustedArtifact } from '../settings/trust.js'
import pkg from '../../package.json' with { type: 'json' }
import { loadInstalledPlugins } from '../plugins/loader.js'
import { resolvePluginVariables } from '../plugins/variables.js'

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

/** Stable model-facing name that fits the 64-character function-name limit. */
export function mcpToolName(serverName: string, rawName: string): string {
  const joined = `${serverName}__${rawName}`
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_')
  if (normalized === joined && normalized.length <= 64) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, 12)
  return `${normalized.slice(0, 51)}_${hash}`
}

/** Preserves structured output and turns MCP isError into a failed agent tool call. */
export function formatMcpToolResult(result: { content?: unknown; structuredContent?: unknown; isError?: boolean }): string {
  const blocks = Array.isArray(result.content) ? result.content : []
  const text = blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n')
  if (result.isError) throw new Error(text || 'MCP tool returned an error')
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent)
  if (text) return text
  return blocks.length ? JSON.stringify(blocks) : '(empty MCP result)'
}

/** Default time allowed for an MCP server to connect; loadMcpTools clamps overrides to 100ms–60s. */
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

/** Minimal system PATH used when the parent environment has none. */
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

/** Reads and shallow-validates `.deepseek/mcp.json`, returning it with the trust artifact (canonical path + content hash) or null. */
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

interface McpSource {
  config: McpConfig
  artifact: TrustedArtifact
  cwd: string
  prefix: string
}

function contained(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Accepts the native and Claude-style MCP config shapes used by installed plugins. */
function pluginServers(value: unknown, pluginRoot: string): McpConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const servers = (record.servers ?? record.mcpServers ?? record) as Record<string, unknown>
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return null
  const normalized: Record<string, McpServerConfig> = {}
  for (const [name, raw] of Object.entries(servers)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const spec = raw as Record<string, unknown>
    if (typeof spec.command === 'string') {
      normalized[name] = {
        transport: 'stdio',
        command: resolvePluginVariables(spec.command, pluginRoot),
        args: Array.isArray(spec.args) ? spec.args.map(arg => resolvePluginVariables(String(arg), pluginRoot)) : [],
        env: spec.env && typeof spec.env === 'object' && !Array.isArray(spec.env)
          ? Object.fromEntries(Object.entries(spec.env).map(([key, val]) => [key, resolvePluginVariables(String(val), pluginRoot)])) : {},
      }
    } else if (typeof spec.url === 'string') {
      normalized[name] = { transport: 'http', url: resolvePluginVariables(spec.url, pluginRoot) }
    } else return null
  }
  return { servers: normalized }
}

/** Collects plugin MCP files and inline manifest configs without following paths outside the plugin. */
async function loadMcpSources(cwd: string): Promise<{ sources: McpSource[]; errors: string[] }> {
  const sources: McpSource[] = []
  const errors: string[] = []
  const project = await loadConfig(cwd)
  if (project) sources.push({ ...project, cwd, prefix: '' })

  for (const plugin of loadInstalledPlugins()) {
    const specs = ['.mcp.json', ...[plugin.manifest.mcpServers ?? []].flat()]
    const seen = new Set<string>()
    for (const spec of specs) {
      if (typeof spec === 'string') {
        const path = resolve(plugin.path, spec)
        try {
          const canonical = await canonicalPath(path)
          if (!contained(await canonicalPath(plugin.path), canonical)) throw new Error('path leaves plugin root')
          if (seen.has(canonical)) continue
          seen.add(canonical)
          const content = await readFile(canonical, 'utf8')
          const config = pluginServers(JSON.parse(content), plugin.path)
          if (!config) throw new Error('invalid MCP server configuration')
          sources.push({ config, artifact: { canonicalPath: canonical, hash: hashTrustedContent(`${plugin.entry.commitHash ?? ''}\0${content}`) }, cwd: plugin.path, prefix: `${plugin.entry.name}__` })
        } catch (error) {
          if (spec !== '.mcp.json' || (error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`Plugin '${plugin.entry.name}' MCP ${spec}: ${(error as Error).message}`)
        }
      } else {
        const config = pluginServers(spec, plugin.path)
        if (!config) { errors.push(`Plugin '${plugin.entry.name}' has invalid inline MCP configuration`); continue }
        const manifestFile = join(plugin.path, 'plugin.json')
        const fallback = join(plugin.path, '.claude-plugin', 'plugin.json')
        const artifact = await hashTrustedFile(manifestFile).catch(() => hashTrustedFile(fallback))
        artifact.hash = hashTrustedContent(`${plugin.entry.commitHash ?? ''}\0${artifact.hash}`)
        sources.push({ config, artifact, cwd: plugin.path, prefix: `${plugin.entry.name}__` })
      }
    }
  }
  return { sources, errors }
}

/** Closes an MCP client, falling back to closing the raw transport if the client close fails. Never throws. */
async function closeClient(client: Client | undefined, transport: StdioClientTransport | StreamableHTTPClientTransport | undefined): Promise<void> {
  try { await client?.close() } catch {
    await transport?.close().catch(() => undefined)
  }
}

/** Races an operation against a timer, rejecting with `message` after `timeoutMs`. Does not cancel the underlying operation. */
function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    operation.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

/** Records trust for a workspace or plugin MCP config, refusing if it changed since the approval request. */
export async function approveMcpConfig(cwd: string, approval: McpApprovalRequest, trustFile?: string): Promise<void> {
  const { sources } = await loadMcpSources(cwd)
  const current = sources.find(source => source.artifact.canonicalPath === approval.canonicalPath)?.artifact
  if (!current || current.hash !== approval.hash) {
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

/**
 * Connects to trusted project and plugin MCP servers and exposes their tools as `<server>__<tool>`.
 * Returns the first pending `approval` while still connecting approved configs. Per-server
 * failures are collected in `errors` rather than thrown; `cleanup` closes all connected clients.
 */
export async function loadMcpTools(cwd = process.cwd(), options: McpLoadOptions = {}): Promise<McpLoadResult> {
  if (!options.enabled) return { tools: [], errors: [] }
  const { sources, errors } = await loadMcpSources(cwd)
  const trust = new WorkspaceTrustStore(cwd, options.trustFile)
  const tools: Tool[] = []
  const cleanups: Array<() => Promise<void>> = []
  const serverNames = new Set<string>()
  let approval: McpApprovalRequest | undefined
  const initialTimeoutMs = Math.max(100, Math.min(options.initialTimeoutMs ?? MCP_INITIAL_TIMEOUT_MS, 60_000))

  for (const source of sources) {
    if (!await trust.isMcpApproved(source.artifact)) {
      approval ??= source.artifact
      continue
    }
    for (const [rawServerName, serverConfig] of Object.entries(source.config.servers)) {
    const serverName = `${source.prefix}${rawServerName}`
    if (serverNames.has(serverName)) {
      errors.push(`MCP server name collision: '${serverName}' is declared more than once`)
      continue
    }
    serverNames.add(serverName)
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
            cwd: source.cwd,
            env: createMcpProcessEnvironment(options.environment, serverConfig.env ?? {}),
          })
        : new StreamableHTTPClientTransport(new URL(serverConfig.url))

      await withTimeout(connectedClient.connect(transport), initialTimeoutMs, `MCP server '${serverName}' connection timed out after ${initialTimeoutMs}ms`)

      // Log audit event after successful connection
      await auditLog(buildMcpLoadEvent(serverName, serverConfig.transport))

      const { tools: mcpTools } = await withTimeout(connectedClient.listTools(), initialTimeoutMs, `MCP server '${serverName}' tool listing timed out`)

      for (const mcpTool of mcpTools) {
        const name = mcpToolName(serverName, mcpTool.name)
        if (tools.some(tool => tool.name === name)) {
          errors.push(`MCP tool name collision: ${serverName}/${mcpTool.name} maps to '${name}'`)
          continue
        }
        tools.push({
          name,
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
            if ('toolResult' in result) throw new Error(`MCP tool '${mcpTool.name}' returned an unsupported task result`)
            return formatMcpToolResult(result)
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
  }

  return {
    tools,
    errors,
    ...(approval ? { approval } : {}),
    ...(cleanups.length ? { cleanup: async () => { await Promise.allSettled(cleanups.map(cleanup => cleanup())) } } : {}),
  }
}
