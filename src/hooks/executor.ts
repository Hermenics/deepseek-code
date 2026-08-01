import { spawn } from 'child_process'
import { randomUUID } from 'node:crypto'
import type { HooksConfig, HookCommand, HookInput, HookRun, PreToolHookOutput } from './types.js'
import { matchesHookPattern } from './matcher.js'

const MAX_OUTPUT_BYTES = 100_000

/** In-memory audit log of hook runs. Survives for the session lifetime. */
export const hookAuditLog: HookRun[] = []

export function buildInput(base: Omit<HookInput, 'schema_version' | 'correlation_id' | 'run_id' | 'cwd'>): HookInput {
  return {
    ...base,
    schema_version: 1,
    correlation_id: randomUUID(),
    run_id: randomUUID(),
    cwd: process.cwd(),
  }
}

/**
 * Run a single hook command. Sends JSON to stdin, captures stdout.
 * Returns stdout string or empty on timeout/error.
 */
export async function runHookCommand(cmd: HookCommand, input: HookInput): Promise<string> {
  if (cmd.enabled === false) return ''
  const timeoutMs = (cmd.timeout ?? 30) * 1000

  const run: HookRun = {
    run_id: input.run_id,
    hook_id: cmd.id,
    event: input.event,
    command: cmd.command,
    started_at: new Date().toISOString(),
  }

  return new Promise<string>((resolve) => {
    const proc = spawn('sh', ['-c', cmd.command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('error', (err) => {
      run.finished_at = new Date().toISOString()
      run.error = err.message
      hookAuditLog.push(run)
      resolve('')
    })
    proc.on('close', (code) => {
      run.finished_at = new Date().toISOString()
      run.exit_code = code ?? undefined
      run.output_truncated = stdout.length >= MAX_OUTPUT_BYTES
      if (code !== 0) {
        const errInfo = stderr.trim() || `exited with code ${code}`
        run.error = errInfo
        console.error(`[hooks] Hook "${cmd.command}" failed: ${errInfo}`)
        hookAuditLog.push(run)
        resolve(JSON.stringify({ decision: 'block', reason: `Hook failed: ${errInfo}` }))
        return
      }
      hookAuditLog.push(run)
      resolve(stdout.trim())
    })

    // Send input as JSON to stdin
    try {
      proc.stdin?.write(JSON.stringify(input))
      proc.stdin?.end()
    } catch {
      run.finished_at = new Date().toISOString()
      run.error = 'Failed to write to hook stdin'
      hookAuditLog.push(run)
      resolve('')
    }
  })
}

/**
 * Run PreToolUse hooks for a tool invocation.
 * Returns: approve (proceed), block (stop), or pass (no hooks matched).
 * If a hook returns modified_input, it's passed to the next hook and ultimately used for execution.
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
      })

      const output = await runHookCommand(hook, input)
      if (!output) continue

      try {
        const parsed = JSON.parse(output) as PreToolHookOutput
        if (parsed.decision === 'block') {
          return { decision: 'block', reason: parsed.reason ?? 'Blocked by PreToolUse hook' }
        }
        if (parsed.modified_input) {
          currentInput = parsed.modified_input
        }
      } catch {
        // Malformed JSON — audit and continue
        console.error(`[hooks] PreToolUse hook "${hook.command}" returned non-JSON output (run ${input.run_id})`)
      }
    }
  }

  if (!matched) return { decision: 'pass' }
  return { decision: 'approve', modifiedInput: currentInput !== toolInput ? currentInput : undefined }
}

/**
 * Run PostToolUse hooks (fire-and-forget, non-blocking errors).
 * Each run is tracked in hookAuditLog for diagnostics.
 */
export async function runPostToolHooks(
  config: HooksConfig | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResult: string,
  sessionId: string,
): Promise<void> {
  if (!config?.PostToolUse?.length) return

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
        tool_result: toolResult.slice(0, 10_000), // cap result size sent to hooks
      })
      // Fire-and-forget but tracked via hookAuditLog
      runHookCommand(hook, input).catch(() => {})
    }
  }
}

/**
 * Run SessionStart hooks.
 */
export async function runSessionStartHooks(
  config: HooksConfig | undefined,
  sessionId: string,
): Promise<void> {
  if (!config?.SessionStart?.length) return

  for (const hook of config.SessionStart) {
    if (hook.enabled === false) continue
    const input = buildInput({ event: 'SessionStart', session_id: sessionId })
    await runHookCommand(hook, input).catch(() => {})
  }
}
