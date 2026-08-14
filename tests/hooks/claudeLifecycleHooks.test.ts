import { beforeEach, describe, expect, it } from 'bun:test'
import { runClaudeHookEvent } from '../../src/hooks/lifecycle.js'
import { hookAuditLog } from '../../src/hooks/executor.js'

const sessionId = 'claude-hook-test-session'
const command = (output = '') => ({ type: 'command' as const, command: output ? `printf '%s' '${output}'` : 'true' })

describe('Claude Code lifecycle hooks', () => {
  beforeEach(() => { hookAuditLog.length = 0 })

  it('runs command and matcher events with Claude-specific payload fields', async () => {
    const config = {
      Setup: [{ matcher: 'init', hooks: [command()] }],
      InstructionsLoaded: [{ matcher: 'session_start', hooks: [command()] }],
      PostToolBatch: [command('{"hookSpecificOutput":{"additionalContext":"batch checked"}}')],
      StopFailure: [{ matcher: 'unknown', hooks: [command()] }],
    }
    const setup = await runClaudeHookEvent(config, 'Setup', sessionId, { cwd: '/tmp', trigger: 'init' })
    const unmatchedSetup = await runClaudeHookEvent(config, 'Setup', sessionId, { cwd: '/tmp', trigger: 'maintenance' })
    const instructions = await runClaudeHookEvent(config, 'InstructionsLoaded', sessionId, {
      cwd: '/tmp', file_path: '/tmp/AGENTS.md', load_reason: 'session_start', memory_type: 'Project',
    }, 'session_start')
    const batch = await runClaudeHookEvent(config, 'PostToolBatch', sessionId, {
      cwd: '/tmp', tool_calls: [{ tool_name: 'read_file', tool_response: 'ok' }],
    })
    await runClaudeHookEvent(config, 'StopFailure', sessionId, { cwd: '/tmp', error: 'unknown' }, 'unknown')

    expect(setup.decision).toBe('pass')
    expect(unmatchedSetup.decision).toBe('pass')
    expect(instructions.decision).toBe('pass')
    expect(batch.additionalContext).toBe('batch checked')
    expect(hookAuditLog.map(run => run.event)).toEqual(['Setup', 'InstructionsLoaded', 'PostToolBatch', 'StopFailure'])
  })

  it('honors Claude permissionDecision output on matcher events', async () => {
    const result = await runClaudeHookEvent({
      PermissionDenied: [{ matcher: 'shell', hooks: [command('{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"policy"}}')] }],
    }, 'PermissionDenied', sessionId, { tool_name: 'shell', reason: 'auto-denied' }, 'shell')

    expect(result).toMatchObject({ decision: 'block', reason: 'policy' })
  })
})
