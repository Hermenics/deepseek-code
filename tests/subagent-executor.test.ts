import { describe, expect, it } from 'bun:test'
import type { Tool } from '../src/tools/types.js'
import { SUBAGENT_RESULT_SCHEMA } from '../src/orchestration/schema.js'
import { runSubAgentLoop } from '../src/tools/SubAgent/executor.js'
import { StructuredOutputError, validateSubAgentResult, type SubAgentResult } from '../src/tools/SubAgent/contracts.js'
import { AGGREGATE_REQUEST_BYTES, AGGREGATE_TURN_BYTES, OrchestratorSession } from '../src/orchestration/index.js'
import type { TaskEventType } from '../src/orchestration/types.js'
import { estimateCost } from '../src/agent/cost.js'
import { Agent } from '../src/agent/agent.js'
import { RecordClaim, SessionEvidenceTool } from '../src/tools/SessionEvidence/SessionEvidence.js'
import { DiscoverTools } from '../src/tools/DiscoverTools/DiscoverTools.js'
import { AGGREGATE_READ_TOOL_NAMES, CONVERSATION_MESSAGE_BYTES, nativeToolBatchFitsBudget, nativeToolResultEnvelopeBytes, TOOL_BATCH_BYTES } from '../src/agent/toolOutputBudget.js'
import { TaskRuntimeError } from '../src/orchestration/lifecycle.js'
import { redactSecrets } from '../src/orchestration/events.js'
import type { ToolErrorEnvelopeV1 } from '../src/tools/result.js'
import { MoAExecutionError } from '../src/tools/MoA/types.js'

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

function terminalArgs(value: unknown, id = 'terminal', name = 'submit_result') {
  return { content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(value) } }] }
}

const terminal = {
  name: 'submit_result' as const,
  description: 'submit',
  schema: SUBAGENT_RESULT_SCHEMA,
  maxValidationRetries: 1,
  transform: validateSubAgentResult,
}

