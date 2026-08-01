import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Store } from '../../src/kernel/store/store.js'
import { MIGRATIONS } from '../../src/kernel/store/migrations.js'
import { EventBus } from '../../src/kernel/events/eventBus.js'
import { createAgentSpec, validateAgentSpec } from '../../src/kernel/threads/agentSpec.js'
import { ThreadRuntime } from '../../src/kernel/threads/threadRuntime.js'
import { TaskBoard, LeaseManager } from '../../src/kernel/tasks/taskBoard.js'
import { MessageRouter } from '../../src/kernel/tasks/messageRouter.js'
import { GoalRepo } from '../../src/kernel/store/repositories.js'

const ALL_MIGRATIONS = MIGRATIONS
const SESSION = 'test-session-phase3'

function seedSession(store: Store): void {
  store.run(
    'INSERT INTO sessions (id, cwd, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    SESSION, '/tmp/test', 'test-model', 'test-provider', new Date().toISOString(), new Date().toISOString(),
  )
  // Threads referenced by goal FK constraints.
  for (const tid of ['th1', 'shared-th']) {
    store.run('INSERT INTO threads (id, session_id, agent_spec, agent_name, role, context_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      tid, SESSION, '{}', 'test', 'reader', 'fresh', 'idle', new Date().toISOString(), new Date().toISOString())
  }
}

// ── AgentSpec ───────────────────────────────────────────────────────

describe('AgentSpec', () => {
  it('should create with defaults applied', () => {
    const spec = createAgentSpec({ agent_id: 'a1', name: 'test', system_prompt: 'You are a tester.' })
    expect(spec.agent_id).toBe('a1')
    expect(spec.role).toBe('reader')
    expect(spec.provider).toBe('deepseek')
    expect(spec.context_mode).toBe('fresh')
    expect(spec.timeout_ms).toBe(120_000)
  })

  it('should validate successfully', () => {
    const spec = createAgentSpec({ agent_id: 'a1', name: 'test', system_prompt: 'hi' })
    const result = validateAgentSpec(spec)
    expect(result.valid).toBe(true)
  })

  it('should detect missing agent_id', () => {
    const result = validateAgentSpec({ agent_id: '', name: 'x', system_prompt: 'hi' } as any)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('agent_id'))).toBe(true)
  })

  it('should detect invalid context_mode', () => {
    const spec = createAgentSpec({ agent_id: 'a', name: 'x', system_prompt: 'hi', context_mode: 'bad' as any })
    const result = validateAgentSpec(spec)
    expect(result.valid).toBe(false)
  })

  it('should reject malformed numeric configuration values', () => {
    const base = { agent_id: 'a', name: 'x', system_prompt: 'hi' }
    const cases: Array<[string, unknown]> = [
      ['timeout_ms', undefined],
      ['timeout_ms', '5000'],
      ['timeout_ms', NaN],
      ['timeout_ms', Infinity],
      ['timeout_ms', 12.5],
      ['max_retries', undefined],
      ['max_retries', '2'],
      ['max_depth', null as unknown],
      ['max_fan_out', NaN],
    ]
    for (const [field, value] of cases) {
      const spec = { ...base, [field]: value } as unknown as Parameters<typeof validateAgentSpec>[0]
      const result = validateAgentSpec(spec)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes(field))).toBe(true)
    }
  })

  it('should still accept valid numeric ranges', () => {
    const spec = createAgentSpec({ agent_id: 'a', name: 'x', system_prompt: 'hi',
      timeout_ms: 5_000, max_retries: 2, max_depth: 4, max_fan_out: 10 })
    expect(validateAgentSpec(spec).valid).toBe(true)
  })
})

// ── ThreadRuntime ───────────────────────────────────────────────────

