import { expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { loadProjectInstructions, formatProjectInstructions } from '../src/agent/steering.js'
import { Agent } from '../src/agent/agent.js'

it('versions and scopes all rule files, deduplicating canonical aliases without collapsing distinct origins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-rule-sources-'))
  try {
    const workspace = join(directory, 'workspace'), app = join(workspace, 'app')
    const steering = join(workspace, '.deepseek', 'steering')
    await mkdir(steering, { recursive: true }); await mkdir(app)
    await writeFile(join(workspace, 'AGENTS.md'), 'Shared root convention')
    await symlink(join(workspace, 'AGENTS.md'), join(workspace, 'DEEPSEEK.md'))
    await writeFile(join(workspace, '.deepseek', 'DEEPSEEK.md'), 'Separate project convention')
    await writeFile(join(steering, 'z.md'), 'Separate project convention')
    await writeFile(join(steering, 'a.md'), 'Steering convention')
    await writeFile(join(app, 'AGENTS.md'), 'App-specific convention')
    const target = join(app, 'new.ts')
    const entries = await loadProjectInstructions(workspace, target)
    const root = entries.find(entry => entry.filePath === join(workspace, 'AGENTS.md'))!
    expect(root.sources.map(source => source.kind)).toEqual(['agents-md', 'deepseek-md'])
    expect(root.scope).toBe(workspace)
    expect(root.version).toBe(createHash('sha256').update(root.content).digest('hex'))
    expect(entries.filter(entry => entry.content === 'Shared root convention')).toHaveLength(1)
    expect(entries.filter(entry => entry.content === 'Separate project convention')).toHaveLength(2)
    expect(entries.find(entry => entry.filePath === join(app, 'AGENTS.md'))!.scope).toBe(app)
    expect(await loadProjectInstructions(workspace, target)).toEqual(entries)
    const rendered = formatProjectInstructions(entries)
    expect(rendered.split('Shared root convention')).toHaveLength(2)
    expect(rendered).toContain(root.version)
    expect(rendered).toContain('presentation order do not resolve conflicts')
    const before = entries.find(entry => entry.filePath === join(steering, 'a.md'))!
    await writeFile(join(steering, 'a.md'), 'Updated steering convention')
    const after = (await loadProjectInstructions(workspace, target)).find(entry => entry.id === before.id)!
    expect(after.version).not.toBe(before.version)
    expect(after.content).toBe('Updated steering convention')
    expect(await loadProjectInstructions(workspace, join(directory, 'outside.ts'))).toEqual([])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('rejects project-rule links that escape the workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-rule-link-'))
  try {
    const workspace = join(directory, 'workspace')
    await mkdir(workspace)
    await writeFile(join(directory, 'private.md'), 'Outside source must not be injected')
    await symlink(join(directory, 'private.md'), join(workspace, 'DEEPSEEK.md'))
    await expect(loadProjectInstructions(workspace, workspace)).rejects.toThrow('escapes the workspace')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('refreshes steering and DEEPSEEK rules before writing and rejects later journal mutations', async () => {
  for (const relative of ['DEEPSEEK.md', '.deepseek/DEEPSEEK.md', '.deepseek/steering/rules.md']) {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-rule-refresh-'))
    const rules = join(directory, relative)
    await mkdir(join(directory, '.deepseek', 'steering'), { recursive: true })
    await writeFile(rules, 'Original project convention')
    const agent = new Agent({ provider: 'local', localModel: 'fixture' }, { projectRoot: directory, logFile: null, snapshotFile: null })
    try {
      await agent.readyPromise
      const internal = agent as any
      internal.settings = { risk: { enabled: false } }
      let executions = 0
      internal.executeTool = async () => { executions++; return 'started' }
      agent.setToolPermissionHandler(async () => 'once')
      const args = { path: join(directory, 'new.ts'), content: 'export {}' }
      const call = () => internal.checkAndExecuteTool({ id: crypto.randomUUID(), type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } }, args, { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} })
      await writeFile(rules, 'Updated project convention')
      expect((await call()).result).toContain('Write not executed. Project instruction files changed')
      expect(JSON.stringify(agent.getMessages())).toContain('Updated project convention')
      expect(JSON.stringify(agent.getMessages())).not.toContain('Original project convention')
      expect(executions).toBe(0)
      agent.orchestrator.executeJournaled = async (_name, _args, execute) => {
        await writeFile(rules, 'Changed during authorization')
        return execute()
      }
      expect((await call()).result).toContain('Project instruction files changed before execution')
      expect(executions).toBe(0)
      expect(internal.undoStack).toHaveLength(0)
      await rm(rules)
      expect((await call()).result).toContain('removedInstructions')
      expect(JSON.stringify(agent.getMessages())).not.toContain('Updated project convention')
    } finally { await agent.shutdown(); await rm(directory, { recursive: true, force: true }) }
  }
})
