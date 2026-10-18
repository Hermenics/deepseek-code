import { expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'

const callbacks = {
  onToken() {},
  onThinking() {},
  onToolCall() {},
  onToolResult() {},
  onDone() {},
}

it('normalizes exceptions from the primary Agent tool boundary without losing partial data or secret redaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-error-envelope-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
    projectRoot: root,
    logFile: null,
    snapshotFile: null,
  })

  try {
    await agent.readyPromise
    const internal = agent as any
    internal.settings = { permissions: { allow: ['introspect'], deny: [] }, risk: { enabled: false } }
    const secret = 'sk-SUPERSECRETCANARY1234567890'
    const failure = Object.assign(new Error(`Remote request failed: api_key=${secret}`), {
      code: 'REMOTE_FAILURE',
      retryable: true,
      partial: { completed: 1 },
    })
    internal.executeTool = async () => { throw failure }

    const result = await internal.checkAndExecuteTool({
      id: 'primary-error-envelope-call',
      type: 'function',
      function: { name: 'introspect', arguments: '{}' },
    }, {}, callbacks)

    expect(result.result.trimStart().startsWith('{')).toBe(true)
    const envelope = JSON.parse(result.result) as {
      schemaVersion?: number
      status?: string
      error?: { kind?: string; code?: string; message?: string; retryable?: boolean }
      partial?: unknown
    }
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      status: 'partial',
      error: { kind: 'tool', code: 'REMOTE_FAILURE', retryable: true },
      partial: { completed: 1 },
    })
    expect(envelope.error?.message).toContain('api_key=[REDACTED]')
    expect(result.result).not.toContain(secret)
    expect(JSON.stringify(internal.sessionEvidence.toolSources())).not.toContain(secret)
  } finally {
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it('normalizes executor AbortError as cancellation without counting it toward repeated failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-abort-error-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
    projectRoot: root,
    logFile: null,
    snapshotFile: null,
  })

  try {
    await agent.readyPromise
    const internal = agent as any
    internal.settings = { permissions: { allow: ['introspect'], deny: [] }, risk: { enabled: false } }
    let executions = 0
    internal.executeTool = async () => {
      executions++
      if (executions === 1) throw Object.assign(new Error('The request was aborted'), { name: 'AbortError' })
      throw Object.assign(new Error('The remote fixture failed'), { code: 'REMOTE_FAILURE', retryable: true })
    }
    const call = {
      id: 'primary-abort-error-call',
      type: 'function',
      function: { name: 'introspect', arguments: '{}' },
    }

    const cancelled = await internal.checkAndExecuteTool(call, {}, callbacks)
    const firstFailure = await internal.checkAndExecuteTool(call, {}, callbacks)
    const secondFailure = await internal.checkAndExecuteTool(call, {}, callbacks)
    const thirdFailure = await internal.checkAndExecuteTool(call, {}, callbacks)
    const blocked = await internal.checkAndExecuteTool(call, {}, callbacks)

    expect(JSON.parse(cancelled.result)).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'tool', code: 'CANCELLED', retryable: false },
    })
    expect(JSON.parse(firstFailure.result).error.code).toBe('REMOTE_FAILURE')
    expect(JSON.parse(secondFailure.result).error.code).toBe('REMOTE_FAILURE')
    expect(JSON.parse(thirdFailure.result)).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'tool', code: 'REMOTE_FAILURE', retryable: true },
    })
    expect(JSON.parse(thirdFailure.result).error.message).toContain('[Repeated failure]')
    expect(JSON.parse(blocked.result).error.code).toBe('REPEATED_FAILURE_BLOCKED')
    expect(executions).toBe(4)
  } finally {
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

it('returns a typed refusal when workflow script resolution escapes the project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-resolution-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'deepseek-workflow-resolution-outside-'))
  const scriptPath = join(outside, 'workflow.js')
  await writeFile(scriptPath, 'export const meta = { name: "outside" }; return "unsafe";')
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
    projectRoot: root,
    logFile: null,
    snapshotFile: null,
  })

  try {
    await agent.readyPromise
    const internal = agent as any
    internal.settings = { permissions: { allow: ['workflow'], deny: [] }, risk: { enabled: false }, workflows: { enabled: true } }
    let executions = 0
    internal.executeTool = async () => { executions++; return 'started' }

    const result = await internal.checkAndExecuteTool({
      id: 'outside-workflow-script',
      type: 'function',
      function: { name: 'workflow', arguments: JSON.stringify({ scriptPath }) },
    }, { scriptPath }, callbacks)

    expect(JSON.parse(result.result)).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'validation', code: 'WORKFLOW_REJECTED', retryable: false },
    })
    expect(JSON.parse(result.result).error.message).toContain('Workflow rejected:')
    expect(JSON.parse(result.result).error.message).toContain('must live inside the project')
    expect(executions).toBe(0)
  } finally {
    await agent.shutdown()
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ])
  }
})

it('keeps the typed error envelope valid when the repeated-failure guard engages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-repeated-error-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
    projectRoot: root,
    logFile: null,
    snapshotFile: null,
  })

  try {
    await agent.readyPromise
    const internal = agent as any
    internal.settings = { permissions: { allow: ['introspect'], deny: [] }, risk: { enabled: false } }
    let executions = 0
    internal.executeTool = async () => {
      executions++
      throw Object.assign(new Error('The remote fixture failed'), { code: 'REMOTE_FAILURE', retryable: true, partial: { completed: executions - 1 } })
    }
    const call = {
      id: 'repeated-error-call',
      type: 'function',
      function: { name: 'introspect', arguments: '{}' },
    }

    const first = await internal.checkAndExecuteTool(call, {}, callbacks)
    const second = await internal.checkAndExecuteTool(call, {}, callbacks)
    const third = await internal.checkAndExecuteTool(call, {}, callbacks)
    const blocked = await internal.checkAndExecuteTool(call, {}, callbacks)

    expect(JSON.parse(first.result).error.code).toBe('REMOTE_FAILURE')
    expect(JSON.parse(second.result).error.code).toBe('REMOTE_FAILURE')
    expect(JSON.parse(third.result)).toMatchObject({
      schemaVersion: 1,
      status: 'partial',
      error: { kind: 'tool', code: 'REMOTE_FAILURE', retryable: true },
      partial: { completed: 2 },
    })
    expect(JSON.parse(third.result).error.message).toContain('[Repeated failure]')
    expect(JSON.parse(blocked.result)).toMatchObject({
      schemaVersion: 1,
      status: 'error',
      error: { kind: 'tool', code: 'REPEATED_FAILURE_BLOCKED', retryable: false },
    })
    expect(executions).toBe(3)
  } finally {
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})
