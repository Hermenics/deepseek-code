import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { EventBus } from '../src/kernel/events/eventBus.js'
import { HookRuntime, type HookDefinition } from '../src/kernel/hooks/hookRuntime.js'
import { MIGRATIONS } from '../src/kernel/store/migrations.js'
import { Store } from '../src/kernel/store/store.js'
import { runScript } from './platform-commands.js'

const SECRET_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'DEEPSEEK_TEST_HOOK_SECRET',
] as const

const SESSION_ID = 'hook-env-test'

describe('HookRuntime child environment', () => {
  let store: Store
  let runtime: HookRuntime
  let priorSecrets: Map<string, string | undefined>

  beforeEach(() => {
    priorSecrets = new Map(SECRET_KEYS.map(key => [key, process.env[key]]))
    SECRET_KEYS.forEach(key => { process.env[key] = `canary-${key}` })
    store = new Store({ memory: true })
    store.migrate(MIGRATIONS)
    store.run('INSERT INTO sessions (id, cwd, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      SESSION_ID, process.cwd(), 'test', 'test', new Date().toISOString(), new Date().toISOString())
    runtime = new HookRuntime(store, new EventBus(store, SESSION_ID))
  })

  afterEach(() => {
    for (const [key, value] of priorSecrets) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    store.close()
  })

  const environmentProbe = `
    const env = process.env;
    const observed = {
      secrets: ${JSON.stringify(SECRET_KEYS)}.map(key => env[key] ?? null),
      path: Boolean(env.PATH ?? env.Path),
      home: Boolean(env.HOME ?? env.USERPROFILE),
    };
    process.stdout.write(JSON.stringify({ decision: 'allow', modified_input: observed }));
  `

  async function run(handlerType: 'command' | 'shell'): Promise<Record<string, unknown> | undefined> {
    const definition: HookDefinition = {
      id: `env-${handlerType}`,
      event: 'PreToolUse',
      handler_type: handlerType,
      handler_config: handlerType === 'command'
        ? { command: process.execPath, argv: [process.execPath, '-e', environmentProbe] }
        : { command: runScript(environmentProbe) },
      scope: 'user',
      timeout_ms: 10_000,
      enabled: true,
    }
    runtime.register(definition)
    const result = await runtime.execute('PreToolUse', 'WriteFile', {}, { session_id: SESSION_ID, cwd: process.cwd() })
    expect(result.decision).toBe('allow')
    return result.modifiedInput
  }

  it('scrubs inherited secrets from command hooks and keeps execution variables', async () => {
    expect(await run('command')).toEqual({ secrets: SECRET_KEYS.map(() => null), path: true, home: true })
  })

  it('scrubs inherited secrets from shell hooks and keeps execution variables', async () => {
    expect(await run('shell')).toEqual({ secrets: SECRET_KEYS.map(() => null), path: true, home: true })
  })
})
