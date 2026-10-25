import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureConversation, searchConversations, getConversationExcerpt, clearConversationMemory } from '../src/agent/conversationMemory.js'
import { MemoryStore } from '../src/agent/memory.js'
import { saveSession } from '../src/agent/session.js'
import { SessionSearch } from '../src/tools/Memory/SessionSearch.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-conversation-memory-'))
  roots.push(root)
  const project = join(root, 'project'), directory = join(root, 'memory')
  await mkdir(project)
  return { root, project, directory }
}

test('retrieves actual pre-compaction messages, redacts secrets and omits private/system/tool content', async () => {
  const { project, directory } = await fixture()
  await captureConversation(directory, project, 'first-session', [
    { role: 'system', content: 'hidden-system-canary' },
    { role: 'user', content: 'Decided on Redis Streams, api_key=conversation-secret' },
    { role: 'assistant', content: 'The queue uses consumer groups.' },
    { role: 'tool', content: 'private-tool-canary' },
    { role: 'assistant', reasoning_content: 'private-reasoning-canary', content: null },
  ])
  const hits = await searchConversations(directory, project, 'Redis Streams')
  expect(hits).toHaveLength(1)
  expect(hits[0]).toMatchObject({ role: 'user', sessionId: 'first-session', source: 'compaction' })
  expect(hits[0]!.content).toContain('api_key=[REDACTED]')
  const excerpt = await getConversationExcerpt(directory, project, hits[0]!.reference)
  expect(excerpt.map(item => item.role)).toEqual(['user', 'assistant'])
  const raw = await readFile(join(directory, 'CONVERSATIONS.v1.json'), 'utf8')
  for (const secret of ['conversation-secret', 'hidden-system-canary', 'private-tool-canary', 'private-reasoning-canary']) expect(raw).not.toContain(secret)
})

test('partitions shared archives by project, deduplicates captures, and forgets without disturbing other projects', async () => {
  const { project, directory, root } = await fixture()
  const other = join(root, 'other'); await mkdir(other)
  const messages = [{ role: 'user', content: 'The queue uses RabbitMQ' }]
  await Promise.all([captureConversation(directory, project, 'one', messages), captureConversation(directory, project, 'one', messages)])
  await captureConversation(directory, other, 'two', messages)
  const first = await searchConversations(directory, project, 'RabbitMQ')
  expect(first).toHaveLength(1)
  await expect(getConversationExcerpt(directory, other, first[0]!.reference)).rejects.toThrow('not found')
  await clearConversationMemory(directory, project)
  expect(await searchConversations(directory, project, 'RabbitMQ')).toEqual([])
  expect(await searchConversations(directory, other, 'RabbitMQ')).toHaveLength(1)
})

test('clears invalid and oversized archives but propagates unrelated filesystem errors', async () => {
  const { project, directory } = await fixture()
  await mkdir(directory)
  const file = join(directory, 'CONVERSATIONS.v1.json')
  for (const content of ['{invalid', 'null', JSON.stringify({ schemaVersion: 2, episodes: [] }), ' '.repeat(4_000_001)]) {
    await writeFile(file, content)
    await clearConversationMemory(directory, project)
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  }
  await mkdir(file)
  await expect(clearConversationMemory(directory, project)).rejects.toThrow()
})

test('bounds archived text and clears conversation recall with agent memory', async () => {
  const { project, directory } = await fixture()
  await captureConversation(directory, project, 'one', [{ role: 'user', content: 'needle ' + 'x'.repeat(40_000) }])
  const hit = (await searchConversations(directory, project, 'needle'))[0]!
  expect(hit.content.length).toBeLessThanOrEqual(800)
  expect(hit.truncated).toBe(true)
  const memory = new MemoryStore(project); memory.setDirectory(directory)
  await memory.configure({ scope: 'project' })
  await memory.clear('agent')
  expect(await searchConversations(directory, project, 'needle')).toEqual([])
})

test('retains the most recent context when the pre-compaction capture exceeds its budget', async () => {
  const { project, directory } = await fixture()
  await captureConversation(directory, project, 'one', [
    ...Array.from({ length: 120 }, (_, index) => ({ role: 'assistant', content: `old_detail_${index} ` + 'x'.repeat(1000) })),
    { role: 'user', content: 'LATEST_ARCHITECTURE_DECISION choose consumer groups' },
  ])
  expect(await searchConversations(directory, project, 'LATEST_ARCHITECTURE_DECISION')).toHaveLength(1)
  expect(await searchConversations(directory, project, 'old_detail_0')).toEqual([])
})

test('searches actual saved sessions with source references and respects the disable switch', async () => {
  const { root, project, directory } = await fixture()
  const previousHome = process.env.HOME
  const previousUserProfile = process.env.USERPROFILE
  process.env.HOME = root
  process.env.USERPROFILE = root
  try {
    const other = join(root, 'other'); await mkdir(other)
    for (const [cwd, id, content] of [[project, '0123456789ab', 'We chose queue_decision_42'], [other, 'abcdef123456', 'queue_decision_42 private-other-project']] as const) {
      await saveSession({ id, cwd, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: 'fixture', provider: 'local',
        language: null, activeAgent: null, agentMessages: [], uiMessages: [{ role: 'user', content }], filesModified: [] })
    }
    const memory = new MemoryStore(project); memory.setDirectory(directory)
    const context = { session: { memory }, projectRoot: project, sessionId: 'current' } as any
    const found = JSON.parse(await SessionSearch.execute({ query: 'queue_decision_42' }, context))
    expect(found.results).toHaveLength(1)
    expect(found.results[0]).toMatchObject({ source: 'session', sessionId: '0123456789ab' })
    const excerpt = JSON.parse(await SessionSearch.execute({ reference: found.results[0].reference }, context))
    expect(excerpt.messages[0].content).toBe('We chose queue_decision_42')
    expect(JSON.stringify(excerpt)).not.toContain('private-other-project')
    await saveSession({ id: '0123456789ab', cwd: project, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: 'fixture', provider: 'local',
      language: null, activeAgent: null, agentMessages: [], uiMessages: [{ role: 'user', content: 'The decision was corrected to queue_decision_99' }], filesModified: [] })
    await expect(SessionSearch.execute({ reference: found.results[0].reference }, context)).rejects.toThrow('not found')
    await memory.configure({ enabled: false }, project)
    expect(JSON.parse(await SessionSearch.execute({ query: 'queue_decision_42' }, context)).error.code).toBe('MEMORY_DISABLED')
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
  }
})
