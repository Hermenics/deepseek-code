import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAgentConfig, loadAgentRegistry, listAgents } from '../src/agent/config.js'
import { OrchestratorSession } from '../src/orchestration/index.js'
import { spawnSubAgentTask } from '../src/tools/SubAgent/SubAgent.js'

let root = ''
let directory = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'deepseek-agent-config-'))
  directory = join(root, '.deepseek', 'agents')
  await mkdir(directory, { recursive: true })
})

afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('agent configuration', () => {
  it('loads canonical project configuration', async () => {
    await writeFile(join(directory, 'test-agent.json'), JSON.stringify({
      name: 'test-agent', model: 'deepseek-chat', usage: 'both', responsibility: 'Run deterministic tests',
      systemPrompt: 'Test agent.', permissionProfile: 'tester', timeoutMs: 5000, maxRetries: 1,
      contextMode: 'fresh', tools: ['read_file', 'shell'], outputSchema: { type: 'object' },
    }))
    const { config, source } = await loadAgentConfig('test-agent', root)
    expect(config.name).toBe('test-agent')
    expect(config.model).toBe('deepseek-chat')
    expect(config.permissionProfile).toBe('tester')
    expect(source).toBe('local')
    expect((await listAgents(root)).some(agent => agent.name === 'test-agent')).toBe(true)
  })

  it('throws an actionable error for malformed or incomplete definitions', async () => {
    await writeFile(join(directory, 'invalid-agent.json'), JSON.stringify({ model: 'deepseek-chat' }))
    await expect(loadAgentRegistry(root)).rejects.toThrow("Invalid agent config '")
    await rm(join(directory, 'invalid-agent.json'))
    await writeFile(join(directory, 'broken.json'), '{not json')
    await expect(loadAgentRegistry(root)).rejects.toThrow('malformed JSON')
  })

  it('rejects unsafe profile/isolation combinations and invalid output schemas', async () => {
    await writeFile(join(directory, 'unsafe.json'), JSON.stringify({
      name: 'unsafe', systemPrompt: 'No.', permissionProfile: 'writer-worktree', isolation: 'serialized-writer',
    }))
    await expect(loadAgentRegistry(root)).rejects.toThrow('writer-worktree must use git-worktree')
    await rm(join(directory, 'unsafe.json'))
    await writeFile(join(directory, 'schema.json'), JSON.stringify({
      name: 'schema', systemPrompt: 'No.', outputSchema: { type: 'not-a-json-schema-type' },
    }))
    await expect(loadAgentRegistry(root)).rejects.toThrow('outputSchema is invalid')
  })

  it('throws distinct errors for missing and disabled agents', async () => {
    await expect(loadAgentConfig('non-existent-xyz', root)).rejects.toThrow("Agent 'non-existent-xyz' was not found.")
    await writeFile(join(directory, 'disabled.json'), JSON.stringify({ name: 'disabled', systemPrompt: 'x', enabled: false }))
    await expect(loadAgentConfig('disabled', root)).rejects.toThrow("Agent 'disabled' is disabled.")
  })

  it('rejects agent file patterns that can leave the project', async () => {
    await writeFile(join(directory, 'files.json'), JSON.stringify({
      name: 'files', systemPrompt: 'No.', files: ['../../.ssh/*'],
    }))
    await expect(loadAgentRegistry(root)).rejects.toThrow('project-relative patterns')
  })

  it('never lets a declarative subagent elevate itself to coordinator', async () => {
    await writeFile(join(directory, 'elevated.json'), JSON.stringify({
      name: 'elevated', usage: 'subagent', systemPrompt: 'Run as coordinator.', permissionProfile: 'coordinator-integrator',
    }))
    const session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
    await expect(spawnSubAgentTask({ task: 'do work', agent: 'elevated', mode: 'background' }, session.toolContext())).rejects.toThrow('cannot use coordinator-integrator')
  })
})
