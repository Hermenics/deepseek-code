import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { acquireFileLease } from '../orchestration/fileLease.js'

export interface TrustedArtifact {
  canonicalPath: string
  hash: string
}
export interface CachedMcpToolSchema {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export type CachedMcpSchemas = Record<string, CachedMcpToolSchema[]>

interface WorkspaceTrustFile {
  schemaVersion: 1
  projects: Record<string, {
    agents: Record<string, string>
    mcp?: TrustedArtifact
    mcpArtifacts?: Record<string, string>
    mcpSchemas?: Record<string, { hash: string; servers: CachedMcpSchemas }>
  }>
}

const DEFAULT_TRUST_FILE = join(homedir(), '.deepseek', 'workspace-trust.json')
const MAX_MCP_SCHEMA_CACHE_SERVERS = 128
const MAX_MCP_SCHEMA_CACHE_TOOLS = 1_024
const MAX_MCP_SCHEMA_CACHE_BYTES = 1_048_576

/** Resolves symlinks for a path, falling back to a plain absolute path when it does not exist. */
export async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path) } catch { return resolve(path) }
}

/** SHA-256 hex digest used to pin approved agent and MCP files to their exact content. */
export function hashTrustedContent(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Reads a file and returns its canonical path together with its content hash for a trust check or approval. */
export async function hashTrustedFile(path: string): Promise<TrustedArtifact> {
  const content = await readFile(path)
  return { canonicalPath: await canonicalPath(path), hash: hashTrustedContent(content) }
}

/** Loads the workspace trust file; a missing, unreadable or wrong-schema file is treated as empty (nothing trusted). */
async function readTrustFile(path: string): Promise<WorkspaceTrustFile> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<WorkspaceTrustFile>
    if (value.schemaVersion !== 1 || !value.projects || typeof value.projects !== 'object') throw new Error('invalid trust file')
    return value as WorkspaceTrustFile
  } catch {
    return { schemaVersion: 1, projects: {} }
  }
}

