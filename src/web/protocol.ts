// Web UI protocol — the only contract between the localhost server and browser.
// Keep this data-only: it is intentionally easy to inspect with browser devtools.

import type { AskUserAnswers, AskUserQuestion } from '../tools/AskUserQuestions/types.js'
import type { ToolPermissionReason, ToolPermissionResult } from '../agent/agent.js'
import type { InteractionMode } from '../ui/interactionMode.js'

export type AgentPhase = 'refining' | 'executing'

export interface WebTool {
  name: string
  description: string
}

export interface SourceControlFile {
  path: string
  previousPath?: string
  indexStatus: string
  worktreeStatus: string
}

export interface SourceControlSnapshot {
  repository: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: SourceControlFile[]
  selectedPath?: string
  diff: string
  stagedDiff: string
}

/** Live session telemetry mirrored from the Agent (tokens, context, cost). */
export interface SessionStats {
  tokenCount: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  contextUsage: number
  contextLimit: number
  toolCalls: number
  filesModified: number
  costUsd: number
}

/** Agent todo list entry, as maintained by the `todo` tool. */
export interface TodoItemView {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'done'
}

/** Server → client events. */
type ServerEventPayload =
  | { type: 'hello'; sessionId: string; model: string; cwd: string; mode: InteractionMode; tools: WebTool[]; sourceControl: SourceControlSnapshot; latestSeq: number; stats: SessionStats; todos: TodoItemView[] }
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_pending'; name: string; argsText: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: string; args: unknown }
  | { type: 'phase'; phase: AgentPhase }
  | { type: 'micro_compact'; freedTokensEstimate: number }
  | { type: 'auto_compact'; summary: string }
  | { type: 'deny_abort' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'mode'; mode: InteractionMode }
  | { type: 'command_result'; content: string; clear?: boolean }
  | { type: 'source_control'; snapshot: SourceControlSnapshot }
  | { type: 'terminal_data'; data: string }
  | { type: 'terminal_exit'; code: number }
  | { type: 'subagent_start'; id: string; task: string; agentName?: string }
  | { type: 'subagent_tool'; id: string; tool: string; info?: string }
  | { type: 'subagent_tokens'; id: string; tokens: number }
  | { type: 'subagent_message'; id: string; role: 'user' | 'assistant' | 'thinking'; content: string }
  | { type: 'subagent_done'; id: string; result: string; tokens?: number; costUsd?: number }
  | { type: 'subagent_error'; id: string; error: string }
  | { type: 'permission_request'; requestId: string; toolName: string; args: Record<string, unknown>; reason: ToolPermissionReason; externalDirectory?: string; riskDescription?: string }
  | { type: 'confirm_request'; requestId: string; message: string }
  | { type: 'questions_request'; requestId: string; questions: AskUserQuestion[] }
  | { type: 'diff_review_request'; requestId: string; summary: string }
  | { type: 'plan_review_request'; requestId: string; path: string; content: string; summary?: string }
  | { type: 'verification_request'; requestId: string; files: string[]; command: string }
  | { type: 'verification_result'; command: string; ok: boolean; output: string }
  | { type: 'commit_result'; message: string; output: string }
  | { type: 'session_gap'; from: number; to: number }
  | { type: 'stats'; stats: SessionStats }
  | { type: 'todos'; items: TodoItemView[] }
  | { type: 'heartbeat'; at: number }
  | { type: 'workflow_update'; runId: string; name: string; status: string; phase?: string; usage: { agents: number; tokens: number; costUsd: number }; error?: string }
  | { type: 'workflow_log'; runId: string; value: string }
  | { type: 'subagent_blocked'; id: string; reason: string }

export type ServerEvent = ServerEventPayload & { seq?: number }

/** Client → server commands. */
export type ClientCommand =
  | { type: 'run'; prompt: string }
  | { type: 'abort' }
  | { type: 'set_mode'; mode: InteractionMode }
  | { type: 'refresh_source_control'; path?: string }
  | { type: 'stage_files'; paths: string[] }
  | { type: 'unstage_files'; paths: string[] }
  | { type: 'commit'; message: string }
  | { type: 'terminal_open'; cols: number; rows: number }
  | { type: 'terminal_input'; data: string }
  | { type: 'terminal_resize'; cols: number; rows: number }
  | { type: 'terminal_reset'; cols: number; rows: number }
  | { type: 'terminal_replay' }
  | { type: 'resume'; since: number }
  | { type: 'permission_response'; requestId: string; decision: ToolPermissionResult }
  | { type: 'confirm_response'; requestId: string; approved: boolean }
  | { type: 'questions_response'; requestId: string; answers: AskUserAnswers | null }
  | { type: 'diff_review_response'; requestId: string; approved: boolean }
  | { type: 'plan_review_response'; requestId: string; approved: boolean; feedback?: string; aborted?: boolean }
  | { type: 'verification_response'; requestId: string; approved: boolean }

