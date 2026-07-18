import { describe, expect, it } from 'bun:test'
import type { Tool } from '../src/tools/types.js'
import { SUBAGENT_RESULT_SCHEMA } from '../src/orchestration/schema.js'
import { runSubAgentLoop } from '../src/tools/SubAgent/executor.js'
import { StructuredOutputError, validateSubAgentResult, type SubAgentResult } from '../src/tools/SubAgent/contracts.js'
import { OrchestratorSession } from '../src/orchestration/index.js'

const provider = { provider: 'local' as const, localModel: 'fake' }
const valid: SubAgentResult = {
  summary: 'done', confidence: 1, filesRead: [], filesChanged: [], issuesFound: [], suggestions: [], metadata: {},
}

function response(message: Record<string, unknown>) {
  return { choices: [{ message }], usage: { total_tokens: 3 } }
}

function fakeClient(messages: Array<Record<string, unknown>>) {
  return { chat: { completions: { create: async () => response(messages.shift() ?? { content: null }) } } } as any
}

function terminalArgs(value: unknown, id = 'terminal') {
  return { content: null, tool_calls: [{ id, type: 'function', function: { name: 'submit_result', arguments: JSON.stringify(value) } }] }
}

const terminal = {
  name: 'submit_result' as const,
  description: 'submit',
  schema: SUBAGENT_RESULT_SCHEMA,
  maxValidationRetries: 1,
  transform: validateSubAgentResult,
}

