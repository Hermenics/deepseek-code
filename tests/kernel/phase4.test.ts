import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../../src/kernel/store/store.js'
import { MIGRATIONS } from '../../src/kernel/store/migrations.js'
import { EventBus } from '../../src/kernel/events/eventBus.js'
import { PathOwnership } from '../../src/kernel/workspace/pathOwnership.js'
import { IntegrationPipeline, WorktreeGC } from '../../src/kernel/workspace/integration.js'

const ALL = MIGRATIONS
const SID = 'test-phase4'

function seedSession(store: Store): void {
  store.run('INSERT INTO sessions (id, cwd, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    SID, '/tmp', 'test', 'test', new Date().toISOString(), new Date().toISOString())
}

// ── PathOwnership ───────────────────────────────────────────────────

describe('PathOwnership', () => {
  let store: Store
  let events: EventBus
  let owner: PathOwnership

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(ALL)
    seedSession(store)
    events = new EventBus(store, SID)
    owner = new PathOwnership(store, events)
  })
  afterEach(() => store.close())

  it('should declare path ownership', () => {
    expect(owner.declare('t1', ['src/editor/**']).ok).toBe(true)
    expect(owner.listClaims().length).toBe(1)
  })

  it('should detect overlapping paths', () => {
    owner.declare('t1', ['src/editor/**'])
    const result = owner.declare('t2', ['src/editor/format.ts'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.overlaps.length).toBeGreaterThan(0)
  })

  it('should allow disjoint paths', () => {
    owner.declare('t1', ['src/frontend/**'])
    expect(owner.declare('t2', ['src/backend/**']).ok).toBe(true)
  })

  it('should check if a file is claimed', () => {
    owner.declare('t1', ['src/secret/**'])
    expect(owner.isClaimed('src/secret/.env')).toBe('t1')
    expect(owner.isClaimed('src/public/readme.md')).toBeNull()
  })

  it('should release claims', () => {
    owner.declare('t1', ['src/**'])
    owner.release('t1')
    expect(owner.listClaims().length).toBe(0)
  })

  it('should exclude task from isClaimed', () => {
    owner.declare('t1', ['src/**'])
    expect(owner.isClaimed('src/file.ts', 't1')).toBeNull() // exclude self
  })

  it('should not overlap src/a/** with src/ab/** (segment boundary)', () => {
    owner.declare('t1', ['src/a/**'])
    const result = owner.declare('t2', ['src/ab/**'])
    expect(result.ok).toBe(true)
  })

  it('should detect valid directory-prefix overlap', () => {
    owner.declare('t1', ['src/**'])
    const result = owner.declare('t2', ['src/a/**'])
    expect(result.ok).toBe(false)
  })

  it('should detect overlap for leading-wildcard patterns', () => {
    owner.declare('t1', ['**/*.test.ts'])
    // A pattern that can match anywhere overlaps any other claimed pattern.
    const result = owner.declare('t2', ['src/a/**'])
    expect(result.ok).toBe(false)
  })

  it('should treat identical exact paths as overlapping', () => {
    owner.declare('t1', ['src/index.ts'])
    const result = owner.declare('t2', ['src/index.ts'])
    expect(result.ok).toBe(false)
  })

  it('should rehydrate path claims across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsk-claim-'))
    const dbPath = join(dir, 'kernel.db')

    try {
      const s1 = new Store({ path: dbPath })
      s1.migrate(ALL)
      const e1 = new EventBus(s1, SID)
      const o1 = new PathOwnership(s1, e1)
      o1.declare('persist-claim', ['src/editor/**'])
      s1.close()

      const s2 = new Store({ path: dbPath })
      s2.migrate(ALL)
      const e2 = new EventBus(s2, SID)
      const o2 = new PathOwnership(s2, e2)
      const claims = o2.listClaims()
      expect(claims.length).toBe(1)
      expect(claims[0]!.task_id).toBe('persist-claim')
      expect(o2.isClaimed('src/editor/main.ts')).toBe('persist-claim')
      s2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── IntegrationPipeline ─────────────────────────────────────────────

describe('IntegrationPipeline', () => {
  let store: Store
  let events: EventBus
  let pipeline: IntegrationPipeline

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(ALL)
    seedSession(store)
    events = new EventBus(store, SID)
    pipeline = new IntegrationPipeline(store, events)
  })
  afterEach(() => store.close())

  it('should complete integration for empty change sets', async () => {
    const result = await pipeline.start({
      task_id: 't1', workspace_path: '/tmp/ws', project_root: '/tmp',
      base_commit: 'abc123', files_changed: [],
    })
    expect(result.status).toBe('integrated')
    expect(result.verified).toBe(true)
  })

  it('should run verifier for non-empty change sets', async () => {
    const result = await pipeline.start({
      task_id: 't2', workspace_path: '/tmp/ws', project_root: '/tmp',
      base_commit: 'abc', files_changed: ['src/a.ts'], patch: 'diff content',
    }, async () => ({ passed: true }))
    expect(result.status).toBe('integrated')
    expect(result.verified).toBe(true)
    expect(result.files_integrated).toContain('src/a.ts')
  })

  it('should rollback on verification failure', async () => {
    const result = await pipeline.start({
      task_id: 't3', workspace_path: '/tmp/ws', project_root: '/tmp',
      base_commit: 'abc', files_changed: ['src/b.ts'], patch: 'bad diff',
    }, async () => ({ passed: false, reason: 'Tests failed' }))
    expect(result.status).toBe('rolled_back')
    expect(result.rolled_back).toBe(true)
    expect(result.conflict_reason).toBe('Tests failed')
  })

  it('should support manual rollback', async () => {
    await pipeline.start({ task_id: 't4', workspace_path: '/tmp/ws', project_root: '/tmp', base_commit: 'x', files_changed: ['f.ts'], patch: 'd' })
    const rb = pipeline.rollback('t4', 'manual override')
    expect(rb).not.toBeNull()
    expect(rb!.rolled_back).toBe(true)
  })

  it('should treat a non-empty change set without a patch as a conflict', async () => {
    const result = await pipeline.start({
      task_id: 't-no-patch', workspace_path: '/tmp/ws', project_root: '/tmp',
      base_commit: 'abc', files_changed: ['src/x.ts'], // no patch
    })
    expect(result.status).toBe('conflict')
    expect(result.verified).toBe(false)
    expect(result.rolled_back).toBe(false)
  })

  it('should rehydrate integration results across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsk-int-'))
    const dbPath = join(dir, 'kernel.db')

    try {
      const s1 = new Store({ path: dbPath })
      s1.migrate(ALL)
      const e1 = new EventBus(s1, SID)
      const p1 = new IntegrationPipeline(s1, e1)
      const result = await p1.start({ task_id: 'persist-1', workspace_path: '/w', project_root: '/', base_commit: '1', files_changed: ['a.ts'], patch: 'p' })
      expect(result.status).toBe('integrated')
      s1.close()

      // Reopen the same file-backed database.
      const s2 = new Store({ path: dbPath })
      s2.migrate(ALL)
      const e2 = new EventBus(s2, SID)
      const p2 = new IntegrationPipeline(s2, e2)
      const restored = p2.get('persist-1')
      expect(restored).toBeDefined()
      expect(restored!.status).toBe('integrated')
      expect(restored!.files_integrated).toContain('a.ts')
      s2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should track multiple integrations', async () => {
    await pipeline.start({ task_id: 'a', workspace_path: '/w', project_root: '/', base_commit: '1', files_changed: [] })
    await pipeline.start({ task_id: 'b', workspace_path: '/w2', project_root: '/', base_commit: '2', files_changed: ['x.ts'], patch: 'p' }, async () => ({ passed: true }))
    expect(pipeline.list().length).toBe(2)
  })
})

