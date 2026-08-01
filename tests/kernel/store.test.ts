import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../../src/kernel/store/store.js'
import { MIGRATIONS } from '../../src/kernel/store/migrations.js'
import { EventBus } from '../../src/kernel/events/eventBus.js'

describe('Store', () => {
  let store!: Store

  afterEach(() => {
    store?.close()
  })

  it('should create an in-memory database', () => {
    store = new Store({ memory: true })
    expect(store.path).toBe(':memory:')
  })

  it('should open a database in a nested custom directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsk-kernel-'))
    const dbPath = join(dir, 'nested', 'deeper', 'custom.db')
    const custom = new Store({ path: dbPath })
    custom.migrate(MIGRATIONS)
    expect(existsSync(dbPath)).toBe(true)
    custom.close()
    rmSync(dir, { recursive: true, force: true })
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

  it('should upgrade an existing database by applying only missing migrations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsk-migrate-'))
    const dbPath = join(dir, 'kernel.db')
    let oldStore: Store | undefined
    let upgraded: Store | undefined
    try {
      // "Old" database: only migrations v1 and v2 applied.
      oldStore = new Store({ path: dbPath })
      oldStore.migrate(MIGRATIONS.filter(m => m.version <= 2))
      expect(oldStore.query<{ c: number }>('SELECT COUNT(*) as c FROM _schema_version')[0]!.c).toBe(2)
      oldStore.close(); oldStore = undefined

      // Upgrade path: applying the full migration set adds only the missing ones.
      upgraded = new Store({ path: dbPath })
      upgraded.migrate(MIGRATIONS)
      const versions = upgraded.query<{ version: number }>('SELECT version FROM _schema_version ORDER BY version').map(r => r.version)
      expect(versions).toEqual([1, 2, 3, 4, 5])
      // New tables/columns exist after the upgrade.
      expect(upgraded.query('SELECT name FROM sqlite_master WHERE name = \'workflow_runs\'').length).toBe(1)
      expect(upgraded.query('SELECT name FROM sqlite_master WHERE name = \'path_claims\'').length).toBe(1)
      // event_seq column added to events.
      expect(upgraded.query('SELECT name FROM pragma_table_info(\'events\') WHERE name = \'event_seq\'').length).toBe(1)
    } finally {
      oldStore?.close()
      upgraded?.close()
      rmSync(dir, { recursive: true, force: true })
    }
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

  it('should isolate synchronous listener throws', () => {
    let otherReceived = 0
    bus.subscribe(() => { throw new Error('listener boom') })
    bus.subscribe(() => { otherReceived++ })
    expect(() => bus.emit('sync-throw', {})).not.toThrow()
    expect(otherReceived).toBe(1)
  })

  it('should isolate rejected async listeners', async () => {
    let otherReceived = 0
    bus.subscribe(() => Promise.reject(new Error('async boom')))
    bus.subscribe(() => { otherReceived++; return undefined })
    expect(() => bus.emit('async-reject', {})).not.toThrow()
    // Await the microtask flush so expect runs within the test.
    await Promise.resolve()
    expect(otherReceived).toBe(1)
  })

  it('should emit a monotonic event_seq', () => {
    const e1 = bus.emit('seq', { n: 1 })
    const e2 = bus.emit('seq', { n: 2 })
    expect(e1.event_seq).toBeGreaterThan(0)
    expect(e2.event_seq).toBe(e1.event_seq! + 1)
  })

  it('should order events deterministically by event_seq', () => {
    // Emit several events within the same millisecond to defeat timestamp ordering.
    const ids: number[] = []
    for (let i = 0; i < 10; i++) ids.push(bus.emit('burst', { i }).event_seq!)
    const replayed = bus.query({ type: 'burst' })
    expect(replayed.map(e => e.event_seq)).toEqual([...ids].sort((a, b) => a - b))
    // Stable on replay
    const replay2 = bus.replay({ type: 'burst' })
    expect(replay2.map(e => e.event_seq)).toEqual(ids)
  })

  it('should support after_seq cursors', () => {
    const e1 = bus.emit('cursor', { n: 1 })
    bus.emit('cursor', { n: 2 })
    bus.emit('cursor', { n: 3 })
    const after = bus.query({ type: 'cursor', after_seq: e1.event_seq })
    expect(after.length).toBe(2)
  })
})
