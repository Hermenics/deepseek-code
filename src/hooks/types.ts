export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart'

export interface HookCommand {
  id?: string
  type: 'command'
  command: string
  timeout?: number // seconds, default 30
  enabled?: boolean
}

export interface HookMatcher {
  id?: string
  matcher: string // tool name pattern: exact name, "*", or pipe-separated "Shell|WriteFile"
  hooks: HookCommand[]
  enabled?: boolean
}

export interface HooksConfig {
  PreToolUse?: HookMatcher[]
  PostToolUse?: HookMatcher[]
  SessionStart?: HookCommand[]
}

/** JSON sent to hook command via stdin */
export interface HookInput {
  schema_version: 1
  event: HookEvent
  session_id: string
  correlation_id: string
  run_id: string
  cwd: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_result?: string
}

/** Expected stdout from PreToolUse hooks */
export interface PreToolHookOutput {
  decision?: 'approve' | 'block'
  reason?: string
  modified_input?: Record<string, unknown>
}

/** Record of a single hook execution for audit */
export interface HookRun {
  run_id: string
  hook_id?: string
  event: HookEvent
  command: string
  started_at: string
  finished_at?: string
  exit_code?: number
  decision?: string
  error?: string
  output_truncated?: boolean
}
