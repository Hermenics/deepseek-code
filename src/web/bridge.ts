import { readFile } from 'node:fs/promises'
import type { AgentCallbacks, ToolPermissionHandler, ToolPermissionRequest } from '../agent/agent.js'
import { detectVerificationCommand, runVerification } from '../agent/verify.js'
import { getTodos, subscribe as subscribeTodos } from '../agent/todoStore.js'
import type { AskUserHandler } from '../tools/AskUserQuestions/types.js'
import type { SubAgentCallbacks } from '../tools/SubAgent/SubAgent.js'
import type { InteractionMode } from '../ui/interactionMode.js'
import type { ClientCommand, ServerEvent, SessionStats, TodoItemView } from './protocol.js'
import { HELP_TEXT, parseCommand } from '../commands/index.js'

export interface WebAgent {
  run(userMessage: string, cb: AgentCallbacks): Promise<void>
  abort(): void
  interactionMode?: InteractionMode
  setConfirmHandler?(handler: ((message: string) => Promise<boolean>) | null): void
  setToolPermissionHandler?(handler: ToolPermissionHandler | null): void
  setAskUserHandler?(handler: AskUserHandler | null): void
  setDiffReviewHandler?(handler: ((summary: string) => Promise<boolean>) | null): void
  setVerificationHandler?(handler: ((files: string[]) => Promise<void>) | null): void
  setPlanSubmitHandler?(handler: ((path: string, summary?: string) => Promise<string>) | null): void
  getWorkingDirectory?(): string
  getToolInfo?(): Array<{ name: string; description: string }>
  getSessionStats?(): SessionStats
  clearHistory?(): void
  compact?(): Promise<string>
  setModel?(model: string): void
  getCostSummary?(): string
  getStats?(): string
  getSystemPrompt?(): string
  getFilesModified?(): string[]
  getToolNames?(): string[]
  undo?(): Promise<string>
  undoAll?(): Promise<string>
  undoList?(): Promise<string>
  saveCheckpoint?(label?: string): Promise<string>
  listCheckpoints?(): Promise<Array<{ id: string; label: string; filesModified: string[] }>>
  restoreCheckpoint?(id: string): Promise<string>
  askBtw?(question: string): Promise<string>
  setEffortLevel?(level: 'low' | 'high' | 'max'): void
  setSubAgentCallbacks?(callbacks: SubAgentCallbacks | null): void
}

export interface BridgeTransport {
  send(event: ServerEvent): void
}

interface PendingResponse {
  responseType: ClientCommand['type']
  event: ServerEvent
  resolve(command: ClientCommand): void
  fallback(): void
}

export interface WebBridgeOptions {
  onWorkspaceChanged?(): void
}

/**
 * Bridges the full interactive Agent surface to WebSocket. Tool callbacks are
 * deliberately not special-cased: every native and discovered MCP tool flows
 * through the same event stream the GUI renders.
 */
export class WebBridge {
  private running = false
  private readonly pending = new Map<string, PendingResponse>()
  private nextRequestId = 0
  private readonly unsubscribeTodos: () => void

  constructor(
    private readonly agent: WebAgent,
    private readonly transport: BridgeTransport,
    private readonly options: WebBridgeOptions = {},
  ) {
    this.installInteractiveHandlers()
    this.unsubscribeTodos = subscribeTodos(() => this.sendTodos())
  }

  /** Current agent todo list, as maintained by the `todo` tool. */
  todos(): TodoItemView[] {
    return getTodos().map((item) => ({ id: item.id, title: item.title, status: item.status }))
  }

  private sendTodos(): void {
    this.transport.send({ type: 'todos', items: this.todos() })
  }

  /** Live telemetry snapshot; omitted entirely when the agent cannot provide it. */
  sendStats(): void {
    const stats = this.agent.getSessionStats?.()
    if (stats) this.transport.send({ type: 'stats', stats })
  }

  handleCommand(command: ClientCommand): void {
    switch (command.type) {
      case 'run':
        if (command.prompt.trim().startsWith('/')) { void this.handleSlashCommand(command.prompt); return }
        void this.run(command.prompt); return
      case 'abort': this.agent.abort(); return
      case 'set_mode':
        this.agent.interactionMode = command.mode
        this.transport.send({ type: 'mode', mode: command.mode })
        return
      case 'permission_response':
      case 'confirm_response':
      case 'questions_response':
      case 'diff_review_response':
      case 'plan_review_response':
      case 'verification_response': {
        const pending = this.pending.get(command.requestId)
        if (pending && pending.responseType === command.type) {
          this.pending.delete(command.requestId)
          pending.resolve(command)
        }
        return
      }
      default: return
    }
  }