// ── WorktreeGC ──────────────────────────────────────────────────────

describe('WorktreeGC', () => {
  let store: Store
  let events: EventBus
  let gc: WorktreeGC

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(ALL)
    seedSession(store)
    events = new EventBus(store, SID)
    gc = new WorktreeGC(events)
  })
  afterEach(() => store.close())

  it('should clean integrated worktrees', () => {
    const result = gc.evaluate([{
      path: '/tmp/wt1', integrated: true, integrated_patch_hash: 'h1',
      current_patch_hash: 'h1', has_ignored_files: false, task_id: 't1',
    }])
    expect(result.cleaned.length).toBe(1)
    expect(result.preserved.length).toBe(0)
  })

  it('should preserve non-integrated worktrees', () => {
    const result = gc.evaluate([{
      path: '/tmp/wt2', integrated: false, has_ignored_files: false, task_id: 't2',
    }])
    expect(result.preserved.length).toBe(1)
    expect(result.preserved[0]).toContain('not integrated')
  })

  it('should preserve worktrees with ignored files', () => {
    const result = gc.evaluate([{
      path: '/tmp/wt3', integrated: true, integrated_patch_hash: 'h',
      current_patch_hash: 'h', has_ignored_files: true, task_id: 't3',
    }])
    expect(result.preserved.length).toBe(1)
    expect(result.preserved[0]).toContain('ignored files')
  })

  it('should preserve worktrees with changed patches', () => {
    const result = gc.evaluate([{
      path: '/tmp/wt4', integrated: true, integrated_patch_hash: 'old',
      current_patch_hash: 'new', has_ignored_files: false, task_id: 't4',
    }])
    expect(result.preserved.length).toBe(1)
    expect(result.preserved[0]).toContain('patch changed')
  })

  it('should preserve a worktree when the integrated hash is missing', () => {
    const result = gc.evaluate([{
      path: '/tmp/wt5', integrated: true,
      current_patch_hash: 'h', has_ignored_files: false, task_id: 't5',
    }])
    expect(result.cleaned.length).toBe(0)
    expect(result.preserved.length).toBe(1)
    expect(result.preserved[0]).toContain('unknown integrated patch hash')
  })

  it('should preserve a worktree when the current hash is missing', () => {
    const result = gc.evaluate([{
      path: '/tmp/wt6', integrated: true, integrated_patch_hash: 'h',
      has_ignored_files: false, task_id: 't6',
    }])
    expect(result.cleaned.length).toBe(0)
    expect(result.preserved.length).toBe(1)
    expect(result.preserved[0]).toContain('unknown current patch hash')
  })
})
