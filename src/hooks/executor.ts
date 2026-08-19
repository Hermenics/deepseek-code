import { spawn } from 'child_process'
import { randomUUID } from 'node:crypto'
import type { HooksConfig, HookCommand, HookInput, HookRun, PreToolHookOutput } from './types.js'
import { matchesHookPattern } from './matcher.js'
import { defaultShell, isWindows } from '../utils/platform.js'

const MAX_OUTPUT_BYTES = 100_000
/** Bounded in-memory retention for hook audit entries. */
export const MAX_HOOK_AUDIT_ENTRIES = 500

/** In-memory audit log of hook runs. Survives for the session lifetime. */
export const hookAuditLog: HookRun[] = []

function pushAudit(run: HookRun): void {
  hookAuditLog.push(run)
  if (hookAuditLog.length > MAX_HOOK_AUDIT_ENTRIES) {
    hookAuditLog.splice(0, hookAuditLog.length - MAX_HOOK_AUDIT_ENTRIES)
  }
}

/** Append bytes from a Buffer to a string, respecting MAX_OUTPUT_BYTES. */
function appendCapped(target: string, chunk: Buffer): string {
  if (target.length >= MAX_OUTPUT_BYTES) return target
  const remaining = MAX_OUTPUT_BYTES - target.length
  return target + chunk.toString('utf8', 0, Math.min(chunk.length, remaining))
}

/**
 * Build the JSON input sent to a hook. `correlationId` links related hook
 * executions (e.g. all PreToolUse hooks for one tool call); when omitted, a
 * fresh ID is generated.
 */
export function buildInput(
  base: Omit<HookInput, 'schema_version' | 'hook_event_name' | 'correlation_id' | 'run_id' | 'cwd'> & { cwd?: string },
  correlationId?: string,
): HookInput {
  return {
    ...base,
    hook_event_name: base.event,
    schema_version: 1,
    correlation_id: correlationId ?? randomUUID(),
    run_id: randomUUID(),
    cwd: base.cwd ?? process.cwd(),
  }
}

/**
 * Run a single hook command. Sends JSON to stdin, captures stdout.
 * Every exit path returns a block-decision JSON payload or stdout text.
 * The finalization guard ensures error and close handlers cannot duplicate
 * audit entries.
 */
export async function runHookCommand(cmd: HookCommand, input: HookInput): Promise<string> {
  if (cmd.enabled === false) return ''
  const timeoutMs = (cmd.timeout ?? 30) * 1000

  const run: HookRun = {
    run_id: input.run_id,
    hook_id: cmd.id,
    event: input.event,
    command: cmd.command,
    correlation_id: input.correlation_id,
    session_id: input.session_id,
    started_at: new Date().toISOString(),
  }

  return new Promise<string>((resolve) => {
    const proc = spawn(defaultShell(), isWindows ? ['/d', '/s', '/c', cmd.command] : ['-c', cmd.command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    })

    let stdout = ''
    let stderr = ''
    let finalized = false
    let killedByTimeout = false

    const timer = setTimeout(() => {
      killedByTimeout = true
      proc.kill('SIGKILL')
    }, timeoutMs)

    function finalize(decision: string, error?: string, exitCode?: number, outputTruncated?: boolean): void {
      if (finalized) return
      finalized = true
      clearTimeout(timer)
      run.finished_at = new Date().toISOString()
      run.decision = decision
      if (exitCode !== undefined) run.exit_code = exitCode
      run.error = error
      run.output_truncated = outputTruncated ?? (stdout.length >= MAX_OUTPUT_BYTES)
      pushAudit(run)
    }

    proc.stdout?.on('data', (chunk: Buffer) => { stdout = appendCapped(stdout, chunk) })
    proc.stderr?.on('data', (chunk: Buffer) => { stderr = appendCapped(stderr, chunk) })

    // Register stdin error listener BEFORE writing or ending input.
    proc.stdin?.on('error', (err) => {
      finalize('block', `stdin error: ${err.message}`)
      resolve(JSON.stringify({ decision: 'block', reason: `stdin error: ${err.message}` }))
    })

    proc.on('error', (err) => {
      finalize('block', err.message)
      resolve(JSON.stringify({ decision: 'block', reason: err.message }))
    })

    proc.on('close', (code, signal) => {
      if (killedByTimeout || (code === null && signal === 'SIGKILL')) {
        finalize('block', 'Hook timed out')
        resolve(JSON.stringify({ decision: 'block', reason: 'Hook timed out' }))
        return
      }
      const errInfo = stderr.trim()
      const truncated = stdout.length >= MAX_OUTPUT_BYTES || stderr.length >= MAX_OUTPUT_BYTES
      if (code !== 0) {
        const reason = errInfo || `exited with code ${code}`
        finalize('block', reason, code ?? undefined, truncated)
        console.error(`[hooks] Hook "${cmd.command}" failed: ${reason}`)
        resolve(JSON.stringify({ decision: 'block', reason: `Hook failed: ${reason}` }))
        return
      }
      finalize('allow', undefined, 0, truncated)
      resolve(stdout.trim())
    })

    // Send input as JSON to stdin
    try {
      proc.stdin?.write(JSON.stringify(input))
      proc.stdin?.end()
    } catch {
      // stdin error listener above already handles this path.
    }
  })
}

