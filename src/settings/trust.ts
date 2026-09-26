import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export interface TrustedArtifact {
  canonicalPath: string
  hash: string
}

interface WorkspaceTrustFile {
  schemaVersion: 1
  projects: Record<string, {
    agents: Record<string, string>
    mcp?: TrustedArtifact
    mcpArtifacts?: Record<string, string>
  }>
}

const DEFAULT_TRUST_FILE = join(homedir(), '.deepseek', 'workspace-trust.json')

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

  /** True if this exact agent file content was approved for the workspace. */
  async isAgentApproved(artifact: TrustedArtifact): Promise<boolean> {
    const { key, state } = await this.project()
    return state.projects[key]?.agents?.[artifact.canonicalPath] === artifact.hash
  }

  /** Records approval of the agent file's current hash for the workspace. */
  async approveAgent(artifact: TrustedArtifact): Promise<void> {
    const { key, state } = await this.project()
    const project = state.projects[key] ?? { agents: {} }
    project.agents[artifact.canonicalPath] = artifact.hash
    state.projects[key] = project
    await writeTrustFile(this.file, state)
  }

  /** True if the workspace's approved MCP config matches this path and hash. */
  async isMcpApproved(artifact: TrustedArtifact): Promise<boolean> {
    const { key, state } = await this.project()
    const approval = state.projects[key]?.mcp
    return (approval?.canonicalPath === artifact.canonicalPath && approval.hash === artifact.hash) ||
      state.projects[key]?.mcpArtifacts?.[artifact.canonicalPath] === artifact.hash
  }

  /** Records the workspace's MCP config approval, replacing any previous one. */
  async approveMcp(artifact: TrustedArtifact): Promise<void> {
    const { key, state } = await this.project()
    const project = state.projects[key] ?? { agents: {} }
    project.mcpArtifacts ??= {}
    project.mcpArtifacts[artifact.canonicalPath] = artifact.hash
    state.projects[key] = project
    await writeTrustFile(this.file, state)
  }
}
