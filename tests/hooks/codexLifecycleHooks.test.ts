import { beforeEach, describe, expect, it } from 'bun:test'
import {
  runPermissionRequestHooks,
  runPostCompactHooks,
  runPreCompactHooks,
  runStopHooks,
  runSubagentStartHooks,
  runSubagentStopHooks,
  runUserPromptSubmitHooks,
} from '../../src/hooks/lifecycle.js'
import { hookAuditLog } from '../../src/hooks/executor.js'
import type { HooksConfig } from '../../src/hooks/types.js'
import { printOutput } from '../platform-commands.js'

const sessionId = 'codex-hook-test-session'
const command = (output: string) => ({ type: 'command' as const, command: printOutput(output) })

describe('Codex lifecycle hooks', () => {
  beforeEach(() => { hookAuditLog.length = 0 })

  it('adds UserPromptSubmit additional context and preserves the event name', async () => {
    const result = await runUserPromptSubmitHooks({
      UserPromptSubmit: [command('{"hookSpecificOutput":{"additionalContext":"branch: main"}}')],
    }, sessionId, 'fix the bug')

    expect(result).toEqual({ decision: 'pass', additionalContext: 'branch: main', approved: false })
    expect(hookAuditLog.at(-1)?.event).toBe('UserPromptSubmit')
  })

  it('lets PermissionRequest hooks allow or deny a pending tool permission', async () => {
    const allow = await runPermissionRequestHooks({
      PermissionRequest: [{ matcher: 'shell', hooks: [command('{"hookSpecificOutput":{"decision":{"behavior":"allow"}}}')] }],
    }, 'shell', { command: 'bun test' }, sessionId)
    expect(allow.approved).toBe(true)

    const deny = await runPermissionRequestHooks({
      PermissionRequest: [{ matcher: 'shell', hooks: [command('{"hookSpecificOutput":{"decision":{"behavior":"deny","message":"blocked"}}}')] }],
    }, 'shell', { command: 'rm -rf build' }, sessionId)
    expect(deny).toMatchObject({ decision: 'block', reason: 'blocked' })
  })

  it('supports Stop hook continuation feedback', async () => {
    const result = await runStopHooks({
      Stop: [command('{"decision":"block","reason":"run tests first"}')],
    }, sessionId, 'I changed the code', false)
    expect(result).toMatchObject({ decision: 'block', reason: 'run tests first' })
  })

  it('runs compaction hooks with the trigger and keeps post-compaction observational', async () => {
    const config: HooksConfig = {
      PreCompact: [
        { matcher: 'manual', hooks: [command('pre-manual')] },
        { matcher: 'auto', hooks: [command('pre-auto')] },
      ],
      PostCompact: [
        { matcher: 'manual', hooks: [command('post-manual')] },
        { matcher: 'auto', hooks: [command('post-auto')] },
      ],
    }
    expect((await runPreCompactHooks(config, sessionId, 'auto')).decision).toBe('pass')
    await runPostCompactHooks(config, sessionId, 'auto')
    expect(hookAuditLog.map(run => run.event)).toEqual(['PreCompact', 'PostCompact'])
    expect(hookAuditLog.map(run => run.command)).toEqual([
      printOutput('pre-auto'),
      printOutput('post-auto'),
    ])
  })

  it('matches SubagentStart and SubagentStop by agent type', async () => {
    const config: HooksConfig = {
      SubagentStart: [{ matcher: 'reviewer', hooks: [command('true')] }],
      SubagentStop: [{ matcher: 'reviewer', hooks: [command('true')] }],
    }
    await runSubagentStartHooks(config, sessionId, 'agent-1', 'reviewer')
    await runSubagentStopHooks(config, sessionId, 'agent-1', 'reviewer', 'done')
    expect(hookAuditLog.map(run => run.event)).toEqual(['SubagentStart', 'SubagentStop'])
  })
})
