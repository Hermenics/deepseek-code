import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Store } from '../../src/kernel/store/store.js'
import { MIGRATIONS } from '../../src/kernel/store/migrations.js'
import { EventBus } from '../../src/kernel/events/eventBus.js'
import {
  runHookCommand, buildInput, hookAuditLog, MAX_HOOK_AUDIT_ENTRIES,
  runPreToolHooks,
} from '../../src/hooks/executor.js'
import { HookRuntime, MAX_HOOK_RUNTIME_RUNS, type HookDefinition } from '../../src/kernel/hooks/hookRuntime.js'

const ALL = MIGRATIONS
const SID = 'test-hooks'

function seed(store: Store): void {
  store.run('INSERT INTO sessions (id, cwd, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    SID, '/tmp', 'test', 'test', new Date().toISOString(), new Date().toISOString())
}

describe('Legacy hook executor audit', () => {
  beforeEach(() => { hookAuditLog.length = 0 })

  it('should record allow decision on successful run', async () => {
    const input = buildInput({ event: 'SessionStart', session_id: 's1' })
    await runHookCommand({ type: 'command', command: 'echo ok' }, input)
    const run = hookAuditLog.find(r => r.run_id === input.run_id)!
    expect(run.decision).toBe('allow')
  })

  it('should record block decision on nonzero exit', async () => {
    const input = buildInput({ event: 'SessionStart', session_id: 's1' })
    await runHookCommand({ type: 'command', command: 'exit 1' }, input)
    const run = hookAuditLog.find(r => r.run_id === input.run_id)!
    expect(run.decision).toBe('block')
  })

  it('should record block decision on process error', async () => {
    const input = buildInput({ event: 'SessionStart', session_id: 's1' })
    await runHookCommand({ type: 'command', command: 'definitely-not-a-real-command-xyz' }, input)
    const run = hookAuditLog.find(r => r.run_id === input.run_id)!
    expect(run.decision).toBe('block')
  })

  it('should mark audit decision as block when a pre-tool hook blocks via JSON', async () => {
    const config = {
      PreToolUse: [{ matcher: 'WriteFile', hooks: [{ type: 'command' as const, command: 'echo \'{"decision":"block","reason":"no"}\'' }] }],
    }
    const result = await runPreToolHooks(config, 'WriteFile', {}, 's1')
    expect(result.decision).toBe('block')
    // The audit entry for that run reflects the block.
    expect(hookAuditLog.some(r => r.decision === 'block')).toBe(true)
  })

  it('should bound in-memory audit retention', async () => {
    // Seeding the log directly keeps this a pure check of the cap. Spawning 520 real
    // processes made it exceed the default timeout under --coverage, and the aborted
    // loop kept appending entries that corrupted the following test.
    const seedInput = buildInput({ event: 'SessionStart', session_id: 's1' })
    await runHookCommand({ type: 'command', command: 'true' }, seedInput)
    const template = hookAuditLog[0]!
    while (hookAuditLog.length < MAX_HOOK_AUDIT_ENTRIES) {
      hookAuditLog.push({ ...template, run_id: `filler-${hookAuditLog.length}` })
    }

    const input = buildInput({ event: 'SessionStart', session_id: 's1' })
    await runHookCommand({ type: 'command', command: 'true' }, input)

    expect(hookAuditLog.length).toBe(MAX_HOOK_AUDIT_ENTRIES)
    // Retention is FIFO: the newest run survives and the oldest is evicted.
    expect(hookAuditLog.at(-1)!.run_id).toBe(input.run_id)
    expect(hookAuditLog.some(run => run.run_id === seedInput.run_id)).toBe(false)
  })

  it('should use one correlation_id for a pre-tool group', async () => {
    const config = {
      PreToolUse: [
        { matcher: 'WriteFile', hooks: [
          { type: 'command' as const, command: 'true' },
          { type: 'command' as const, command: 'true' },
        ]},
      ],
    }
    await runPreToolHooks(config, 'WriteFile', {}, 's1')
    const runs = hookAuditLog.slice(-2)
    // Each hook gets a unique run_id, but both share the same correlation_id.
    expect(runs[0]!.run_id).not.toBe(runs[1]!.run_id)
    expect(runs.length).toBe(2)
    expect(runs[0]!.correlation_id).toBe(runs[1]!.correlation_id)
  })
})

// ── HookRuntime ─────────────────────────────────────────────────────

describe('HookRuntime execution', () => {
  let store: Store
  let events: EventBus
  let runtime: HookRuntime

  beforeEach(() => { store = new Store({ memory: true }); store.migrate(ALL); seed(store); events = new EventBus(store, SID); runtime = new HookRuntime(store, events) })
  afterEach(() => store.close())

  const shellHook = (overrides: Partial<HookDefinition> = {}): HookDefinition => ({
    id: 'h-shell', event: 'PreToolUse', matcher: 'WriteFile', handler_type: 'shell',
    handler_config: { command: "echo '{\"decision\":\"allow\"}'" }, scope: 'user',
    timeout_ms: 10_000, enabled: true, ...overrides,
  })

  it('should execute a shell handler and apply its decision', async () => {
    runtime.register(shellHook())
    runtime.trust('h-shell')
    const result = await runtime.execute('PreToolUse', 'WriteFile', { path: 'a.ts' }, { session_id: 's1', cwd: '/tmp' })
    expect(result.decision).toBe('allow')
    expect(result.runs.length).toBe(1)
    expect(result.runs[0]!.hook_id).toBe('h-shell')
  })

  it('should apply a block decision from a shell handler', async () => {
    runtime.register(shellHook({ id: 'h-block', handler_config: { command: "echo '{\"decision\":\"block\",\"reason\":\"nope\"}'" } }))
    runtime.trust('h-block')
    const result = await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: 's1', cwd: '/tmp' })
    expect(result.decision).toBe('block')
    expect(result.runs[0]!.decision).toBe('block')
  })

  it('should apply modified_input from a handler', async () => {
    runtime.register(shellHook({ id: 'h-mod', handler_config: { command: "echo '{\"decision\":\"allow\",\"modified_input\":{\"path\":\"changed.ts\"}}'" } }))
    runtime.trust('h-mod')
    const result = await runtime.execute('PreToolUse', 'WriteFile', { path: 'orig.ts' }, { session_id: 's1', cwd: '/tmp' })
    expect(result.modifiedInput).toEqual({ path: 'changed.ts' })
  })

  it('should convert a handler failure into a blocking outcome', async () => {
    runtime.registerHandler('agent', async () => { throw new Error('boom') })
    runtime.register(shellHook({ id: 'h-fail', handler_type: 'agent', handler_config: {} }))
    runtime.trust('h-fail')
    const result = await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: 's1', cwd: '/tmp' })
    expect(result.decision).toBe('block')
    expect(result.runs[0]!.error).toContain('boom')
  })

  it('should persist hook runs to the store', async () => {
    runtime.register(shellHook())
    runtime.trust('h-shell')
    await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: 's1', cwd: '/tmp' })
    const persisted = store.query<{ run_id: string }>('SELECT run_id FROM hook_runs')
    expect(persisted.length).toBe(1)
  })

  it('should bound in-memory runtime runs', async () => {
    // An in-process handler keeps this a pure check of the cap; 520 real shells pushed
    // the test past the default timeout under --coverage.
    runtime.registerHandler('agent', async () => ({ decision: 'allow' }))
    runtime.register(shellHook({ id: 'h-fast', handler_type: 'agent', handler_config: {} }))
    runtime.trust('h-fast')
    for (let i = 0; i < MAX_HOOK_RUNTIME_RUNS + 20; i++) {
      await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: 's1', cwd: '/tmp' })
    }
    const runs = runtime.getRuns({ limit: 10_000 })
    expect(runs.length).toBe(MAX_HOOK_RUNTIME_RUNS)
  })

  it('should run a command (argv) handler without a shell', async () => {
    // argv handler with a literal node script via -e; no shell interpolation.
    const script = 'process.stdout.write(JSON.stringify({decision:"allow"}))'
    runtime.register({
      id: 'h-cmd', event: 'PreToolUse', handler_type: 'command',
      handler_config: { command: process.execPath, argv: [process.execPath, '-e', script] },
      scope: 'user', timeout_ms: 10_000, enabled: true,
    })
    runtime.trust('h-cmd')
    const result = await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: 's1', cwd: '/tmp' })
    expect(result.decision).toBe('allow')
  })

  it('should block when no handler is registered for a type', async () => {
    runtime.register(shellHook({ id: 'h-noh', handler_type: 'prompt', handler_config: {} }))
    runtime.trust('h-noh')
    const result = await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: 's1', cwd: '/tmp' })
    expect(result.decision).toBe('block')
    expect(result.runs[0]!.error).toContain('No handler registered')
  })

  it('should chain modified_input through consecutive hooks', async () => {
    runtime.registerHandler('command', async (_def, ctx) => {
      if (!ctx.tool_input || !(ctx.tool_input as Record<string, string>).path) return { decision: 'allow', modified_input: { path: 'first.ts' } }
      return { decision: 'allow', modified_input: { path: (ctx.tool_input as Record<string, string>).path + '.second' } }
    })
    runtime.register({ id: 'h1', event: 'PreToolUse', handler_type: 'command', handler_config: {}, scope: 'user', timeout_ms: 5000, enabled: true })
    runtime.register({ id: 'h2', event: 'PreToolUse', handler_type: 'command', handler_config: {}, scope: 'user', timeout_ms: 5000, enabled: true })
    runtime.trust('h1'); runtime.trust('h2')

    const result = await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: 's1', cwd: '/tmp' })
    expect(result.decision).toBe('allow')
    expect(result.modifiedInput).toEqual({ path: 'first.ts.second' })
    expect(result.runs.length).toBe(2)
  })

  it('should bounded in-memory runs use an in-process handler', async () => {
    runtime.registerHandler('command', async () => ({ decision: 'allow' }))
    const hook = { id: 'h-fast', event: 'PreToolUse', handler_type: 'command' as const, handler_config: {}, scope: 'user' as const, timeout_ms: 5000, enabled: true }
    runtime.register(hook); runtime.trust('h-fast')
    for (let i = 0; i < MAX_HOOK_RUNTIME_RUNS + 20; i++) {
      await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: 's1', cwd: '/tmp' })
    }
    expect(runtime.getRuns({ limit: 10000 }).length).toBe(MAX_HOOK_RUNTIME_RUNS)
  })
})
