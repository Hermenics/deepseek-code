import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import type { WebAgent } from '../src/web/bridge.js'
import { WebBridge } from '../src/web/bridge.js'
import { parseClientCommand, type ServerEvent } from '../src/web/protocol.js'
import { isLocalHost, startWebServer } from '../src/web/server.js'
import { changeStaging, commitStaged, getSourceControl } from '../src/web/sourceControl.js'
import { addTodo, clearTodos } from '../src/agent/todoStore.js'
import { allTools } from '../src/tools/index.js'
import { printLines, printOutput } from './platform-commands.js'

const fakeStats = { tokenCount: 1234, promptTokens: 900, completionTokens: 334, cachedTokens: 400, contextUsage: 21_000, contextLimit: 128_000, toolCalls: 3, filesModified: 2, costUsd: 0.0042 }

const fakeAgent: WebAgent = {
  abort() {},
  getToolInfo: () => [{ name: 'read_file', description: 'Read a file from the workspace.' }],
  getSessionStats: () => ({ ...fakeStats }),
  async run(_userMessage, cb) {
    cb.onPhaseChange?.('executing')
    cb.onToken?.('olá')
    cb.onToken?.(' mundo')
    cb.onToolCall?.('read_file', { path: '/tmp/x' })
    cb.onToolResult?.('read_file', 'conteúdo', { path: '/tmp/x' })
    cb.onDone?.()
  },
}

function startTestServer() {
  return startWebServer({
    agent: fakeAgent,
    sessionId: 'test-session',
    model: 'deepseek-v4-flash',
    cwd: '/tmp',
    port: 0,
  })
}