describe('ThreadRuntime', () => {
  let store: Store
  let events: EventBus
  let runtime: ThreadRuntime

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(ALL_MIGRATIONS)
    seedSession(store)
    events = new EventBus(store, SESSION)
    runtime = new ThreadRuntime(store, events)
  })

  afterEach(() => store.close())

  it('should create a thread from an AgentSpec', () => {
    const spec = createAgentSpec({ agent_id: 't1', name: 'Worker', system_prompt: 'Do work.' })
    const thread = runtime.createThread(spec)
    expect(thread.id).toBe('t1')
    expect(thread.status).toBe('idle')
    expect(thread.agent_name).toBe('Worker')
    expect(thread.role).toBe('reader')
  })

  it('should retrieve an AgentSpec', () => {
    const spec = createAgentSpec({ agent_id: 't2', name: 'W', system_prompt: 'X', role: 'writer' })
    runtime.createThread(spec)
    const restored = runtime.getAgentSpec('t2')
    expect(restored!.role).toBe('writer')
    expect(restored!.name).toBe('W')
  })

  it('should create and complete turns', () => {
    const spec = createAgentSpec({ agent_id: 't3', name: 'T', system_prompt: 'Y' })
    runtime.createThread(spec)
    const turn = runtime.createTurn('t3', 'deepseek-v4-flash', 'deepseek')
    expect(turn.sequence).toBe(1)
    expect(turn.status).toBe('pending')

    runtime.startTurn(turn.id)
    runtime.completeTurn(turn.id, {
      transcript_json: '["msg1","msg2"]',
      tokens_in: 100, tokens_out: 50, tokens_cache: 10,
    })

    const completed = runtime.getTurn(turn.id)!
    expect(completed.status).toBe('done')
    expect(completed.tokens_in).toBe(100)
    expect(completed.tokens_out).toBe(50)
  })

  it('should fail a turn', () => {
    const spec = createAgentSpec({ agent_id: 't4', name: 'F', system_prompt: 'Z' })
    runtime.createThread(spec)
    const turn = runtime.createTurn('t4', 'm', 'p')
    runtime.failTurn(turn.id, 'something broke')
    const failed = runtime.getTurn(turn.id)!
    expect(failed.status).toBe('failed')
  })

  it('should build fresh context (empty)', () => {
    const spec = createAgentSpec({ agent_id: 't5', name: 'C', system_prompt: 'ctx', context_mode: 'fresh' })
    runtime.createThread(spec)
    const ctx = runtime.buildContext('t5')
    expect(ctx).toBe('')
  })

  it('should list threads by session', () => {
    runtime.createThread(createAgentSpec({ agent_id: 'ta', name: 'A', system_prompt: 'a' }))
    runtime.createThread(createAgentSpec({ agent_id: 'tb', name: 'B', system_prompt: 'b' }))
    // Includes the two seed threads (th1, shared-th) from the shared session.
    expect(runtime.listThreads().length).toBeGreaterThanOrEqual(4)
  })

  it('should allocate turn sequences atomically', () => {
    const spec = createAgentSpec({ agent_id: 'atomic-turns', name: 'AT', system_prompt: 'x' })
    runtime.createThread(spec)
    // Concurrent-ish creation in sequence must produce strictly increasing numbers.
    const turns = [runtime.createTurn('atomic-turns', 'm', 'p'), runtime.createTurn('atomic-turns', 'm', 'p')]
    expect(turns[0]!.sequence).toBe(1)
    expect(turns[1]!.sequence).toBe(2)
    expect(runtime.listTurns('atomic-turns').map(t => t.sequence)).toEqual([1, 2])
  })

  it('should build child context from parent turns for last_n_turns', () => {
    const parent = createAgentSpec({ agent_id: 'parent-ctx', name: 'P', system_prompt: 'parent' })
    runtime.createThread(parent)
    const t1 = runtime.createTurn('parent-ctx', 'm', 'p')
    runtime.completeTurn(t1.id, { transcript_json: JSON.stringify(['parent-msg-1']), tokens_in: 1, tokens_out: 1, tokens_cache: 0 })

    const child = createAgentSpec({ agent_id: 'child-ctx', name: 'C', system_prompt: 'child', context_mode: 'last_n_turns', context_window: 5 })
    runtime.createThread(child, 'parent-ctx')

    const ctx = runtime.buildContext('child-ctx')
    expect(ctx).toContain('parent-msg-1')
  })

  it('should build child context from parent turns for full mode', () => {
    const parent = createAgentSpec({ agent_id: 'parent-full', name: 'P', system_prompt: 'p' })
    runtime.createThread(parent)
    const t1 = runtime.createTurn('parent-full', 'm', 'p')
    runtime.completeTurn(t1.id, { transcript_json: JSON.stringify(['full-parent']), tokens_in: 1, tokens_out: 1, tokens_cache: 0 })

    const child = createAgentSpec({ agent_id: 'child-full', name: 'C', system_prompt: 'c', context_mode: 'full' })
    runtime.createThread(child, 'parent-full')

    expect(runtime.buildContext('child-full')).toContain('full-parent')
  })

  it('should return empty context for non-fresh child without a parent', () => {
    const child = createAgentSpec({ agent_id: 'orphan-ctx', name: 'O', system_prompt: 'o', context_mode: 'summary' })
    runtime.createThread(child)
    expect(runtime.buildContext('orphan-ctx')).toBe('')
  })
})

