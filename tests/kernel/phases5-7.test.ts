import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { Store } from '../../src/kernel/store/store.js'
import { MIGRATIONS } from '../../src/kernel/store/migrations.js'
import { EventBus } from '../../src/kernel/events/eventBus.js'
import { GoalEngine } from '../../src/kernel/goals/goalEngine.js'
import { HookRuntime, type HookDefinition } from '../../src/kernel/hooks/hookRuntime.js'
import { WorkflowEngine, REVIEW_WORKFLOW, IMPLEMENT_WORKFLOW, RESEARCH_WORKFLOW } from '../../src/kernel/workflows/workflowEngine.js'
import { LEASE_MIGRATION } from '../../src/kernel/tasks/taskBoard.js'
import { PathOwnership } from '../../src/kernel/workspace/pathOwnership.js'
import { TaskBoard } from '../../src/kernel/tasks/taskBoard.js'
import { MessageRouter } from '../../src/kernel/tasks/messageRouter.js'

const ALL = [...MIGRATIONS, LEASE_MIGRATION]
const SID = 'test-phases5-7'

function seed(store: Store): void {
  store.run('INSERT INTO sessions (id, cwd, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    SID, '/tmp', 'test', 'test', new Date().toISOString(), new Date().toISOString())
  // Threads needed for FK refs from goals
  for (const tid of ['th1', 'th2', 'th3', 'th4', 'th5', 'th6', 'th7', 'gc-th']) {
    store.run('INSERT INTO threads (id, session_id, agent_spec, agent_name, role, context_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      tid, SID, '{}', 'test', 'reader', 'fresh', 'idle', new Date().toISOString(), new Date().toISOString())
  }
  // Tasks needed for FK refs from leases/messages
  for (const tid of ['task-x', 't1']) {
    store.run('INSERT INTO tasks (task_id, session_id, type, mode, context_mode, state, depth, attempt, permission_profile, timeout_ms, tokens_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      tid, SID, 'agent', 'foreground', 'fresh', 'queued', 0, 0, 'writer-worktree', 120_000, 0, new Date().toISOString())
  }
}

// ── GoalEngine ──────────────────────────────────────────────────────

describe('GoalEngine', () => {
  let store: Store
  let events: EventBus
  let engine: GoalEngine

  beforeEach(() => { store = new Store({ memory: true }); store.migrate(ALL); seed(store); events = new EventBus(store, SID); engine = new GoalEngine(store, events) })
  afterEach(() => store.close())

  it('should create a goal with criteria', () => {
    const goal = engine.create({ thread_id: 'th1', objective: 'Implement auth', criteria: [
      { kind: 'command', spec: 'bun test' },
      { kind: 'test', spec: 'tests/auth.test.ts', required: true },
    ]})
    expect(goal.status).toBe('active')
    const criteria = engine.repo.listCriteria(goal.goal_id)
    expect(criteria.length).toBe(2)
    expect(criteria[1]!.required).toBe(1)
  })

  it('should not complete when required criteria fail', () => {
    const goal = engine.create({ thread_id: 'th2', objective: 'Add API', criteria: [
      { kind: 'test', spec: 'tests/api.test.ts', required: true },
    ]})
    const result = engine.tryComplete(goal.goal_id)
    expect(result.completed).toBe(false)
    expect(engine.repo.get(goal.goal_id)!.status).toBe('active')
  })

  it('should complete when all criteria pass', () => {
    const goal = engine.create({ thread_id: 'th3', objective: 'Fix bug', criteria: [
      { kind: 'command', spec: 'bun test', required: true },
    ]})
    const criteria = engine.repo.listCriteria(goal.goal_id)
    engine.repo.updateCriteria(criteria[0]!.id, { status: 'passed', result: 'OK' })

    const result = engine.tryComplete(goal.goal_id)
    expect(result.completed).toBe(true)
    expect(engine.repo.get(goal.goal_id)!.status).toBe('complete')
  })

  it('should detect no progress', () => {
    const goal = engine.create({ thread_id: 'th4', objective: 'Refactor', criteria: [
      { kind: 'test', spec: 'tests/**', required: true },
    ]})
    const eval1 = engine.evaluate(goal.goal_id)
    const hash1 = engine.detectNoProgress(goal.goal_id, '').current_hash
    // Same criteria state should produce same hash
    const r2 = engine.detectNoProgress(goal.goal_id, hash1)
    expect(r2.stuck).toBe(true)
  })

  it('should pause and resume a goal', () => {
    const goal = engine.create({ thread_id: 'th5', objective: 'Pause test', criteria: [] })
    engine.pause(goal.goal_id)
    expect(engine.repo.get(goal.goal_id)!.status).toBe('paused')
    engine.resume(goal.goal_id)
    expect(engine.repo.get(goal.goal_id)!.status).toBe('active')
  })

  it('should block and cancel a goal', () => {
    const goal = engine.create({ thread_id: 'th6', objective: 'Block test', criteria: [] })
    engine.block(goal.goal_id, 'API key missing')
    const blocked = engine.repo.get(goal.goal_id)!
    expect(blocked.status).toBe('blocked')
    expect(blocked.block_reason).toBe('API key missing')

    engine.cancel(goal.goal_id)
    expect(engine.repo.get(goal.goal_id)!.status).toBe('cancelled')
  })

  it('should evaluate a goal with criteria', () => {
    const goal = engine.create({ thread_id: 'th7', objective: 'Eval test', criteria: [
      { kind: 'command', spec: 'tsc --noEmit', required: true },
      { kind: 'command', spec: 'bun test', required: false },
    ]})
    const criteria = engine.repo.listCriteria(goal.goal_id)
    engine.repo.updateCriteria(criteria[0]!.id, { status: 'passed' })

    const evaluation = engine.evaluate(goal.goal_id)
    expect(evaluation.all_required_passed).toBe(true)
    expect(evaluation.progress_delta).toContain('1/2')
  })
})

// ── HookRuntime ─────────────────────────────────────────────────────

describe('HookRuntime', () => {
  let store: Store
  let events: EventBus
  let runtime: HookRuntime

  beforeEach(() => { store = new Store({ memory: true }); store.migrate(ALL); seed(store); events = new EventBus(store, SID); runtime = new HookRuntime(store, events) })
  afterEach(() => store.close())

  const testHook: HookDefinition = {
    id: 'hook-1', event: 'PreToolUse', matcher: 'WriteFile',
    handler_type: 'command', handler_config: { command: 'echo ok' },
    scope: 'user', timeout_ms: 30_000, enabled: true,
  }

  it('should register a hook', () => {
    runtime.register(testHook)
    expect(testHook.content_hash).toBeTruthy()
  })

  it('should match hooks by event and tool', () => {
    runtime.register(testHook)
    runtime.trust('hook-1')
    const matched = runtime.getMatching('PreToolUse', 'WriteFile')
    expect(matched.length).toBe(1)
  })

  it('should not match different tool', () => {
    runtime.register(testHook)
    runtime.trust('hook-1')
    expect(runtime.getMatching('PreToolUse', 'ReadFile').length).toBe(0)
  })

  it('should require trust for project hooks', () => {
    const projectHook: HookDefinition = { ...testHook, id: 'hook-p', scope: 'project' }
    runtime.register(projectHook)
    expect(runtime.getMatching('PreToolUse', 'WriteFile').length).toBe(0) // not trusted
    runtime.trust('hook-p')
    expect(runtime.getMatching('PreToolUse', 'WriteFile').length).toBe(1)
  })

  it('should detect trust invalidation', () => {
    runtime.register(testHook)
    runtime.trust('hook-1')
    // modify the hook
    runtime.register({ ...testHook, handler_config: { command: 'echo changed' } })
    const invalid = runtime.checkTrustInvalidation()
    expect(invalid.length).toBe(1)
    expect(invalid[0]!.hook_id).toBe('hook-1')
  })

  it('should execute matching hooks', async () => {
    runtime.register(testHook)
    runtime.trust('hook-1')
    const result = await runtime.execute('PreToolUse', 'WriteFile', { path: 'test.ts' }, { session_id: 's1', cwd: '/tmp' })
    expect(result.decision).toBe('allow')
    expect(result.runs.length).toBe(1)
    expect(result.runs[0]!.hook_id).toBe('hook-1')
  })

  it('should get run history', async () => {
    runtime.register(testHook)
    runtime.trust('hook-1')
    await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: 's1', cwd: '/tmp' })
    const runs = runtime.getRuns({ hook_id: 'hook-1' })
    expect(runs.length).toBe(1)
  })

  it('should support wildcard event matching', () => {
    const wildHook: HookDefinition = { ...testHook, id: 'hook-w', event: '*', matcher: undefined }
    runtime.register(wildHook)
    runtime.trust('hook-w')
    expect(runtime.getMatching('PreToolUse', 'WriteFile').length).toBe(1)
    expect(runtime.getMatching('SessionStart').length).toBe(1)
  })
})

// ── WorkflowEngine ──────────────────────────────────────────────────

describe('WorkflowEngine', () => {
  let store: Store
  let events: EventBus
  let engine: WorkflowEngine

  beforeEach(() => { store = new Store({ memory: true }); store.migrate(ALL); seed(store); events = new EventBus(store, SID); engine = new WorkflowEngine(store, events) })
  afterEach(() => store.close())

  it('should run review workflow', () => {
    const spawned: string[] = []
    const run = engine.start(REVIEW_WORKFLOW, { task: 'Check PR #42', context: 'auth module' },
      (_phase, _prompt) => { const id = `task-${randomUUID().slice(0, 8)}`; spawned.push(id); return id })
    expect(run.status).toBe('completed')
    expect(run.task_ids.length).toBe(5) // 3 Find + 2 Verify
    expect(spawned.length).toBe(5)
  })

  it('should run implement workflow with dependency order', () => {
    const spawned: { phase: string; id: string }[] = []
    const run = engine.start(IMPLEMENT_WORKFLOW, { task: 'Add login endpoint' },
      (phase, _prompt) => { const id = `task-${randomUUID().slice(0, 8)}`; spawned.push({ phase: phase.title, id }); return id })
    expect(run.status).toBe('completed')
    // 1 Plan + 1 Implement + 2 Review = 4
    expect(run.task_ids.length).toBe(4)
    // Verify order: Plan first
    expect(spawned[0]!.phase).toBe('Plan')
    expect(spawned[1]!.phase).toBe('Implement')
    expect(spawned[2]!.phase).toBe('Review')
  })

  it('should run research workflow', () => {
    const run = engine.start(RESEARCH_WORKFLOW, { task: 'Database migration patterns' },
      (_phase, _prompt) => randomUUID())
    expect(run.status).toBe('completed')
    expect(run.task_ids.length).toBe(5) // 4 Scan + 1 Synthesize
  })

  it('should track runs', () => {
    engine.start(REVIEW_WORKFLOW, { task: 'T1' }, () => randomUUID())
    engine.start(REVIEW_WORKFLOW, { task: 'T2' }, () => randomUUID())
    expect(engine.listRuns().length).toBe(2)
  })

  it('should get run by ID', () => {
    const run = engine.start(IMPLEMENT_WORKFLOW, { task: 'T' }, () => randomUUID())
    expect(engine.getRun(run.run_id)!.workflow_name).toBe('implement-and-review')
  })
})

// ── Benchmark Harness ───────────────────────────────────────────────

describe('Benchmark Harness', () => {
  let store: Store
  let events: EventBus

  beforeEach(() => { store = new Store({ memory: true }); store.migrate(ALL); seed(store); events = new EventBus(store, SID) })
  afterEach(() => store.close())

  // Gate A: Parallel writer safety
  it('Gate A: parallel writer path ownership prevents overlap', () => {
    const owner = new PathOwnership(store, events)
    owner.declare('writer-1', ['src/auth/**'])
    const result = owner.declare('writer-2', ['src/auth/login.ts'])
    expect(result.ok).toBe(false)
  })

  // Gate B: Crash recovery — tasks survive restart
  it('Gate B: task state persists across store instances', () => {
    const board = new TaskBoard(store, events)
    const task = board.create({ type: 'agent' })
    board.transition(task.task_id, 'running')

    // Simulate restart — new board on same store
    const board2 = new TaskBoard(store, events)
    const restored = board2.get(task.task_id)!
    expect(restored.state).toBe('running')
  })

  // Gate C: Goal correctness — no false completion
  it('Gate C: goal with failed required criteria cannot complete', () => {
    const engine = new GoalEngine(store, events)
    const goal = engine.create({ thread_id: 'gc-th', objective: 'Gate C test', criteria: [
      { kind: 'test', spec: 'tests/critical.test.ts', required: true },
    ]})
    const result = engine.tryComplete(goal.goal_id)
    expect(result.completed).toBe(false)
  })

  // Gate E: Observability — events traceable
  it('Gate E: events link to sessions and tasks', () => {
    events.emit('TestEvent', { key: 'val' }, { task_id: 'task-x', thread_id: 'thread-x' })
    const evts = events.query({ task_id: 'task-x' })
    expect(evts.length).toBe(1)
    expect(evts[0]!.type).toBe('TestEvent')
    expect(evts[0]!.session_id).toBe(SID)
  })

  // Gate G: UX control — agent peer messaging works
  it('Gate G: agents can message each other', () => {
    const router = new MessageRouter(store, events)
    router.send({ sender_id: 'agent-a', recipient_id: 'agent-b', task_id: 't1', type: 'question', payload: { q: 'ready?' } })
    const pending = router.listPending('agent-b')
    expect(pending.length).toBe(1)
    expect(pending[0]!.payload.q).toBe('ready?')
  })
})
