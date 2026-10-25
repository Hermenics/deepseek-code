import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Agent, type AgentCallbacks } from '../src/agent/agent.js'
import { searchConversations } from '../src/agent/conversationMemory.js'

const roots: string[] = []
const previousHistoryPath = process.env.DEEPSEEK_HISTORY_PATH
afterEach(async () => {
  if (previousHistoryPath === undefined) delete process.env.DEEPSEEK_HISTORY_PATH
  else process.env.DEEPSEEK_HISTORY_PATH = previousHistoryPath
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-memory-recall-')); roots.push(root)
  process.env.DEEPSEEK_HISTORY_PATH = join(root, 'history.json')
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
    projectRoot: root, memoryDirectory: join(root, 'memory'), logFile: null, snapshotFile: null,
  })
  await agent.readyPromise
  const internal = agent as any
  internal.settings.promptRefiner = { enabled: false }
  internal.interactionMode = 'build'
  return { root, agent, internal }
}
const callbacks = { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} } as AgentCallbacks

test('recalls relevant verified archive notes without injecting unreviewed facts or unrelated notes', async () => {
  const { root, agent, internal } = await fixture()
  try {
    await agent.orchestrator.memory.configure({ scope: 'project' }, root)
    await writeFile(join(root, 'architecture.txt'), 'Redis streams with consumer groups')
    await agent.orchestrator.memory.add('agent', 'Redis XACK_CHECKPOINT records consumer acknowledgements.', { tier: 'archive', sourcePath: 'architecture.txt' })
    await agent.orchestrator.memory.add('agent', 'Redis UNVERIFIED_CANARY assumption', { tier: 'archive' })
    await agent.orchestrator.memory.add('agent', 'Postgres UNRELATED_CANARY migration', { tier: 'archive', provenance: 'explicit-user' })
    for (let index = 0; index < 9; index++) await agent.orchestrator.memory.add('agent', `Redis XACK_CHECKPOINT core_${index}`, { provenance: 'explicit-user' })
    const review = spyOn(agent.orchestrator.memory, 'review')
    let prompt = ''
    internal.loop = async () => { prompt = JSON.stringify(agent.getRawMessages()) }
    await agent.run('Explain XACK_CHECKPOINT in Redis', callbacks)
    expect(prompt).toContain('XACK_CHECKPOINT records consumer acknowledgements')
    expect(prompt).toContain('untrusted reference')
    expect(prompt).not.toContain('UNVERIFIED_CANARY')
    expect(prompt).not.toContain('UNRELATED_CANARY')
    expect(review.mock.calls.map(([target]) => target).sort()).toEqual(['agent', 'user'])
    review.mockRestore()
    const sidecar = join(root, 'memory', 'MEMORY.v1.json')
    const original = await readFile(sidecar, 'utf8')
    await writeFile(sidecar, '{invalid')
    await agent.run('Explain XACK_CHECKPOINT in Redis', callbacks)
    expect(prompt).not.toContain('XACK_CHECKPOINT records consumer acknowledgements')
    await writeFile(sidecar, original)
    await writeFile(join(root, 'architecture.txt'), 'Now uses RabbitMQ')
    await agent.run('Explain XACK_CHECKPOINT in Redis', callbacks)
    expect(prompt).not.toContain('XACK_CHECKPOINT records consumer acknowledgements')
  } finally { await agent.shutdown() }
})

test('ranks archive notes from both targets over the same corpus', async () => {
  const { root, agent, internal } = await fixture()
  try {
    const memory = agent.orchestrator.memory
    await memory.configure({ scope: 'project' }, root)
    for (let index = 0; index < 3; index++) await memory.add('agent', `RANKING_NEEDLE agent_${index} ${'detail '.repeat(200)}`, { tier: 'archive', provenance: 'explicit-user' })
    for (let index = 0; index < 20; index++) await memory.add('agent', `Unrelated note_${index}`, { tier: 'archive', provenance: 'explicit-user' })
    await memory.add('user', 'RANKING_NEEDLE concise preference', { tier: 'archive', provenance: 'explicit-user' })
    internal.loop = async () => {}
    await agent.run('RANKING_NEEDLE', callbacks)
    const recall = internal.projectContextSections.find(([name]: [string, string]) => name === 'memory-recall')[1] as string
    expect(recall.indexOf('concise preference')).toBeGreaterThan(0)
    expect(recall.indexOf('concise preference')).toBeLessThan(recall.indexOf('agent_0'))
    expect(recall).not.toContain('agent_2')
  } finally { await agent.shutdown() }
})

test('preserves actual text before compaction and skips archive writes in review mode', async () => {
  const { root, agent, internal } = await fixture()
  try {
    internal.messages = [
      { role: 'system', content: 'system' },
      { role: 'assistant', content: '[Compacted context] SYNTHETIC_SUMMARY_CANARY' },
      { role: 'user', content: 'Keep invoice_queue-v2 across compaction' },
      { role: 'user', content: '[Compacted context] USER_QUOTED_CANARY' },
      { role: 'assistant', content: 'VISIBLE_ASSISTANT_CANARY' },
    ]
    internal.withRetry = async () => ({ choices: [{ message: { content: Array.from({ length: 9 }, (_, index) => `## ${index + 1}. Section\nRetained context.`).join('\n\n') } }], usage: {} })
    await agent.compact()
    expect(await searchConversations(agent.orchestrator.memory.getDirectory(), root, 'invoice_queue-v2')).toHaveLength(1)
    expect(await searchConversations(agent.orchestrator.memory.getDirectory(), root, 'SYNTHETIC_SUMMARY_CANARY')).toEqual([])
    expect(await searchConversations(agent.orchestrator.memory.getDirectory(), root, 'USER_QUOTED_CANARY')).toHaveLength(1)
    expect(await searchConversations(agent.orchestrator.memory.getDirectory(), root, 'VISIBLE_ASSISTANT_CANARY')).toHaveLength(1)
    internal.interactionMode = 'review'
    internal.messages.push({ role: 'user', content: 'review_only_queue' })
    await agent.compact()
    expect(await searchConversations(agent.orchestrator.memory.getDirectory(), root, 'review_only_queue')).toEqual([])
  } finally { await agent.shutdown() }
})

test('does not discard active context when pre-compaction persistence fails', async () => {
  const { root, agent, internal } = await fixture()
  try {
    await mkdir(join(root, 'memory'), { recursive: true })
    await writeFile(join(root, 'memory', 'CONVERSATIONS.v1.json'), '{invalid')
    internal.messages = [{ role: 'user', content: 'ORIGINAL_CONTEXT_MUST_SURVIVE' }]
    let providerCalls = 0
    internal.withRetry = async () => { providerCalls++; throw new Error('should not summarize') }
    await expect(agent.compact()).rejects.toThrow()
    expect(providerCalls).toBe(0)
    expect(JSON.stringify(agent.getRawMessages())).toContain('ORIGINAL_CONTEXT_MUST_SURVIVE')
  } finally { await agent.shutdown() }
})