// ── TaskBoard ───────────────────────────────────────────────────────

describe('TaskBoard', () => {
  let store: Store
  let events: EventBus
  let board: TaskBoard

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(ALL_MIGRATIONS)
    seedSession(store)
    events = new EventBus(store, SESSION)
    board = new TaskBoard(store, events)
  })

  afterEach(() => store.close())

  it('should create a task', () => {
    const task = board.create({ type: 'agent', permission_profile: 'writer-worktree' })
    expect(task.task_id).toBeTruthy()
    expect(task.state).toBe('queued')
    expect(task.permission_profile).toBe('writer-worktree')
  })

  it('should transition through states', () => {
    const task = board.create({})
    board.transition(task.task_id, 'running')
    expect(board.get(task.task_id)!.state).toBe('running')

    board.transition(task.task_id, 'done', { tokens_used: 500 })
    const done = board.get(task.task_id)!
    expect(done.state).toBe('done')
    expect(done.tokens_used).toBe(500)
  })

  it('should list tasks by state', () => {
    board.create({})
    board.create({})
    const t3 = board.create({})
    board.transition(t3.task_id, 'running')
    board.transition(t3.task_id, 'done')
    expect(board.list({ state: 'queued' }).length).toBe(2)
    expect(board.list({ state: 'done' }).length).toBe(1)
  })

  it('should add and check dependencies', () => {
    const t1 = board.create({})
    const t2 = board.create({})
    board.transition(t1.task_id, 'running')
    board.transition(t1.task_id, 'done')
    board.addDependency(t2.task_id, t1.task_id)

    const ready = board.listReady()
    // t1 is done (not queued), t2 is queued with dep met → ready
    expect(ready.some(t => t.task_id === t2.task_id)).toBe(true)
  })

  it('should block task with pending dependency', () => {
    const t1 = board.create({})
    const t2 = board.create({})
    board.addDependency(t2.task_id, t1.task_id)
    // t1 is still queued, so t2 should not be ready
    const ready = board.listReady()
    expect(ready.some(t => t.task_id === t2.task_id)).toBe(false)
  })
})

// ── LeaseManager ────────────────────────────────────────────────────

