import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Store } from '../../src/kernel/store/store.js'
import { MIGRATIONS } from '../../src/kernel/store/migrations.js'
import { EventBus } from '../../src/kernel/events/eventBus.js'

describe('Store', () => {
  let store: Store

  afterEach(() => {
    store.close()
  })

  it('should create an in-memory database', () => {
    store = new Store({ memory: true })
    expect(store.path).toBe(':memory:')
  })

  it('should run migrations without error', () => {
    store = new Store({ memory: true })
    store.migrate(MIGRATIONS)
    // Verify schema_version table exists and has entries
    const rows = store.query<{ version: number; name: string }>('SELECT version, name FROM _schema_version ORDER BY version')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.version).toBe(1)
  })

  it('should be idempotent on multiple migrate calls', () => {
    store = new Store({ memory: true })
    store.migrate(MIGRATIONS)
    const count1 = store.query<{ c: number }>('SELECT COUNT(*) as c FROM _schema_version')[0]!.c
    store.migrate(MIGRATIONS)
    const count2 = store.query<{ c: number }>('SELECT COUNT(*) as c FROM _schema_version')[0]!.c
    expect(count1).toBe(count2)
  })

  it('should execute within a transaction', () => {
    store = new Store({ memory: true })
    store.migrate(MIGRATIONS)
    store.transaction(() => {
      store.run('INSERT INTO sessions (id, cwd, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        's1', '/tmp', 'test-model', 'test-provider', new Date().toISOString(), new Date().toISOString())
      store.run('INSERT INTO sessions (id, cwd, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        's2', '/tmp', 'test-model', 'test-provider', new Date().toISOString(), new Date().toISOString())
    })
    const rows = store.query<{ id: string }>('SELECT id FROM sessions')
    expect(rows.length).toBe(2)
  })

  it('should rollback on error in transaction', () => {
    store = new Store({ memory: true })
    store.migrate(MIGRATIONS)
    try {
      store.transaction(() => {
        store.run('INSERT INTO sessions (id, cwd, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          's1', '/tmp', 'test', 'test', new Date().toISOString(), new Date().toISOString())
        throw new Error('rollback')
      })
    } catch { /* expected */ }
    const rows = store.query<{ id: string }>('SELECT id FROM sessions')
    expect(rows.length).toBe(0)
  })
})

describe('EventBus', () => {
  let store: Store
  let bus: EventBus
  const sessionId = 'test-session-1'

  beforeEach(() => {
    store = new Store({ memory: true })
    store.migrate(MIGRATIONS)
    bus = new EventBus(store, sessionId)
  })

  afterEach(() => {
    store.close()
  })

  it('should emit an event durably', () => {
    const event = bus.emit('test.event', { key: 'value' })
    expect(event.event_id).toBeTruthy()
    expect(event.type).toBe('test.event')
    expect(event.session_id).toBe(sessionId)
    expect(event.payload.key).toBe('value')
  })

  it('should persist events to the store', () => {
    bus.emit('test.one', { n: 1 })
    bus.emit('test.two', { n: 2 })
    const all = bus.query()
    expect(all.length).toBe(2)
    expect(all[0]!.type).toBe('test.one')
    expect(all[1]!.type).toBe('test.two')
  })

  it('should filter events by type', () => {
    bus.emit('A', {})
    bus.emit('A', {})
    bus.emit('B', {})
    expect(bus.query({ type: 'A' }).length).toBe(2)
    expect(bus.query({ type: 'B' }).length).toBe(1)
  })

  it('should filter events by task_id', () => {
    bus.emit('task', {}, { task_id: 't1' })
    bus.emit('task', {}, { task_id: 't2' })
    bus.emit('task', {}, { task_id: 't1' })
    expect(bus.query({ task_id: 't1' }).length).toBe(2)
  })

  it('should notify subscribers', () => {
    const received: string[] = []
    bus.subscribe((e) => { received.push(e.type) })
    bus.emit('sub.test', {})
    bus.emit('sub.test2', {})
    expect(received).toEqual(['sub.test', 'sub.test2'])
  })

  it('should unsubscribe correctly', () => {
    const received: string[] = []
    const unsub = bus.subscribe((e) => { received.push(e.type) })
    bus.emit('first', {})
    unsub()
    bus.emit('second', {})
    expect(received).toEqual(['first'])
  })

  it('should count events', () => {
    bus.emit('A', {})
    bus.emit('A', {})
    bus.emit('B', {})
    expect(bus.count()).toBe(3)
    expect(bus.count({ type: 'A' })).toBe(2)
  })

  it('should include correlation_id and causation_id', () => {
    const event = bus.emit('linked', {}, { correlation_id: 'corr-1', causation_id: 'cause-1' })
    expect(event.correlation_id).toBe('corr-1')
    expect(event.causation_id).toBe('cause-1')
  })

  it('should replay events without side effects', () => {
    let called = false
    bus.subscribe(() => { called = true; undefined })
    bus.emit('replay.test', { x: 1 })
    expect(called).toBe(true)
    called = false

    const events = bus.replay({ type: 'replay.test' })
    expect(events.length).toBe(1)
    expect(events[0]!.payload.x).toBe(1)
    // replay() is read-only, no subscribers called
    expect(called).toBe(false)
  })

  it('should support structured payloads', () => {
    bus.emit('struct', {
      nested: { a: 1, b: [2, 3] },
      bool: true,
      nil: null,
    })
    const events = bus.query({ type: 'struct' })
    // payload is JSON-stringified in the store, parse to verify
    expect(typeof (events[0]!.payload as unknown)).toBe('object')
  })
})
