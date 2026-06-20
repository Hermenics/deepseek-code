import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { loadAgentConfig, listAgents } from '../src/agent/config.js'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'

const TEST_DIR = join(process.cwd(), '.deepseek', 'agents')
const TEST_AGENT = { name: 'test-agent', model: 'deepseek-chat', systemPrompt: 'Test agent.' }
const INVALID_AGENT_PATH = join(TEST_DIR, 'invalid-agent.json')

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  await writeFile(join(TEST_DIR, 'test-agent.json'), JSON.stringify(TEST_AGENT))
  // Agent with missing required fields
  await writeFile(INVALID_AGENT_PATH, JSON.stringify({ model: 'deepseek-chat' }))
})

afterAll(async () => {
  await rm(join(TEST_DIR, 'test-agent.json'), { force: true })
  await rm(INVALID_AGENT_PATH, { force: true })
})

describe('loadAgentConfig', () => {
  it('loads a local agent', async () => {
    const { config, source } = await loadAgentConfig('test-agent')
    expect(config.name).toBe('test-agent')
    expect(config.model).toBe('deepseek-chat')
    expect(source).toBe('local')
  })

  it('throws for non-existent agent', async () => {
    await expect(loadAgentConfig('non-existent-xyz')).rejects.toThrow()
  })

  it('throws for agent with missing required fields (name, systemPrompt)', async () => {
    await expect(loadAgentConfig('invalid-agent')).rejects.toThrow()
  })
})

describe('listAgents', () => {
  it('returns at least the test agent', async () => {
    const agents = await listAgents()
    const found = agents.find((a) => a.name === 'test-agent')
    expect(found).toBeDefined()
    expect(found?.source).toBe('local')
  })
})
