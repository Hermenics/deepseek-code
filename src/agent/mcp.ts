import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFile, realpath } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import type { Tool } from '../tools/types.js'
import type { PromptImage } from '../types/input.js'
import { auditLog, type AuditEvent } from './auditLog.js'
import { canonicalPath, getMcpSchemaCacheIssue, hashTrustedContent, hashTrustedFile, WorkspaceTrustStore, type CachedMcpSchemas, type CachedMcpToolSchema, type TrustedArtifact } from '../settings/trust.js'
import pkg from '../../package.json' with { type: 'json' }
import { loadInstalledPlugins } from '../plugins/loader.js'
import { resolvePluginVariables } from '../plugins/variables.js'
import { sandboxAvailable } from '../utils/platform.js'
import {
  createMcpElicitationRedactionTracker,
  handleMcpElicitationRequest,
  type McpElicitationHandler,
  type McpElicitationRedaction,
  type McpElicitationRedactionTracker,
} from './mcpElicitation.js'

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
  /** Advertise form-mode elicitation only for an interactive UI session. */
  enableFormElicitation?: boolean
  /** Kept dynamic by Agent so clients created during startup use the current session handler. */
  mcpElicitationHandler?: McpElicitationHandler
  environment?: Record<string, string | undefined>
  trustFile?: string
  initialTimeoutMs?: number
  /** Force connection and catalog listing even when an approved stdio schema cache exists. */
  eager?: boolean
  /** Restrict loading to one fully-qualified server for isolated first-use validation. */
  onlyServerName?: string
  /** Avoid persisting a staged schema before the host compares it with the installed catalog. */
  persistSchemaCache?: boolean
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

const MCP_IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function protectedMcpVisualKind(block: unknown): 'image' | 'binary' | undefined {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return undefined
  const candidate = block as Record<string, unknown>
  if (candidate.type === 'image') return 'image'
  if (candidate.type !== 'resource' || !candidate.resource || typeof candidate.resource !== 'object' || Array.isArray(candidate.resource)) return undefined
  const resource = candidate.resource as Record<string, unknown>
  if (typeof resource.mimeType === 'string' && resource.mimeType.toLowerCase().startsWith('image/')) return 'image'
  // Unknown binary resource types may contain images, so omit them when elicitation values are active.
  return typeof resource.blob === 'string' ? 'binary' : undefined
}

/** Retains raw schema keywords for the elicitation validator after SDK request validation. */
function preserveRawMcpElicitationSchema() {
  return {
    shape: ElicitRequestSchema.shape,
    safeParse(data: unknown) {
      const parsed = ElicitRequestSchema.safeParse(data)
      if (!parsed.success || parsed.data.params.mode === 'url') return parsed
      const rawSchema = (data as { params: { requestedSchema: unknown } }).params.requestedSchema
      return {
        ...parsed,
        data: {
          ...parsed.data,
          params: { ...parsed.data.params, requestedSchema: rawSchema },
        },
      }
    },
  } as unknown as typeof ElicitRequestSchema
}

/**
 * Preserves structured output and turns MCP isError into a failed agent tool call. Elicitation
 * values are redacted before the result can reach conversation history, audit logs, or events.
 * Image blocks go to `attachImage` (when the model accepts images) instead of into the text as base64.
 */