describe('web server', () => {
  test('serves the page with a valid token and rejects an invalid one', async () => {
    const server = startTestServer()
    try {
      const ok = await fetch(server.url)
      expect(ok.status).toBe(200)
      expect(await ok.text()).toContain('DeepSeek Code')
      expect(ok.headers.get('content-security-policy')).toContain("default-src 'none'")
      expect(ok.headers.get('x-content-type-options')).toBe('nosniff')

      const favicon = await fetch(`http://127.0.0.1:${server.port}/favicon.svg?token=${server.token}`)
      expect(favicon.status).toBe(200)
      expect(favicon.headers.get('content-type')).toContain('image/svg+xml')
      expect(await favicon.text()).toContain('#4d6bfe')

      const app = await fetch(`http://127.0.0.1:${server.port}/app.js?token=${server.token}`)
      expect(app.status).toBe(200)
      const appSource = await app.text()
      expect(appSource).toContain('aria-label="Source Control"')
      expect(appSource).toContain('Live trace')
      expect(appSource).toContain('Connection lost. Retrying')
      expect(appSource).toContain('terminal_replay')
      expect(appSource).toContain('Filter available tools')
      expect(appSource).toContain('Stage all')
      expect(appSource).toContain('Commit staged changes')
      expect(appSource).toContain('Tool inspector')
      expect(appSource).toContain('Last signal')
      expect(appSource).toContain('tool-card-head')
      expect(appSource).toContain('Agent todos')
      expect(appSource).toContain('Telemetry')
      expect(appSource).toContain('renderInlineDiff')
      expect(appSource).toContain('Show full output')
      expect(() => new Function(appSource)).not.toThrow()

      const [xtermJs, xtermCss] = await Promise.all([
        fetch(`http://127.0.0.1:${server.port}/xterm.js?token=${server.token}`),
        fetch(`http://127.0.0.1:${server.port}/xterm.css?token=${server.token}`),
      ])
      expect(xtermJs.status).toBe(200)
      expect(await xtermJs.text()).toContain('Terminal')
      expect(xtermCss.status).toBe(200)
      expect(await xtermCss.text()).toContain('.xterm')

      const styles = await fetch(`http://127.0.0.1:${server.port}/app.css?token=${server.token}`)
      const stylesText = await styles.text()
      expect(stylesText).toContain('.nav-button svg, .project-glyph svg, .branch svg')
      expect(stylesText).toContain('.content { display: grid;')
      expect(stylesText).toContain('.context-resizer')
      expect(stylesText).toContain('white-space: pre-wrap')
      expect(stylesText).toContain('.changes-view.active { display: grid; }')

      const noToken = await fetch(`http://127.0.0.1:${server.port}/`)
      expect(noToken.status).toBe(403)
    } finally {
      server.stop()
    }
  })

  test('streams run events over websocket', async () => {
    const server = startTestServer()
    const events: unknown[] = []
    let socket: WebSocket | undefined
    try {
      socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
      const received = await new Promise<unknown[]>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 5000)
        socket!.onerror = () => {
          clearTimeout(timeout)
          reject(new Error('ws error'))
        }
        socket!.onmessage = (event) => {
          const parsed = JSON.parse(String(event.data))
          events.push(parsed)
          if ((parsed as { type?: string }).type === 'done') {
            clearTimeout(timeout)
            resolve(events)
          }
        }
        socket!.onopen = () => socket!.send(JSON.stringify({ type: 'run', prompt: 'test' }))
      })

      const types = received.map((event) => (event as { type?: string }).type)
      expect(types[0]).toBe('hello')
      expect((received[0] as { tools?: Array<{ name: string; description: string }> }).tools).toEqual([{ name: 'read_file', description: 'Read a file from the workspace.' }])
      expect(types).toContain('token')
      expect(types).toContain('tool_call')
      expect(types).toContain('tool_result')
      expect(types).toContain('done')
    } finally {
      socket?.close()
      server.stop()
    }
  })

  test('replays agent events missed during a websocket disconnect', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const agent: WebAgent = {
      abort() {},
      async run(_prompt, cb) {
        cb.onToken?.('before disconnect')
        await gate
        cb.onToken?.('after disconnect')
        cb.onDone?.()
      },
    }
    const server = startWebServer({ agent, sessionId: 'replay-session', model: 'deepseek-v4-flash', cwd: '/tmp', port: 0 })
    let first: WebSocket | undefined
    let second: WebSocket | undefined
    try {
      const before = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('pre-disconnect timeout')), 5000)
        first = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        first.onerror = () => { clearTimeout(timeout); reject(new Error('pre-disconnect websocket error')) }
        first.onopen = () => first!.send(JSON.stringify({ type: 'run', prompt: 'replay me' }))
        first.onmessage = (event) => {
          const data = JSON.parse(String(event.data)) as { type?: string; seq?: number }
          if (data.type === 'token' && data.seq) {
            clearTimeout(timeout)
            resolve(data.seq)
            first!.close()
            release()
          }
        }
      })

      const replayed = await new Promise<string[]>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('replay timeout')), 5000)
        const received: string[] = []
        second = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        second.onerror = () => { clearTimeout(timeout); reject(new Error('replay websocket error')) }
        second.onopen = () => second!.send(JSON.stringify({ type: 'resume', since: before }))
        second.onmessage = (event) => {
          const data = JSON.parse(String(event.data)) as { type?: string; text?: string }
          if (data.type === 'token' && data.text) received.push(data.text)
          if (data.type === 'done') { clearTimeout(timeout); resolve(received) }
        }
      })
      expect(replayed).toEqual(['after disconnect'])
    } finally {
      release()
      first?.close()
      second?.close()
      server.stop()
    }
  })

  test('streams every built-in and dynamically loaded runtime tool', async () => {
    const runtimeTools = [
      ...allTools.map((tool) => ({ name: tool.name, description: tool.description })),
      { name: 'mcp_project_status', description: 'A project MCP tool.' },
    ]
    const agent: WebAgent = {
      abort() {},
      getToolInfo: () => runtimeTools,
      async run(_userMessage, cb) {
        for (const tool of runtimeTools) {
          cb.onToolCall(tool.name, {})
          cb.onToolResult(tool.name, 'ok', {})
        }
        cb.onDone()
      },
    }
    const server = startWebServer({ agent, sessionId: 'tool-stream', model: 'deepseek-v4-flash', cwd: '/tmp', port: 0 })
    let socket: WebSocket | undefined
    try {
      const events = await new Promise<Array<{ type: string; name?: string }>>((resolve, reject) => {
        const received: Array<{ type: string; name?: string }> = []
        const timeout = setTimeout(() => reject(new Error('tool stream timeout')), 5000)
        socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        socket.onopen = () => socket!.send(JSON.stringify({ type: 'run', prompt: 'test every tool' }))
        socket.onerror = () => { clearTimeout(timeout); reject(new Error('tool stream websocket error')) }
        socket.onmessage = (event) => {
          const parsed = JSON.parse(String(event.data)) as { type: string; name?: string }
          received.push(parsed)
          if (parsed.type === 'done') { clearTimeout(timeout); resolve(received) }
        }
      })
      expect(events[0]?.type).toBe('hello')
      expect(events.filter((event) => event.type === 'tool_call').map((event) => event.name)).toEqual(runtimeTools.map((tool) => tool.name))
      expect(events.filter((event) => event.type === 'tool_result').map((event) => event.name)).toEqual(runtimeTools.map((tool) => tool.name))
    } finally {
      socket?.close()
      server.stop()
    }
  })

  test('streams every built-in and dynamically loaded runtime tool', async () => {
    const runtimeTools = [
      ...allTools.map((tool) => ({ name: tool.name, description: tool.description })),
      { name: 'mcp_project_status', description: 'A project MCP tool.' },
    ]
    const agent: WebAgent = {
      abort() {},
      getToolInfo: () => runtimeTools,
      async run(_userMessage, cb) {
        for (const tool of runtimeTools) {
          cb.onToolCall(tool.name, {})
          cb.onToolResult(tool.name, 'ok', {})
        }
        cb.onDone()
      },
    }
    const server = startWebServer({ agent, sessionId: 'tool-stream', model: 'deepseek-v4-flash', cwd: '/tmp', port: 0 })
    let socket: WebSocket | undefined
    try {
      const events = await new Promise<Array<{ type: string; name?: string }>>((resolve, reject) => {
        const received: Array<{ type: string; name?: string }> = []
        const timeout = setTimeout(() => reject(new Error('tool stream timeout')), 5000)
        socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        socket.onopen = () => socket!.send(JSON.stringify({ type: 'run', prompt: 'test every tool' }))
        socket.onerror = () => { clearTimeout(timeout); reject(new Error('tool stream websocket error')) }
        socket.onmessage = (event) => {
          const parsed = JSON.parse(String(event.data)) as { type: string; name?: string }
          received.push(parsed)
          if (parsed.type === 'done') { clearTimeout(timeout); resolve(received) }
        }
      })
      expect(events.find((event) => event.type === 'hello')?.type).toBe('hello')
      expect(events.filter((event) => event.type === 'tool_call').map((event) => event.name)).toEqual(runtimeTools.map((tool) => tool.name))
      expect(events.filter((event) => event.type === 'tool_result').map((event) => event.name)).toEqual(runtimeTools.map((tool) => tool.name))
    } finally {
      socket?.close()
      server.stop()
    }
  })

  test('rejects websocket upgrade without a valid token', async () => {
    const server = startTestServer()
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=wrong`)
      const closed = await new Promise<boolean>((resolve) => {
        socket.onclose = () => resolve(true)
        socket.onopen = () => resolve(false)
        socket.onerror = () => {}
      })
      expect(closed).toBe(true)
      socket.close()
    } finally {
      server.stop()
    }
  })

  test('streams session stats and agent todos', async () => {
    const server = startTestServer()
    let socket: WebSocket | undefined
    try {
      clearTodos()
      const received = await new Promise<ServerEvent[]>((resolve, reject) => {
        const events: ServerEvent[] = []
        const timeout = setTimeout(() => reject(new Error('timeout')), 5000)
        socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        socket.onerror = () => { clearTimeout(timeout); reject(new Error('ws error')) }
        socket.onopen = () => {
          socket!.send(JSON.stringify({ type: 'run', prompt: 'test' }))
          addTodo('Map the web GUI')
          addTodo('Harden the server')
        }
        socket.onmessage = (event) => {
          const parsed = JSON.parse(String(event.data)) as ServerEvent
          events.push(parsed)
          const hasHello = events.some((item) => item.type === 'hello')
          const hasDone = events.some((item) => item.type === 'done')
          const hasTodos = events.some((item) => item.type === 'todos' && item.items.length === 2)
          // stats arrive after tool_result, done, and the run's finally block.
          const statsCount = events.filter((item) => item.type === 'stats').length
          if (hasHello && hasDone && hasTodos && statsCount >= 3) {
            clearTimeout(timeout)
            resolve(events)
          }
        }
      })
      const hello = received.find((event) => event.type === 'hello')
      expect(hello?.type === 'hello' && hello.stats.tokenCount).toBe(fakeStats.tokenCount)
      expect(received.some((event) => event.type === 'done')).toBe(true)
      const stats = received.filter((event) => event.type === 'stats')
      expect(stats.length).toBeGreaterThanOrEqual(2)
      expect(received.some((event) => event.type === 'todos' && event.items.length === 1)).toBe(true)
      const todos = received.filter((event) => event.type === 'todos').at(-1)
      expect(todos?.type === 'todos' && todos.items.map((item) => item.title)).toEqual(['Map the web GUI', 'Harden the server'])
    } finally {
      clearTodos()
      socket?.close()
      server.stop()
    }
  })

  test('only accepts loopback host headers', () => {
    expect(isLocalHost(`127.0.0.1:4321`, 4321)).toBe(true)
    expect(isLocalHost(`localhost:4321`, 4321)).toBe(true)
    expect(isLocalHost(`[::1]:4321`, 4321)).toBe(true)
    expect(isLocalHost('evil.example:4321', 4321)).toBe(false)
    expect(isLocalHost('127.0.0.1.evil.example:4321', 4321)).toBe(false)
    expect(isLocalHost(null, 4321)).toBe(false)
    expect(isLocalHost('127.0.0.1:9999', 4321)).toBe(false)
  })

  test('ignores oversized websocket messages without dropping the connection', async () => {
    const server = startTestServer()
    let socket: WebSocket | undefined
    try {
      const done = await new Promise<boolean>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 5000)
        socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        socket.onerror = () => { clearTimeout(timeout); reject(new Error('ws error')) }
        socket.onopen = () => {
          socket!.send(JSON.stringify({ type: 'terminal_input', data: 'x'.repeat(1_100_000) }))
          socket!.send(JSON.stringify({ type: 'run', prompt: 'still alive' }))
        }
        socket.onmessage = (event) => {
          const parsed = JSON.parse(String(event.data)) as { type?: string }
          if (parsed.type === 'done') { clearTimeout(timeout); resolve(true) }
        }
      })
      expect(done).toBe(true)
    } finally {
      socket?.close()
      server.stop()
    }
  })

  test('runs a persistent terminal PTY through the socket', async () => {
    const server = startTestServer()
    let socket: WebSocket | undefined
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('terminal timeout')), 5000)
        socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        let received = ''
        socket.onopen = () => {
          socket!.send(JSON.stringify({ type: 'terminal_open', cols: 80, rows: 24 }))
          socket!.send(JSON.stringify({ type: 'terminal_input', data: `${printOutput('web-terminal-ok ✓')}\r` }))
        }
        socket.onerror = () => { clearTimeout(timeout); reject(new Error('terminal websocket error')) }
        socket.onmessage = (event) => {
          const data = JSON.parse(String(event.data))
          if (data.type !== 'terminal_data') return
          received += data.data
          if (received.includes('web-terminal-ok ✓')) { clearTimeout(timeout); resolve(received) }
        }
      })
      expect(output).toContain('web-terminal-ok ✓')
    } finally {
      socket?.close()
      server.stop()
    }
  })

  test('coalesces bursts of pty output into fewer websocket frames', async () => {
    const server = startTestServer()
    let socket: WebSocket | undefined
    try {
      const result = await new Promise<{ frames: number; output: string }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('terminal timeout')), 8000)
        let frames = 0
        let output = ''
        socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        socket.onopen = () => {
          socket!.send(JSON.stringify({ type: 'terminal_open', cols: 200, rows: 40 }))
          socket!.send(JSON.stringify({ type: 'terminal_input', data: `${printLines("Array.from({length:3000},(_,i)=>String(i+1)+'\\n').join('')+'COALESCE-OK\\n'")}\r` }))
        }
        socket.onerror = () => { clearTimeout(timeout); reject(new Error('terminal websocket error')) }
        socket.onmessage = (event) => {
          const data = JSON.parse(String(event.data))
          if (data.type !== 'terminal_data') return
          frames += 1
          output += data.data
          if (output.includes('COALESCE-OK')) {
            clearTimeout(timeout)
            resolve({ frames, output })
          }
        }
      })
      expect(result.output).toContain('COALESCE-OK')
      // ~19KB of sequence output is buffered into a handful of frames instead
      // of one websocket message per PTY chunk.
      expect(result.frames).toBeLessThanOrEqual(30)
    } finally {
      socket?.close()
      server.stop()
    }
  })

  test('replays the persistent terminal transcript after websocket reconnect', async () => {
    const server = startTestServer()
    let first: WebSocket | undefined
    let second: WebSocket | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('terminal seed timeout')), 5000)
        first = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        first.onopen = () => {
          first!.send(JSON.stringify({ type: 'terminal_open', cols: 80, rows: 24 }))
          first!.send(JSON.stringify({ type: 'terminal_input', data: `${printOutput('reconnect-transcript-ok')}\r` }))
        }
        first.onerror = () => { clearTimeout(timeout); reject(new Error('terminal seed websocket error')) }
        first.onmessage = (event) => {
          const data = JSON.parse(String(event.data))
          if (data.type === 'terminal_data' && String(data.data).includes('reconnect-transcript-ok')) {
            clearTimeout(timeout)
            resolve()
          }
        }
      })
      first!.close()

      const replay = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('terminal replay timeout')), 5000)
        let received = ''
        second = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${server.token}`)
        second.onerror = () => { clearTimeout(timeout); reject(new Error('terminal replay websocket error')) }
        second.onopen = () => second!.send(JSON.stringify({ type: 'terminal_replay' }))
        second.onmessage = (event) => {
          const data = JSON.parse(String(event.data))
          if (data.type !== 'terminal_data') return
          received += data.data
          if (received.includes('reconnect-transcript-ok')) {
            clearTimeout(timeout)
            resolve(received)
          }
        }
      })
      expect(replay).toContain('reconnect-transcript-ok')
    } finally {
      first?.close()
      second?.close()
      server.stop()
    }
  })
})

