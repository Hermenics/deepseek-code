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
  event: HookEvent
  session_id: string
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