/** Writes the trust file atomically with owner-only permissions (0700 dir, 0600 file). */
async function writeTrustFile(path: string, value: WorkspaceTrustFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await chmod(dirname(path), 0o700).catch(() => undefined)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await chmod(temporary, 0o600)
    await rename(temporary, path)
    await chmod(path, 0o600)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Per-workspace approvals of project agent and MCP files, keyed by canonical path; an approval stays valid only while the file hash is unchanged. */
export class WorkspaceTrustStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly file = DEFAULT_TRUST_FILE,
  ) {}

  /** Canonical workspace key plus a freshly read trust file state. */
  private async project(): Promise<{ key: string; state: WorkspaceTrustFile }> {
    const key = await canonicalPath(this.workspaceRoot)
    return { key, state: await readTrustFile(this.file) }
  }

  private async updateProject(key: string, update: (project: WorkspaceTrustFile['projects'][string]) => void): Promise<void> {
    const lease = await acquireFileLease(`workspace-trust:${resolve(this.file)}`)
    try {
      const state = await readTrustFile(this.file)
      const project = state.projects[key] ?? { agents: {} }
      update(project)
      state.projects[key] = project
      await writeTrustFile(this.file, state)
    } finally {
      await lease.release()
    }
  }

  /** True if this exact agent file content was approved for the workspace. */
  async isAgentApproved(artifact: TrustedArtifact): Promise<boolean> {
    const { key, state } = await this.project()
    return state.projects[key]?.agents?.[artifact.canonicalPath] === artifact.hash
  }

  /** Records approval of the agent file's current hash for the workspace. */
  async approveAgent(artifact: TrustedArtifact): Promise<void> {
    const key = await canonicalPath(this.workspaceRoot)
    await this.updateProject(key, project => { project.agents[artifact.canonicalPath] = artifact.hash })
  }

  /** True if the workspace's approved MCP config matches this path and hash. */
  async isMcpApproved(artifact: TrustedArtifact): Promise<boolean> {
    const { key, state } = await this.project()
    return isMcpApproved(state.projects[key], artifact)
  }

  /** Records the workspace's MCP config approval, replacing any previous one. */
  async approveMcp(artifact: TrustedArtifact): Promise<void> {
    const key = await canonicalPath(this.workspaceRoot)
    await this.updateProject(key, project => {
      if (project.mcp?.canonicalPath === artifact.canonicalPath) delete project.mcp
      project.mcpArtifacts ??= {}
      project.mcpArtifacts[artifact.canonicalPath] = artifact.hash
      const cached = project.mcpSchemas?.[artifact.canonicalPath]
      if (cached && cached.hash !== artifact.hash) delete project.mcpSchemas![artifact.canonicalPath]
    })
  }

  /** Returns schemas only while the exact MCP artifact remains approved. */
  async getMcpSchemas(artifact: TrustedArtifact): Promise<CachedMcpSchemas | null> {
    const { key, state } = await this.project()
    const project = state.projects[key]
    if (!isMcpApproved(project, artifact)) return null
    const cacheMap = project?.mcpSchemas as unknown
    if (cacheMap === undefined) return null
    if (!cacheMap || typeof cacheMap !== 'object' || Array.isArray(cacheMap)) {
      await this.invalidateMcpSchemasIfStillInvalid(artifact).catch(() => undefined)
      return null
    }
    const cached = (cacheMap as Record<string, unknown>)[artifact.canonicalPath]
    if (cached === undefined) return null
    if (!cached || typeof cached !== 'object' || Array.isArray(cached)) {
      await this.invalidateMcpSchemasIfStillInvalid(artifact).catch(() => undefined)
      return null
    }
    const record = cached as { hash?: unknown; servers?: unknown }
    if (record.hash !== artifact.hash) {
      // A cache for a different hash may belong to a newer concurrent load. Never
      // let an older generation delete that entry merely because it is stale here.
      if (typeof record.hash !== 'string') await this.invalidateMcpSchemasIfStillInvalid(artifact).catch(() => undefined)
      return null
    }
    if (getMcpSchemaCacheIssue(record.servers) !== null) {
      await this.invalidateMcpSchemasIfStillInvalid(artifact).catch(() => undefined)
      return null
    }
    return structuredClone(record.servers as CachedMcpSchemas)
  }

  /** Saves a catalog only if the same artifact is still approved under the trust-file lease. */
  async saveMcpSchemas(artifact: TrustedArtifact, servers: CachedMcpSchemas): Promise<boolean> {
    const key = await canonicalPath(this.workspaceRoot)
    let saved = false
    await this.updateProject(key, project => {
      if (!isMcpApproved(project, artifact)) return
      if (getMcpSchemaCacheIssue(servers) !== null) {
        const cacheMap = project.mcpSchemas as unknown
        if (cacheMap && typeof cacheMap === 'object' && !Array.isArray(cacheMap)) {
          const cached = (cacheMap as Record<string, unknown>)[artifact.canonicalPath]
          if (cached && typeof cached === 'object' && !Array.isArray(cached) &&
            (cached as { hash?: unknown }).hash === artifact.hash) {
            delete (cacheMap as Record<string, unknown>)[artifact.canonicalPath]
          }
        }
        return
      }
      if (!project.mcpSchemas || typeof project.mcpSchemas !== 'object' || Array.isArray(project.mcpSchemas)) {
        project.mcpSchemas = {}
      }
      project.mcpSchemas[artifact.canonicalPath] = { hash: artifact.hash, servers: structuredClone(servers) }
      saved = true
    })
    return saved
  }

  /** Drops cached schemas for this exact artifact without changing approval. */
  async invalidateMcpSchemas(artifact: TrustedArtifact): Promise<void> {
    const { key, state } = await this.project()
    const cacheMap = state.projects[key]?.mcpSchemas as unknown
    const malformedMap = cacheMap !== undefined && (!cacheMap || typeof cacheMap !== 'object' || Array.isArray(cacheMap))
    const hasEntry = !!cacheMap && typeof cacheMap === 'object' && !Array.isArray(cacheMap) &&
      Object.prototype.hasOwnProperty.call(cacheMap, artifact.canonicalPath)
    if (!malformedMap && !hasEntry) return
    await this.updateProject(key, project => {
      const current = project.mcpSchemas as unknown
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const entry = (current as Record<string, unknown>)[artifact.canonicalPath]
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          (entry as { hash?: unknown }).hash === artifact.hash || typeof (entry as { hash?: unknown }).hash !== 'string') {
          delete (current as Record<string, unknown>)[artifact.canonicalPath]
        }
      } else if (current !== undefined) {
        project.mcpSchemas = {}
      }
    })
  }

  /** Removes a malformed cache only if it is still malformed when the trust-file lease is held. */
  private async invalidateMcpSchemasIfStillInvalid(artifact: TrustedArtifact): Promise<void> {
    const key = await canonicalPath(this.workspaceRoot)
    await this.updateProject(key, project => {
      const current = project.mcpSchemas as unknown
      if (current === undefined) return
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        project.mcpSchemas = {}
        return
      }
      const map = current as Record<string, unknown>
      if (!Object.prototype.hasOwnProperty.call(map, artifact.canonicalPath)) return
      const entry = map[artifact.canonicalPath]
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        delete map[artifact.canonicalPath]
        return
      }
      const record = entry as { hash?: unknown; servers?: unknown }
      if (typeof record.hash !== 'string') {
        delete map[artifact.canonicalPath]
        return
      }
      if (record.hash !== artifact.hash) return
      if (getMcpSchemaCacheIssue(record.servers) !== null) delete map[artifact.canonicalPath]
    })
  }

  /** Revokes one exact MCP approval and removes its schema cache. */
  async revokeMcp(artifact: TrustedArtifact): Promise<void> {
    const key = await canonicalPath(this.workspaceRoot)
    await this.updateProject(key, project => {
      if (project.mcp?.canonicalPath === artifact.canonicalPath && project.mcp.hash === artifact.hash) delete project.mcp
      if (project.mcpArtifacts?.[artifact.canonicalPath] === artifact.hash) delete project.mcpArtifacts[artifact.canonicalPath]
      if (project.mcpSchemas?.[artifact.canonicalPath]?.hash === artifact.hash) delete project.mcpSchemas[artifact.canonicalPath]
    })
  }
}

