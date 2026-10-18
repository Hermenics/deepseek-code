import { beforeEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runClaudeHookEvent, runSubagentStartHooks } from '../../src/hooks/lifecycle.js'
import { hookAuditLog } from '../../src/hooks/executor.js'
import { printOutput } from '../platform-commands.js'

const sessionId = 'claude-hook-test-session'
const command = (output = '') => ({ type: 'command' as const, command: printOutput(output) })

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

  it.skipIf(process.platform === 'win32')('cancels a SubagentStart hook process group and its child', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsk-hook-cancel-'))
    const started = join(directory, 'started')
    const late = join(directory, 'late')
    const child = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(late)}, 'late'), 700)`
    const parent = `const fs = require('node:fs'); const { spawn } = require('node:child_process'); fs.writeFileSync(${JSON.stringify(started)}, 'started'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' }); child.on('exit', () => {});`
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const config = { SubagentStart: [{ matcher: 'reviewer', hooks: [{ type: 'command' as const, command: `${quote(process.execPath)} -e ${quote(parent)}`, timeout: 3 }] }] }
    const controller = new AbortController()
    const pending = Reflect.apply(runSubagentStartHooks, undefined, [config, sessionId, 'agent-1', 'reviewer', {}, controller.signal]) as Promise<unknown>
    try {
      const deadline = Date.now() + 2_000
      while (!existsSync(started) && Date.now() < deadline) await Bun.sleep(10)
      expect(existsSync(started)).toBe(true)
      controller.abort(new Error('cancelled hook'))
      await expect(pending).rejects.toThrow('cancelled hook')
      await Bun.sleep(800)
      expect(existsSync(late)).toBe(false)
    } finally {
      controller.abort()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