describe('web bridge interactions', () => {
  test('returns browser confirmation decisions to the agent', async () => {
    let confirm: ((message: string) => Promise<boolean>) | null = null
    const events: ServerEvent[] = []
    const agent: WebAgent = {
      abort() {}, async run() {},
      setConfirmHandler(handler) { confirm = handler },
    }
    const bridge = new WebBridge(agent, { send(event) { events.push(event) } })
    const decision = confirm!('Write this file?')
    const request = events[0]
    expect(request?.type).toBe('confirm_request')
    if (request?.type !== 'confirm_request') throw new Error('missing confirmation request')
    expect(bridge.pendingEvents()).toEqual([request])
    bridge.handleCommand({ type: 'confirm_response', requestId: request.requestId, approved: true })
    expect(await decision).toBe(true)
    expect(bridge.pendingEvents()).toEqual([])
    bridge.stop()
  })

  test('changes the active Agent mode from a browser command', () => {
    const events: ServerEvent[] = []
    const agent: WebAgent = { abort() {}, async run() {}, interactionMode: 'build' }
    const bridge = new WebBridge(agent, { send(event) { events.push(event) } })
    bridge.handleCommand({ type: 'set_mode', mode: 'review' })
    expect(agent.interactionMode).toBe('review')
    expect(events).toContainEqual({ type: 'mode', mode: 'review' })
    bridge.stop()
  })

  test('forwards correlated subagent progress to the browser', () => {
    const events: ServerEvent[] = []
    let callbacks: NonNullable<WebAgent['setSubAgentCallbacks']> extends (value: infer Value) => void ? Value : never
    const agent: WebAgent = {
      abort() {}, async run() {},
      setSubAgentCallbacks(value) { callbacks = value! },
    }
    const bridge = new WebBridge(agent, { send(event) { events.push(event) } })
    callbacks!.onStart('task-1', 'Inspect the GUI', 'reviewer')
    callbacks!.onTokens?.('task-1', 314)
    callbacks!.onDone('task-1', 'Done')
    expect(events).toEqual([
      { type: 'subagent_start', id: 'task-1', task: 'Inspect the GUI', agentName: 'reviewer' },
      { type: 'subagent_tokens', id: 'task-1', tokens: 314 },
      { type: 'subagent_done', id: 'task-1', result: 'Done', tokens: undefined, costUsd: undefined },
    ])
    bridge.stop()
  })

  test('routes every interactive Agent callback through the browser', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'deepseek-web-interactions-'))
    const events: ServerEvent[] = []
    let permission: ((request: { toolName: string; args: object; reason: 'outside_workspace' | 'risk' | 'permission' | 'agent_config' | 'workflow'; riskDescription?: string }) => Promise<'once' | 'session' | 'directory' | 'always' | 'deny'>) | null = null
    let questions: ((input: Array<{ question: string; header: string }>) => Promise<Record<string, string> | null>) | null = null
    let diffReview: ((summary: string) => Promise<boolean>) | null = null
    let verification: ((files: string[]) => Promise<void>) | null = null
    let planSubmit: ((path: string, summary?: string) => Promise<string>) | null = null
    const agent: WebAgent = {
      abort() {}, async run() {}, interactionMode: 'plan', getWorkingDirectory: () => cwd,
      setToolPermissionHandler(handler) { permission = handler },
      setAskUserHandler(handler) { questions = handler },
      setDiffReviewHandler(handler) { diffReview = handler },
      setVerificationHandler(handler) { verification = handler },
      setPlanSubmitHandler(handler) { planSubmit = handler },
    }
    const bridge = new WebBridge(agent, { send(event) { events.push(event) } })
    const latest = <Type extends ServerEvent['type']>(type: Type): Extract<ServerEvent, { type: Type }> => {
      const event = events.at(-1)
      if (!event || event.type !== type) throw new Error(`expected ${type}`)
      return event as Extract<ServerEvent, { type: Type }>
    }
    const waitFor = async <Type extends ServerEvent['type']>(type: Type): Promise<Extract<ServerEvent, { type: Type }>> => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const event = [...events].reverse().find((candidate) => candidate.type === type)
        if (event) return event as Extract<ServerEvent, { type: Type }>
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error(`timed out waiting for ${type}`)
    }
    try {
      const permissionDecision = permission!({ toolName: 'shell', args: { command: 'pwd' }, reason: 'risk', riskDescription: 'Runs a local command.' })
      const permissionRequest = latest('permission_request')
      bridge.handleCommand({ type: 'permission_response', requestId: permissionRequest.requestId, decision: 'once' })
      expect(await permissionDecision).toBe('once')

      const answer = questions!([{ header: 'Scope', question: 'Proceed?' }])
      const questionRequest = latest('questions_request')
      bridge.handleCommand({ type: 'questions_response', requestId: questionRequest.requestId, answers: { 0: 'Yes' } })
      expect(await answer).toEqual({ 0: 'Yes' })

      const reviewed = diffReview!('Changed src/web/server.ts')
      const reviewRequest = latest('diff_review_request')
      bridge.handleCommand({ type: 'diff_review_response', requestId: reviewRequest.requestId, approved: true })
      expect(await reviewed).toBe(true)

      const planPath = join(cwd, 'plan.md')
      await writeFile(planPath, '# Web plan\n')
      const plan = planSubmit!(planPath, 'Implement the GUI')
      const planRequest = await waitFor('plan_review_request')
      expect(planRequest.content).toBe('# Web plan\n')
      bridge.handleCommand({ type: 'plan_review_response', requestId: planRequest.requestId, approved: true })
      expect(JSON.parse(await plan)).toMatchObject({ approved: true })
      expect(agent.interactionMode).toBe('build')

      await writeFile(join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'echo test' } }))
      await writeFile(join(cwd, 'bun.lock'), '')
      const verifying = verification!(['src/web/server.ts'])
      const verificationRequest = await waitFor('verification_request')
      expect(verificationRequest.command).toBe('bun test')
      bridge.handleCommand({ type: 'verification_response', requestId: verificationRequest.requestId, approved: false })
      await verifying
    } finally {
      bridge.stop()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('rejects malformed browser commands at the protocol boundary', () => {
    expect(parseClientCommand({ type: 'run', prompt: '' })).toBeNull()
    expect(parseClientCommand({ type: 'terminal_resize', cols: -1, rows: 20 })).toBeNull()
    expect(parseClientCommand({ type: 'set_mode', mode: 'unsafe' })).toBeNull()
    expect(parseClientCommand({ type: 'terminal_replay' })).toEqual({ type: 'terminal_replay' })
    expect(parseClientCommand({ type: 'commit', message: 'ship it' })).toEqual({ type: 'commit', message: 'ship it' })
    expect(parseClientCommand({ type: 'commit', message: ' ' })).toBeNull()
    expect(parseClientCommand({ type: 'run', prompt: 'inspect the repository' })).toEqual({ type: 'run', prompt: 'inspect the repository' })
  })

  test('rejects prototype pollution payloads in question answers', () => {
    // JSON.parse keeps __proto__ as an own property — exactly how a hostile
    // websocket frame would reach the validator.
    const hostile = JSON.parse('{"type":"questions_response","requestId":"r1","answers":{"__proto__":"polluted","ok":"yes"}}')
    const poisoned = parseClientCommand(hostile)
    expect(poisoned).toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    const clean = parseClientCommand({ type: 'questions_response', requestId: 'r1', answers: { 0: 'Proceed' } })
    expect(clean).toEqual({ type: 'questions_response', requestId: 'r1', answers: { 0: 'Proceed' } })
  })

  test('bridges todo store changes to the browser', () => {
    const events: ServerEvent[] = []
    const agent: WebAgent = { abort() {}, async run() {} }
    const bridge = new WebBridge(agent, { send(event) { events.push(event) } })
    try {
      expect(bridge.todos()).toEqual([])
      addTodo('Analyze the renderers')
      const todosEvent = events.find((event) => event.type === 'todos')
      expect(todosEvent?.type === 'todos' && todosEvent.items).toEqual([{ id: expect.any(String), title: 'Analyze the renderers', status: 'pending' }])
    } finally {
      clearTodos()
      bridge.stop()
    }
  })
})

