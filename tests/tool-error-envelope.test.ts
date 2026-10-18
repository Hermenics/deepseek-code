import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Agent } from '../src/agent/agent.js'
import { createGoal, getGoal, setGoal } from '../src/agent/goal.js'
import { isToolErrorResult, normalizeToolException, normalizeToolResult } from '../src/tools/result.js'
import { MoAExecutionError } from '../src/tools/MoA/types.js'
import { CreateGoal } from '../src/tools/CreateGoal/CreateGoal.js'
import { Todo } from '../src/tools/Todo/Todo.js'
import type { Tool } from '../src/tools/types.js'

it('normalizes explicit tool failures while preserving successful output', () => {
  expect(JSON.parse(normalizeToolResult('Error: file not found: missing.txt'))).toEqual({
    schemaVersion: 1,
    status: 'error',
    error: { kind: 'tool', code: 'TOOL_ERROR', message: 'file not found: missing.txt', retryable: false },
  })
  expect(JSON.parse(normalizeToolResult('[Tool Error: read_file] Invalid arguments:\n- /path is required'))).toEqual({
    schemaVersion: 1,
    status: 'error',
    error: { kind: 'validation', code: 'INVALID_ARGUMENTS', message: '/path is required', retryable: false },
  })
  expect(JSON.parse(normalizeToolResult('Command blocked — network access requires explicit approval.'))).toMatchObject({
    schemaVersion: 1,
    status: 'error',
    error: { kind: 'permission', code: 'TOOL_BLOCKED', message: 'network access requires explicit approval.', retryable: false },
  })
  expect(JSON.parse(normalizeToolResult('Cancelled: user cancelled the command.'))).toEqual({
    schemaVersion: 1,
    status: 'error',
    error: { kind: 'tool', code: 'TOOL_CANCELLED', message: 'user cancelled the command.', retryable: false },
  })
  expect(JSON.parse(normalizeToolResult('{"error":"file is unavailable"}'))).toMatchObject({
    schemaVersion: 1,
    status: 'error',
    error: { kind: 'tool', code: 'TOOL_ERROR', message: 'file is unavailable', retryable: false },
  })
  expect(JSON.parse(normalizeToolResult('{"success":false,"error":"completion_summary is required"}'))).toMatchObject({
    schemaVersion: 1,
    status: 'error',
    error: { kind: 'tool', code: 'TOOL_ERROR', message: 'completion_summary is required', retryable: false },
  })
  expect(normalizeToolResult('{"error":"No active goal.","goal":null}')).toBe('{"error":"No active goal.","goal":null}')
  expect(JSON.parse(normalizeToolResult('Unknown action: invalid'))).toMatchObject({
    schemaVersion: 1,
    status: 'error',
    error: { kind: 'validation', code: 'INVALID_ARGUMENTS', retryable: false },
  })
  expect(normalizeToolResult('{"error":"data","source":"user document"}')).toBe('{"error":"data","source":"user document"}')
  expect(normalizeToolResult('file content')).toBe('file content')
})

it('preserves Shell exit, timeout, cancellation, and recoverable output state', () => {
  const outputId = '123e4567-e89b-42d3-a456-426614174000'
  expect(JSON.parse(normalizeToolResult(`Error: Command exited with code 7.\ncompiler failure\nRetrieve retained captured output with shell output_id="${outputId}".`))).toEqual({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'SHELL_EXIT', message: 'Command exited with code 7.', retryable: false },
    partial: {
      state: 'failed',
      exitCode: 7,
      signal: null,
      output: `compiler failure\nRetrieve retained captured output with shell output_id="${outputId}".`,
      outputId,
      outputIncomplete: false,
      outputPreviewTruncated: false,
    },
  })
  expect(JSON.parse(normalizeToolResult('Error: Command timed out after 3s and was killed.\npartial output'))).toMatchObject({
    status: 'partial',
    error: { code: 'TIMED_OUT', retryable: false },
    partial: { state: 'timed_out', exitCode: null, output: 'partial output', outputIncomplete: false },
  })
  expect(JSON.parse(normalizeToolResult('Cancelled: Command was terminated by signal SIGTERM.\npartial output'))).toMatchObject({
    status: 'partial',
    error: { code: 'CANCELLED', retryable: false },
    partial: { state: 'cancelled', signal: 'SIGTERM', output: 'partial output', outputIncomplete: false },
  })
  expect(JSON.parse(normalizeToolResult('Error: Command exited with code 1.\n[Pipe drain deadline reached; output may be incomplete.]'))).toMatchObject({
    partial: { outputIncomplete: true },
  })
  const long = normalizeToolResult(`Error: Command exited with code 7.\n${'😀'.repeat(800)}\nRetrieve retained captured output with shell output_id="${outputId}".`)
  const partial = JSON.parse(long).partial
  expect(partial).toMatchObject({ output: '😀'.repeat(500), outputId, outputPreviewTruncated: true })
  expect(Buffer.byteLength(long, 'utf8')).toBeLessThan(20_000)
})