describe('subagent terminal protocol', () => {
  it('returns one schema-valid terminal result', async () => {
    const result = await runSubAgentLoop('system', 'task', 'id', [], provider, 'fake', { client: fakeClient([terminalArgs(valid)]), terminal })
    expect(result.terminalResult).toEqual(valid)
    expect(result.totalTokens).toBe(3)
  })

  it('retries validation once and preserves raw output', async () => {
    const result = await runSubAgentLoop('system', 'task', 'id', [], provider, 'fake', {
      client: fakeClient([terminalArgs({ summary: 'incomplete' }, 'bad'), terminalArgs(valid, 'good')]), terminal,
    })
    expect(result.terminalResult).toEqual(valid)
    expect(result.rawOutput).toContain('incomplete')
  })

  it('fails when output is absent, mixed, multiple or repeatedly invalid', async () => {
    const cases = [
      [{ content: 'plain' }, { content: 'still plain' }],
      [{ content: null, tool_calls: [terminalArgs(valid).tool_calls[0], { id: 'other', type: 'function', function: { name: 'read_file', arguments: '{"path":"x"}' } }] }, terminalArgs({})],
      [{ content: null, tool_calls: [terminalArgs(valid, 'a').tool_calls[0], terminalArgs(valid, 'b').tool_calls[0]] }, terminalArgs({})],
    ]
    for (const messages of cases) {
      await expect(runSubAgentLoop('system', 'task', 'id', [], provider, 'fake', { client: fakeClient(messages), terminal })).rejects.toBeInstanceOf(StructuredOutputError)
    }
  })

  it('does not execute tools whose permission decision is ask', async () => {
    let executions = 0
    const readTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { executions++; return 'secret' },
    }
    const toolCall = { content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }
    const result = await runSubAgentLoop('system', 'task', 'id', [readTool], provider, 'fake', {
      client: fakeClient([toolCall, terminalArgs(valid)]), terminal,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file(src/**)'] } },
    })
    expect(result.terminalResult).toEqual(valid)
    expect(executions).toBe(0)
  })

  it('stops the whole tool-call batch as soon as permission blocks the task', async () => {
    let writes = 0
    const tools: Tool[] = [
      { name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, async execute() { return 'read' } },
      { name: 'write_file', description: 'write', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, async execute() { writes++; return 'written' } },
    ]
    const batch = {
      content: null,
      tool_calls: [
        { id: 'ask', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } },
        { id: 'write', type: 'function', function: { name: 'write_file', arguments: '{"path":"x","content":"x"}' } },
      ],
    }
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const task = session.spawn({ taskId: 'permission-task', maxRetries: 0 }, async runContext => runSubAgentLoop(
      'system', 'task', runContext.taskId, tools, provider, 'fake', {
        client: fakeClient([batch]), terminal,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
        context: session.toolContext({ taskId: runContext.taskId, signal: runContext.signal, permissionProfile: 'writer-worktree' }),
      },
    ))
    for (let index = 0; index < 100 && task.status().state !== 'blocked'; index++) await Bun.sleep(1)
    expect(task.status().state).toBe('blocked')
    expect(writes).toBe(0)
    expect(session.registry.mailbox.list('coordinator', 'pending')).toHaveLength(1)
    task.cancel()
  })

  it('accepts an explicit coordinator grant and resumes the same observable handle', async () => {
    let reads = 0
    const readTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { reads++; return 'verified content' },
    }
    const readCall = { content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const task = session.spawn({ taskId: 'grant-task', maxRetries: 0 }, async runContext => runSubAgentLoop(
      'system', 'task', runContext.taskId, [readTool], provider, 'fake', {
        client: fakeClient([readCall, terminalArgs(valid)]), terminal,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
        context: session.toolContext({ taskId: runContext.taskId, signal: runContext.signal, permissionProfile: 'researcher-readonly' }),
      },
    ))
    const completion = task.awaitResult()
    for (let index = 0; index < 100 && task.status().state !== 'blocked'; index++) await Bun.sleep(1)
    expect(task.status().state).toBe('blocked')
    const [request] = session.registry.mailbox.list('coordinator', 'pending')
    session.registry.sendMessage(task.taskId, 'permission', { decision: 'allow', tool: 'read_file', requestId: request!.messageId })
    expect(task.resume()).toBe(true)
    expect((await completion).status).toBe('done')
    expect(reads).toBe(1)
    expect(session.registry.mailbox.list(task.taskId, 'processed')).toHaveLength(1)
    expect(session.registry.mailbox.list('coordinator', 'processed')).toHaveLength(1)
  })

  it('does not reuse a coordinator grant for different arguments', async () => {
    let reads = 0
    const readTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { reads++; return 'content' },
    }
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const task = session.spawn({ taskId: 'scoped-grant', maxRetries: 0 }, async runContext => {
      const path = runContext.attempt === 1 ? 'README.md' : '.env'
      const call = { content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path }) } }] }
      return runSubAgentLoop('system', 'task', runContext.taskId, [readTool], provider, 'fake', {
        client: fakeClient([call]), terminal,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
        context: session.toolContext({ taskId: runContext.taskId, signal: runContext.signal, permissionProfile: 'researcher-readonly' }),
      })
    })
    for (let index = 0; index < 100 && task.status().state !== 'blocked'; index++) await Bun.sleep(1)
    const [request] = session.registry.mailbox.list('coordinator', 'pending')
    session.registry.sendMessage(task.taskId, 'permission', { decision: 'allow', tool: 'read_file', requestId: request!.messageId })
    expect(task.resume()).toBe(true)
    for (let index = 0; index < 100 && !(task.status().state === 'blocked' && task.status().attempt === 2); index++) await Bun.sleep(1)
    expect(task.status().state).toBe('blocked')
    expect(reads).toBe(0)
    task.cancel()
  })

  it('closes tool schemas even when properties is empty', async () => {
    let executions = 0
    const tool: Tool = {
      name: 'introspect', description: 'empty', parameters: { type: 'object', properties: {} },
      async execute() { executions++; return 'ran' },
    }
    const call = { content: null, tool_calls: [{ id: 'extra', type: 'function', function: { name: 'introspect', arguments: '{"unexpected":true}' } }] }
    const result = await runSubAgentLoop('system', 'task', 'id', [tool], provider, 'fake', {
      client: fakeClient([call, terminalArgs(valid)]), terminal,
    })
    expect(result.terminalResult).toEqual(valid)
    expect(executions).toBe(0)
  })

  it('enforces the runtime profile even when text or config asks for broader access', async () => {
    let executions = 0
    const writeTool: Tool = {
      name: 'write_file', description: 'write',
      parameters: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { executions++; return 'written' },
    }
    const write = (args: object, id: string) => ({
      content: null, tool_calls: [{ id, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } }],
    })
    const context = {
      sessionId: 's', taskId: 't', workspacePath: process.cwd(), projectRoot: process.cwd(),
      permissionProfile: 'researcher-readonly' as const,
    }
    const result = await runSubAgentLoop('system', 'task', 'id', [writeTool], provider, 'fake', {
      client: fakeClient([
        write({ path: 'x', content: 'x', permissionProfile: 'coordinator-integrator' }, 'elevation'),
        write({ path: 'x', content: 'x' }, 'profile-denied'),
        terminalArgs(valid),
      ]),
      terminal, context,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
    })
    expect(result.terminalResult).toEqual(valid)
    expect(executions).toBe(0)
  })

  it('enforces the task allowlist independently of role and prompt text', async () => {
    let executions = 0
    const writeTool: Tool = {
      name: 'write_file', description: 'write',
      parameters: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { executions++; return 'written' },
    }
    const toolCall = {
      content: null,
      tool_calls: [{ id: 'write', type: 'function', function: { name: 'write_file', arguments: '{"path":"x","content":"x"}' } }],
    }
    const result = await runSubAgentLoop('system', 'task', 'id', [writeTool], provider, 'fake', {
      client: fakeClient([toolCall, terminalArgs(valid)]), terminal,
      context: {
        sessionId: 's', taskId: 't', workspacePath: process.cwd(), projectRoot: process.cwd(),
        permissionProfile: 'writer-worktree', allowedTools: ['read_file'],
      },
    })
    expect(result.terminalResult).toEqual(valid)
    expect(executions).toBe(0)
  })

  it('stops once a reliable token metric exceeds the task budget', async () => {
    await expect(runSubAgentLoop('system', 'task', 'id', [], provider, 'fake', {
      client: fakeClient([terminalArgs(valid)]), terminal,
      context: { sessionId: 's', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'researcher-readonly', maxTokens: 2 },
    })).rejects.toMatchObject({ code: 'TOKEN_BUDGET_EXCEEDED' })
  })
})