describe('web source control', () => {
  test('reads diffs and stages only workspace files', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'deepseek-web-'))
    try {
      await execa('git', ['init'], { cwd })
      await execa('git', ['config', 'user.email', 'web@test.invalid'], { cwd })
      await execa('git', ['config', 'user.name', 'Web Test'], { cwd })
      await writeFile(join(cwd, 'tracked.txt'), 'before\n')
      await execa('git', ['add', 'tracked.txt'], { cwd })
      await execa('git', ['commit', '-m', 'initial'], { cwd })
      await writeFile(join(cwd, 'tracked.txt'), 'after\n')
      await writeFile(join(cwd, 'new.txt'), 'new file\n')
      await mkdir(join(cwd, 'src', 'web'), { recursive: true })
      await writeFile(join(cwd, 'src', 'web', 'server.ts'), 'export const server = true\n')

      const changed = await getSourceControl(cwd, 'tracked.txt')
      expect(changed.repository).toBe(true)
      expect(changed.files.map((file) => file.path)).toContain('tracked.txt')
      expect(changed.files.map((file) => file.path)).toContain('src/web/server.ts')
      expect(changed.diff).toContain('-before')
      expect(changed.diff).toContain('+after')

      await changeStaging(cwd, 'unstage', ['src/web/server.ts'])
      await changeStaging(cwd, 'stage', ['new.txt'])
      const staged = await getSourceControl(cwd, 'new.txt')
      expect(staged.stagedDiff).toContain('+new file')
      await expect(changeStaging(cwd, 'stage', ['../outside.txt'])).rejects.toThrow('outside the workspace')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('commits staged files without touching unstaged edits', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'deepseek-web-commit-'))
    try {
      await execa('git', ['init'], { cwd })
      await execa('git', ['config', 'user.email', 'web@test.invalid'], { cwd })
      await execa('git', ['config', 'user.name', 'Web Test'], { cwd })
      await writeFile(join(cwd, 'tracked.txt'), 'before\n')
      await execa('git', ['add', 'tracked.txt'], { cwd })
      await execa('git', ['commit', '-m', 'initial'], { cwd })
      await writeFile(join(cwd, 'tracked.txt'), 'unstaged edit\n')
      await writeFile(join(cwd, 'staged.txt'), 'staged file\n')
      await changeStaging(cwd, 'stage', ['staged.txt'])

      const output = await commitStaged(cwd, 'add staged file')
      expect(output).toContain('add staged file')
      expect((await execa('git', ['log', '-1', '--pretty=%s'], { cwd })).stdout).toBe('add staged file')
      expect((await getSourceControl(cwd)).files.map((file) => file.path)).toEqual(['tracked.txt'])
      await expect(commitStaged(cwd, 'no changes')).rejects.toThrow('No staged changes')
      await expect(commitStaged(cwd, ' '.repeat(501))).rejects.toThrow('between 1 and 500')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
