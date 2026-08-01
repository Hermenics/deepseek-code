import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Store } from '../../src/kernel/store/store.js'
import { MIGRATIONS } from '../../src/kernel/store/migrations.js'
import { EventBus } from '../../src/kernel/events/eventBus.js'
import { createAgentSpec, validateAgentSpec } from '../../src/kernel/threads/agentSpec.js'
import { ThreadRuntime } from '../../src/kernel/threads/threadRuntime.js'
import { TaskBoard, LeaseManager, LEASE_MIGRATION } from '../../src/kernel/tasks/taskBoard.js'
import { MessageRouter } from '../../src/kernel/tasks/messageRouter.js'

const ALL_MIGRATIONS = [...MIGRATIONS, LEASE_MIGRATION]
const SESSION = 'test-session-phase3'

function seedSession(store: Store): void {
  store.run(
    'INSERT INTO sessions (id, cwd, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    SESSION, '/tmp/test', 'test-model', 'test-provider', new Date().toISOString(), new Date().toISOString(),
  )
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
    expect(runtime.listThreads().length).toBe(2)
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
    board.transition(t3.task_id, 'done')
    expect(board.list({ state: 'queued' }).length).toBe(2)
    expect(board.list({ state: 'done' }).length).toBe(1)
  })

  it('should add and check dependencies', () => {
    const t1 = board.create({})
    const t2 = board.create({})
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
})