describe('LeaseManager', () => {
  let store: Store
  let events: EventBus
  let leases: LeaseManager

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(ALL_MIGRATIONS)
    seedSession(store)
    events = new EventBus(store, SESSION)
    leases = new LeaseManager(store, events)
    // Create task rows for FK refs — tests use t1, t2, task-1, task-2
    for (const tid of ['t1', 't2', 'task-1', 'task-2']) {
      store.run('INSERT INTO tasks (task_id, session_id, type, mode, context_mode, state, depth, attempt, permission_profile, timeout_ms, tokens_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        tid, SESSION, 'agent', 'foreground', 'fresh', 'queued', 0, 0, 'writer-worktree', 120_000, 0, new Date().toISOString())
    }
  })

  afterEach(() => store.close())

  it('should acquire a lease', () => {
    const lease = leases.acquire('task-1', 'holder-1', '/tmp/resource')
    expect(lease).not.toBeNull()
    expect(lease!.status).toBe('active')
    expect(lease!.resource_path).toBe('/tmp/resource')
  })

  it('should block concurrent lease on same resource', () => {
    leases.acquire('task-1', 'h1', '/tmp/r')
    const second = leases.acquire('task-2', 'h2', '/tmp/r')
    expect(second).toBeNull()
  })

  it('should allow lease on different resource', () => {
    leases.acquire('task-1', 'h1', '/tmp/a')
    const second = leases.acquire('task-2', 'h2', '/tmp/b')
    expect(second).not.toBeNull()
  })

  it('should release a lease', () => {
    const lease = leases.acquire('t1', 'h1', '/tmp/x')!
    leases.release(lease.lease_id)
    // After release, a new lease should be possible
    const second = leases.acquire('t2', 'h2', '/tmp/x')
    expect(second).not.toBeNull()
  })

  it('should release all leases for a task', () => {
    leases.acquire('t1', 'h1', '/tmp/p')
    leases.acquire('t1', 'h1', '/tmp/q')
    leases.releaseAll('t1')
    expect(leases.hasLease('t1')).toBe(false)
  })

  it('should enforce sequential mutual exclusion on same resource', () => {
    // Both calls run synchronously on one connection, so this tests the
    // serialized mutual exclusion path — the partial unique index and
    // INSERT OR IGNORE make the second acquire fail.
    const a = leases.acquire('t1', 'h1', '/tmp/race')
    const b = leases.acquire('t2', 'h2', '/tmp/race')
    expect(a).not.toBeNull()
    expect(b).toBeNull()
  })

  it('should heartbeat an active lease', () => {
    const lease = leases.acquire('t1', 'h1', '/tmp/hb')!
    expect(leases.heartbeat(lease.lease_id)).toBe(true)
  })

  it('should return false for heartbeat on a missing lease', () => {
    expect(leases.heartbeat('does-not-exist')).toBe(false)
  })

  it('should return false for heartbeat on a released lease', () => {
    const lease = leases.acquire('t1', 'h1', '/tmp/hb2')!
    leases.release(lease.lease_id)
    expect(leases.heartbeat(lease.lease_id)).toBe(false)
  })
})

// ── Task transitions ────────────────────────────────────────────────