export function formatMcpToolResult(
  result: { content?: unknown; structuredContent?: unknown; isError?: boolean },
  attachImage?: (image: PromptImage, label: string) => void,
  toolName = 'MCP tool',
  redaction?: McpElicitationRedaction,
): string {
  const blocks = Array.isArray(result.content) ? result.content : []
  const textBlocks = blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text as string)
  const text = redaction?.redactTextBlocks(textBlocks) ?? textBlocks.join('\n')
  const structuredContent = result.structuredContent === undefined
    ? undefined
    : redaction?.redactValue(result.structuredContent) ?? result.structuredContent
  if (result.isError) {
    const partial = {
      ...(text ? { text } : {}),
      ...(structuredContent === undefined ? {} : { structuredContent }),
    }
    throw Object.assign(new Error(text || 'MCP tool returned an error'), {
      code: 'MCP_TOOL_ERROR',
      ...(Object.keys(partial).length ? { partial } : {}),
    })
  }
  const images = blocks.filter(block => block?.type === 'image' && typeof block.data === 'string' && MCP_IMAGE_TYPES.has(block.mimeType))
  const protectedVisuals = redaction?.hasValues()
    ? blocks.map(block => ({ block, kind: protectedMcpVisualKind(block) })).filter(item => item.kind)
    : []
  const protectedImages = protectedVisuals.filter(item => item.kind === 'image')
  const protectedBinaryResources = protectedVisuals.filter(item => item.kind === 'binary')
  const omitImagesForRedaction = protectedVisuals.length > 0
  if (!omitImagesForRedaction) {
    for (const block of images) attachImage?.({ mediaType: block.mimeType, data: block.data }, `image returned by ${toolName}`)
  }
  const imageNote = omitImagesForRedaction
    ? [
        ...(protectedImages.length ? [`[${protectedImages.length} image${protectedImages.length === 1 ? '' : 's'} omitted to protect elicitation values]`] : []),
        ...(protectedBinaryResources.length ? [`[${protectedBinaryResources.length} binary resource${protectedBinaryResources.length === 1 ? '' : 's'} omitted to protect elicitation values]`] : []),
      ].join('\n')
    : images.length === 0 ? ''
      : attachImage ? `[${images.length} image${images.length === 1 ? '' : 's'} attached for the model]`
      : `[${images.length} image${images.length === 1 ? '' : 's'} omitted: the current model does not accept images]`
  const others = blocks.filter(block => block?.type !== 'text' && !images.includes(block) && !protectedVisuals.some(item => item.block === block))
  if (structuredContent !== undefined) return [JSON.stringify(structuredContent), imageNote].filter(Boolean).join('\n')
  if (text || imageNote) return [text, others.length ? JSON.stringify(redaction?.redactValue(others) ?? others) : '', imageNote].filter(Boolean).join('\n')
  return blocks.length ? JSON.stringify(redaction?.redactValue(blocks) ?? blocks) : '(empty MCP result)'
}