it('preserves typed foreground Shell exception status and recovery references', () => {
  const outputId = '123e4567-e89b-42d3-a456-426614174000'
  const exit = Object.assign(new Error(`Command exited with code 7. Recover output with shell output_id="${outputId}".`), { code: 'SHELL_EXIT' })
  expect(JSON.parse(normalizeToolException(exit))).toEqual({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'SHELL_EXIT', message: 'Command exited with code 7.', retryable: false },
    partial: {
      state: 'failed', exitCode: 7, signal: null,
      output: `Recover output with shell output_id="${outputId}".`, outputId,
      outputIncomplete: false, outputPreviewTruncated: false,
    },
  })

  const cancellation = Object.assign(new Error(`Command was terminated by signal SIGTERM. Recover output with shell output_id="${outputId}".`), { code: 'CANCELLED' })
  expect(JSON.parse(normalizeToolException(cancellation))).toMatchObject({
    status: 'partial',
    error: { code: 'CANCELLED', retryable: false },
    partial: { state: 'cancelled', signal: 'SIGTERM', outputId },
  })
})

it('preserves retryability on non-Shell exceptions and rejects it for Shell execution errors', () => {
  const retryable = Object.assign(new Error('Remote lookup timed out'), { code: 'REMOTE_LOOKUP_FAILED', retryable: true })
  expect(JSON.parse(normalizeToolException(retryable))).toMatchObject({
    error: { code: 'REMOTE_LOOKUP_FAILED', retryable: true },
  })

  const shell = Object.assign(new Error('Shell process failed'), { code: 'SHELL_SIGNAL', retryable: true })
  expect(JSON.parse(normalizeToolException(shell))).toMatchObject({
    error: { code: 'SHELL_SIGNAL', retryable: false },
  })
})

it('normalizes composite success:false responses and preserves their partial details', () => {
  const original = {
    success: false,
    goal: { objective: 'Finish the task.', status: 'active' },
    verification: { complete: false, reason: 'A required criterion is unverified.' },
    message: 'Continue working and retry after collecting evidence.',
  }

  expect(JSON.parse(normalizeToolResult(JSON.stringify(original)))).toEqual({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'TOOL_ERROR', message: original.message, retryable: false },
    partial: {
      goal: original.goal,
      verification: original.verification,
      message: original.message,
    },
  })
})

it('normalizes explicit ok:false and failed-status responses without losing details', () => {
  const failed = {
    ok: false,
    status: 'failed',
    error: { code: 'REMOTE_LOOKUP_FAILED', message: 'Lookup timed out', retryable: true },
    response: { requestId: 'req-1', completedPages: 2 },
  }

  expect(JSON.parse(normalizeToolResult(JSON.stringify(failed)))).toEqual({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'REMOTE_LOOKUP_FAILED', message: 'Lookup timed out', retryable: true },
    partial: { response: failed.response },
  })

  expect(JSON.parse(normalizeToolResult(JSON.stringify({ status: 'error', message: 'Operation failed', output: 'partial output' })))).toEqual({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'TOOL_ERROR', message: 'Operation failed', retryable: false },
    partial: { message: 'Operation failed', output: 'partial output' },
  })

  expect(JSON.parse(normalizeToolResult(JSON.stringify({ error: { code: 'REMOTE_FAILURE', message: 'Request failed', retryable: false }, output: 'partial output' })))).toEqual({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'REMOTE_FAILURE', message: 'Request failed', retryable: false },
    partial: { output: 'partial output' },
  })

  expect(JSON.parse(normalizeToolResult(JSON.stringify({ status: 'cancelled', error: { code: 'CANCELLED', message: '' }, output: 'partial output' })))).toEqual({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'CANCELLED', message: 'Tool reported cancelled status', retryable: false },
    partial: { output: 'partial output' },
  })
})

it('normalizes boolean cancellation and preserves the answers payload as partial data', () => {
  const result = normalizeToolResult(JSON.stringify({ cancelled: true, answers: {} }))

  expect(JSON.parse(result)).toEqual({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'TOOL_CANCELLED', message: 'Tool was cancelled', retryable: false },
    partial: { answers: {} },
  })
  expect(isToolErrorResult(result)).toBe(true)

  const successful = JSON.stringify({ cancelled: false, answers: { ok: 'yes' } })
  expect(normalizeToolResult(successful)).toBe(successful)
})

it('returns typed errors for invalid and conflicting goal creation', async () => {
  const previous = getGoal()
  try {
    const invalid = JSON.parse(await CreateGoal.execute({ objective: '   ' }))
    expect(invalid).toMatchObject({ status: 'error', error: { kind: 'validation', code: 'INVALID_ARGUMENTS' } })

    createGoal('existing objective')
    const conflict = JSON.parse(await CreateGoal.execute({ objective: 'another objective' }))
    expect(conflict).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'conflict', code: 'GOAL_ALREADY_EXISTS' },
    })
    expect(conflict.error.message).toContain('existing objective')
  } finally {
    setGoal(previous)
  }
})

