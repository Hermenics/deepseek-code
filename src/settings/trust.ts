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
  }>
}

const DEFAULT_TRUST_FILE = join(homedir(), '.deepseek', 'workspace-trust.json')

export async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path) } catch { return resolve(path) }
}

export function hashTrustedContent(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function hashTrustedFile(path: string): Promise<TrustedArtifact> {
  const content = await readFile(path)
  return { canonicalPath: await canonicalPath(path), hash: hashTrustedContent(content) }
}

async function readTrustFile(path: string): Promise<WorkspaceTrustFile> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<WorkspaceTrustFile>
    if (value.schemaVersion !== 1 || !value.projects || typeof value.projects !== 'object') throw new Error('invalid trust file')
    return value as WorkspaceTrustFile
  } catch {
    return { schemaVersion: 1, projects: {} }
  }
}

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

export class WorkspaceTrustStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly file = DEFAULT_TRUST_FILE,
  ) {}

  private async project(): Promise<{ key: string; state: WorkspaceTrustFile }> {
    const key = await canonicalPath(this.workspaceRoot)
    return { key, state: await readTrustFile(this.file) }
  }

  async isAgentApproved(artifact: TrustedArtifact): Promise<boolean> {
    const { key, state } = await this.project()
    return state.projects[key]?.agents?.[artifact.canonicalPath] === artifact.hash
  }

  async approveAgent(artifact: TrustedArtifact): Promise<void> {
    const { key, state } = await this.project()
    const project = state.projects[key] ?? { agents: {} }
    project.agents[artifact.canonicalPath] = artifact.hash
    state.projects[key] = project
    await writeTrustFile(this.file, state)
  }

  async isMcpApproved(artifact: TrustedArtifact): Promise<boolean> {
    const { key, state } = await this.project()
    const approval = state.projects[key]?.mcp
    return approval?.canonicalPath === artifact.canonicalPath && approval.hash === artifact.hash
  }

  async approveMcp(artifact: TrustedArtifact): Promise<void> {
    const { key, state } = await this.project()
    const project = state.projects[key] ?? { agents: {} }
    project.mcp = artifact
    state.projects[key] = project
    await writeTrustFile(this.file, state)
  }
}
