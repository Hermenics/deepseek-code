import { spawn } from 'child_process'
import type { HooksConfig, HookCommand, HookInput, PreToolHookOutput } from './types.js'
import { matchesHookPattern } from './matcher.js'

/**
 * Run a single hook command. Sends JSON to stdin, captures stdout.
 * Returns stdout string or empty on timeout/error.
 */
export async function runHookCommand(cmd: HookCommand, input: HookInput): Promise<string> {
  const timeoutMs = (cmd.timeout ?? 30) * 1000

  return new Promise<string>((resolve) => {
    const proc = spawn('sh', ['-c', cmd.command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('error', () => resolve(''))
    proc.on('close', (code) => {
      if (code !== 0) {
        const errInfo = stderr.trim() || `exited with code ${code}`
        console.error(`[hooks] Hook "${cmd.command}" failed: ${errInfo}`)
        // Return a JSON error so callers can detect hook failure
        resolve(JSON.stringify({ decision: 'block', reason: `Hook failed: ${errInfo}` }))
        return
      }
      resolve(stdout.trim())
    })

    // Send input as JSON to stdin
    try {
      proc.stdin?.write(JSON.stringify(input))
      proc.stdin?.end()
    } catch {
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
    if (!matchesHookPattern(matcher.matcher, toolName)) continue
    matched = true

    for (const hook of matcher.hooks) {
      const input: HookInput = {
        event: 'PreToolUse',
        session_id: sessionId,
        tool_name: toolName,
        tool_input: currentInput,
      }

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
        // Non-JSON output — ignore
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

  for (const matcher of config.PostToolUse) {
    if (!matchesHookPattern(matcher.matcher, toolName)) continue

    for (const hook of matcher.hooks) {
      const input: HookInput = {
        event: 'PostToolUse',
        session_id: sessionId,
        tool_name: toolName,
        tool_input: toolInput,
        tool_result: toolResult.slice(0, 10_000), // cap result size sent to hooks
      }
      await runHookCommand(hook, input).catch(() => {})
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
    const input: HookInput = { event: 'SessionStart', session_id: sessionId }
    await runHookCommand(hook, input).catch(() => {})
  }
}