describe('TaskBoard transitions', () => {
  let store: Store
  let events: EventBus
  let board: TaskBoard

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(ALL_MIGRATIONS)
    seedSession(store)
    events = new EventBus(store, SESSION)
    board = new TaskBoard(store, events)
  })
  afterEach(() => store.close())

  it('should reject invalid transitions from terminal states', () => {
    const task = board.create({})
    board.transition(task.task_id, 'running')
    board.transition(task.task_id, 'done')
    // done is fully terminal — neither running nor queued are reachable.
    expect(() => board.transition(task.task_id, 'running')).toThrow(/invalid task transition/i)
    expect(() => board.transition(task.task_id, 'queued')).toThrow(/invalid task transition/i)
  })

  it('should reject invalid transition from running to queued', () => {
    const task = board.create({})
    board.transition(task.task_id, 'running')
    expect(() => board.transition(task.task_id, 'queued')).toThrow(/invalid task transition/i)
  })

  it('should reject queued directly to done (must pass through running)', () => {
    const task = board.create({})
    expect(() => board.transition(task.task_id, 'done')).toThrow(/invalid task transition/i)
  })

  it('should set completed_at on terminal transitions', () => {
    const task = board.create({})
    board.transition(task.task_id, 'running')
    board.transition(task.task_id, 'done')
    const done = board.get(task.task_id)!
    expect(done.completed_at).toBeTruthy()
  })

  it('should preserve completed_at across non-terminal no-op updates', () => {
    const task = board.create({})
    board.transition(task.task_id, 'running')
    board.transition(task.task_id, 'done')
    const completedAt = board.get(task.task_id)!.completed_at

    // No-op transition on a terminal task must not erase history.
    board.transition(task.task_id, 'done')
    expect(board.get(task.task_id)!.completed_at).toBe(completedAt)
  })

  it('should clear completed_at when a retryable terminal task resumes to queued', () => {
    const task = board.create({})
    board.transition(task.task_id, 'running')
    board.transition(task.task_id, 'failed')
    expect(board.get(task.task_id)!.completed_at).toBeTruthy()

    // failed -> queued is the retry path and starts a new attempt.
    board.transition(task.task_id, 'queued')
    expect(board.get(task.task_id)!.completed_at).toBeNull()
  })
})

// ── MessageRouter ───────────────────────────────────────────────────

describe('MessageRouter', () => {
  let store: Store
  let events: EventBus
  let router: MessageRouter

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(ALL_MIGRATIONS)
    seedSession(store)
    events = new EventBus(store, SESSION)
    router = new MessageRouter(store, events)
  })

  afterEach(() => store.close())

  it('should send a message', () => {
    const { message } = router.send({
      sender_id: 'agent-a', recipient_id: 'agent-b',
      task_id: 'task-1', type: 'direct', payload: { text: 'hello' },
    })
    expect(message.message_id).toBeTruthy()
    expect(message.status).toBe('pending')
    expect(message.payload.text).toBe('hello')
  })

  it('should deduplicate by message_id', () => {
    const { message: m1 } = router.send({
      message_id: 'dup-1', sender_id: 'a', recipient_id: 'b',
      task_id: 't1', type: 'direct', payload: { x: 1 },
    })
    const { message: m2, duplicate } = router.send({
      message_id: 'dup-1', sender_id: 'a', recipient_id: 'b',
      task_id: 't1', type: 'direct', payload: { x: 1 },
    })
    expect(duplicate).toBe(true)
    expect(m2.message_id).toBe(m1.message_id)
  })

  it('should throw on message_id collision with different content', () => {
    router.send({ message_id: 'c1', sender_id: 'a', recipient_id: 'b', task_id: 't', type: 'direct', payload: { a: 1 } })
    expect(() => {
      router.send({ message_id: 'c1', sender_id: 'a', recipient_id: 'b', task_id: 't', type: 'direct', payload: { a: 2 } })
    }).toThrow('collision')
  })

  it('should acknowledge messages', () => {
    const { message } = router.send({ sender_id: 'a', recipient_id: 'b', task_id: 't', type: 'result', payload: {} })
    expect(router.acknowledge(message.message_id)).toBe(true)
    // Idempotent
    expect(router.acknowledge(message.message_id)).toBe(true)
    // No pending for recipient
    expect(router.listPending('b').length).toBe(0)
  })

  it('should list pending for recipient', () => {
    router.send({ sender_id: 'a', recipient_id: 'b', task_id: 't', type: 'direct', payload: {} })
    router.send({ sender_id: 'c', recipient_id: 'b', task_id: 't2', type: 'question', payload: {} })
    router.send({ sender_id: 'd', recipient_id: 'e', task_id: 't3', type: 'direct', payload: {} })
    expect(router.listPending('b').length).toBe(2)
  })

  it('should get conversation between two agents', () => {
    router.send({ sender_id: 'a', recipient_id: 'b', task_id: 't', type: 'direct', payload: { n: 1 } })
    router.send({ sender_id: 'b', recipient_id: 'a', task_id: 't', type: 'direct', payload: { n: 2 } })
    router.send({ sender_id: 'c', recipient_id: 'a', task_id: 't', type: 'direct', payload: { n: 3 } })
    const conv = router.listConversation('a', 'b')
    expect(conv.length).toBe(2)
  })

  it('should followup with event', () => {
    const msg = router.followup({ sender_id: 'a', recipient_id: 'b', task_id: 't', payload: { resume: true } })
    expect(msg.type).toBe('followup')
    expect(msg.payload.resume).toBe(true)
  })

  it('should broadcast a root task to all other root tasks but not itself', () => {
    // Root tasks (parent_task_id IS NULL).
    for (const tid of ['root-a', 'root-b', 'root-c']) {
      store.run('INSERT INTO tasks (task_id, session_id, type, mode, context_mode, state, depth, attempt, permission_profile, timeout_ms, tokens_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        tid, SESSION, 'agent', 'foreground', 'fresh', 'queued', 0, 0, 'writer-worktree', 120_000, 0, new Date().toISOString())
    }

    const sent = router.broadcast({ sender_id: 'root-a', task_id: 'root-a', type: 'direct', payload: { ping: true } })
    expect(sent.length).toBe(2) // root-b and root-c, not root-a
    expect(sent.every(m => m.recipient_id !== 'root-a')).toBe(true)
    expect(sent.map(m => m.recipient_id).sort()).toEqual(['root-b', 'root-c'])
  })
})

