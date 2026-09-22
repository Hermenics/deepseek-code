import { randomUUID } from 'node:crypto'
import type { HookCommand, HookInput, HookMatcher, HookMatcherEvent, HookOutput, HooksConfig } from './types.js'
import type { HookEvent } from './types.js'
import { buildInput, runHookCommand } from './executor.js'
import { matchesHookPattern } from './matcher.js'

export interface HookControlResult {
  decision: 'pass' | 'block'
  reason?: string
  additionalContext?: string
  approved?: boolean
  retry?: boolean
  suppressOutput?: boolean
  systemMessage?: string
  updatedInput?: Record<string, unknown>
  watchPaths?: string[]
}

type HookInputExtras = Partial<Omit<HookInput, 'schema_version' | 'hook_event_name' | 'correlation_id' | 'run_id' | 'event' | 'session_id'>>

/** Parses a hook's stdout as JSON control output; empty, non-JSON or non-object output means "no instructions". */
function parseOutput(output: string): HookOutput {
  if (!output) return {}
  try {
    const parsed = JSON.parse(output) as HookOutput
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

/** Reduces one hook output to block/approve, checking deny first, then allow/approve, then `continue: false` or `decision: block`. */
function outputDecision(output: HookOutput): { blocked: boolean; approved: boolean; reason?: string } {
  const behavior = output.hookSpecificOutput?.decision?.behavior
  if (behavior === 'deny') return { blocked: true, approved: false, reason: output.hookSpecificOutput?.decision?.message ?? output.reason }
  const permissionDecision = output.hookSpecificOutput?.permissionDecision
  if (permissionDecision === 'deny') return { blocked: true, approved: false, reason: output.hookSpecificOutput?.permissionDecisionReason ?? output.reason }
  if (behavior === 'allow' || permissionDecision === 'allow' || output.decision === 'approve') return { blocked: false, approved: true }
  if (output.hookSpecificOutput?.continue === false) return { blocked: true, approved: false, reason: output.reason ?? output.stopReason }
  if (output.decision === 'block' || output.continue === false) return { blocked: true, approved: false, reason: output.reason ?? output.stopReason }
  return { blocked: false, approved: false }
}

/** Extra context text a hook asked to inject, ignoring blank values. */
function additionalContext(output: HookOutput): string | undefined {
  const context = output.hookSpecificOutput?.additionalContext ?? output.additionalContext
  return typeof context === 'string' && context.trim() ? context : undefined
}

/** Runs the enabled commands in parallel under one correlation id, de-duplicating identical command+timeout pairs. */
async function runCommands(
  event: HookEvent,
  commands: HookCommand[],
  sessionId: string,
  extras: HookInputExtras = {},
): Promise<HookOutput[]> {
  const correlationId = randomUUID()
  const uniqueCommands = [...new Map(
    commands
      .filter(command => command.enabled !== false)
      .map(command => [JSON.stringify({ command: command.command, timeout: command.timeout }), command] as const),
  ).values()]
  return Promise.all(uniqueCommands.map(async (command) => {
    const input = buildInput({ event, session_id: sessionId, ...extras }, correlationId)
    return parseOutput(await runHookCommand(command, input))
  }))
}

/** Runs the commands of every enabled matcher whose pattern matches `matcherValue`. */
async function runMatcherCommands(
  event: HookEvent,
  matchers: HookMatcher[],
  matcherValue: string,
  sessionId: string,
  extras: HookInputExtras = {},
): Promise<HookOutput[]> {
  const commands = matchers
    .filter(matcher => matcher.enabled !== false && matchesHookPattern(matcher.matcher, matcherValue))
    .flatMap(matcher => matcher.hooks)
  return runCommands(event, commands, sessionId, extras)
}

/**
 * Combines several hook outputs into one result: the first blocking output wins, contexts are joined,
 * the first system message / updated input is kept, and retry or suppressOutput from any hook applies.
 */
function foldControl(outputs: HookOutput[]): HookControlResult {
  const context = outputs.map(additionalContext).filter((value): value is string => Boolean(value)).join('\n\n') || undefined
  const systemMessage = outputs.map(output => output.hookSpecificOutput?.systemMessage ?? output.systemMessage).find((value): value is string => Boolean(value))
  const updatedInput = outputs.map(output => output.hookSpecificOutput?.updatedInput ?? output.updatedInput).find((value): value is Record<string, unknown> => Boolean(value))
  const retry = outputs.some(output => output.hookSpecificOutput?.retry === true)
  const suppressOutput = outputs.some(output => output.hookSpecificOutput?.suppressOutput === true || output.suppressOutput === true)
  const optional = {
    ...(retry ? { retry: true } : {}),
    ...(suppressOutput ? { suppressOutput: true } : {}),
    ...(systemMessage ? { systemMessage } : {}),
    ...(updatedInput ? { updatedInput } : {}),
  }
  let approved = false
  for (const output of outputs) {
    const decision = outputDecision(output)
    approved = approved || decision.approved
    if (decision.blocked) return { decision: 'block', reason: decision.reason, additionalContext: context, ...optional }
  }
  return { decision: 'pass', additionalContext: context, approved, ...optional }
}

const MATCHER_EVENTS = new Set<HookMatcherEvent>([
  'PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStart', 'SubagentStop',
  'SessionStart', 'Setup', 'SessionEnd', 'PreCompact', 'PostCompact',
  'InstructionsLoaded', 'UserPromptExpansion', 'PostToolUseFailure', 'PermissionDenied',
  'Notification', 'StopFailure', 'ConfigChange', 'DirectoryAdded', 'FileChanged',
  'Elicitation', 'ElicitationResult',
])

/** Run a Claude Code lifecycle event using its documented matcher/command shape. */
export async function runClaudeHookEvent(
  config: HooksConfig | undefined,
  event: HookEvent,
  sessionId: string,
  extras: HookInputExtras = {},
  matcherValue?: string,
): Promise<HookControlResult> {
  if (!config || !MATCHER_EVENTS.has(event as HookMatcherEvent)) {
    const commands = (config?.[event] ?? []) as HookCommand[]
    if (!commands.length) return { decision: 'pass' }
    return foldControl(await runCommands(event, commands, sessionId, extras))
  }
  const matchers = (config[event] ?? []) as HookMatcher[]
  if (!matchers.length) return { decision: 'pass' }
  const eventMatcherValue = matcherValue ?? (
    event === 'SessionStart' ? extras.source
      : event === 'Setup' || event === 'PreCompact' || event === 'PostCompact' ? extras.trigger
        : event === 'SessionEnd' ? extras.reason
          : undefined
  ) ?? ''
  const outputs = await runMatcherCommands(event, matchers, eventMatcherValue, sessionId, extras)
  return foldControl(outputs)
}

/** Runs UserPromptSubmit hooks for a prompt before it is sent; hooks can block it or add context. */
export async function runUserPromptSubmitHooks(
  config: HooksConfig | undefined,
  sessionId: string,
  prompt: string,
  extras: Omit<HookInputExtras, 'prompt'> = {},
): Promise<HookControlResult> {
  if (!config?.UserPromptSubmit?.length) return { decision: 'pass' }
  const outputs = await runCommands('UserPromptSubmit', config.UserPromptSubmit, sessionId, { ...extras, prompt })
  return foldControl(outputs)
}

/** Run hooks after command/prompt expansion, allowing a prompt rewrite. */
export async function runUserPromptExpansionHooks(
  config: HooksConfig | undefined,
  sessionId: string,
  prompt: string,
  extras: Omit<HookInputExtras, 'prompt'> = {},
): Promise<HookControlResult> {
  if (!config?.UserPromptExpansion?.length) return { decision: 'pass' }
  return foldControl(await runMatcherCommands('UserPromptExpansion', config.UserPromptExpansion, 'prompt', sessionId, {
    ...extras, prompt,
  }))
}

/** Fires SessionStart hooks, matched on the start source (default `startup`); their output is ignored. */
export async function runSessionStartHooks(
  config: HooksConfig | undefined,
  sessionId: string,
  source: HookInput['source'] = 'startup',
  extras: Omit<HookInputExtras, 'source'> = {},
): Promise<void> {
  if (!config?.SessionStart?.length) return
  await runClaudeHookEvent(config, 'SessionStart', sessionId, { ...extras, source })
}

/** Runs PermissionRequest hooks matched on the tool name; a hook may approve or deny the pending permission prompt. */
export async function runPermissionRequestHooks(
  config: HooksConfig | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionId: string,
  extras: Omit<HookInputExtras, 'tool_name' | 'tool_input'> = {},
): Promise<HookControlResult> {
  if (!config?.PermissionRequest?.length) return { decision: 'pass' }
  const outputs = await runMatcherCommands('PermissionRequest', config.PermissionRequest, toolName, sessionId, {
    ...extras, tool_name: toolName, tool_input: toolInput,
  })
  return foldControl(outputs)
}

/** Runs Stop hooks when the agent finishes a turn; a block asks the agent to keep going. */
export async function runStopHooks(
  config: HooksConfig | undefined,
  sessionId: string,
  lastAssistantMessage: string | null,
  stopHookActive: boolean,
  extras: Omit<HookInputExtras, 'last_assistant_message' | 'stop_hook_active'> = {},
): Promise<HookControlResult> {
  if (!config?.Stop?.length) return { decision: 'pass' }
  const outputs = await runCommands('Stop', config.Stop, sessionId, {
    ...extras, last_assistant_message: lastAssistantMessage, stop_hook_active: stopHookActive,
  })
  return foldControl(outputs)
}

/** Fires SessionEnd hooks with reason `other`; output is ignored. */
export async function runSessionEndHooks(
  config: HooksConfig | undefined,
  sessionId: string,
  cwd?: string,
): Promise<void> {
  if (!config?.SessionEnd?.length) return
  await runClaudeHookEvent(config, 'SessionEnd', sessionId, { cwd: cwd ?? process.cwd(), reason: 'other' })
}

/** Runs PreCompact hooks matched on the trigger (`manual`/`auto`); a hook can block the compaction. */
export async function runPreCompactHooks(
  config: HooksConfig | undefined,
  sessionId: string,
  trigger: 'manual' | 'auto',
  extras: Omit<HookInputExtras, 'trigger'> = {},
): Promise<HookControlResult> {
  if (!config?.PreCompact?.length) return { decision: 'pass' }
  return runClaudeHookEvent(config, 'PreCompact', sessionId, { ...extras, trigger })
}

/** Fires PostCompact hooks matched on the trigger after compaction completes; output is ignored. */
export async function runPostCompactHooks(
  config: HooksConfig | undefined,
  sessionId: string,
  trigger: 'manual' | 'auto',
  extras: Omit<HookInputExtras, 'trigger'> = {},
): Promise<void> {
  if (!config?.PostCompact?.length) return
  await runClaudeHookEvent(config, 'PostCompact', sessionId, { ...extras, trigger })
}

/** Runs SubagentStart hooks matched on the agent type before a subagent starts. */
export async function runSubagentStartHooks(
  config: HooksConfig | undefined,
  sessionId: string,
  agentId: string,
  agentType: string,
  extras: Omit<HookInputExtras, 'agent_id' | 'agent_type'> = {},
): Promise<HookControlResult> {
  if (!config?.SubagentStart?.length) return { decision: 'pass' }
  const outputs = await runMatcherCommands('SubagentStart', config.SubagentStart, agentType, sessionId, {
    ...extras, agent_id: agentId, agent_type: agentType,
  })
  return foldControl(outputs)
}

/** Runs SubagentStop hooks matched on the agent type when a subagent finishes; `stop_hook_active` is always sent as false. */
export async function runSubagentStopHooks(
  config: HooksConfig | undefined,
  sessionId: string,
  agentId: string,
  agentType: string,
  lastAssistantMessage: string | null,
  extras: Omit<HookInputExtras, 'agent_id' | 'agent_type' | 'last_assistant_message' | 'stop_hook_active'> = {},
): Promise<HookControlResult> {
  if (!config?.SubagentStop?.length) return { decision: 'pass' }
  const outputs = await runMatcherCommands('SubagentStop', config.SubagentStop, agentType, sessionId, {
    ...extras,
    agent_id: agentId,
    agent_type: agentType,
    last_assistant_message: lastAssistantMessage,
    stop_hook_active: false,
  })
  return foldControl(outputs)
}
