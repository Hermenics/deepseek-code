import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Store } from '../../src/kernel/store/store.js'
import { MIGRATIONS } from '../../src/kernel/store/migrations.js'
import { EventBus } from '../../src/kernel/events/eventBus.js'
import { PathOwnership } from '../../src/kernel/workspace/pathOwnership.js'
import { IntegrationPipeline, WorktreeGC } from '../../src/kernel/workspace/integration.js'
import { LEASE_MIGRATION } from '../../src/kernel/tasks/taskBoard.js'

const ALL = [...MIGRATIONS, LEASE_MIGRATION]
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

  it('should support manual rollback', () => {
    pipeline.start({ task_id: 't4', workspace_path: '/tmp/ws', project_root: '/tmp', base_commit: 'x', files_changed: ['f.ts'], patch: 'd' })
    const rb = pipeline.rollback('t4', 'manual override')
    expect(rb!.rolled_back).toBe(true)
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
})
