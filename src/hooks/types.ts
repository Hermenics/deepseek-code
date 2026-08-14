export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PermissionRequest'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'PostCompact'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Setup'
  | 'InstructionsLoaded'
  | 'UserPromptExpansion'
  | 'MessageDisplay'
  | 'PostToolUseFailure'
  | 'PostToolBatch'
  | 'PermissionDenied'
  | 'Notification'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'StopFailure'
  | 'TeammateIdle'
  | 'ConfigChange'
  | 'CwdChanged'
  | 'DirectoryAdded'
  | 'FileChanged'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'Elicitation'
  | 'ElicitationResult'

export type HookMatcherEvent =
  | 'PreToolUse' | 'PostToolUse' | 'PermissionRequest' | 'SubagentStart' | 'SubagentStop'
  | 'SessionStart' | 'Setup' | 'SessionEnd' | 'PreCompact' | 'PostCompact'
  | 'InstructionsLoaded' | 'UserPromptExpansion' | 'PostToolUseFailure' | 'PermissionDenied'
  | 'Notification' | 'StopFailure' | 'ConfigChange' | 'DirectoryAdded' | 'FileChanged'
  | 'Elicitation' | 'ElicitationResult'
export type HookCommandEvent = Exclude<HookEvent, HookMatcherEvent>

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
  PermissionRequest?: HookMatcher[]
  SubagentStart?: HookMatcher[]
  SubagentStop?: HookMatcher[]
  InstructionsLoaded?: HookMatcher[]
  UserPromptExpansion?: HookMatcher[]
  PostToolUseFailure?: HookMatcher[]
  PermissionDenied?: HookMatcher[]
  Notification?: HookMatcher[]
  StopFailure?: HookMatcher[]
  ConfigChange?: HookMatcher[]
  DirectoryAdded?: HookMatcher[]
  FileChanged?: HookMatcher[]
  Elicitation?: HookMatcher[]
  ElicitationResult?: HookMatcher[]
  UserPromptSubmit?: HookCommand[]
  Stop?: HookCommand[]
  SessionStart?: HookMatcher[]
  SessionEnd?: HookMatcher[]
  PreCompact?: HookMatcher[]
  PostCompact?: HookMatcher[]
  Setup?: HookMatcher[]
  MessageDisplay?: HookCommand[]
  PostToolBatch?: HookCommand[]
  TaskCreated?: HookCommand[]
  TaskCompleted?: HookCommand[]
  TeammateIdle?: HookCommand[]
  CwdChanged?: HookCommand[]
  WorktreeCreate?: HookCommand[]
  WorktreeRemove?: HookCommand[]
}

/** JSON sent to hook command via stdin */
export interface HookInput {
  schema_version: 1
  event: HookEvent
  hook_event_name: HookEvent
  session_id: string
  correlation_id: string
  run_id: string
  cwd: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_result?: string
  prompt?: string
  model?: string
  permission_mode?: string
  trigger?: 'manual' | 'auto' | 'init' | 'maintenance'
  stop_hook_active?: boolean
  last_assistant_message?: string | null
  agent_id?: string
  agent_type?: string
  agent_transcript_path?: string | null
  reason?: string
  transcript_path?: string
  tool_use_id?: string
  tool_calls?: Array<Record<string, unknown>>
  error?: string
  error_details?: string
  message?: string
  title?: string
  notification_type?: string
  source?: 'startup' | 'resume' | 'clear' | 'compact'
  task_id?: string
  task_subject?: string
  task_description?: string
  teammate_name?: string
  team_name?: string
  old_cwd?: string
  new_cwd?: string
  file_path?: string
  file_change_type?: 'change' | 'add' | 'unlink'
  name?: string
  mcp_server_name?: string
  mode?: string
  url?: string
  elicitation_id?: string
  requested_schema?: Record<string, unknown>
  path?: string
  memory_type?: 'User' | 'Project' | 'Local' | 'Managed'
  load_reason?: 'session_start' | 'nested_traversal' | 'path_glob_match' | 'include' | 'compact'
}

/** Expected stdout from PreToolUse hooks */
export interface PreToolHookOutput {
  decision?: 'approve' | 'block'
  reason?: string
  modified_input?: Record<string, unknown>
}

export interface HookOutput {
  decision?: 'approve' | 'block'
  reason?: string
  continue?: boolean
  stopReason?: string
  additionalContext?: string
  systemMessage?: string
  suppressOutput?: boolean
  updatedInput?: Record<string, unknown>
  hookSpecificOutput?: {
    hookEventName?: HookEvent
    additionalContext?: string
    systemMessage?: string
    permissionDecision?: 'allow' | 'deny'
    permissionDecisionReason?: string
    retry?: boolean
    continue?: boolean
    suppressOutput?: boolean
    updatedInput?: Record<string, unknown>
    decision?: { behavior?: 'allow' | 'deny'; message?: string }
  }
}

/** Record of a single hook execution for audit */
export interface HookRun {
  run_id: string
  hook_id?: string
  event: HookEvent
  command: string
  correlation_id?: string
  session_id?: string
  started_at: string
  finished_at?: string
  exit_code?: number
  decision?: string
  error?: string
  output_truncated?: boolean
}