describe('subagent terminal protocol', () => {
  it('sends typed envelopes for delegated tool preflight failures and preserves ordinary output', async () => {
    const readTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { return 'ordinary tool output' },
    }
    const gitTool: Tool = {
      name: 'git', description: 'Git',
      parameters: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
      async execute() { return 'git executed' },
    }
    const scenarios = [
      {
        name: 'malformed arguments', toolName: 'read_file', arguments: '{', tools: [readTool],
        expected: { schemaVersion: 1, status: 'error', error: { kind: 'validation', code: 'INVALID_ARGUMENTS', retryable: false } },
      },
      {
        name: 'unknown tool', toolName: 'missing_tool', arguments: '{}', tools: [readTool],
        expected: { schemaVersion: 1, status: 'error', error: { kind: 'tool', code: 'UNKNOWN_TOOL', retryable: false } },
      },
      {
        name: 'schema rejection', toolName: 'read_file', arguments: '{"path":42}', tools: [readTool],
        expected: { schemaVersion: 1, status: 'error', error: { kind: 'validation', code: 'INVALID_ARGUMENTS', retryable: false } },
      },
      {
        name: 'missing owning Git workspace', toolName: 'git', arguments: '{"action":"commit"}', tools: [gitTool],
        context: { sessionId: 'missing-git-workspace', permissionProfile: 'coordinator-integrator' },
        expected: { schemaVersion: 1, status: 'error', error: { kind: 'conflict', code: 'GIT_WORKSPACE_REQUIRED', retryable: false } },
      },
      {
        name: 'Git identity capture failure', toolName: 'git', arguments: '{"action":"commit"}', tools: [gitTool],
        context: { sessionId: 'missing-git-identity', workspacePath: '/no-such-git-workspace', projectRoot: process.cwd(), permissionProfile: 'coordinator-integrator' },
        expected: { schemaVersion: 1, status: 'error', error: { kind: 'conflict', code: 'GIT_IDENTITY_UNAVAILABLE', retryable: false } },
      },
      {
        name: 'ordinary tool output', toolName: 'read_file', arguments: '{"path":"README.md"}', tools: [readTool],
        expectedText: 'ordinary tool output',
      },
    ]

    for (const [index, scenario] of scenarios.entries()) {
      const requests: Array<Record<string, unknown>> = []
      let calls = 0
      const client = { chat: { completions: { create: async (body: Record<string, unknown>) => {
        requests.push(body)
        if (calls++ > 0) return response(terminalArgs(valid))
        return response({ content: null, tool_calls: [{
          id: `preflight-${index}`, type: 'function', function: { name: scenario.toolName, arguments: scenario.arguments },
        }] })
      } } } } as any

      const result = await runSubAgentLoop('system', 'task', `preflight-${index}`, scenario.tools, provider, 'fake', {
        client, terminal,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file', 'git'] } },
        context: scenario.context as any,
      })
      expect(result.terminalResult).toEqual(valid)
      const toolMessage = ((requests[1]!.messages as Array<Record<string, unknown>>)
        .find(message => message.role === 'tool' && message.tool_call_id === `preflight-${index}`))!
      if (scenario.expectedText !== undefined) {
        expect(toolMessage.content).toBe(scenario.expectedText)
      } else {
        expect(JSON.parse(String(toolMessage.content))).toMatchObject(scenario.expected)
      }
    }
  })

  it('rejects an oversized complete conversation before dispatching to the provider', async () => {
    let calls = 0
    const client = { chat: { completions: { create: async () => { calls++; return response({ content: 'unexpected' }) } } } } as any
    await expect(runSubAgentLoop('system', 'x'.repeat(CONVERSATION_MESSAGE_BYTES), 'oversized-conversation', [], provider, 'fake', { client }))
      .rejects.toThrow('serialized provider request exceeds the 4 MiB UTF-8 limit')
    expect(calls).toBe(0)
  })

  it('reserves the final serialized request before dispatch even without token or cost limits', async () => {
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const existing = await session.registry.acquireAggregateBudget('turn')
    if (!existing) throw new Error('Expected the default aggregate request-byte budget')
    existing.reserveRequestBytes(AGGREGATE_REQUEST_BYTES - 1)
    existing.release()
    let calls = 0
    const client = { chat: { completions: { create: async () => { calls++; return response({ content: 'unexpected' }) } } } } as any

    try {
      await expect(runSubAgentLoop('system', 'task', 'byte-budget', [], provider, 'fake', {
        client, context: session.toolContext({ budgetGroupId: 'turn' }),
      })).rejects.toMatchObject({ code: 'AGGREGATE_REQUEST_BYTES_EXCEEDED' })
      expect(calls).toBe(0)
    } finally {
      await session.shutdown()
    }
  })

  it('charges shared read outputs before history append and blocks later effects on rejection', async () => {
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const groupId = 'shared-captured-output'
    const acceptedOutput = 'é'
    const requestHeadroom = 64 * 1024
    const recordOutputBytes = session.registry.recordAggregateOutputBytes.bind(session.registry)
    expect(recordOutputBytes(groupId, AGGREGATE_TURN_BYTES - requestHeadroom)).toBe(true)
    let outputCalls = 0
    session.registry.recordAggregateOutputBytes = (id, bytes) => {
      if (id === groupId && outputCalls++ === 1) return false
      return recordOutputBytes(id, bytes)
    }
    const artifactId = '123e4567-e89b-42d3-a456-426614174000'
    let reads = 0
    let effects = 0
    const oversizedRead = JSON.stringify({ outputId: artifactId, content: 'secret captured output '.repeat(4_000) })
    const tools: Tool[] = [
      { name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } } }, async execute(args) { reads++; return args.path === 'first' ? acceptedOutput : oversizedRead } },
      { name: 'custom_effect', description: 'effect', parameters: { type: 'object', properties: {} }, async execute() { effects++; return 'effect ran' } },
    ]
    expect(AGGREGATE_READ_TOOL_NAMES.has('shell')).toBe(false)
    const requests: Array<Record<string, unknown>> = []
    let calls = 0
    const client = { chat: { completions: { create: async (body: Record<string, unknown>) => {
      requests.push(body)
      if (calls++ > 0) return response(terminalArgs(valid))
      return response({ content: null, tool_calls: [
        { id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"first"}' } },
        { id: 'large-read', type: 'function', function: { name: 'read_file', arguments: '{"path":"large"}' } },
        { id: 'effect', type: 'function', function: { name: 'custom_effect', arguments: '{}' } },
      ] })
    } } } } as any

    try {
      const result = await runSubAgentLoop('system', 'task', 'shared-output', tools, provider, 'fake', {
        client, terminal,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file', 'custom_effect'] } },
        context: session.toolContext({ budgetGroupId: groupId }),
      })
      expect(result.terminalResult).toEqual(valid)
      expect(reads).toBe(2)
      expect(effects).toBe(0)
      const returnedMessages = requests[1]!.messages as Array<Record<string, unknown>>
      expect(returnedMessages.find(message => message.tool_call_id === 'read')?.content).toBe(acceptedOutput)
      const rejectedRead = JSON.parse(String(returnedMessages.find(message => message.tool_call_id === 'large-read')?.content))
      expect(rejectedRead).toMatchObject({
        schemaVersion: 1, status: 'partial', error: { code: 'AGGREGATE_OUTPUT_BYTES_EXCEEDED' },
        partial: { outputOmitted: true, outputId: artifactId },
      })
      expect(returnedMessages.find(message => message.tool_call_id === 'effect')?.content).toContain('AGGREGATE_OUTPUT_BYTES_EXCEEDED')
      expect(JSON.stringify(returnedMessages)).not.toContain('secret captured output')
    } finally {
      await session.shutdown()
    }
  })

  it('charges delegated custom and MCP results cumulatively', async () => {
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const groupId = 'shared-custom-mcp-output'
    const tools: Tool[] = ['custom_result', 'mcp_result'].map(name => ({
      name, description: 'Return a short result', parameters: { type: 'object', properties: {} },
      async execute() { return name === 'custom_result' ? 'custom' : 'mcp' },
    }))
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const context = session.toolContext({ budgetGroupId: groupId })
    context.emit = (type, payload) => events.push({ type, payload })
    let calls = 0
    const client = { chat: { completions: { create: async (body: Record<string, unknown>) => {
      if (calls++ > 0) return response(terminalArgs(valid))
      const requestBytes = Buffer.byteLength(JSON.stringify(body), 'utf8')
      expect(session.registry.recordAggregateOutputBytes(groupId, AGGREGATE_TURN_BYTES - requestBytes - 7)).toBe(true)
      return response({ content: null, tool_calls: [
        { id: 'custom', type: 'function', function: { name: 'custom_result', arguments: '{}' } },
        { id: 'mcp', type: 'function', function: { name: 'mcp_result', arguments: '{}' } },
      ] })
    } } } } as any

    try {
      await expect(runSubAgentLoop('system', 'task', 'custom-mcp-output', tools, provider, 'fake', {
        client, terminal, context,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['custom_result', 'mcp_result'] } },
      })).rejects.toMatchObject({ code: 'AGGREGATE_REQUEST_BYTES_EXCEEDED' })
      expect(calls).toBe(1)
      const results = events.filter(event => event.type === 'tool_finished').map(event => event.payload.result)
      expect(results[0]).toBe('custom')
      expect(results[1]).toContain('AGGREGATE_OUTPUT_BYTES_EXCEEDED')
    } finally {
      await session.shutdown()
    }
  })

  it('does not charge detached Shell handles again after Shell source accounting', async () => {
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const groupId = 'shared-detached-shell-output'
    const handle = JSON.stringify({ taskId: 'background-shell-task', type: 'shell', state: 'running' })
    const shell: Tool = {
      name: 'shell', description: 'Start a detached Shell task', parameters: { type: 'object', properties: { background: { type: 'boolean' } } },
      async execute(_args, context) {
        if (!context?.session?.registry.recordAggregateOutputBytes(context.budgetGroupId, 8)) throw new Error('source output accounting failed')
        return handle
      },
    }
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const context = session.toolContext({ budgetGroupId: groupId })
    context.emit = (type, payload) => events.push({ type, payload })
    let calls = 0
    const client = { chat: { completions: { create: async (body: Record<string, unknown>) => {
      if (calls++ > 0) return response(terminalArgs(valid))
      const requestBytes = Buffer.byteLength(JSON.stringify(body), 'utf8')
      expect(session.registry.recordAggregateOutputBytes(groupId, AGGREGATE_TURN_BYTES - requestBytes - 8)).toBe(true)
      return response({ content: null, tool_calls: [{ id: 'shell', type: 'function', function: { name: 'shell', arguments: '{"background":true}' } }] })
    } } } } as any

    try {
      await expect(runSubAgentLoop('system', 'task', 'detached-shell-output', [shell], provider, 'fake', {
        client, terminal, context,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['shell'] } },
      })).rejects.toMatchObject({ code: 'AGGREGATE_REQUEST_BYTES_EXCEEDED' })
      expect(calls).toBe(1)
      expect(events.find(event => event.type === 'tool_finished')?.payload.result).toBe(handle)
    } finally {
      await session.shutdown()
    }
  })

  it('rejects an oversized serialized provider message before emitting or interpreting it', async () => {
    const emitted: string[] = []
    const context = {
      sessionId: 'oversized-response', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'researcher-readonly',
      emit: (type: string) => emitted.push(type),
    } as any
    const client = { chat: { completions: { create: async () => response({ content: 'x'.repeat(CONVERSATION_MESSAGE_BYTES) }) } } } as any

    await expect(runSubAgentLoop('system', 'task', 'oversized-response', [], provider, 'fake', { client, context }))
      .rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' })
    expect(emitted).not.toContain('subagent_message')
  })

  it('keeps aggregated raw output within its serialized UTF-8 cap on terminal failures', async () => {
    const output = 'é'.repeat(1_100_000)
    let calls = 0
    const client = { chat: { completions: { create: async () => response({ content: calls++ < 2 ? output : null }) } } } as any
    let caught: StructuredOutputError | undefined
    try {
      await runSubAgentLoop('system', 'task', 'bounded-raw', [], provider, 'fake', { client, terminal })
    } catch (error) {
      caught = error as StructuredOutputError
    }

    expect(caught).toBeInstanceOf(StructuredOutputError)
    expect(caught?.rawOutput).toContain('[Subagent raw output truncated at the 4 MiB serialized UTF-8 limit.]')
    expect(Buffer.byteLength(JSON.stringify(caught?.rawOutput), 'utf8')).toBeLessThanOrEqual(CONVERSATION_MESSAGE_BYTES)
  })

  it('rejects an oversized delegated tool schema before dispatching to the provider', async () => {
    let calls = 0
    const client = { chat: { completions: { create: async () => { calls++; return response({ content: 'unexpected' }) } } } } as any
    const tool: Tool = {
      name: 'large_schema', description: 'Large schema fixture',
      parameters: { type: 'object', description: 'x'.repeat(CONVERSATION_MESSAGE_BYTES) },
      async execute() { return 'unexpected' },
    }

    await expect(runSubAgentLoop('system', 'short task', 'oversized-schema', [tool], provider, 'fake', { client }))
      .rejects.toThrow('serialized provider request exceeds the 4 MiB UTF-8 limit')
    expect(calls).toBe(0)
  })

  it('rejects schema and executor mutations between validation and journal execution', async () => {
    for (const changeExecutor of [false, true]) {
      let executions = 0
      const tool: Tool = { name: 'read_file', description: 'Read fixture', parameters: { type: 'object', properties: { path: { type: 'string' } } }, execute: async () => { executions++; return 'started' } }
      const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
      session.executeJournaled = async (_name, _args, execute) => {
        if (changeExecutor) tool.execute = async () => { executions++; return 'replacement' }
        else (tool.parameters as any).properties.path.type = 'number'
        return execute()
      }
      const emitted: Array<Record<string, unknown>> = []
      const context = session.toolContext({ permissionProfile: 'researcher-readonly' })
      context.emit = (_type, payload) => { emitted.push(payload) }
      const result = await runSubAgentLoop('system', 'task', `contract-${changeExecutor}`, [tool], provider, 'fake', {
        client: fakeClient([{ content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }, terminalArgs(valid)]), terminal,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file'] } }, context,
      })
      expect(result.terminalResult).toEqual(valid)
      expect(executions).toBe(0)
      expect(emitted.some(event => String(event.result).includes('schema or executor changed during authorization'))).toBe(true)
    }
  })

  it('bounds long structured tool output, recovers redacted source from child evidence, and scopes discovery', async () => {
    const secret = 'sk-SUPERSECRETCANARY1234567890'
    const source = JSON.stringify({ api_key: secret, payload: 'é'.repeat(55_000) })
    let requestCount = 0
    let evidenceId = ''
    let nextStart: number | null = null
    let recovered = ''
    let discoveryResult = ''
    const providerBodies: Array<Record<string, unknown>> = []
    const emitted: Array<Record<string, unknown>> = []
    const longRead: Tool = {
      name: 'read_file', description: 'Read source files',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { return source },
    }
    const client = { chat: { completions: { create: async (body: Record<string, unknown>) => {
      providerBodies.push(body)
      const messages = body.messages as Array<Record<string, any>>
      const discovery = messages.find(message => message.role === 'tool' && message.tool_call_id === 'discover')
      if (discovery) discoveryResult = String(discovery.content)
      const boundedSource = messages.find(message => message.role === 'tool' && message.tool_call_id === 'long-read')
      if (boundedSource && !evidenceId) {
        expect(Buffer.byteLength(JSON.stringify(boundedSource))).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
        const marker = String(boundedSource.content).match(/\[Session evidence: ([a-f0-9-]{36})\]/i)
        expect(marker).not.toBeNull()
        evidenceId = marker![1]!
      }
      const recovery = [...messages].reverse().find(message => message.role === 'tool' && String(message.tool_call_id).startsWith('recover-'))
      if (recovery) {
        const envelope = JSON.parse(String(recovery.content)) as { text: string; next: number | null }
        recovered += envelope.text
        nextStart = envelope.next
        if (nextStart === null) return response({ content: 'Recovered complete source.' })
        return response({ content: null, tool_calls: [{ id: `recover-${requestCount}`, type: 'function', function: { name: 'session_evidence', arguments: JSON.stringify({ id: evidenceId, start_char: nextStart, max_chars: 20_000 }) } }] })
      }
      if (requestCount++ === 0) return response({ content: null, tool_calls: [{ id: 'discover', type: 'function', function: { name: 'discover_tools', arguments: '{"query":"read source"}' } }] })
      if (requestCount === 2) return response({ content: null, tool_calls: [{ id: 'long-read', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/large.json"}' } }] })
      const bounded = messages.find(message => message.role === 'tool' && message.tool_call_id === 'long-read')
      const marker = String(bounded?.content).match(/\[Session evidence: ([a-f0-9-]{36})\]/i)
      evidenceId = marker?.[1] ?? ''
      return response({ content: null, tool_calls: [{ id: `recover-${requestCount}`, type: 'function', function: { name: 'session_evidence', arguments: JSON.stringify({ id: evidenceId, start_char: 0, max_chars: 20_000 }) } }] })
    } } } } as any
    const context = {
      sessionId: 'child-scope', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'researcher-readonly',
      allowedTools: ['read_file', 'session_evidence', 'discover_tools'],
      readSessionEvidence: () => 'PARENT_LEDGER_CANARY',
      discoverTools: () => 'PARENT_TOOL_CATALOG_CANARY',
      emit: (_type: string, payload: Record<string, unknown>) => emitted.push(payload),
    } as any
    const result = await runSubAgentLoop('child system', 'inspect the oversized JSON safely', 'child-1',
      [longRead, SessionEvidenceTool, DiscoverTools], provider, 'fake', {
        client, context,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file', 'session_evidence', 'discover_tools'] } },
      })
    expect(result.resultText).toBe('Recovered complete source.')
    expect(Buffer.byteLength(source)).toBeGreaterThan(TOOL_BATCH_BYTES)
    expect(discoveryResult).not.toContain('PARENT_TOOL_CATALOG_CANARY')
    expect(JSON.parse(discoveryResult).matches.map((tool: Tool) => tool.name)).toContain('read_file')
    expect(recovered).toContain('"payload":"' + 'é'.repeat(100))
    expect(recovered).toContain('[REDACTED]')
    expect(recovered).not.toContain(secret)
    expect(providerBodies.map(body => JSON.stringify(body.messages)).join('\n')).not.toContain('PARENT_LEDGER_CANARY')
    expect(providerBodies.map(body => JSON.stringify(body.messages)).join('\n')).not.toContain(secret)
    expect(JSON.stringify(emitted)).not.toContain(secret)
  })

  it('applies the serialized byte cap after short-secret redaction expands content', async () => {
    const source = JSON.stringify({ rows: Array.from({ length: 2_600 }, () => ({ token: 'x' })) })
    const redactedSource = redactSecrets(source) as string
    expect(Buffer.byteLength(source)).toBeLessThan(TOOL_BATCH_BYTES)
    expect(Buffer.byteLength(redactedSource)).toBeGreaterThan(TOOL_BATCH_BYTES)
    const bodies: Array<Record<string, unknown>> = []
    let calls = 0
    const readTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { return source },
    }
    const client = { chat: { completions: { create: async (body: Record<string, unknown>) => {
      bodies.push(body)
      if (calls++ === 0) return response({ content: null, tool_calls: [{ id: 'expanded', type: 'function', function: { name: 'read_file', arguments: '{"path":"data.json"}' } }] })
      const messages = body.messages as Array<Record<string, any>>
      const toolMessage = messages.find(message => message.role === 'tool' && message.tool_call_id === 'expanded')
      expect(toolMessage).toBeTruthy()
      if (!toolMessage) throw new Error('Expected provider-visible tool result')
      expect(Buffer.byteLength(JSON.stringify(toolMessage))).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
      expect(String(toolMessage.content)).toContain('[Session evidence:')
      return response({ content: 'done' })
    } } } } as any
    const result = await runSubAgentLoop('system', 'inspect JSON', 'expanded-output', [readTool], provider, 'fake', {
      client,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file'] } },
      context: { sessionId: 'expanded', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'researcher-readonly' } as any,
    })
    expect(result.resultText).toBe('done')
    expect(bodies).toHaveLength(2)
  })

  it('rejects an oversized mutating tool batch before any delegated tool executes', async () => {
    let executions = 0
    const writeTool: Tool = {
      name: 'write_file', description: 'write a file',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { executions++; return 'written' },
    }
    const firstArguments = JSON.stringify({ path: 'first.txt', content: 'x'.repeat(20_000) })
    const secondArguments = JSON.stringify({ path: 'second.txt', content: 'y'.repeat(20_000) })
    const calls = [{ id: 'first-write', arguments: firstArguments }, { id: 'second-write', arguments: secondArguments }]
    expect(calls.every(call => Buffer.byteLength(call.arguments, 'utf8') + nativeToolResultEnvelopeBytes([call.id]) <= TOOL_BATCH_BYTES)).toBe(true)
    expect(calls.reduce((total, call) => total + Buffer.byteLength(call.arguments, 'utf8'), 0) + nativeToolResultEnvelopeBytes(calls.map(call => call.id)))
      .toBeGreaterThan(TOOL_BATCH_BYTES)

    let failure: unknown
    try {
      await runSubAgentLoop('system', 'write two files', 'oversized-write-batch', [writeTool], provider, 'fake', {
        client: fakeClient([{
          content: null,
          tool_calls: [
            { id: 'first-write', type: 'function', function: { name: 'write_file', arguments: firstArguments } },
            { id: 'second-write', type: 'function', function: { name: 'write_file', arguments: secondArguments } },
          ],
        }]),
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(TaskRuntimeError)
    expect(failure).toMatchObject({ code: 'TOOL_BATCH_TOO_LARGE' })
    expect((failure as Error).message.length).toBeLessThan(200)
    expect(executions).toBe(0)
  })

  it('rejects a delegated mutating call whose redacted arguments exceed the batch budget', async () => {
    let executions = 0
    const writeTool: Tool = {
      name: 'write_file', description: 'write a file',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { executions++; return 'written' },
    }
    const argumentsJson = JSON.stringify({ path: 'secret-expansion.txt', content: 'token=x;'.repeat(2_400) })
    const redactedArguments = redactSecrets(argumentsJson) as string
    expect(Buffer.byteLength(argumentsJson, 'utf8')).toBeLessThan(TOOL_BATCH_BYTES)
    expect(Buffer.byteLength(redactedArguments, 'utf8') + nativeToolResultEnvelopeBytes(['redacted-write']))
      .toBeGreaterThan(TOOL_BATCH_BYTES)

    let failure: unknown
    try {
      await runSubAgentLoop('system', 'write the file', 'redacted-write-batch', [writeTool], provider, 'fake', {
        client: fakeClient([{
          content: null,
          tool_calls: [{ id: 'redacted-write', type: 'function', function: { name: 'write_file', arguments: argumentsJson } }],
        }]),
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(TaskRuntimeError)
    expect(failure).toMatchObject({ code: 'TOOL_BATCH_TOO_LARGE' })
    expect(executions).toBe(0)
  })

  it('rejects a delegated mutating call when serialized call metadata plus result envelopes exceed the batch budget', async () => {
    let executions = 0
    const writeTool: Tool = {
      name: 'write_file', description: 'write a file',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { executions++; return 'written' },
    }
    const call = {
      id: 'i'.repeat(20_000),
      type: 'function' as const,
      function: { name: 'write_file', arguments: JSON.stringify({ path: 'must-not-exist.txt', content: 'must not be written' }) },
    }
    const serializedCallBytes = Buffer.byteLength(JSON.stringify(redactSecrets([call]))!, 'utf8')
    const resultEnvelopeBytes = nativeToolResultEnvelopeBytes([call.id])
    expect(Buffer.byteLength(call.function.arguments, 'utf8') + resultEnvelopeBytes).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
    expect(serializedCallBytes + resultEnvelopeBytes).toBeGreaterThan(TOOL_BATCH_BYTES)

    let failure: unknown
    try {
      await runSubAgentLoop('system', 'write the file', 'metadata-heavy-write', [writeTool], provider, 'fake', {
        client: fakeClient([{ content: null, tool_calls: [call] }]),
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(TaskRuntimeError)
    expect(failure).toMatchObject({ code: 'TOOL_BATCH_TOO_LARGE' })
    expect(executions).toBe(0)
  })

  it('rejects a mixed custom and mutating batch when the complete serialized call payload exceeds the budget', async () => {
    let executions = 0
    const writeTool: Tool = {
      name: 'write_file', description: 'write a file',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { executions++; return 'written' },
    }
    const writeCall = {
      id: 'small-write',
      type: 'function' as const,
      function: { name: 'write_file', arguments: JSON.stringify({ path: 'must-not-exist.txt', content: 'small write' }) },
    }
    const customCall = {
      id: 'large-custom',
      type: 'custom' as const,
      custom: { name: 'custom_op', input: 'x'.repeat(40_800) },
    }
    const calls = [writeCall, customCall]
    const emptyResultEnvelopeBytes = nativeToolResultEnvelopeBytes(calls.map(call => call.id))
    const fullRedactedCallBytes = Buffer.byteLength(JSON.stringify(redactSecrets(calls)), 'utf8')

    expect(Buffer.byteLength(writeCall.function.arguments, 'utf8') + emptyResultEnvelopeBytes).toBeLessThanOrEqual(TOOL_BATCH_BYTES)
    expect(fullRedactedCallBytes + emptyResultEnvelopeBytes).toBeGreaterThan(TOOL_BATCH_BYTES)

    let failure: unknown
    try {
      await runSubAgentLoop('system', 'write the file', 'custom-call-budget', [writeTool], provider, 'fake', {
        client: fakeClient([{ content: null, tool_calls: calls }]),
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
      })
    } catch (error) {
      failure = error
    }

    expect(executions).toBe(0)
    expect(failure).toBeInstanceOf(TaskRuntimeError)
    expect(failure).toMatchObject({ code: 'TOOL_BATCH_TOO_LARGE' })
  })

  it('rejects a delegated redacted aggregate that exceeds the budget before either call executes', async () => {
    let executions = 0
    const writeTool: Tool = {
      name: 'write_file', description: 'write a file',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { executions++; return 'written' },
    }
    const calls = [
      { id: 'redacted-first', type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify({ path: 'first.txt', content: 'token=x;'.repeat(1_400) }) } },
      { id: 'redacted-second', type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify({ path: 'second.txt', content: 'token=y;'.repeat(1_400) }) } },
    ]
    for (const call of calls) {
      expect(nativeToolBatchFitsBudget([call])).toBe(true)
    }
    expect(nativeToolBatchFitsBudget(calls)).toBe(false)

    let failure: unknown
    try {
      await runSubAgentLoop('system', 'write two files', 'redacted-aggregate-write-batch', [writeTool], provider, 'fake', {
        client: fakeClient([{
          content: null,
          tool_calls: calls.map((call, index) => ({
            id: call.id,
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: index === 0 ? 'first.txt' : 'second.txt', content: `${index === 0 ? 'token=x;' : 'token=y;'}`.repeat(1_400) }) },
          })),
        }]),
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(TaskRuntimeError)
    expect(failure).toMatchObject({ code: 'TOOL_BATCH_TOO_LARGE' })
    expect((failure as Error).message.length).toBeLessThan(200)
    expect(executions).toBe(0)
  })

  it('sends typed partial tool failures to delegated models', async () => {
    const bodies: Array<Record<string, any>> = []
    let calls = 0
    const partial = {
      references: [{
        candidateId: 'candidate-1', model: 'candidate-a', provider: 'deepseek', status: 'done' as const,
        response: 'candidate answer', attempts: 1, usageAvailable: true, costAvailable: false, durationMs: 12,
      }],
    }
    const failedTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { throw new MoAExecutionError('AGGREGATOR_FAILED', 'Aggregator failed: unavailable', partial) },
    }
    const client = { chat: { completions: { create: async (body: Record<string, any>) => {
      bodies.push(body)
      if (calls++ === 0) return response({ content: null, tool_calls: [{ id: 'missing', type: 'function', function: { name: 'read_file', arguments: '{"path":"missing.txt"}' } }] })
      const toolMessage = (body.messages as Array<Record<string, any>>).find(message => message.role === 'tool' && message.tool_call_id === 'missing')
      expect(toolMessage).toBeTruthy()
      if (!toolMessage) throw new Error('Expected provider-visible tool result')
      expect(JSON.parse(String(toolMessage.content))).toEqual({
        schemaVersion: 1,
        status: 'partial',
        error: { kind: 'tool', code: 'AGGREGATOR_FAILED', message: 'Aggregator failed: unavailable', retryable: false },
        partial,
      } satisfies ToolErrorEnvelopeV1)
      return response(terminalArgs(valid))
    } } } } as any

    const result = await runSubAgentLoop('system', 'inspect the file', 'typed-tool-error', [failedTool], provider, 'fake', {
      client,
      terminal,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file'] } },
      context: { sessionId: 'typed-tool-error', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'researcher-readonly' } as any,
    })
    expect(result.terminalResult).toEqual(valid)
    expect(bodies).toHaveLength(2)
  })

  it('sends foreground Shell exception state and recovery IDs to delegated models', async () => {
    const bodies: Array<Record<string, any>> = []
    let calls = 0
    const outputId = '123e4567-e89b-42d3-a456-426614174000'
    const failedTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { throw Object.assign(new Error(`Command exited with code 7. Recover output with shell output_id="${outputId}".`), { code: 'SHELL_EXIT' }) },
    }
    const client = { chat: { completions: { create: async (body: Record<string, any>) => {
      bodies.push(body)
      if (calls++ === 0) return response({ content: null, tool_calls: [{ id: 'shell-failure', type: 'function', function: { name: 'read_file', arguments: '{"path":"fixture"}' } }] })
      const toolMessage = (body.messages as Array<Record<string, any>>).find(message => message.role === 'tool' && message.tool_call_id === 'shell-failure')
      expect(toolMessage).toBeTruthy()
      if (!toolMessage) throw new Error('Expected provider-visible tool result')
      expect(JSON.parse(String(toolMessage.content))).toMatchObject({
        schemaVersion: 1,
        status: 'partial',
        error: { code: 'SHELL_EXIT', retryable: false },
        partial: { state: 'failed', exitCode: 7, outputId },
      })
      return response(terminalArgs(valid))
    } } } } as any

    const result = await runSubAgentLoop('system', 'inspect the command result', 'typed-shell-error', [failedTool], provider, 'fake', {
      client,
      terminal,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file'] } },
      context: { sessionId: 'typed-shell-error', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'researcher-readonly' } as any,
    })
    expect(result.terminalResult).toEqual(valid)
    expect(bodies).toHaveLength(2)
  })

  it('normalizes composite success:false results before sending them to delegated models', async () => {
    const bodies: Array<Record<string, any>> = []
    let calls = 0
    const failure = {
      success: false,
      goal: { objective: 'Finish the task.', status: 'active' },
      verification: { complete: false, reason: 'A required criterion is unverified.' },
      message: 'Continue working and retry after collecting evidence.',
    }
    const failedTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { return JSON.stringify(failure) },
    }
    const client = { chat: { completions: { create: async (body: Record<string, any>) => {
      bodies.push(body)
      if (calls++ === 0) return response({ content: null, tool_calls: [{ id: 'composite', type: 'function', function: { name: 'read_file', arguments: '{"path":"missing.txt"}' } }] })
      const toolMessage = (body.messages as Array<Record<string, any>>).find(message => message.role === 'tool' && message.tool_call_id === 'composite')
      expect(toolMessage).toBeTruthy()
      if (!toolMessage) throw new Error('Expected provider-visible tool result')
      expect(JSON.parse(String(toolMessage.content))).toEqual({
        schemaVersion: 1,
        status: 'partial',
        error: { kind: 'tool', code: 'TOOL_ERROR', message: failure.message, retryable: false },
        partial: { goal: failure.goal, verification: failure.verification, message: failure.message },
      } satisfies ToolErrorEnvelopeV1)
      return response(terminalArgs(valid))
    } } } } as any

    const result = await runSubAgentLoop('system', 'inspect the file', 'typed-composite-failure', [failedTool], provider, 'fake', {
      client,
      terminal,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file'] } },
      context: { sessionId: 'typed-composite-failure', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'researcher-readonly' } as any,
    })
    expect(result.terminalResult).toEqual(valid)
    expect(bodies).toHaveLength(2)
  })

  it('stops a context-less loop after the default elapsed-time limit', async () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now
    const client = { chat: { completions: { create: async () => {
      now = 120_000
      return response({ content: null, tool_calls: [{ id: 'loop', type: 'function', function: { name: 'unknown', arguments: '{}' } }] })
    } } } } as any
    try {
      await expect(runSubAgentLoop('system', 'task', 'id', [], provider, 'fake', { client }))
        .rejects.toMatchObject({ code: 'TIMED_OUT' })
    } finally {
      Date.now = originalNow
    }
  })

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

  it('supports a workflow-defined terminal schema with five correction attempts', async () => {
    const workflowTerminal = {
      name: 'submit_workflow_result', description: 'submit workflow result', maxValidationRetries: 5,
      schema: { type: 'object', additionalProperties: false, properties: { answer: { type: 'number' } }, required: ['answer'] },
    }
    const messages = Array.from({ length: 5 }, (_, index) => terminalArgs({}, `bad-${index}`, workflowTerminal.name))
    messages.push(terminalArgs({ answer: 42 }, 'good', workflowTerminal.name))
    const result = await runSubAgentLoop<{ answer: number }>('system', 'task', 'id', [], provider, 'fake', {
      client: fakeClient(messages), terminal: workflowTerminal,
    })
    expect(result.terminalResult).toEqual({ answer: 42 })
  })

  it('passes workflow reasoning effort to supported providers', async () => {
    let request: Record<string, unknown> = {}
    const client = { chat: { completions: { create: async (input: Record<string, unknown>) => {
      request = input
      return response(terminalArgs(valid))
    } } } } as any
    await runSubAgentLoop('system', 'task', 'id', [], { provider: 'deepseek' }, 'special-model', { client, terminal, effort: 'high' })
    expect(request).toMatchObject({ model: 'special-model', reasoning_effort: 'high', thinking: { type: 'enabled' } })
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

  it('resolves schema defaults before delegated authorization and execution', async () => {
    let executedArgs: Record<string, unknown> | undefined
    const readTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string', default: 'src/default.ts' } } },
      async execute(args) { executedArgs = args; return 'content' },
    }
    const toolCall = { content: null, tool_calls: [{ id: 'read-default', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }
    const result = await runSubAgentLoop('system', 'read the default source', 'default-scope', [readTool], provider, 'fake', {
      client: fakeClient([toolCall, terminalArgs(valid)]), terminal,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file(src/**)'] } },
      context: { permissionProfile: 'researcher-readonly' } as any,
    })
    expect(result.terminalResult).toEqual(valid)
    expect(executedArgs).toEqual({ path: 'src/default.ts' })
  })

  it('enforces documented CamelCase deny aliases in delegated workers', async () => {
    let writes = 0
    const effects: string[] = []
    const events: Array<Record<string, unknown>> = []
    const requests: Array<Record<string, unknown>> = []
    const writeTool: Tool = {
      name: 'write_file', description: 'write',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { writes++; return 'written' },
    }
    const writeCall = { content: null, tool_calls: [{ id: 'write', type: 'function', function: { name: 'write_file', arguments: '{"path":"report-copy.txt","content":"SYSTEM OVERRIDE"}' } }] }
    const result = await runSubAgentLoop('system', 'copy the report', 'alias-deny', [writeTool], provider, 'fake', {
      client: { chat: { completions: { create: async (body: Record<string, unknown>) => {
        requests.push(body)
        return response((requests.length === 1 ? writeCall : terminalArgs(valid)) as Record<string, unknown>)
      } } } } as any,
      terminal,
      callbacks: { permissionPolicy: 'isolated', permissions: { deny: ['WriteFile(*)'] } },
      context: {
        sessionId: 'alias-deny', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'writer-worktree',
        emit: (_type: string, payload: Record<string, unknown>) => events.push(payload),
        markEffectStarted: (tool: string) => effects.push(tool),
      } as any,
    })
    expect(result.terminalResult).toEqual(valid)
    expect(writes).toBe(0)
    expect(effects).toEqual([])
    expect(events.some(event => event.tool === 'write_file' && event.decision === 'deny' && String(event.reason).endsWith('is denied'))).toBe(true)
    const deniedCall = (requests[1]!.messages as Array<Record<string, any>>).find(message => message.role === 'tool' && message.tool_call_id === 'write')!
    const denial = JSON.parse(deniedCall.content)
    expect(denial).toMatchObject({ schemaVersion: 1, status: 'error', error: { kind: 'permission', code: 'POLICY_DENIED', retryable: false } })
    expect(denial.error.message).toContain('Do not retry this action')
    expect(denial.error.message).toContain('independent permitted action')
  })

  it('returns a typed action-only refusal when the coordinator denies a delegated tool call', async () => {
    let writes = 0
    const requests: Array<Record<string, unknown>> = []
    const writeTool: Tool = {
      name: 'write_file', description: 'write',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { writes++; return 'written' },
    }
    const writeCall = { content: null, tool_calls: [{ id: 'user-denied-write', type: 'function', function: { name: 'write_file', arguments: '{"path":"denied.txt","content":"must not be written"}' } }] }
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    session.requestToolPermission = async (): Promise<'allow' | 'deny'> => 'deny'
    try {
      const result = await runSubAgentLoop('system', 'write the requested file', 'user-denied-write', [writeTool], provider, 'fake', {
        client: { chat: { completions: { create: async (body: Record<string, unknown>) => {
          requests.push(body)
          return response((requests.length === 1 ? writeCall : terminalArgs(valid)) as Record<string, unknown>)
        } } } } as any,
        terminal,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['introspect'] } },
        context: session.toolContext({ permissionProfile: 'writer-worktree' }),
      })
      expect(result.terminalResult).toEqual(valid)
      expect(writes).toBe(0)
      const deniedCall = (requests[1]!.messages as Array<Record<string, any>>).find(message => message.role === 'tool' && message.tool_call_id === 'user-denied-write')!
      const denial = JSON.parse(deniedCall.content)
      expect(denial).toMatchObject({ schemaVersion: 1, status: 'error', error: { kind: 'permission', code: 'USER_DENIED', retryable: false } })
      expect(denial.error.message).toContain('Do not retry it')
      expect(denial.error.message).toContain('continue with an independent permitted action')
    } finally { await session.shutdown() }
  })

  it('marks an authorized delegated side effect immediately before execution', async () => {
    const effects: string[] = []
    const writeTool: Tool = {
      name: 'write_file', description: 'write',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute() { return 'written' },
    }
    const writeCall = { content: null, tool_calls: [{ id: 'write', type: 'function', function: { name: 'write_file', arguments: '{"path":"report.txt","content":"ok"}' } }] }

    const result = await runSubAgentLoop('system', 'write a report', 'effect-marker', [writeTool], provider, 'fake', {
      client: fakeClient([writeCall, terminalArgs(valid)]), terminal,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file'] } },
      context: {
        sessionId: 'effect-marker', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'writer-worktree',
        markEffectStarted: (tool: string) => effects.push(tool),
      } as any,
    })

    expect(result.terminalResult).toEqual(valid)
    expect(effects).toEqual(['write_file'])
  })

  it('does not mark read-only Git calls or saved Shell-output reads as effects', async () => {
    const marked: string[] = []
    const receivedIds: Array<string | undefined> = []
    const gitTool: Tool = {
      name: 'git', description: 'Git',
      parameters: {
        type: 'object', properties: {
          action: { type: 'string' }, create: { type: 'string' }, switch: { type: 'string' }, output_id: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
          operations: { type: 'array', items: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] } },
        }, required: ['action'],
      },
      async execute(_args, context) { receivedIds.push(context?.effectId); return 'read' },
    }
    const shellTool: Tool = {
      name: 'shell', description: 'Saved Shell output',
      parameters: { type: 'object', properties: { command: { type: 'string' }, output_id: { type: 'string' }, max_chars: { type: 'number' } } },
      async execute(_args, context) { receivedIds.push(context?.effectId); return 'saved output' },
    }
    const calls = [
      ['git-status', 'git', { action: 'status' }],
      ['git-diff', 'git', { action: 'diff' }],
      ['git-log', 'git', { action: 'log' }],
      ['git-branches', 'git', { action: 'branch' }],
      ['git-batch', 'git', { action: 'batch', operations: [{ action: 'status' }, { action: 'diff' }] }],
      ['shell-output', 'shell', { output_id: '123e4567-e89b-42d3-a456-426614174000', max_chars: 512 }],
      ['git-add', 'git', { action: 'add', files: ['src/example.ts'] }],
    ] as const
    const result = await runSubAgentLoop('system', 'inspect the repository and saved output', 'read-effects', [gitTool, shellTool], provider, 'fake', {
      client: fakeClient([
        { content: null, tool_calls: calls.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })) },
        terminalArgs(valid),
      ]),
      terminal,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['git', 'shell'] } },
      context: {
        sessionId: 'read-effects', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'coordinator-integrator',
        markEffectStarted: (tool: string) => { marked.push(tool); return `effect-${marked.length}` },
      } as any,
    })

    expect(result.terminalResult).toEqual(valid)
    expect(marked).toEqual(['git'])
    expect(receivedIds).toEqual([...Array(calls.length - 1).fill(undefined), 'effect-1'])
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
    const task = session.spawn({ taskId: 'permission-task', maxRetries: 0, effectPolicy: 'tool-gated' }, async runContext => runSubAgentLoop(
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
    const task = session.spawn({ taskId: 'grant-task', maxRetries: 0, effectPolicy: 'tool-gated' }, async runContext => runSubAgentLoop(
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

  it('retains a child-scoped denial source across a blocked task retry', async () => {
    const readTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { return 'read result' },
    }
    const bodies: Array<Record<string, unknown>> = []
    let calls = 0
    let denialDetailSeen = false
    const client = { chat: { completions: { create: async (body: Record<string, unknown>) => {
      bodies.push(body)
      const messages = body.messages as Array<Record<string, any>>
      calls++
      if (calls === 1) return response({ content: null, tool_calls: [{ id: 'read-once', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] })
      if (calls === 2) return response({ content: null, tool_calls: [{ id: 'evidence-index', type: 'function', function: { name: 'session_evidence', arguments: '{}' } }] })
      if (calls === 3) {
        const indexMessage = messages.find(message => message.role === 'tool' && message.tool_call_id === 'evidence-index')
        const denialId = String(indexMessage?.content).match(/([a-f0-9-]{36}) denial read_file/)?.[1]
        expect(denialId).toBeTruthy()
        return response({ content: null, tool_calls: [{ id: 'denial-detail', type: 'function', function: { name: 'session_evidence', arguments: JSON.stringify({ id: denialId }) } }] })
      }
      denialDetailSeen = JSON.stringify(messages).includes('requires coordinator permission')
      return response(terminalArgs(valid))
    } } } } as any
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const task = session.spawn({ taskId: 'evidence-retry', maxRetries: 0, effectPolicy: 'tool-gated' }, async runContext => runSubAgentLoop(
      'system', 'preserve the review constraint', runContext.taskId, [readTool, SessionEvidenceTool], provider, 'fake', {
        client, terminal,
        callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['write_file', 'session_evidence'] } },
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
    expect(bodies).toHaveLength(4)
    expect(denialDetailSeen).toBe(true)
    await session.shutdown()
  })

  it('does not reuse a coordinator grant for different arguments', async () => {
    let reads = 0
    const readTool: Tool = {
      name: 'read_file', description: 'read',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute() { reads++; return 'content' },
    }
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const task = session.spawn({ taskId: 'scoped-grant', maxRetries: 0, effectPolicy: 'tool-gated' }, async runContext => {
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

  it('keeps a current policy denial mandatory despite an earlier coordinator grant', async () => {
    let denied = false, reads = 0
    const readTool: Tool = { name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, async execute() { reads++; return 'content' } }
    const readCall = { content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    const task = session.spawn({ taskId: 'revoked-grant', maxRetries: 0, effectPolicy: 'tool-gated' }, async runContext => runSubAgentLoop('system', 'task', runContext.taskId, [readTool], provider, 'fake', {
      client: fakeClient([readCall, terminalArgs(valid)]), terminal,
      callbacks: { permissionPolicy: 'isolated', permissions: denied ? { deny: ['read_file'] } : { allow: ['write_file'] } },
      context: session.toolContext({ taskId: runContext.taskId, signal: runContext.signal, permissionProfile: 'researcher-readonly' }),
    }))
    const completion = task.awaitResult()
    for (let index = 0; index < 100 && task.status().state !== 'blocked'; index++) await Bun.sleep(1)
    expect(task.status().state).toBe('blocked')
    const request = session.registry.mailbox.list('coordinator', 'pending')[0]!
    session.registry.sendMessage(task.taskId, 'permission', { decision: 'allow', tool: 'read_file', requestId: request.messageId })
    denied = true
    expect(task.resume()).toBe(true)
    expect((await completion).status).toBe('done')
    expect(reads).toBe(0)
    await session.shutdown()
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
    /** Fake write tool that records its arguments. */
    const write = (args: object, id: string) => ({
      content: null, tool_calls: [{ id, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } }],
    })
    /** Minimal read-only execution context. */
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
    const bodies: Array<Record<string, unknown>> = []
    const client = { chat: { completions: { create: async (body: Record<string, unknown>) => { bodies.push(body); return response(terminalArgs(valid)) } } } } as any
    await expect(runSubAgentLoop('system', 'task', 'id', [], provider, 'fake', {
      client, terminal,
      context: { sessionId: 's', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'researcher-readonly', maxTokens: 2 },
    })).rejects.toMatchObject({ code: 'TOKEN_BUDGET_EXCEEDED' })
    expect(bodies[0]!.max_tokens).toBe(2)
  })

  it('fails a token-limited worker closed when the provider omits usage', async () => {
    const session = new OrchestratorSession({ sessionId: 'unmetered-token', projectRoot: process.cwd() })
    const task = session.spawn({ taskId: 'unmetered-token-task', maxTokens: 100, maxRetries: 0 }, context => runSubAgentLoop(
      'system', 'inspect with a token limit', context.taskId, [], provider, 'fake', {
        client: { chat: { completions: { create: async () => ({ choices: [{ message: terminalArgs(valid) }] }) } } } as any,
        terminal,
        context: session.toolContext({ taskId: context.taskId, budgetGroupId: context.budgetGroupId, signal: context.signal, maxTokens: context.maxTokens, permissionProfile: 'researcher-readonly' }),
      },
    ))
    const result = await task.awaitResult()
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('TOKEN_BUDGET_UNAVAILABLE')
    expect(result.metrics).toMatchObject({ tokens: 0, usageAvailable: false })
    await session.shutdown()
  })

  it('emits cumulative token_progress after every LLM completion', async () => {
    const emitted: Array<{ type: TaskEventType; payload: Record<string, unknown> }> = []
    const context = {
      sessionId: 's', taskId: 't', workspacePath: process.cwd(), projectRoot: process.cwd(),
      permissionProfile: 'researcher-readonly' as const,
      emit: (type: TaskEventType, payload: Record<string, unknown>) => emitted.push({ type, payload }),
    }
    const unknownToolCall = { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'nope', arguments: '{}' } }] }
    const result = await runSubAgentLoop('system', 'task', 'id', [], provider, 'fake', {
      client: fakeClient([unknownToolCall, terminalArgs(valid)]), terminal, context,
    })
    expect(result.totalTokens).toBe(6)
    expect(emitted.filter(event => event.type === 'token_progress'))
      .toEqual([
        { type: 'token_progress', payload: { tokens: 3 } },
        { type: 'token_progress', payload: { tokens: 6 } },
      ])
  })

  it('drains mailbox questions into the conversation and emits subagent_message', async () => {
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>(resolve => { releaseFirst = resolve })
    let calls = 0
    const captured: Array<{ messages: unknown[] }> = []
    const client = { chat: { completions: { create: async (input: Record<string, unknown>) => {
      calls++
      captured.push(input as { messages: unknown[] })
      if (calls === 1) await gate
      return calls === 1 ? response({ content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'nope', arguments: '{}' } }] }) : response(terminalArgs(valid))
    } } } } as any
    const task = session.spawn({ taskId: 'drain-task', maxRetries: 0 }, async runContext => runSubAgentLoop(
      'system', 'task', runContext.taskId, [], provider, 'fake', {
        client, terminal,
        context: session.toolContext({ taskId: runContext.taskId, signal: runContext.signal }),
      },
    ))
    // Wait for the first completion to be in flight, then post a question.
    for (let index = 0; index < 100 && calls < 1; index++) await Bun.sleep(1)
    session.registry.sendMessage(task.taskId, 'question', { text: 'hello' })
    releaseFirst()
    expect((await task.awaitResult()).status).toBe('done')

    // The second completion's prompt includes the drained user message.
    expect(captured[1]!.messages).toContainEqual({ role: 'user', content: 'hello' })
    // The mailbox entry is acknowledged.
    expect(session.registry.mailbox.list(task.taskId, 'processed').some(message => message.type === 'question')).toBe(true)
    // The drained user message is NOT re-emitted as a subagent_message: the
    // focused-subagent UI already shows it via an optimistic append in App.tsx,
    // so re-emitting here would duplicate the transcript row.
    expect(session.events.list(task.taskId).some(event =>
      event.type === 'subagent_message' && event.payload.role === 'user' && event.payload.content === 'hello')).toBe(false)
  })

  it('drains a question arriving during a final completion instead of returning', async () => {
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>(resolve => { releaseFirst = resolve })
    let calls = 0
    const captured: Array<{ messages: unknown[] }> = []
    const client = { chat: { completions: { create: async (input: Record<string, unknown>) => {
      calls++
      captured.push(input as { messages: unknown[] })
      if (calls === 1) await gate
      // The first completion already holds a valid terminal result, but a
      // question arriving mid-completion must force the loop to continue (and
      // re-complete) instead of returning and dropping the user's message.
      return response(terminalArgs(valid))
    } } } } as any
    const task = session.spawn({ taskId: 'drain-final-task', maxRetries: 0 }, async runContext => runSubAgentLoop(
      'system', 'task', runContext.taskId, [], provider, 'fake', {
        client, terminal,
        context: session.toolContext({ taskId: runContext.taskId, signal: runContext.signal }),
      },
    ))
    for (let index = 0; index < 100 && calls < 1; index++) await Bun.sleep(1)
    session.registry.sendMessage(task.taskId, 'question', { text: 'late' })
    releaseFirst()
    expect((await task.awaitResult()).status).toBe('done')

    // The loop ran a second completion (it did NOT return after the first one).
    expect(calls).toBeGreaterThanOrEqual(2)
    // The late question reached the second completion's prompt.
    expect(captured[1]!.messages).toContainEqual({ role: 'user', content: 'late' })
  })
})

describe('subagent cost', () => {
  const usage = { total_tokens: 1_500_000, prompt_tokens: 1_000_000, prompt_cache_hit_tokens: 400_000, completion_tokens: 500_000 }
  const deepseekProvider = { provider: 'deepseek' as const, baseURL: 'https://api.deepseek.com' }
  /** Client that answers with a valid terminal result and a large priced usage, recording each request body. */
  const pricedClient = (bodies: Array<Record<string, unknown>> = []) => ({
    chat: { completions: { create: async (body: Record<string, unknown>) => { bodies.push(body); return { choices: [{ message: terminalArgs(valid) }], usage } } } },
  }) as any
  /** Read-only execution context, extended with task-specific fields. */
  const context = (extra: Record<string, unknown> = {}) => ({
    sessionId: 's', workspacePath: process.cwd(), projectRoot: process.cwd(), permissionProfile: 'researcher-readonly' as const, ...extra,
  })

  it('prices the full usage with the shared cost table', async () => {
    const result = await runSubAgentLoop('system', 'task', 'id', [], deepseekProvider, 'deepseek-flash', { client: pricedClient(), terminal })
    const expected = estimateCost('deepseek-flash', { promptTokens: 1_000_000, cachedTokens: 400_000, completionTokens: 500_000 })
    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.costUsd).toBeCloseTo(expected, 8)
  })

  it('stops a subagent that goes over maxCostUsd and records what it spent', async () => {
    const session = new OrchestratorSession({ sessionId: 'cost', projectRoot: process.cwd() })
    session.registry.spawn({ taskId: 'cost-task', maxCostUsd: 0.01 }, async () => 'unused')
    await session.registry.awaitIdle()
    const record = { taskId: 'cost-task' }
    await expect(runSubAgentLoop('system', 'task', 'id', [], deepseekProvider, 'deepseek-flash', {
      client: pricedClient(), terminal,
      context: context({ maxCostUsd: 0.01, taskId: record.taskId, session }),
    })).rejects.toMatchObject({ code: 'COST_BUDGET_EXCEEDED' })
    expect(session.registry.getStatus(record.taskId).metrics.costUsd).toBeGreaterThan(0.01)
  })

  it('fails closed when a cost-limited worker receives tokens without priceable usage details', async () => {
    const session = new OrchestratorSession({ sessionId: 'unpriced-usage', projectRoot: process.cwd() })
    const task = session.spawn({ taskId: 'unpriced-task', maxCostUsd: 5, maxRetries: 0 }, context => runSubAgentLoop(
      'system', 'inspect with a cost limit', context.taskId, [], deepseekProvider, 'deepseek-flash', {
        client: { chat: { completions: { create: async () => ({ choices: [{ message: terminalArgs(valid) }], usage: { total_tokens: 9 } }) } } } as any,
        terminal,
        context: session.toolContext({ taskId: context.taskId, budgetGroupId: context.budgetGroupId, signal: context.signal, maxCostUsd: context.maxCostUsd, permissionProfile: 'researcher-readonly' }),
      },
    ))
    const result = await task.awaitResult()
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('COST_BUDGET_UNAVAILABLE')
    expect(result.metrics).toMatchObject({ tokens: 9, usageAvailable: true, costAvailable: false })
    await session.shutdown()
  })

  it('refuses a cost budget before calling a provider without a verified model rate', async () => {
    let calls = 0
    await expect(runSubAgentLoop('system', 'task', 'id', [], { provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test.json' }, 'deepseek-ai/deepseek-r1', {
      client: { chat: { completions: { create: async () => { calls++; return { choices: [{ message: terminalArgs(valid) }], usage } } } } } as any,
      terminal,
      context: context({ maxCostUsd: 5 }),
    })).rejects.toMatchObject({ code: 'COST_BUDGET_UNAVAILABLE' })
    expect(calls).toBe(0)
  })

  it('refuses an aggregate cost budget before calling a provider without a verified model rate', async () => {
    let calls = 0
    const session = new OrchestratorSession({ sessionId: 'vendor-budget', projectRoot: process.cwd(), limits: { maxAggregateCostUsd: 5 } })
    const task = session.registry.spawn({ taskId: 'vendor-budget-task' }, async () => 'unused')
    await task.awaitResult()
    const record = session.registry.getStatus(task.taskId)
    await expect(runSubAgentLoop('system', 'task', task.taskId, [], { provider: 'vertex', gcpProject: 'test', gcpLocation: 'global', gcpCredentials: '/tmp/test.json' }, 'deepseek-ai/deepseek-r1', {
      client: { chat: { completions: { create: async () => { calls++; return { choices: [{ message: terminalArgs(valid) }], usage } } } } } as any,
      terminal,
      context: session.toolContext({ taskId: task.taskId, budgetGroupId: record.budgetGroupId, permissionProfile: 'researcher-readonly' }),
    })).rejects.toMatchObject({ code: 'COST_BUDGET_UNAVAILABLE' })
    expect(calls).toBe(0)
    await session.shutdown()
  })

  it('stays under a generous maxCostUsd', async () => {
    const result = await runSubAgentLoop('system', 'task', 'id', [], deepseekProvider, 'deepseek-flash', { client: pricedClient(), terminal, context: context({ maxCostUsd: 10 }) })
    expect(result.terminalResult).toEqual(valid)
  })

  it('uses finite provider output ceilings and preserves the smaller low-effort limit', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const deepseek = { ...deepseekProvider, apiKey: 'test' }
    await runSubAgentLoop('system', 'task', 'id', [], deepseek, 'deepseek-flash', { client: pricedClient(bodies), terminal })
    await runSubAgentLoop('system', 'task', 'id', [], deepseek, 'deepseek-flash', { client: pricedClient(bodies), terminal, effort: 'low' })
    await runSubAgentLoop('system', 'task', 'id', [], provider, 'fake', { client: pricedClient(bodies), terminal })
    expect(bodies.map((b) => b.max_tokens)).toEqual([32768, 8192, 32768])
  })

  it('adds subagent spend to the parent session cost', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key-for-unit-tests', baseURL: 'https://api.deepseek.com' }, { logFile: null, snapshotFile: null })
    await agent.readyPromise.catch(() => {})
    const before = agent.getSessionStats().costUsd
    const events = (agent as unknown as { orchestrator: OrchestratorSession }).orchestrator.events
    events.emit('metrics_updated', { metrics: { tokens: 10, costUsd: 0.2, costAvailable: true } }, 'task-a')
    events.emit('metrics_updated', { metrics: { tokens: 20, costUsd: 0.3, costAvailable: true } }, 'task-a')
    events.emit('metrics_updated', { metrics: { tokens: 5, costUsd: 0.05, costAvailable: true } }, 'task-b')
    expect(agent.getSessionStats().costUsd).toBeCloseTo(before + 0.35, 8)
    await agent.shutdown()
  })

  it('labels parent cost as partial when a subagent response cannot be priced', async () => {
    const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key-for-unit-tests', baseURL: 'https://api.deepseek.com' }, { logFile: null, snapshotFile: null })
    await agent.readyPromise.catch(() => {})
    const events = (agent as unknown as { orchestrator: OrchestratorSession }).orchestrator.events
    events.emit('metrics_updated', { metrics: { tokens: 9, costUsd: 0, costAvailable: false } }, 'unpriced-task')
    expect(agent.getCostSummary()).toContain('partial subtotal')
    expect(agent.getSessionStats().subagentCostAvailable).toBe(false)
    await agent.shutdown()
  })

  it('retains measured worker usage from failed attempts in the final task metrics', async () => {
    const session = new OrchestratorSession({ sessionId: 'retry-usage', projectRoot: process.cwd(), limits: { retryBackoffMs: 0 } })
    let calls = 0
    let transforms = 0
    const client = { chat: { completions: { create: async () => {
      calls++
      const promptTokens = calls === 1 ? 7 : 13
      const completionTokens = calls === 1 ? 3 : 7
      return { choices: [{ message: terminalArgs(valid) }], usage: { total_tokens: promptTokens + completionTokens, prompt_tokens: promptTokens, completion_tokens: completionTokens } }
    } } } } as any
    const task = session.spawn({ taskId: 'metered-retry', maxRetries: 1, effectPolicy: 'tool-gated' }, context => runSubAgentLoop(
      'system', 'retry after a metered response', 'metered-retry', [], provider, 'deepseek-flash', {
        client,
        context: session.toolContext({ taskId: context.taskId, budgetGroupId: context.budgetGroupId, signal: context.signal, maxTokens: context.maxTokens, maxCostUsd: context.maxCostUsd, permissionProfile: 'researcher-readonly' }),
        terminal: {
          ...terminal,
          transform: value => {
            if (transforms++ === 0) throw Object.assign(new Error('transient after metered response'), { retryable: true })
            return validateSubAgentResult(value)
          },
        },
      },
    ))

    const result = await task.awaitResult()
    expect(result.status).toBe('done')
    expect(calls).toBe(2)
    expect(result.metrics).toMatchObject({
      tokens: 30,
      promptTokens: 20,
      completionTokens: 10,
      usageAvailable: true,
    })
    await session.shutdown()
  })
})