const MODES = new Set<InteractionMode>(['plan', 'review', 'build', 'auto'])
const PERMISSION_DECISIONS = new Set<ToolPermissionResult>(['once', 'session', 'directory', 'always', 'deny'])
const MAX_TEXT = 100_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function string(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

function id(value: unknown): string | null {
  const valueString = string(value, 128)
  return valueString && /^[a-zA-Z0-9_-]+$/.test(valueString) ? valueString : null
}

function dimensions(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 500 ? value : null
}

function paths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return null
  const parsed = value.map((item) => string(item, 4_096))
  return parsed.every((item): item is string => item !== null) ? parsed : null
}

// Answer keys are user-chosen identifiers; these names would collide with
// Object.prototype members and enable prototype pollution sinks downstream.
const UNSAFE_ANSWER_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function answers(value: unknown): AskUserAnswers | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const output: AskUserAnswers = Object.create(null)
  for (const [key, answer] of Object.entries(value)) {
    if (UNSAFE_ANSWER_KEYS.has(key) || !/^[a-zA-Z0-9_-]{1,128}$/.test(key) || typeof answer !== 'string' || answer.length > MAX_TEXT) return undefined
    output[key] = answer
  }
  return output
}

/** Validate JSON at the WebSocket trust boundary before it reaches the runtime. */
export function parseClientCommand(value: unknown): ClientCommand | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  const requestId = id(value.requestId)
  switch (value.type) {
    case 'run': {
      const prompt = string(value.prompt)
      return prompt !== null && prompt.trim() ? { type: 'run', prompt } : null
    }
    case 'abort': return { type: 'abort' }
    case 'set_mode': return MODES.has(value.mode as InteractionMode) ? { type: 'set_mode', mode: value.mode as InteractionMode } : null
    case 'refresh_source_control': {
      const path = value.path === undefined ? undefined : string(value.path, 4_096)
      return path === null ? null : { type: 'refresh_source_control', path }
    }
    case 'stage_files': {
      const parsed = paths(value.paths)
      return parsed ? { type: 'stage_files', paths: parsed } : null
    }
    case 'unstage_files': {
      const parsed = paths(value.paths)
      return parsed ? { type: 'unstage_files', paths: parsed } : null
    }
    case 'commit': {
      const message = string(value.message, 500)
      return message && message.trim() ? { type: 'commit', message } : null
    }
    case 'terminal_open':
    case 'terminal_reset': {
      const cols = dimensions(value.cols); const rows = dimensions(value.rows)
      return cols && rows ? { type: value.type, cols, rows } : null
    }
    case 'terminal_resize': {
      const cols = dimensions(value.cols); const rows = dimensions(value.rows)
      return cols && rows ? { type: 'terminal_resize', cols, rows } : null
    }
    case 'terminal_input': {
      const data = string(value.data, 16_384)
      return data !== null ? { type: 'terminal_input', data } : null
    }
    case 'terminal_replay': return { type: 'terminal_replay' }
    case 'resume': return typeof value.since === 'number' && Number.isSafeInteger(value.since) && value.since >= 0
      ? { type: 'resume', since: value.since } : null
    case 'permission_response':
      return requestId && PERMISSION_DECISIONS.has(value.decision as ToolPermissionResult)
        ? { type: 'permission_response', requestId, decision: value.decision as ToolPermissionResult } : null
    case 'confirm_response':
      return requestId && typeof value.approved === 'boolean' ? { type: 'confirm_response', requestId, approved: value.approved } : null
    case 'questions_response': {
      const parsed = answers(value.answers)
      return requestId && parsed !== undefined ? { type: 'questions_response', requestId, answers: parsed } : null
    }
    case 'diff_review_response':
      return requestId && typeof value.approved === 'boolean' ? { type: 'diff_review_response', requestId, approved: value.approved } : null
    case 'plan_review_response': {
      const feedback = value.feedback === undefined ? undefined : string(value.feedback)
      return requestId && typeof value.approved === 'boolean' && (value.aborted === undefined || typeof value.aborted === 'boolean') && feedback !== null
        ? { type: 'plan_review_response', requestId, approved: value.approved, feedback, aborted: value.aborted as boolean | undefined } : null
    }
    case 'verification_response':
      return requestId && typeof value.approved === 'boolean' ? { type: 'verification_response', requestId, approved: value.approved } : null
    default: return null
  }
}