// ── GoalRepo integrity ──────────────────────────────────────────────

describe('GoalRepo integrity', () => {
  let store: Store
  let events: EventBus
  let goals: GoalRepo

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(ALL_MIGRATIONS)
    seedSession(store)
    events = new EventBus(store, SESSION)
    goals = new GoalRepo(store, events)
  })
  afterEach(() => store.close())

  it('should increment revision on each update', () => {
    const goal = goals.create({ thread_id: 'th1', objective: 'Rev test' })
    expect(goal.revision).toBe(1)
    goals.update(goal.goal_id, { status: 'paused' })
    goals.update(goal.goal_id, { status: 'active' })
    expect(goals.get(goal.goal_id)!.revision).toBe(3)
  })

  it('should make concurrent writes conflict via the revision guard', () => {
    const goal = goals.create({ thread_id: 'th1', objective: 'Race test' })
    const staleRevision = goal.revision // 1

    // First writer applies its change against revision 1 → 1 row changed.
    const firstChanges = store.run(
      `UPDATE goals SET revision = ?, status = ? WHERE goal_id = ? AND revision = ?`,
      staleRevision + 1, 'paused', goal.goal_id, staleRevision,
    )
    expect(firstChanges).toBe(1)

    // Second writer, still holding the stale revision, matches zero rows.
    const secondChanges = store.run(
      `UPDATE goals SET revision = ?, status = ? WHERE goal_id = ? AND revision = ?`,
      staleRevision + 1, 'active', goal.goal_id, staleRevision,
    )
    expect(secondChanges).toBe(0)

    // Repo-level update always re-reads inside the transaction, so it bumps cleanly.
    goals.update(goal.goal_id, { status: 'blocked' })
    expect(goals.get(goal.goal_id)!.revision).toBe(staleRevision + 2)
  })

  it('should scope getActive to the current session', () => {
    const goal = goals.create({ thread_id: 'shared-th', objective: 'Session A goal' })

    // A second session reuses the same thread ID but must not see this goal.
    const otherEvents = new EventBus(store, 'other-session')
    const otherGoals = new GoalRepo(store, otherEvents)

    expect(goals.getActive('shared-th')!.goal_id).toBe(goal.goal_id)
    expect(otherGoals.getActive('shared-th')).toBeUndefined()
  })
})
