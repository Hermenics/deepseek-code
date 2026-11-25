import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

  it('pins cached MCP schemas to the approved artifact and revokes the cache with approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workspace-trust-cache-'))
    roots.push(root)
    const workspace = join(root, 'project')
    await mkdir(workspace)
    const file = join(root, 'workspace-trust.json')
    const artifact = { canonicalPath: join(workspace, '.deepseek', 'mcp.json'), hash: 'exact-config-hash' }
    const store = new WorkspaceTrustStore(workspace, file)
    const schemas = { fixture: [{ name: 'read', inputSchema: { type: 'object', properties: {} } }] }

    expect(await store.saveMcpSchemas(artifact, schemas)).toBe(false)
    await store.approveMcp(artifact)
    expect(await store.saveMcpSchemas(artifact, schemas)).toBe(true)
    expect(await store.getMcpSchemas(artifact)).toEqual(schemas)
    await store.revokeMcp(artifact)
    expect(await store.isMcpApproved(artifact)).toBe(false)
    expect(await store.getMcpSchemas(artifact)).toBeNull()
  })

  it('drops a cache when approval moves to a different exact config hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workspace-trust-change-'))
    roots.push(root)
    const workspace = join(root, 'project')
    await mkdir(workspace)
    const file = join(root, 'workspace-trust.json')
    const oldArtifact = { canonicalPath: join(workspace, '.deepseek', 'mcp.json'), hash: 'old-config-hash' }
    const newArtifact = { canonicalPath: oldArtifact.canonicalPath, hash: 'new-config-hash' }
    const store = new WorkspaceTrustStore(workspace, file)

    await store.approveMcp(oldArtifact)
    await store.saveMcpSchemas(oldArtifact, { fixture: [{ name: 'old', inputSchema: { type: 'object' } }] })
    await store.approveMcp(newArtifact)

    expect(await store.getMcpSchemas(oldArtifact)).toBeNull()
    expect(await store.getMcpSchemas(newArtifact)).toBeNull()
  })

  it('does not restore a superseded legacy approval after revoking its replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workspace-trust-legacy-revoke-'))
    roots.push(root)
    const workspace = join(root, 'project')
    await mkdir(workspace)
    const file = join(root, 'workspace-trust.json')
    const workspaceKey = await canonicalPath(workspace)
    const legacyArtifact = { canonicalPath: join(workspace, '.deepseek', 'mcp.json'), hash: 'legacy-config-hash' }
    const replacementArtifact = { canonicalPath: legacyArtifact.canonicalPath, hash: 'replacement-config-hash' }
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      projects: { [workspaceKey]: { agents: {}, mcp: legacyArtifact } },
    }))
    const store = new WorkspaceTrustStore(workspace, file)

    expect(await store.isMcpApproved(legacyArtifact)).toBe(true)
    await store.approveMcp(replacementArtifact)
    expect(await store.isMcpApproved(legacyArtifact)).toBe(false)
    expect(await store.isMcpApproved(replacementArtifact)).toBe(true)
    await store.revokeMcp(replacementArtifact)

    expect(await store.isMcpApproved(legacyArtifact)).toBe(false)
    expect(await store.isMcpApproved(replacementArtifact)).toBe(false)
  })

  it('does not let an old artifact invalidate a newer approved schema cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workspace-trust-cache-generation-'))
    roots.push(root)
    const workspace = join(root, 'project')
    await mkdir(workspace)
    const file = join(root, 'workspace-trust.json')
    const oldArtifact = { canonicalPath: join(workspace, '.deepseek', 'mcp.json'), hash: 'old-generation' }
    const currentArtifact = { canonicalPath: oldArtifact.canonicalPath, hash: 'current-generation' }
    const currentSchemas = { fixture: [{ name: 'current', inputSchema: { type: 'object' } }] }
    const store = new WorkspaceTrustStore(workspace, file)

    await store.approveMcp(oldArtifact)
    await store.saveMcpSchemas(oldArtifact, { fixture: [{ name: 'old', inputSchema: { type: 'object' } }] })
    await store.approveMcp(currentArtifact)
    await store.saveMcpSchemas(currentArtifact, currentSchemas)

    await store.invalidateMcpSchemas(oldArtifact)
    expect(await store.getMcpSchemas(currentArtifact)).toEqual(currentSchemas)
  })

  it('rejects oversized schema caches and discards oversized stored data without revoking approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workspace-trust-oversized-cache-'))
    roots.push(root)
    const workspace = join(root, 'project')
    await mkdir(workspace)
    const file = join(root, 'workspace-trust.json')
    const artifact = { canonicalPath: join(workspace, '.deepseek', 'mcp.json'), hash: 'oversized-cache-hash' }
    const store = new WorkspaceTrustStore(workspace, file)
    await store.approveMcp(artifact)
    expect(await store.saveMcpSchemas(artifact, { fixture: [{ name: 'previous', inputSchema: { type: 'object' } }] })).toBe(true)

    const oversizedCaches = [
      Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`server-${index}`, []])),
      { fixture: Array.from({ length: 1_025 }, (_, index) => ({ name: `tool-${index}`, inputSchema: { type: 'object' } })) },
      { fixture: [{ name: 'large', description: 'x'.repeat(1_048_576), inputSchema: { type: 'object' } }] },
    ]
    for (const oversized of oversizedCaches) {
      expect(await store.saveMcpSchemas(artifact, oversized)).toBe(false)
    }
    expect(await store.isMcpApproved(artifact)).toBe(true)
    expect(await store.getMcpSchemas(artifact)).toBeNull()

    expect(await store.saveMcpSchemas(artifact, { fixture: [{ name: 'valid', inputSchema: { type: 'object' } }] })).toBe(true)
    const trustData = JSON.parse(await readFile(file, 'utf8'))
    const workspaceKey = await canonicalPath(workspace)
    trustData.projects[workspaceKey].mcpSchemas[artifact.canonicalPath].servers = oversizedCaches[1]
    await writeFile(file, JSON.stringify(trustData))

    expect(await store.getMcpSchemas(artifact)).toBeNull()
    expect(await store.isMcpApproved(artifact)).toBe(true)
    const cleanedTrustData = JSON.parse(await readFile(file, 'utf8'))
    expect(cleanedTrustData.projects[workspaceKey].mcpArtifacts[artifact.canonicalPath]).toBe(artifact.hash)
    expect(cleanedTrustData.projects[workspaceKey].mcpSchemas[artifact.canonicalPath]).toBeUndefined()
  })
})
