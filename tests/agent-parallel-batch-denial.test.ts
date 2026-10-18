import { expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks } from '../src/agent/agent.js'

type AgentTestSeam = {
  settings: object
  runPostToolBatchHooks: (...args: unknown[]) => Promise<void>
  openStream: (...args: unknown[]) => Promise<AsyncIterable<object>>
  checkAndExecuteTool: (...args: unknown[]) => Promise<unknown>
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>
}

function stream(chunks: object[]): AsyncIterable<object> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

it('does not execute a parallel call whose permission prompt resolves after a sibling denial', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-parallel-pending-permission-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null })
  const internal = agent as unknown as AgentTestSeam
  const firstPromptStarted = deferred<void>()
  const secondPromptStarted = deferred<void>()
  const denyFirst = deferred<'deny'>()
  const approveSecond = deferred<'once'>()
  const firstDenialObserved = deferred<void>()
  const executedUrls: string[] = []
  let requestCount = 0
  const callbacks: AgentCallbacks = {
    onToken() {},
    onToolCall() {},
    onToolResult() {},
    onDone() {},
    onDenyAbort() {},
  }

  try {
    await agent.readyPromise
    agent.interactionMode = 'build'
    internal.settings = { permissions: { allow: ['introspect'], deny: [] }, risk: { enabled: false } }
    internal.runPostToolBatchHooks = async () => {}
    internal.openStream = async () => {
      requestCount++
      if (requestCount > 1) return stream([{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }])
      return stream([{
        choices: [{
          delta: { tool_calls: [
            { index: 0, id: 'web-first', function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.com/first' }) } },
            { index: 1, id: 'web-second', function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.com/second' }) } },
          ] },
          finish_reason: 'tool_calls',
        }],
      }])
    }
    agent.setToolPermissionHandler(async request => {
      const url = String((request.args as Record<string, unknown>).url)
      if (url.endsWith('/first')) {
        firstPromptStarted.resolve()
        return denyFirst.promise
      }
      secondPromptStarted.resolve()
      return approveSecond.promise
    })
    const originalCheck = internal.checkAndExecuteTool.bind(agent)
    internal.checkAndExecuteTool = async (...args) => {
      try {
        return await originalCheck(...args)
      } catch (error) {
        if ((args[0] as { id?: string }).id === 'web-first') firstDenialObserved.resolve()
        throw error
      }
    }
    internal.executeTool = async (_name, args) => {
      executedUrls.push(String(args.url))
      return 'unexpected fetch execution'
    }

    const run = agent.run('Fetch both independent pages.', callbacks)
    await Promise.all([firstPromptStarted.promise, secondPromptStarted.promise])
    denyFirst.resolve('deny')
    await firstDenialObserved.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    approveSecond.resolve('once')
    await run

    expect(executedUrls).toEqual([])
  } finally {
    denyFirst.resolve('deny')
    approveSecond.resolve('once')
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)

async function assertPendingSiblingHookAborted(event: 'PreToolUse' | 'PermissionRequest'): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-parallel-hook-denial-'))
  const started = join(root, 'hook-started')
  const late = join(root, 'hook-late')
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null })
  const internal = agent as unknown as AgentTestSeam
  const firstPromptStarted = deferred<void>()
  const denyFirst = deferred<'deny'>()
  const firstDenialObserved = deferred<void>()
  const executedUrls: string[] = []
  let requestCount = 0
  const callbacks: AgentCallbacks = {
    onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {}, onDenyAbort() {},
  }

  try {
    await agent.readyPromise
    agent.interactionMode = 'build'
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const child = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(late)}, 'late'), 600)`
    const hook = `let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { const args = JSON.parse(input).tool_input; if (args.url.endsWith('/second')) { require('node:fs').writeFileSync(${JSON.stringify(started)}, 'started'); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' }); setTimeout(() => process.stdout.write('{}'), 2000); } else process.stdout.write('{}'); });`
    internal.settings = {
      permissions: { allow: ['introspect'], deny: [] },
      risk: { enabled: false },
      hooks: { [event]: [{ matcher: 'web_fetch', hooks: [{ type: 'command', command: `${quote(process.execPath)} -e ${quote(hook)}`, timeout: 5 }] }] },
    }
    internal.runPostToolBatchHooks = async () => {}
    internal.openStream = async () => {
      requestCount++
      if (requestCount > 1) return stream([{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }])
      return stream([{
        choices: [{
          delta: { tool_calls: [
            { index: 0, id: 'hook-first', function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.com/first' }) } },
            { index: 1, id: 'hook-second', function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.com/second' }) } },
          ] },
          finish_reason: 'tool_calls',
        }],
      }])
    }
    agent.setToolPermissionHandler(async request => {
      const url = String((request.args as Record<string, unknown>).url)
      if (url.endsWith('/first')) { firstPromptStarted.resolve(); return denyFirst.promise }
      return 'once'
    })
    const originalCheck = internal.checkAndExecuteTool.bind(agent)
    internal.checkAndExecuteTool = async (...args) => {
      try { return await originalCheck(...args) }
      catch (error) {
        if ((args[0] as { id?: string }).id === 'hook-first') firstDenialObserved.resolve()
        throw error
      }
    }
    internal.executeTool = async (_name, args) => {
      executedUrls.push(String(args.url))
      return 'unexpected fetch execution'
    }

    const run = agent.run('Fetch both independent pages.', callbacks)
    await firstPromptStarted.promise
    const deadline = Date.now() + 2_000
    while (!existsSync(started) && Date.now() < deadline) await Bun.sleep(10)
    expect(existsSync(started)).toBe(true)
    denyFirst.resolve('deny')
    await firstDenialObserved.promise
    const completedPromptly = await Promise.race([run.then(() => true), Bun.sleep(500).then(() => false)])
    expect(completedPromptly).toBe(true)
    await run
    await Bun.sleep(800)
    expect(executedUrls).toEqual([])
    expect(existsSync(late)).toBe(false)
  } finally {
    denyFirst.resolve('deny')
    agent.abort()
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
}

it.skipIf(process.platform === 'win32')('aborts a pending sibling PreToolUse hook after a parallel denial', () => assertPendingSiblingHookAborted('PreToolUse'), 15_000)

it.skipIf(process.platform === 'win32')('aborts a pending sibling PermissionRequest hook after a parallel denial', () => assertPendingSiblingHookAborted('PermissionRequest'), 15_000)

it('aborts a pending legacy confirmation after a parallel denial', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-parallel-confirm-denial-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null })
  const internal = agent as unknown as AgentTestSeam
  const firstPromptStarted = deferred<void>()
  const secondPromptStarted = deferred<void>()
  const denyFirst = deferred<boolean>()
  const approveSecond = deferred<boolean>()
  const firstDenialObserved = deferred<void>()
  let secondSignal: AbortSignal | undefined
  let promptCount = 0
  let requestCount = 0
  let executions = 0
  const callbacks: AgentCallbacks = {
    onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {}, onDenyAbort() {},
  }

  try {
    await agent.readyPromise
    agent.interactionMode = 'build'
    internal.settings = { permissions: { allow: ['introspect'], deny: [] }, risk: { enabled: false } }
    internal.runPostToolBatchHooks = async () => {}
    internal.openStream = async () => {
      requestCount++
      if (requestCount > 1) return stream([{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }])
      return stream([{
        choices: [{
          delta: { tool_calls: [
            { index: 0, id: 'confirm-first', function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.com/first' }) } },
            { index: 1, id: 'confirm-second', function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://example.com/second' }) } },
          ] },
          finish_reason: 'tool_calls',
        }],
      }])
    }
    agent.setConfirmHandler(async (_message, signal) => {
      if (promptCount++ === 0) { firstPromptStarted.resolve(); return denyFirst.promise }
      secondSignal = signal
      secondPromptStarted.resolve()
      return approveSecond.promise
    })
    const originalCheck = internal.checkAndExecuteTool.bind(agent)
    internal.checkAndExecuteTool = async (...args) => {
      try { return await originalCheck(...args) }
      catch (error) {
        if ((args[0] as { id?: string }).id === 'confirm-first') firstDenialObserved.resolve()
        throw error
      }
    }
    internal.executeTool = async () => { executions++; return 'unexpected fetch execution' }

    const run = agent.run('Fetch both independent pages.', callbacks)
    await Promise.all([firstPromptStarted.promise, secondPromptStarted.promise])
    denyFirst.resolve(false)
    await firstDenialObserved.promise
    await Bun.sleep(0)
    expect(secondSignal?.aborted).toBe(true)
    const completedPromptly = await Promise.race([run.then(() => true), Bun.sleep(500).then(() => false)])
    expect(completedPromptly).toBe(true)
    await run
    approveSecond.resolve(true)
    await Bun.sleep(0)
    expect(executions).toBe(0)
  } finally {
    denyFirst.resolve(false)
    approveSecond.resolve(true)
    agent.abort()
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)