/** Mark the most recent matching audit entry for a run as blocked (JSON block). */
function markAuditBlocked(runId: string): void {
  for (let i = hookAuditLog.length - 1; i >= 0; i--) {
    if (hookAuditLog[i]?.run_id === runId) {
      hookAuditLog[i]!.decision = 'block'
      return
    }
  }
}

function isValidString(v: unknown): v is string {
  return typeof v === 'string'
}

function isValidRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Run PreToolUse hooks for a tool invocation.
 */
export async function runPreToolHooks(
  config: HooksConfig | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionId: string,
): Promise<{ decision: 'approve' | 'block' | 'pass'; reason?: string; modifiedInput?: Record<string, unknown> }> {
  if (!config?.PreToolUse?.length) return { decision: 'pass' }

  let currentInput = toolInput
  let matched = false
  const correlationId = randomUUID()

  for (const matcher of config.PreToolUse) {
    if (matcher.enabled === false) continue
    if (!matchesHookPattern(matcher.matcher, toolName)) continue
    matched = true

    for (const hook of matcher.hooks) {
      if (hook.enabled === false) continue
      const input = buildInput({
        event: 'PreToolUse',
        session_id: sessionId,
        tool_name: toolName,
        tool_input: currentInput,
      }, correlationId)

      const output = await runHookCommand(hook, input)
      if (!output) continue

      try {
        const parsed = JSON.parse(output) as PreToolHookOutput

        // Validate field types before using them.
        if (parsed.decision !== undefined && !isValidString(parsed.decision)) {
          console.error(`[hooks] PreToolUse hook "${hook.command}" returned non-string decision (run ${input.run_id})`)
          continue
        }
        if (parsed.reason !== undefined && !isValidString(parsed.reason)) {
          console.error(`[hooks] PreToolUse hook "${hook.command}" returned non-string reason (run ${input.run_id})`)
          continue
        }
        if (parsed.modified_input !== undefined && !isValidRecord(parsed.modified_input)) {
          console.error(`[hooks] PreToolUse hook "${hook.command}" returned non-object modified_input (run ${input.run_id})`)
          continue
        }

        if (parsed.decision === 'block') {
          markAuditBlocked(input.run_id)
          return { decision: 'block', reason: parsed.reason ?? 'Blocked by PreToolUse hook' }
        }
        if (parsed.modified_input) {
          currentInput = parsed.modified_input
        }
      } catch {
        console.error(`[hooks] PreToolUse hook "${hook.command}" returned non-JSON output (run ${input.run_id})`)
      }
    }
  }

  if (!matched) return { decision: 'pass' }
  return { decision: 'approve', modifiedInput: currentInput !== toolInput ? currentInput : undefined }
}

/**
 * Run PostToolUse hooks (fire-and-forget, non-blocking errors).
 */
export async function runPostToolHooks(
  config: HooksConfig | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResult: string,
  sessionId: string,
): Promise<void> {
  if (!config?.PostToolUse?.length) return

  const correlationId = randomUUID()
  for (const matcher of config.PostToolUse) {
    if (matcher.enabled === false) continue
    if (!matchesHookPattern(matcher.matcher, toolName)) continue

    for (const hook of matcher.hooks) {
      if (hook.enabled === false) continue
      const input = buildInput({
        event: 'PostToolUse',
        session_id: sessionId,
        tool_name: toolName,
        tool_input: toolInput,
        tool_result: toolResult.slice(0, 10_000),
      }, correlationId)
      runHookCommand(hook, input).catch(() => {})
    }
  }
}
