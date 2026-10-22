import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { canonicalPath, WorkspaceTrustStore } from '../src/settings/trust.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('workspace trust', () => {
  it('preserves concurrent approvals for separate workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workspace-trust-'))
    roots.push(root)
    const firstRoot = join(root, 'first')
    const secondRoot = join(root, 'second')
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)])
    const file = join(root, 'workspace-trust.json')
    const firstArtifact = { canonicalPath: await canonicalPath(join(firstRoot, 'agent.json')), hash: 'agent-hash' }
    const secondArtifact = { canonicalPath: await canonicalPath(join(secondRoot, 'mcp.json')), hash: 'mcp-hash' }
    const first = new WorkspaceTrustStore(firstRoot, file)
    const second = new WorkspaceTrustStore(secondRoot, file)

    await Promise.all([first.approveAgent(firstArtifact), second.approveMcp(secondArtifact)])

    expect(await first.isAgentApproved(firstArtifact)).toBe(true)
    expect(await second.isMcpApproved(secondArtifact)).toBe(true)
  })
})