function isMcpApproved(project: WorkspaceTrustFile['projects'][string] | undefined, artifact: TrustedArtifact): boolean {
  const pathApprovals = project?.mcpArtifacts
  if (pathApprovals && Object.prototype.hasOwnProperty.call(pathApprovals, artifact.canonicalPath)) {
    return pathApprovals[artifact.canonicalPath] === artifact.hash
  }
  const approval = project?.mcp
  return approval?.canonicalPath === artifact.canonicalPath && approval.hash === artifact.hash
}

/** Returns a safe explanation when a schema cache cannot be loaded or persisted. */
export function getMcpSchemaCacheIssue(value: unknown): string | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'the schema cache format is invalid'
    const servers = Object.entries(value as Record<string, unknown>)
    if (servers.length > MAX_MCP_SCHEMA_CACHE_SERVERS) {
      return `it contains more than ${MAX_MCP_SCHEMA_CACHE_SERVERS} MCP servers`
    }

    let toolCount = 0
    for (const [, tools] of servers) {
      if (!Array.isArray(tools)) return 'a server catalog has an invalid format'
      toolCount += tools.length
      if (toolCount > MAX_MCP_SCHEMA_CACHE_TOOLS) {
        return `it contains more than ${MAX_MCP_SCHEMA_CACHE_TOOLS} tools`
      }
      for (const tool of tools) {
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return 'a tool descriptor has an invalid format'
        const descriptor = tool as Record<string, unknown>
        if (typeof descriptor.name !== 'string' ||
          !descriptor.inputSchema || typeof descriptor.inputSchema !== 'object' || Array.isArray(descriptor.inputSchema) ||
          (descriptor.description !== undefined && typeof descriptor.description !== 'string')) {
          return 'a tool descriptor has an invalid format'
        }
      }
    }

    const serialized = JSON.stringify(value)
    if (typeof serialized !== 'string') return 'the schema cache is not serializable'
    const byteLength = Buffer.byteLength(serialized, 'utf8')
    if (byteLength > MAX_MCP_SCHEMA_CACHE_BYTES) {
      return `its serialized schemas exceed the ${MAX_MCP_SCHEMA_CACHE_BYTES}-byte limit`
    }
    return null
  } catch {
    return 'the schema cache contains invalid data'
  }
}
