import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { createHash } from 'crypto'
import { createGoal, getGoal, reviseGoal, setGoal, updateGoal } from '../src/agent/goal.js'

// ── Redirect SESSIONS_DIR to a temporary directory ─────────────────────────
let testDir: string
let previousHome: string | undefined

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dsk-session-test-'))
  previousHome = process.env.HOME
  process.env.HOME = testDir
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  await rm(testDir, { recursive: true, force: true })
})

// Import after setting HOME so the module uses the correct directory.
async function getModule() {
  // Re-importing with a cache-busting query string does not work in Bun,
  // so import once and reuse the module; HOME is set before the import.
  const mod = await import('../src/agent/session.js')
  return mod
}

describe('session', () => {
  it('persists the revised objective and revision source across a session reload', async () => {
    const { loadSession, newSessionId, saveSessionCheckpoint } = await getModule()
    const now = new Date().toISOString()
    const id = newSessionId()
    createGoal('Initial objective', 8_000, 3)
    reviseGoal('Corrected objective')
    updateGoal({ tokensUsed: 275, continuations: 1, updatedAt: now })
    const savedGoal = structuredClone(getGoal()!)

    await saveSessionCheckpoint({
      id,
      createdAt: now,
      updatedAt: now,
      cwd: process.cwd(),
      model: 'fixture',
      provider: 'local',
      language: null,
      activeAgent: null,
      agentMessages: [],
      uiMessages: [],
      filesModified: [],
      goal: savedGoal,
    })

    setGoal(null)
    const reopened = await loadSession(id, process.cwd())
    expect(reopened?.goal).toMatchObject({
      objective: 'Corrected objective',
      objectiveRevision: 1,
      objectiveSource: 'user',
      tokensUsed: 275,
      continuations: 1,
    })
    expect(reopened?.goal?.objectiveUpdatedAt).toBe(savedGoal.objectiveUpdatedAt)
  })

  it('flushes a tool-action checkpoint before returning and surfaces write failures', async () => {
    const { loadSession, newSessionId, saveSessionCheckpoint } = await getModule()
    const id = newSessionId()
    const toolCall = { role: 'assistant' as const, content: null, tool_calls: [{ id: 'pending', type: 'function' as const, function: { name: 'shell', arguments: '{"command":"run"}' } }] }
    const data = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cwd: '/tmp/session-checkpoint',
      model: 'fixture',
      provider: 'local',
      language: null,
      activeAgent: null,
      agentMessages: [toolCall],
      uiMessages: [],
      filesModified: [],
    }
    await saveSessionCheckpoint(data)
    expect((await loadSession(id))?.agentMessages).toEqual([toolCall])
    const directory = join(testDir, '.deepseek', 'sessions')
    const projectDirectory = (await readdir(directory, { withFileTypes: true })).find(entry => entry.isDirectory())!
    const sessionDirectory = join(directory, projectDirectory.name)
    expect((await readdir(sessionDirectory)).sort()).toEqual([`${id}.json`])
    if (process.platform !== 'win32') expect((await stat(join(sessionDirectory, `${id}.json`))).mode & 0o777).toBe(0o600)

    const blockedHome = join(testDir, 'home-is-a-file')
    await writeFile(blockedHome, 'not a directory')
    process.env.HOME = blockedHome
    await expect(saveSessionCheckpoint({ ...data, id: newSessionId() })).rejects.toThrow()
  })

  describe('newSessionId', () => {
    it('returns a 12-character alphanumeric string', async () => {
      const { newSessionId } = await getModule()
      const id = newSessionId()
      expect(id).toMatch(/^[a-z0-9]{12}$/)
    })

    it('returns unique IDs on consecutive calls', async () => {
      const { newSessionId } = await getModule()
      const id1 = newSessionId()
      await new Promise(r => setTimeout(r, 5))
      const id2 = newSessionId()
      expect(id1).not.toBe(id2)
    })
  })

  describe('saveSession / loadSession', () => {
    it('reports a session as resumable only after it is saved, even from another cwd', async () => {
      const { hasSavedSession, newSessionId, saveSession } = await getModule()
      const id = newSessionId()
      expect(hasSavedSession(id)).toBe(false)
      expect(hasSavedSession('../outside')).toBe(false)
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: '/tmp/another-project',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [{ role: 'user', content: 'hello' }],
        filesModified: [],
      })
      expect(hasSavedSession(id)).toBe(true)
    })

    it('rejects invalid session data in legacy and project directories', async () => {
      const { hasSavedSession } = await getModule()
      const id = '0123456789ab'
      const root = join(testDir, '.deepseek', 'sessions')
      await mkdir(root, { recursive: true })
      await writeFile(join(root, `${id}.json`), '{ invalid json')
      expect(hasSavedSession(id)).toBe(false)

      const projectDir = join(root, 'project')
      await mkdir(projectDir, { recursive: true })
      await writeFile(join(projectDir, `${id}.json`), JSON.stringify({ id, cwd: '/tmp', agentMessages: [] }))
      expect(hasSavedSession(id)).toBe(false)
    })

    it('saves to the project directory under ~/.deepseek/sessions', async () => {
      const { saveSession, newSessionId } = await getModule()
      const cwd = process.cwd()
      await saveSession({
        id: newSessionId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd,
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [],
        filesModified: [],
      })
      const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 8)
      const files = await readdir(join(testDir, '.deepseek', 'sessions', `${basename(cwd)}-${hash}`))
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/\.json$/)
    })

    it('saves and loads a session with uiMessages', async () => {
      const { saveSession, loadSession, newSessionId } = await getModule()
      const id = newSessionId()
      const uiMessages = [
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: 'hello!' },
      ]
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: 'English',
        activeAgent: null,
        agentMessages: [],
        uiMessages,
        filesModified: [],
      })
      const loaded = await loadSession(id)
      expect(loaded).not.toBeNull()
      expect(loaded!.uiMessages).toEqual(uiMessages)
    })

    it('updates the title without losing the conversation', async () => {
      const { saveSession, loadSession, updateSessionTitle, newSessionId } = await getModule()
      const id = newSessionId()
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: process.cwd(),
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [{ role: 'user' as const, content: 'conversation' }],
        filesModified: [],
      })
      await updateSessionTitle(id, 'Short title')
      const loaded = await loadSession(id)
      expect(loaded?.title).toBe('Short title')
      expect(loaded?.uiMessages).toHaveLength(1)
    })

    it('saves and loads a session with agentMessages', async () => {
      const { saveSession, loadSession, newSessionId } = await getModule()
      const id = newSessionId()
      const agentMessages = [
        { role: 'system' as const, content: 'system prompt' },
        { role: 'user' as const, content: 'hello' },
        { role: 'assistant' as const, content: 'hi there' },
      ]
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages,
        uiMessages: [],
        filesModified: [],
      })
      const loaded = await loadSession(id)
      expect(loaded).not.toBeNull()
      expect(loaded!.agentMessages).toEqual(agentMessages)
    })

    it('preserves all session fields', async () => {
      const { saveSession, loadSession, newSessionId } = await getModule()
      const id = newSessionId()
      const data = {
        id,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        cwd: '/home/tester/project',
        model: 'deepseek-reasoner',
        provider: 'deepseek',
        language: 'English',
        activeAgent: 'coder',
        agentMessages: [{ role: 'user' as const, content: 'test' }],
        uiMessages: [{ role: 'user' as const, content: 'test' }],
        filesModified: ['src/index.ts', 'src/agent.ts'],
      }
      await saveSession(data)
      const loaded = await loadSession(id)
      expect(loaded!.id).toBe(id)
      expect(loaded!.cwd).toBe(data.cwd)
      expect(loaded!.model).toBe(data.model)
      expect(loaded!.provider).toBe(data.provider)
      expect(loaded!.language).toBe(data.language)
      expect(loaded!.activeAgent).toBe(data.activeAgent)
      expect(loaded!.filesModified).toEqual(data.filesModified)
    })

    it('returns null for a nonexistent ID', async () => {
      const { loadSession } = await getModule()
      const result = await loadSession('session-does-not-exist-99999')
      expect(result).toBeNull()
    })

    it('preserves empty uiMessages', async () => {
      const { saveSession, loadSession, newSessionId } = await getModule()
      const id = newSessionId()
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [],
        filesModified: [],
      })
      const loaded = await loadSession(id)
      expect(loaded!.uiMessages).toEqual([])
      expect(loaded!.agentMessages).toEqual([])
    })
  })

  describe('listSessions', () => {
    it('returns an empty array when there are no sessions', async () => {
      const { listSessions } = await getModule()
      const result = await listSessions()
      expect(result).toBeArray()
    })

    it('lists saved sessions in descending date order', async () => {
      const { saveSession, listSessions, newSessionId } = await getModule()

      const id1 = newSessionId()
      await saveSession({
        id: id1,
        createdAt: new Date().toISOString(),
        updatedAt: '2026-01-01T00:00:00.000Z',
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [{ role: 'user' as const, content: 'first' }],
        filesModified: [],
      })

      await new Promise(r => setTimeout(r, 5))

      const id2 = newSessionId()
      await saveSession({
        id: id2,
        createdAt: new Date().toISOString(),
        updatedAt: '2026-06-01T00:00:00.000Z',
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [{ role: 'user' as const, content: 'second' }],
        filesModified: [],
      })

      const sessions = await listSessions()
      expect(sessions.length).toBeGreaterThanOrEqual(2)
      // The most recent session (highest updatedAt) should come first.
      const idx1 = sessions.findIndex(s => s.id === id1)
      const idx2 = sessions.findIndex(s => s.id === id2)
      expect(idx2).toBeLessThan(idx1)
    })

    it('includes a newly saved session in the listing', async () => {
      const { saveSession, listSessions, newSessionId } = await getModule()
      const id = newSessionId()
      await saveSession({
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cwd: '/tmp',
        model: 'deepseek-chat',
        provider: 'deepseek',
        language: null,
        activeAgent: null,
        agentMessages: [],
        uiMessages: [{ role: 'user' as const, content: 'msg' }],
        filesModified: [],
      })
      const sessions = await listSessions()
      const found = sessions.find(s => s.id === id)
      expect(found).toBeDefined()
    })

    it('exports the session for the requested workspace', async () => {
      const { saveSession, exportSession } = await getModule()
      const projectA = await mkdtemp(join(testDir, 'project-a-'))
      const projectB = await mkdtemp(join(testDir, 'project-b-'))
      const id = '0123456789ab'
      const base = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: 'deepseek-chat', provider: 'deepseek', language: null, activeAgent: null, agentMessages: [], filesModified: [] }
      await saveSession({ ...base, id, cwd: projectA, uiMessages: [{ role: 'user' as const, content: 'A' }] })
      await saveSession({ ...base, id, cwd: projectB, uiMessages: [{ role: 'user' as const, content: 'B' }] })

      const path = await exportSession(id, 'json', projectA)
      const exported = JSON.parse(await readFile(path, 'utf8')) as { cwd: string; uiMessages: Array<{ content: string }> }
      expect(exported.cwd).toBe(projectA)
      expect(exported.uiMessages[0]?.content).toBe('A')
    })
  })
})