  private commandResult(content: string, clear = false): void {
    this.transport.send({ type: 'command_result', content, clear })
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const command = parseCommand(input)
    if (!command) { void this.run(input); return }
    if (command.type === 'unknown') { this.commandResult(command.input); return }

    try {
      switch (command.type) {
        case 'clear':
          this.agent.clearHistory?.()
          this.commandResult('Conversation cleared.', true)
          return
        case 'help': this.commandResult(HELP_TEXT); return
        case 'compact': this.commandResult('**Context compacted.** Summary:\n\n' + await this.agent.compact?.()); return
        case 'model': this.agent.setModel?.(command.model); this.commandResult(`Model switched to ${command.model}`); return
        case 'cost': this.commandResult(this.agent.getCostSummary?.() ?? 'Cost summary is unavailable.'); return
        case 'stats': this.commandResult(this.agent.getStats?.() ?? 'Session statistics are unavailable.'); return
        case 'system': this.commandResult('**Active mode & permissions:**\n\n```\n' + (this.agent.getSystemPrompt?.() ?? 'Unavailable') + '\n```'); return
        case 'files': {
          const files = this.agent.getFilesModified?.() ?? []
          this.commandResult(files.length ? 'Files modified this session:\n' + files.map((file) => '  ' + file).join('\n') : 'No files modified this session.')
          return
        }
        case 'tools': {
          const names = this.agent.getToolNames?.() ?? []
          this.commandResult('Available tools (' + names.length + '):\n' + names.map((name) => '  ' + name).join('\n'))
          return
        }
        case 'undo': {
          const result = 'action' in command && command.action === 'all'
            ? await this.agent.undoAll?.()
            : 'action' in command && command.action === 'list'
              ? await this.agent.undoList?.()
              : await this.agent.undo?.()
          this.commandResult(result ?? 'Undo is unavailable.')
          return
        }
        case 'checkpoint': {
          if (command.action === 'save') this.commandResult('Checkpoint saved (id: ' + await this.agent.saveCheckpoint?.(command.label) + ')')
          else if (command.action === 'restore') this.commandResult(await this.agent.restoreCheckpoint?.(command.id) ?? 'Checkpoint restore is unavailable.')
          else {
            const checkpoints = await this.agent.listCheckpoints?.() ?? []
            this.commandResult(checkpoints.length ? 'Checkpoints:\n' + checkpoints.map((checkpoint) => `  ${checkpoint.id}  ${checkpoint.label}  (${checkpoint.filesModified.length} files)`).join('\n') : 'No checkpoints saved.')
          }
          return
        }
        case 'review':
          this.agent.interactionMode = 'review'
          this.transport.send({ type: 'mode', mode: 'review' })
          await this.run(`Review the project${command.target ? ` target ${command.target}` : ''}. Report concrete findings and suggested fixes.`)
          return
        case 'plan':
          this.agent.interactionMode = 'plan'
          this.transport.send({ type: 'mode', mode: 'plan' })
          await this.run(command.task)
          return
        case 'btw': this.commandResult(await this.agent.askBtw?.(command.question) ?? 'Side questions are unavailable.'); return
        case 'effort':
          if (command.action === 'set') { this.agent.setEffortLevel?.(command.level); this.commandResult(`Effort level set to ${command.level}.`) }
          else this.commandResult('Effort level is configured from the CLI in this Web build.')
          return
        default:
          this.commandResult(`/${input.trim().slice(1).split(/\s+/)[0]} is recognized, but this command has no Web action yet.`)
      }
    } catch (error) {
      this.commandResult('Command failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  stop(): void {
    this.agent.abort()
    this.unsubscribeTodos()
    for (const pending of this.pending.values()) pending.fallback()
    this.pending.clear()
    this.agent.setConfirmHandler?.(null)
    this.agent.setToolPermissionHandler?.(null)
    this.agent.setAskUserHandler?.(null)
    this.agent.setDiffReviewHandler?.(null)
    this.agent.setVerificationHandler?.(null)
    this.agent.setPlanSubmitHandler?.(null)
    this.agent.setSubAgentCallbacks?.(null)
  }

  /** A reconnecting browser needs outstanding approvals replayed, not a hung agent. */
  pendingEvents(): ServerEvent[] {
    return [...this.pending.values()].map((pending) => pending.event)
  }

  private installInteractiveHandlers(): void {
    this.agent.setSubAgentCallbacks?.({
      onStart: (id, task, agentName) => this.transport.send({ type: 'subagent_start', id, task, agentName }),
      onToolUse: (id, tool, info) => this.transport.send({ type: 'subagent_tool', id, tool, info }),
      onTokens: (id, tokens) => this.transport.send({ type: 'subagent_tokens', id, tokens }),
      onMessage: (id, role, content) => this.transport.send({ type: 'subagent_message', id, role, content }),
      onDone: (id, result, tokens, costUsd) => this.transport.send({ type: 'subagent_done', id, result, tokens, costUsd }),
      onError: (id, error) => this.transport.send({ type: 'subagent_error', id, error }),
    })
    this.agent.setConfirmHandler?.((message) => this.requestBoolean('confirm_response', (requestId) => ({ type: 'confirm_request', requestId, message })))

    this.agent.setToolPermissionHandler?.(async (request) => {
      const response = await this.request('permission_response', (requestId) => ({
        type: 'permission_request', requestId, ...request, args: request.args as Record<string, unknown>,
      }), { type: 'permission_response', requestId: '', decision: 'deny' })
      return response.decision
    })

    this.agent.setAskUserHandler?.(async (questions, signal) => {
      if (signal?.aborted) return null
      const response = await this.request('questions_response', (requestId) => ({ type: 'questions_request', requestId, questions }), {
        type: 'questions_response', requestId: '', answers: null,
      })
      return response.answers
    })

    this.agent.setDiffReviewHandler?.((summary) => this.requestBoolean('diff_review_response', (requestId) => ({ type: 'diff_review_request', requestId, summary })))

    this.agent.setVerificationHandler?.(async (files) => {
      const cwd = this.agent.getWorkingDirectory?.()
      if (!cwd) return
      const verification = await detectVerificationCommand(cwd)
      if (!verification) return
      const approved = await this.requestBoolean('verification_response', (requestId) => ({
        type: 'verification_request', requestId, files, command: verification.display,
      }))
      if (!approved) return
      const result = await runVerification(verification, cwd)
      this.transport.send({ type: 'verification_result', command: verification.display, ok: result.ok, output: result.output })
    })

    this.agent.setPlanSubmitHandler?.(async (path, summary) => {
      let content = ''
      try { content = await readFile(path, 'utf8') } catch { content = '(plan file could not be read)' }
      const response = await this.request<Extract<ClientCommand, { type: 'plan_review_response' }>>('plan_review_response', (requestId) => ({ type: 'plan_review_request', requestId, path, content, summary }), {
        type: 'plan_review_response', requestId: '', approved: false, aborted: true,
      })
      this.agent.interactionMode = 'build'
      this.transport.send({ type: 'mode', mode: 'build' })
      if (response.aborted) throw new Error('aborted')
      if (response.approved) return JSON.stringify({ approved: true, message: 'Plan accepted. Now switch to Build mode and implement it.' })
      const feedback = response.feedback?.trim() ?? ''
      return JSON.stringify({ approved: false, feedback, message: `Plan rejected. User feedback: ${feedback}. Revise the plan file and call submit_plan again when done.` })
    })
  }

  private requestBoolean<T extends Extract<ClientCommand, { requestId: string; approved: boolean }>>(
    responseType: T['type'],
    event: (requestId: string) => ServerEvent,
  ): Promise<boolean> {
    return this.request(responseType, event, { type: responseType, requestId: '', approved: false } as T).then((response) => response.approved)
  }

  private request<T extends Extract<ClientCommand, { requestId: string }>>(
    responseType: T['type'],
    event: (requestId: string) => ServerEvent,
    fallback: T,
  ): Promise<T> {
    const requestId = `r${++this.nextRequestId}`
    return new Promise<T>((resolve) => {
      const requestEvent = event(requestId)
      this.pending.set(requestId, {
        responseType,
        event: requestEvent,
        resolve: (response) => resolve(response as T),
        fallback: () => resolve({ ...fallback, requestId } as T),
      })
      this.transport.send(requestEvent)
    })
  }

  private async run(prompt: string): Promise<void> {
    if (this.running) {
      this.transport.send({ type: 'error', message: 'A task is already running' })
      return
    }
    this.running = true
    try {
      await this.agent.run(prompt, {
        onToken: (text) => this.transport.send({ type: 'token', text }),
        onThinking: (text) => this.transport.send({ type: 'thinking', text }),
        onToolPending: (name, argsText) => this.transport.send({ type: 'tool_pending', name, argsText }),
        onToolCall: (name, args) => this.transport.send({ type: 'tool_call', name, args }),
        onToolResult: (name, result, args) => {
          this.transport.send({ type: 'tool_result', name, result, args })
          this.sendStats()
          if (['write_file', 'edit_file', 'patch_file', 'git'].includes(name)) this.options.onWorkspaceChanged?.()
        },
        onPhaseChange: (phase) => this.transport.send({ type: 'phase', phase }),
        onMicroCompact: (details) => this.transport.send({ type: 'micro_compact', freedTokensEstimate: details.freedTokensEstimate }),
        onAutoCompact: (summary) => this.transport.send({ type: 'auto_compact', summary }),
        onDenyAbort: () => this.transport.send({ type: 'deny_abort' }),
        onDone: () => {
          this.transport.send({ type: 'done' })
          this.sendStats()
        },
      })
    } catch (err) {
      this.transport.send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      this.running = false
      this.sendStats()
    }
  }
}