it('records worker claims in its own ledger and exposes their current state to its next request', async () => {
  const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null })
  const context = session.toolContext({ permissionProfile: 'researcher-readonly' })
  context.recordSessionClaim = () => { throw new Error('Parent ledger must not be used') }
  let calls = 0
  let hypothesis = ''
  let source = ''
  const client = { chat: { completions: { create: async (body: any) => {
    calls++
    const messages = body.messages as Array<Record<string, any>>
    if (calls === 1) return response(terminalArgs({ statement: 'The cache is enabled.', status: 'hypothesis', evidence: [] }, 'hypothesis', 'record_claim'))
    if (calls === 2) {
      hypothesis = JSON.parse(messages.find(message => message.tool_call_id === 'hypothesis')!.content).id
      expect(messages.some(message => String(message.content).includes(`hypothesis ${hypothesis}`))).toBe(true)
      return response(terminalArgs({}, 'index', 'session_evidence'))
    }
    if (calls === 3) {
      const index = JSON.parse(messages.find(message => message.tool_call_id === 'index')!.content)
      source = index.text.match(/([a-f0-9-]{36}) request subagent-task/)![1]
      return response(terminalArgs({ statement: 'The cache is enabled.', status: 'refuted', supersedes: hypothesis, evidence: [{ id: source, excerpt: 'The cache is disabled.' }] }, 'refutation', 'record_claim'))
    }
    expect(messages.some(message => String(message.content).includes('Claim ledger: 1 current model-authored claims'))).toBe(true)
    expect(messages.some(message => String(message.content).includes('refuted '))).toBe(true)
    return response(terminalArgs(valid))
  } } } } as any
  try {
    const result = await runSubAgentLoop('system', 'The cache is disabled.', 'claim-worker', [RecordClaim, SessionEvidenceTool], provider, 'fake', {
      client, terminal, context,
      callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['record_claim', 'session_evidence'] } },
    })
    expect(result.terminalResult).toEqual(valid)
    expect(calls).toBe(4)
  } finally { await session.shutdown() }
})