describe('deleteSession', () => {
  it('removes only the deleted session rollback data', async () => {
    const { deleteSession, loadSession, newSessionId, saveSession } = await getModule()
    const { createFileCheckpoint, listFileCheckpoints } = await import('../src/agent/fileCheckpoint.js')
    const id = newSessionId()
    const otherId = newSessionId()
    const now = new Date().toISOString()
    const makeSession = (sessionId: string) => ({
      id: sessionId,
      createdAt: now,
      updatedAt: now,
      cwd: testDir,
      model: 'fixture',
      provider: 'local',
      language: null,
      activeAgent: null,
      agentMessages: [],
      uiMessages: [],
      filesModified: [],
    })
    const firstFile = join(testDir, 'deleted-session.ts')
    const otherFile = join(testDir, 'retained-session.ts')
    await writeFile(firstFile, 'first')
    await writeFile(otherFile, 'second')
    await saveSession(makeSession(id))
    await saveSession(makeSession(otherId))
    await createFileCheckpoint(id, firstFile, 'write_file')
    await createFileCheckpoint(otherId, otherFile, 'write_file')

    await deleteSession({ id, cwd: testDir })

    expect(await loadSession(id, testDir)).toBeNull()
    expect(await listFileCheckpoints(id)).toHaveLength(0)
    expect(await listFileCheckpoints(otherId)).toHaveLength(1)
    expect((await loadSession(otherId, testDir))?.id).toBe(otherId)
  })

  it('keeps the session record and reports checkpoint cleanup failures', async () => {
    const { deleteSession, loadSession, newSessionId, saveSession } = await getModule()
    const id = newSessionId()
    const now = new Date().toISOString()
    await saveSession({
      id,
      createdAt: now,
      updatedAt: now,
      cwd: testDir,
      model: 'fixture',
      provider: 'local',
      language: null,
      activeAgent: null,
      agentMessages: [],
      uiMessages: [],
      filesModified: [],
    })
    const checkpoints = join(testDir, '.deepseek-code', 'checkpoints')
    await mkdir(checkpoints, { recursive: true })
    await writeFile(join(checkpoints, id), 'not a checkpoint directory')

    await expect(deleteSession({ id, cwd: testDir })).rejects.toThrow('checkpoint session path')
    expect((await loadSession(id, testDir))?.id).toBe(id)
  })

  it('clears checkpoint data only for sessions in the selected scope', async () => {
    const { clearSessions, loadSession, newSessionId, saveSession } = await getModule()
    const { createFileCheckpoint, listFileCheckpoints } = await import('../src/agent/fileCheckpoint.js')
    const otherCwd = join(testDir, 'other-project')
    await mkdir(otherCwd)
    const now = new Date().toISOString()
    const makeSession = (id: string, cwd: string) => ({
      id,
      createdAt: now,
      updatedAt: now,
      cwd,
      model: 'fixture',
      provider: 'local',
      language: null,
      activeAgent: null,
      agentMessages: [],
      uiMessages: [],
      filesModified: [],
    })
    const selectedId = newSessionId()
    const retainedId = newSessionId()
    const selectedFile = join(testDir, 'selected.ts')
    const retainedFile = join(testDir, 'retained.ts')
    await writeFile(selectedFile, 'selected')
    await writeFile(retainedFile, 'retained')
    await saveSession(makeSession(selectedId, testDir))
    await saveSession(makeSession(retainedId, otherCwd))
    await createFileCheckpoint(selectedId, selectedFile, 'write_file')
    await createFileCheckpoint(retainedId, retainedFile, 'write_file')

    expect(await clearSessions('project', testDir)).toBe(1)
    expect(await loadSession(selectedId, testDir)).toBeNull()
    expect(await listFileCheckpoints(selectedId)).toHaveLength(0)
    expect((await loadSession(retainedId, otherCwd))?.id).toBe(retainedId)
    expect(await listFileCheckpoints(retainedId)).toHaveLength(1)
  })

  it('removes checkpoint backups when session retention prunes a session', async () => {
    const { loadSession, newSessionId, saveSession, setSessionRetention } = await getModule()
    const { createFileCheckpoint, listFileCheckpoints } = await import('../src/agent/fileCheckpoint.js')
    const firstId = newSessionId()
    const secondId = newSessionId()
    const now = new Date().toISOString()
    const makeSession = (id: string) => ({
      id,
      createdAt: now,
      updatedAt: now,
      cwd: testDir,
      model: 'fixture',
      provider: 'local',
      language: null,
      activeAgent: null,
      agentMessages: [],
      uiMessages: [],
      filesModified: [],
    })
    const file = join(testDir, 'retention.ts')
    await writeFile(file, 'content')
    try {
      setSessionRetention(1)
      await saveSession(makeSession(firstId))
      await createFileCheckpoint(firstId, file, 'write_file')
      await new Promise(resolve => setTimeout(resolve, 5))
      await saveSession(makeSession(secondId))
    } finally {
      setSessionRetention(50)
    }

    expect(await loadSession(firstId, testDir)).toBeNull()
    expect(await listFileCheckpoints(firstId)).toHaveLength(0)
    expect((await loadSession(secondId, testDir))?.id).toBe(secondId)
  })

  it('treats files missing from some layouts as deleted, but reports real failures', async () => {
    const { deleteSession } = await getModule()
    await expect(deleteSession({ id: 'aaaaaaaaaaaa', cwd: '/nowhere' })).resolves.toBeUndefined()

    // A directory where the legacy session file would be makes unlink fail with something other than ENOENT.
    await mkdir(join(testDir, '.deepseek', 'sessions', 'bbbbbbbbbbbb.json'), { recursive: true })
    await expect(deleteSession({ id: 'bbbbbbbbbbbb', cwd: '/nowhere' })).rejects.toThrow()
  })
})