it('returns typed errors when Todo update or removal targets a missing item', async () => {
  const id = 'missing-todo-for-error-envelope-test'
  const update = JSON.parse(await Todo.execute({ action: 'update', id, status: 'done' }))
  expect(update).toMatchObject({
    schemaVersion: 1,
    status: 'error',
    error: { kind: 'tool', code: 'TODO_NOT_FOUND', retryable: false },
  })

  const remove = JSON.parse(await Todo.execute({ action: 'remove', id }))
  expect(remove).toEqual(update)
})

it('wraps failed Todo batches in one partial error envelope', async () => {
  const result = JSON.parse(await Todo.execute({
    action: 'batch',
    operations: [
      { action: 'update', id: 'missing-batch-todo-1', status: 'done' },
      { action: 'remove', id: 'missing-batch-todo-2' },
    ],
  }))

  expect(result).toMatchObject({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'TODO_BATCH_FAILED', retryable: false },
    partial: {
      operations: [
        { index: 0, status: 'error', result: { error: { code: 'TODO_NOT_FOUND' } } },
        { index: 1, status: 'error', result: { error: { code: 'TODO_NOT_FOUND' } } },
      ],
    },
  })
})

it('sends failed native tool calls to the primary Agent with a typed error status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-tool-error-envelope-'))
  const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' }, { projectRoot: root, logFile: null, snapshotFile: null })
  try {
    await agent.readyPromise
    const executeTool = (agent as unknown as { executeTool(name: string, args: Record<string, unknown>): Promise<string> }).executeTool.bind(agent)
    const result = JSON.parse(await executeTool('read_file', { path: 'missing.txt' }))
    expect(result).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'tool', code: 'TOOL_ERROR', retryable: false },
    })
    expect(result.error.message).toContain('file not found')

    const invalid = JSON.parse(await executeTool('read_file', { path: '' }))
    expect(invalid).toMatchObject({ status: 'error', error: { kind: 'validation', code: 'INVALID_ARGUMENTS', retryable: false } })

    const partial = {
      references: [{
        candidateId: 'candidate-1', model: 'candidate-a', provider: 'deepseek', status: 'done' as const,
        response: 'candidate answer', attempts: 1, usageAvailable: true, costAvailable: false, durationMs: 12,
      }],
    }
    const toolMap = (agent as unknown as { toolMap: Map<string, Tool> }).toolMap
    const askUserQuestionsTool = toolMap.get('ask_user_questions')!
    toolMap.set('ask_user_questions', {
      ...askUserQuestionsTool,
      async execute() { return JSON.stringify({ cancelled: true, answers: {} }) },
    })
    expect(JSON.parse(await executeTool('ask_user_questions', {
      questions: [{ question: 'Continue?', header: 'Confirm', type: 'yesno' }],
    }))).toEqual({
      schemaVersion: 1,
      status: 'partial',
      error: { kind: 'tool', code: 'TOOL_CANCELLED', message: 'Tool was cancelled', retryable: false },
      partial: { answers: {} },
    })

    const readTool = toolMap.get('read_file')!
    const outputId = '123e4567-e89b-42d3-a456-426614174000'
    toolMap.set('read_file', {
      ...readTool,
      async execute() { throw Object.assign(new Error(`Command exited with code 7. Recover output with shell output_id="${outputId}".`), { code: 'SHELL_EXIT' }) },
    })
    expect(JSON.parse(await executeTool('read_file', { path: 'fixture' }))).toMatchObject({
      status: 'partial',
      error: { code: 'SHELL_EXIT' },
      partial: { state: 'failed', exitCode: 7, outputId },
    })

    toolMap.set('moa', {
      name: 'moa', description: 'composite fixture', parameters: { type: 'object', properties: {} },
      async execute() { throw new MoAExecutionError('AGGREGATOR_FAILED', 'Aggregator failed: unavailable', partial) },
    })
    expect(JSON.parse(await executeTool('moa', {}))).toEqual({
      schemaVersion: 1,
      status: 'partial',
      error: { kind: 'tool', code: 'AGGREGATOR_FAILED', message: 'Aggregator failed: unavailable', retryable: false },
      partial,
    })
  } finally {
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it('preserves typed partial results from a composite tool failure', () => {
  const partial = {
    references: [{
      candidateId: 'candidate-1', model: 'candidate-a', provider: 'deepseek', status: 'done' as const,
      response: 'candidate answer', attempts: 1, usageAvailable: true, costAvailable: false, durationMs: 12,
    }],
  }
  const error = new MoAExecutionError('AGGREGATOR_FAILED', 'Aggregator failed: unavailable', partial)
  const result = normalizeToolException(error)

  expect(JSON.parse(result)).toEqual({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'AGGREGATOR_FAILED', message: 'Aggregator failed: unavailable', retryable: false },
    partial,
  })
  expect(isToolErrorResult(result)).toBe(true)
  expect(normalizeToolResult(result)).toBe(result)
})
