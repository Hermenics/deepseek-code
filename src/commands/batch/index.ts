import type { StartWorkflowInput, WorkflowHandle, WorkflowManager } from '../../workflows/manager.js'
import type { WorkflowResult } from '../../workflows/types.js'

const MAX_BATCH_ITEMS = 17
const MAX_PROMPT_LENGTH = 16_384
const MAX_TOTAL_PROMPT_BYTES = 128 * 1024
const MAX_TIMEOUT_MS = 3_600_000

export const BATCH_LIMITS = Object.freeze({
  maxItems: MAX_BATCH_ITEMS,
  maxPromptLength: MAX_PROMPT_LENGTH,
  maxTotalPromptBytes: MAX_TOTAL_PROMPT_BYTES,
  maxTimeoutMs: MAX_TIMEOUT_MS,
})

/**
 * The command is intentionally not registered here. Integration points are:
 * `src/commands/index.ts` (import/list), `src/commands/types.ts` (the
 * `{ type: 'batch'; prompts: string[] }` union member), and the command
 * dispatch switch in `src/ui/App.tsx` (call `executeBatchCommand` with the
 * existing `agent.workflows`). The web dispatcher needs the same case in
 * `src/web/commands.ts` if browser support is wanted.
 *
 * `WorkflowManager.start()` creates the bounded `OrchestratorSession`, so this
 * module only owns parsing and the adapter contract; it does not create a
 * second orchestration runtime.
 */

export interface BatchCommand {
  type: 'batch'
  prompts: string[]
}

export interface BatchParseError {
  type: 'unknown'
  input: string
}

export type BatchCommandResult = BatchCommand | BatchParseError

export interface BatchExecutionOptions {
  workflowManager: Pick<WorkflowManager, 'start'>
  /** Optional owner-level wrapper that performs interactive authorization. */
  startWorkflow?: (input: StartWorkflowInput) => Promise<WorkflowHandle>
  signal?: AbortSignal
  timeoutMs?: number
  maxTokens?: number
  maxCostUsd?: number
}

export const BATCH_WORKFLOW_SCRIPT = `export const meta = {"name":"batch","description":"Run independent prompts in parallel"};
return parallel(args.prompts.map(prompt => () => agent(prompt)));`

const usage = 'Usage: /batch <prompt> [-- <prompt> ...]'

function error(message: string): BatchParseError {
  return { type: 'unknown', input: `${message} ${usage}` }
}

function validatePrompts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(usage)
  if (value.length > MAX_BATCH_ITEMS) throw new Error(`Batch supports at most ${MAX_BATCH_ITEMS} prompts`)

  const prompts = value.map((prompt, index) => {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error(`Batch prompt ${index + 1} must be a non-empty string`)
    const normalized = prompt.trim()
    if (normalized.length > MAX_PROMPT_LENGTH) throw new Error(`Batch prompt ${index + 1} exceeds ${MAX_PROMPT_LENGTH} characters`)
    return normalized
  })

  if (Buffer.byteLength(prompts.join('\0'), 'utf8') > MAX_TOTAL_PROMPT_BYTES) {
    throw new Error(`Batch prompts exceed ${MAX_TOTAL_PROMPT_BYTES} bytes in total`)
  }
  return prompts
}

function validateExecutionOptions(options: BatchExecutionOptions): void {
  if (!options || typeof options !== 'object' || !options.workflowManager || typeof options.workflowManager.start !== 'function') {
    throw new Error('A WorkflowManager is required to execute a batch')
  }
  if (options.signal && (typeof options.signal.aborted !== 'boolean' || typeof options.signal.addEventListener !== 'function' || typeof options.signal.removeEventListener !== 'function')) {
    throw new Error('Batch signal must be an AbortSignal')
  }
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > MAX_TIMEOUT_MS)) {
    throw new Error(`Batch timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`)
  }
  if (options.maxTokens !== undefined && (!Number.isInteger(options.maxTokens) || options.maxTokens < 1)) {
    throw new Error('Batch maxTokens must be a positive integer')
  }
  if (options.maxCostUsd !== undefined && (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd < 0)) {
    throw new Error('Batch maxCostUsd must be a non-negative number')
  }
}

function validateCommand(command: unknown): BatchCommand {
  if (!command || typeof command !== 'object' || (command as { type?: unknown }).type !== 'batch') {
    throw new Error('Invalid batch command')
  }
  const prompts = validatePrompts((command as { prompts?: unknown }).prompts)
  return { type: 'batch', prompts }
}

/** Parse arguments after `/batch`; use a standalone `--` between prompts. */
export function parseBatchCommand(args: readonly string[]): BatchCommandResult {
  if (!Array.isArray(args) || args.length === 0) return error('Batch needs at least one prompt.')

  const prompts: string[] = []
  let current: string[] = []
  for (const arg of args) {
    if (typeof arg !== 'string') return error('Batch arguments must be strings.')
    if (arg === '--') {
      if (!current.join(' ').trim()) return error('Batch prompts cannot be empty.')
      prompts.push(current.join(' '))
      current = []
    } else {
      current.push(arg)
    }
  }
  if (!current.join(' ').trim()) return error('Batch prompts cannot be empty.')
  prompts.push(current.join(' '))

  try {
    return { type: 'batch', prompts: validatePrompts(prompts) }
  } catch (reason) {
    return error((reason as Error).message)
  }
}

/** Start and await a batch through the existing workflow/orchestration runtime. */
export async function executeBatchCommand(command: unknown, options: BatchExecutionOptions): Promise<WorkflowResult> {
  const validCommand = validateCommand(command)
  validateExecutionOptions(options)
  if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('Batch execution cancelled')

  const start = options.startWorkflow ?? ((input: StartWorkflowInput) => options.workflowManager.start(input))
  const handle = await start({
    script: BATCH_WORKFLOW_SCRIPT,
    name: 'batch',
    args: { prompts: validCommand.prompts },
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.maxCostUsd !== undefined ? { maxCostUsd: options.maxCostUsd } : {}),
  })
  const cancel = () => handle.cancel(options.signal?.reason instanceof Error ? options.signal.reason.message : 'Batch execution cancelled')
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  try {
    return await handle.result
  } finally {
    options.signal?.removeEventListener('abort', cancel)
  }
}

const batchCommand = {
  name: 'batch',
  aliases: [],
  description: 'Run independent prompts in parallel (separate prompts with --)',
  parse: parseBatchCommand,
}

export default batchCommand