function redactMcpError(error: unknown, redaction: McpElicitationRedaction): Error {
  if (error instanceof Error && !redaction.hasValues()) return error
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : undefined
  const rawMessage = error instanceof Error ? error.message
    : typeof source?.message === 'string' ? source.message : String(error)
  const rawName = error instanceof Error ? error.name
    : typeof source?.name === 'string' ? source.name : 'Error'
  const safe = new Error(redaction.redactText(rawMessage))
  safe.name = redaction.redactText(rawName)
  for (const key of source ? Object.getOwnPropertyNames(source) : []) {
    const value = source![key]
    if (key === 'message' || key === 'name' || key === 'stack' || key === 'cause') continue
    Object.defineProperty(safe, key, {
      value: redaction.redactValue(value),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return safe
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

/** Validates the command field of an MCP stdio server. */
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

// shortcut: stdio MCP is read-only and network-isolated, upgrade when per-server capabilities can be enforced.
/** Builds a read-only, network-isolated Bubblewrap launch for a local MCP server. */
function buildMcpSandboxArgs(command: string, args: string[], cwd: string): string[] {
  const root = resolve(cwd)
  const runtimeExecutable = realpathSync(process.execPath)
  const runtimeDirectory = dirname(runtimeExecutable)
  let sandboxCommand = command
  if (isAbsolute(command)) {
    try {
      const executable = realpathSync(command)
      if (dirname(executable) === runtimeDirectory) sandboxCommand = `/opt/mcp-runtime/${basename(executable)}`
    } catch { /* Let bubblewrap report missing commands through the normal MCP load error. */ }
  }
  return [
    '--die-with-parent', '--new-session',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/bin', '/bin', '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
    '--ro-bind', root, '/mnt',
    '--ro-bind', runtimeDirectory, '/opt/mcp-runtime',
    '--tmpfs', '/tmp',
    ...(root === '/mnt' ? [] : ['--ro-bind', root, root]),
    '--dev', '/dev', '--proc', '/proc', '--unshare-net', '--unshare-pid', '--unshare-ipc', '--unshare-uts',
    '--setenv', 'PATH', '/opt/mcp-runtime:/usr/local/bin:/usr/bin:/bin',
    '--setenv', 'HOME', '/tmp', '--setenv', 'TMPDIR', '/tmp', '--chdir', '/mnt',
    '--', sandboxCommand, ...args,
  ]
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
async function loadMcpSources(cwd: string, onlyServerName?: string): Promise<{ sources: McpSource[]; errors: string[] }> {
  const sources: McpSource[] = []
  const errors: string[] = []
  const project = await loadConfig(cwd)
  if (project) sources.push({ ...project, cwd, prefix: '' })

  for (const plugin of loadInstalledPlugins()) {
    const pluginPrefix = `${plugin.entry.name}__`
    const pluginCouldProvideSelectedServer = onlyServerName === undefined || onlyServerName.startsWith(pluginPrefix)
    const specs = ['.mcp.json', ...[plugin.manifest.mcpServers ?? []].flat()]
    const seen = new Set<string>()
    for (const spec of specs) {
      if (typeof spec === 'string') {
        const path = resolve(plugin.path, spec)
        try {
          const canonical = await realpath(path)
          if (!contained(await canonicalPath(plugin.path), canonical)) throw new Error('path leaves plugin root')
          if (seen.has(canonical)) continue
          seen.add(canonical)
          const content = await readFile(canonical, 'utf8')
          const config = pluginServers(JSON.parse(content), plugin.path)
          if (!config) throw new Error('invalid MCP server configuration')
          sources.push({ config, artifact: { canonicalPath: canonical, hash: hashTrustedContent(`${plugin.entry.commitHash ?? ''}\0${content}`) }, cwd: plugin.path, prefix: `${plugin.entry.name}__` })
        } catch (error) {
          if (pluginCouldProvideSelectedServer && (spec !== '.mcp.json' || (error as NodeJS.ErrnoException).code !== 'ENOENT')) {
            errors.push(`Plugin '${plugin.entry.name}' MCP ${spec}: ${(error as Error).message}`)
          }
        }
      } else {
        const config = pluginServers(spec, plugin.path)
        if (!config) {
          if (pluginCouldProvideSelectedServer) errors.push(`Plugin '${plugin.entry.name}' has invalid inline MCP configuration`)
          continue
        }
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
  /** Optional cache optimization notices that do not prevent live MCP tools from working. */
  warnings?: string[]
  approval?: McpApprovalRequest
  cleanup?: () => Promise<void>
}

/**
 * Connects to trusted project and plugin MCP servers and exposes their tools as `<server>__<tool>`.
 * Approved stdio schemas are reused without starting the server; the first tool use reconnects,
 * verifies the live catalog, and only then calls the requested tool. Cold caches and `eager` loads
 * keep the current connect-and-list behavior. Returns the first pending `approval` while still
 * connecting approved configs. Live/configuration failures are collected in `errors`; optional cache
 * optimization notices are separated into `warnings`.
 */
export async function loadMcpTools(cwd = process.cwd(), options: McpLoadOptions = {}): Promise<McpLoadResult> {
  if (!options.enabled) return { tools: [], errors: [] }
  const { sources, errors } = await loadMcpSources(cwd, options.onlyServerName)
  const trust = new WorkspaceTrustStore(cwd, options.trustFile)
  const tools: Tool[] = []
  const warnings: string[] = []
  const cleanups: Array<() => Promise<void>> = []
  const serverNames = new Set<string>()
  let approval: McpApprovalRequest | undefined
  const initialTimeoutMs = Math.max(100, Math.min(options.initialTimeoutMs ?? MCP_INITIAL_TIMEOUT_MS, 60_000))
  let cleanupPromise: Promise<void> | undefined

  for (const source of sources) {
    if (options.onlyServerName && !Object.keys(source.config.servers).some(name => `${source.prefix}${name}` === options.onlyServerName)) continue
    if (!await trust.isMcpApproved(source.artifact)) {
      try {
        await trust.invalidateMcpSchemas(source.artifact)
      } catch (error) {
        warnings.push(`MCP schema cache for '${source.artifact.canonicalPath}' could not be invalidated; approval is still required: ${(error as Error).message}`)
      }
      approval ??= source.artifact
      continue
    }

    let cachedSchemas: CachedMcpSchemas | null = null
    try {
      cachedSchemas = await trust.getMcpSchemas(source.artifact)
    } catch (error) {
      warnings.push(`MCP schema cache for '${source.artifact.canonicalPath}' could not be read; live tools remain available: ${(error as Error).message}`)
    }
    // MCP server names are configuration keys, so they can legally collide with
    // Object.prototype names (including the special __proto__ setter).
    const schemaCache = Object.assign(Object.create(null), cachedSchemas ?? {}) as CachedMcpSchemas
    let schemaCacheDisabled = false
    for (const [rawServerName, serverConfig] of Object.entries(source.config.servers)) {
      const serverName = `${source.prefix}${rawServerName}`
      if (options.onlyServerName && serverName !== options.onlyServerName) continue
      if (serverNames.has(serverName)) {
        errors.push(`MCP server name collision: '${serverName}' is declared more than once`)
        continue
      }
      serverNames.add(serverName)
      try {
        if (serverConfig.transport === 'stdio') {
          validateMcpCommand(serverConfig.command)
          if (!sandboxAvailable()) throw new Error('MCP stdio servers require a working Linux bubblewrap sandbox')
        }

        const cachedTools = serverConfig.transport === 'stdio' && !options.eager && cachedSchemas &&
          Object.prototype.hasOwnProperty.call(cachedSchemas, rawServerName)
          ? cachedSchemas?.[rawServerName]
          : undefined
        // An empty cached catalog has no tool invocation that could trigger live validation.
        // Re-list it on load so newly added tools cannot remain invisible forever.
        if (cachedTools?.length) {
          const lazy = createLazyServerTools({
            cwd,
            source,
            rawServerName,
            serverName,
            serverConfig,
            cachedTools,
            options,
            trust,
            initialTimeoutMs,
            onCleanup: cleanup => cleanups.push(cleanup),
          })
          for (const tool of lazy) {
            if (tools.some(existing => existing.name === tool.name)) {
              errors.push(`MCP tool name collision: ${serverName}/${tool.name} maps to '${tool.name}'`)
              continue
            }
            tools.push(tool)
          }
          continue
        }

        const connected = await connectAndListMcpServer(source, serverName, serverConfig, options, initialTimeoutMs)
        try {
          await assertMcpSourceApproved(cwd, source, trust, serverName)
        } catch (error) {
          await closeConnectedMcpServer(connected)
          throw error
        }
        cleanups.push(() => closeConnectedMcpServer(connected))
        const cachedToolsFromServer = connected.tools.map(toCachedMcpTool)
        if (serverConfig.transport === 'stdio' && !schemaCacheDisabled && options.persistSchemaCache !== false) {
          schemaCache[rawServerName] = cachedToolsFromServer
          const cacheIssue = getMcpSchemaCacheIssue(schemaCache)
          if (cacheIssue) {
            schemaCacheDisabled = true
            await trust.invalidateMcpSchemas(source.artifact).catch(() => undefined)
            warnings.push(`MCP server '${serverName}' schema cache optimization was skipped because ${cacheIssue}; live tools remain available.`)
          } else {
            try {
              const saved = await trust.saveMcpSchemas(source.artifact, schemaCache)
              if (!saved) errors.push(`MCP server '${serverName}' schema cache was not saved because its configuration is no longer approved.`)
            } catch (error) {
              warnings.push(`MCP server '${serverName}' schema cache could not be saved; the live tools remain available: ${(error as Error).message}`)
            }
          }
        }
        for (const mcpTool of cachedToolsFromServer) {
          const name = mcpToolName(serverName, mcpTool.name)
          if (tools.some(tool => tool.name === name)) {
            errors.push(`MCP tool name collision: ${serverName}/${mcpTool.name} maps to '${name}'`)
            continue
          }
          tools.push(createMcpTool(mcpTool, name, serverName, connected.client, cwd, source, trust, connected.elicitationRedactions))
        }
      } catch (error) {
        const msg = `MCP server '${serverName}': ${(error as Error).message}`
        errors.push(msg)
      }
    }
  }

  return {
    tools,
    errors,
    ...(warnings.length ? { warnings } : {}),
    ...(approval ? { approval } : {}),
    ...(cleanups.length || sources.length ? { cleanup: () => {
      if (cleanupPromise) return cleanupPromise
      cleanupPromise = Promise.allSettled(cleanups.map(async cleanup => cleanup())).then(() => undefined)
      return cleanupPromise
    } } : {}),
  }
}

interface ConnectedMcpServer {
  client: Client
  transport: StdioClientTransport | StreamableHTTPClientTransport
  tools: Array<{ name: string; description?: string; inputSchema: object }>
  elicitationRedactions: McpElicitationRedactionTracker
}

async function closeConnectedMcpServer(connected: ConnectedMcpServer): Promise<void> {
  try { await closeClient(connected.client, connected.transport) }
  finally { connected.elicitationRedactions.dispose() }
}

async function connectAndListMcpServer(
  source: McpSource,
  serverName: string,
  serverConfig: McpServerConfig,
  options: McpLoadOptions,
  timeoutMs: number,
): Promise<ConnectedMcpServer> {
  let client: Client | undefined
  let transport: StdioClientTransport | StreamableHTTPClientTransport | undefined
  const elicitationRedactions = createMcpElicitationRedactionTracker()
  try {
    client = new Client({ name: 'deepseek-code', version: pkg.version }, {
      capabilities: options.enableFormElicitation ? { elicitation: { form: { applyDefaults: true } } } : {},
    })
    if (options.enableFormElicitation) {
      // Preserve the raw schema: the SDK's ElicitRequestSchema strips unknown JSON Schema keywords,
      // including `pattern`, before a typed handler can reject an unsupported constraint.
      client.setRequestHandler(preserveRawMcpElicitationSchema(), async (request, extra) => {
        const result = await handleMcpElicitationRequest(serverName, request.params, options.mcpElicitationHandler, extra.signal)
        if (result.action === 'accept') elicitationRedactions.record(result.content)
        return result
      })
    }
    transport = serverConfig.transport === 'stdio'
      ? new StdioClientTransport({
          command: 'bwrap',
          args: buildMcpSandboxArgs(serverConfig.command, serverConfig.args ?? [], source.cwd),
          cwd: source.cwd,
          env: createMcpProcessEnvironment(options.environment, serverConfig.env ?? {}),
        })
      : new StreamableHTTPClientTransport(new URL(serverConfig.url))

    await withTimeout(client.connect(transport), timeoutMs, `MCP server '${serverName}' connection timed out after ${timeoutMs}ms`)
    await auditLog(buildMcpLoadEvent(serverName, serverConfig.transport))
    const { tools } = await withTimeout(client.listTools(), timeoutMs, `MCP server '${serverName}' tool listing timed out`)
    return {
      client,
      transport,
      tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as object })),
      elicitationRedactions,
    }
  } catch (error) {
    try { await closeClient(client, transport) }
    finally { elicitationRedactions.dispose() }
    throw error
  }
}

function toCachedMcpTool(tool: { name: string; description?: string; inputSchema: object }): CachedMcpToolSchema {
  return {
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema as Record<string, unknown>,
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function sameMcpSchemaSet(expected: CachedMcpToolSchema[], actual: CachedMcpToolSchema[]): boolean {
  const canonical = (tools: CachedMcpToolSchema[]) => tools
    .map(tool => ({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return stableSerialize(canonical(expected)) === stableSerialize(canonical(actual))
}

async function assertMcpSourceApproved(cwd: string, source: McpSource, trust: WorkspaceTrustStore, serverName = 'server'): Promise<void> {
  const current = (await loadMcpSources(cwd)).sources.find(candidate => candidate.artifact.canonicalPath === source.artifact.canonicalPath)
  if (!current || current.artifact.hash !== source.artifact.hash || !await trust.isMcpApproved(source.artifact)) {
    await trust.invalidateMcpSchemas(source.artifact).catch(() => undefined)
    throw new Error(`MCP ${serverName} configuration changed or approval was revoked; reload MCP tools before retrying.`)
  }
}

function createLazyServerTools(input: {
  cwd: string
  source: McpSource
  rawServerName: string
  serverName: string
  serverConfig: McpServerConfig
  cachedTools: CachedMcpToolSchema[]
  options: McpLoadOptions
  trust: WorkspaceTrustStore
  initialTimeoutMs: number
  onCleanup: (cleanup: () => Promise<void>) => void
}): Tool[] {
  let client: Client | undefined
  let transport: StdioClientTransport | StreamableHTTPClientTransport | undefined
  let connection: Promise<Client> | undefined
  let elicitationRedactions: McpElicitationRedactionTracker | undefined
  let disposed = false
  const cleanup = async () => {
    disposed = true
    await connection?.catch(() => undefined)
    try { await closeClient(client, transport) }
    finally {
      elicitationRedactions?.dispose()
      client = undefined
      transport = undefined
    }
  }
  input.onCleanup(cleanup)

  const getClient = async (): Promise<Client> => {
    if (disposed) throw new Error(`MCP server '${input.serverName}' has been closed.`)
    await assertMcpSourceApproved(input.cwd, input.source, input.trust, input.serverName)
    if (disposed) throw new Error(`MCP server '${input.serverName}' has been closed.`)
    if (client) return client
    if (!connection) {
      connection = (async () => {
        const connected = await connectAndListMcpServer(input.source, input.serverName, input.serverConfig, input.options, input.initialTimeoutMs)
        try {
          await assertMcpSourceApproved(input.cwd, input.source, input.trust, input.serverName)
          const liveTools = connected.tools.map(toCachedMcpTool)
          if (!sameMcpSchemaSet(input.cachedTools, liveTools)) {
            await input.trust.invalidateMcpSchemas(input.source.artifact).catch(() => undefined)
            throw new Error(`MCP server '${input.serverName}' catalog changed since its cached schema; no tool was called. Reload MCP tools and review the updated catalog.`)
          }
          client = connected.client
          transport = connected.transport
          elicitationRedactions = connected.elicitationRedactions
          return connected.client
        } catch (error) {
          await closeConnectedMcpServer(connected)
          throw error
        }
      })().catch(error => {
        connection = undefined
        throw error
      })
    }
    const connected = await connection
    if (disposed) throw new Error(`MCP server '${input.serverName}' has been closed.`)
    return connected
  }

  return input.cachedTools.map(mcpTool => {
    const name = mcpToolName(input.serverName, mcpTool.name)
    return {
      name,
      description: `[MCP:${input.serverName}] ${mcpTool.description ?? ''}`,
      parameters: mcpTool.inputSchema as object,
      mcpServerName: input.serverName,
      async execute(args, context) {
        const connectedClient = await getClient()
        await assertMcpSourceApproved(input.cwd, input.source, input.trust, input.serverName)
        const timeoutMs = 30_000
        const redaction = elicitationRedactions?.begin()
        try {
          const result = await connectedClient.callTool({ name: mcpTool.name, arguments: args }, undefined, { signal: context?.signal, timeout: timeoutMs })
            .catch((error: unknown) => {
              const safeError = redaction ? redactMcpError(error, redaction) : error instanceof Error ? error : new Error(String(error))
              if (context?.signal?.aborted) throw safeError
              if (/timed out|timeout/i.test(safeError.message)) throw new Error(`MCP tool '${mcpTool.name}' timed out after ${timeoutMs / 1000}s`)
              throw safeError
            }) as Awaited<ReturnType<typeof connectedClient.callTool>>
          if ('toolResult' in result) throw new Error(`MCP tool '${mcpTool.name}' returned an unsupported task result`)
          return formatMcpToolResult(result, context?.attachImage, mcpTool.name, redaction)
        } finally {
          redaction?.close()
        }
      },
    }
  })
}

function createMcpTool(
  mcpTool: CachedMcpToolSchema,
  name: string,
  serverName: string,
  client: Client,
  cwd: string,
  source: McpSource,
  trust: WorkspaceTrustStore,
  elicitationRedactions: McpElicitationRedactionTracker,
): Tool {
  return {
    name,
    description: `[MCP:${serverName}] ${mcpTool.description ?? ''}`,
    parameters: mcpTool.inputSchema as object,
    mcpServerName: serverName,
    async execute(args, context) {
      await assertMcpSourceApproved(cwd, source, trust, serverName)
      const timeoutMs = 30_000
      const redaction = elicitationRedactions.begin()
      try {
        const result = await client.callTool({ name: mcpTool.name, arguments: args }, undefined, { signal: context?.signal, timeout: timeoutMs })
          .catch((error: unknown) => {
            const safeError = redactMcpError(error, redaction)
            if (context?.signal?.aborted) throw safeError
            if (/timed out|timeout/i.test(safeError.message)) throw new Error(`MCP tool '${mcpTool.name}' timed out after ${timeoutMs / 1000}s`)
            throw safeError
          }) as Awaited<ReturnType<typeof client.callTool>>
        if ('toolResult' in result) throw new Error(`MCP tool '${mcpTool.name}' returned an unsupported task result`)
        return formatMcpToolResult(result, context?.attachImage, mcpTool.name, redaction)
      } finally {
        redaction.close()
      }
    },
  }
}
