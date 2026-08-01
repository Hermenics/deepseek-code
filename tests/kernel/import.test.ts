import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../../src/kernel/store/store.js'
import { MIGRATIONS } from '../../src/kernel/store/migrations.js'
import { EventBus } from '../../src/kernel/events/eventBus.js'
import { importLegacySessions, listLegacySessionFiles } from '../../src/kernel/compat/import.js'

const SID = 'test-import'

function writeLegacySession(dir: string, session: Record<string, unknown>, file = `${session.id as string}.json`): string {
  writeFileSync(join(dir, file), JSON.stringify(session))
  return join(dir, file)
}

describe('Legacy import', () => {
  let store: Store
  let dir: string

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(MIGRATIONS)
    dir = mkdtempSync(join(tmpdir(), 'dsk-legacy-'))
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('should create a session, thread, and goal for a legacy session with a goal', () => {
    writeLegacySession(dir, {
      id: 'legacy-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      cwd: '/tmp/project',
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      language: null,
      activeAgent: null,
      goal: {
        objective: 'Implement login',
        status: 'active',
        tokensUsed: 100,
        timeUsedSeconds: 30,
        consecutiveBlockCount: 0,
        continuations: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        startedAt: '2026-01-02T00:00:00.000Z',
      },
    })

    const events = new EventBus(store, SID)
    const result = importLegacySessions(store, events, { cwd: dir })

    expect(result.sessions).toBe(1)
    expect(result.goals).toBe(1)
    expect(result.errors).toHaveLength(0)

    // Session exists.
    const session = store.query<{ id: string }>('SELECT id FROM sessions WHERE id = ?', 'legacy-1')[0]
    expect(session).toBeDefined()

    // Imported thread exists and belongs to the session.
    const thread = store.query<{ id: string; session_id: string }>('SELECT id, session_id FROM threads WHERE id = ?', 'imported-legacy-1')[0]
    expect(thread).toBeDefined()
    expect(thread!.session_id).toBe('legacy-1')

    // Goal exists with restored state.
    const goal = store.query<{ goal_id: string; status: string; tokens_used: number }>(
      'SELECT goal_id, status, tokens_used FROM goals WHERE goal_id = ?', 'imported-goal-legacy-1',
    )[0]
    expect(goal).toBeDefined()
    expect(goal!.status).toBe('active')
    expect(goal!.tokens_used).toBe(100)
  })

  it('should list legacy files from a custom directory', () => {
    writeLegacySession(dir, { id: 'custom-1', cwd: '/p', model: 'm', provider: 'p', createdAt: '2026-01-01', updatedAt: '2026-01-01' })
    const files = listLegacySessionFiles(dir)
    expect(files.length).toBe(1)
    expect(files[0]!.id).toBe('custom-1')
  })

  it('should not write anything in dry-run mode', () => {
    writeLegacySession(dir, {
      id: 'dry-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cwd: '/tmp/p',
      model: 'm',
      provider: 'p',
      language: null,
      activeAgent: null,
      goal: { objective: 'X', status: 'active', tokensUsed: 0, timeUsedSeconds: 0, consecutiveBlockCount: 0, continuations: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    })

    const before = store.query('SELECT COUNT(*) as c FROM sessions')[0] as { c: number }
    const events = new EventBus(store, SID)
    const result = importLegacySessions(store, events, { cwd: dir, dryRun: true })

    expect(result.sessions).toBe(1)
    expect(result.goals).toBe(1)

    const after = store.query('SELECT COUNT(*) as c FROM sessions')[0] as { c: number }
    expect(after.c).toBe(before.c) // zero sessions written
    const threads = store.query('SELECT COUNT(*) as c FROM threads')[0] as { c: number }
    expect(threads.c).toBe(0) // zero threads written
  })

  it('should report per-file errors in dry-run mode', () => {
    writeFileSync(join(dir, 'broken.json'), '{ not valid json')
    const events = new EventBus(store, SID)
    const result = importLegacySessions(store, events, { cwd: dir, dryRun: true })
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain('Failed to read')
    expect(result.sessions).toBe(0)
  })
})
