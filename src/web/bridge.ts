import { readFile } from 'node:fs/promises'
import type { AgentCallbacks, ToolPermissionHandler, ToolPermissionRequest } from '../agent/agent.js'
import { detectVerificationCommand, runVerification } from '../agent/verify.js'
import { getTodos, subscribe as subscribeTodos } from '../agent/todoStore.js'
import type { AskUserHandler } from '../tools/AskUserQuestions/types.js'
import type { SubAgentCallbacks } from '../tools/SubAgent/SubAgent.js'
import type { InteractionMode } from '../ui/interactionMode.js'
import type { AgentConfig } from '../agent/config.js'
import type { ContextBreakdown } from '../agent/contextBreakdown.js'
import type { DeepSeekSettings } from '../settings/types.js'
import type { StartWorkflowInput, WorkflowHandle, WorkflowManager, WorkflowManagerEvent } from '../workflows/manager.js'
import { readSavedWorkflow } from '../workflows/commands.js'
import type { ClientCommand, ServerEvent, SessionStats, TodoItemView } from './protocol.js'
import { runWebCommand } from './commands.js'
import { HELP_TEXT, resolveCommand } from '../commands/index.js'

/** Minimal slice of OrchestratorSession the bridge needs to notice a subagent going 'blocked'. */
interface OrchestratorView {
  subscribe(listener: (event: { type: string; taskId?: string }) => void): () => void
  registry: { getStatus(taskId: string): { state: string; error?: { message: string }; blockReason?: string } }
  memory: { load(target: 'agent' | 'user'): Promise<string[]>; clear(target?: 'agent' | 'user'): Promise<void> }
}

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
  workflows?: WorkflowManager
  startWorkflow?(input: StartWorkflowInput): Promise<WorkflowHandle>
  orchestrator?: OrchestratorView
  // Consumed by ./commands.ts to mirror the TUI slash-command surface.
  readyPromise?: Promise<void>
  settings?: DeepSeekSettings
  formatTasks?(): string
  controlTask?(id: string, action: 'status' | 'cancel' | 'resume' | 'result' | 'message' | 'integrate' | 'cleanup', message?: string): Promise<string>
  getContextBreakdown?(): ContextBreakdown
  getPermissionsInfo?(): Parameters<typeof import('../permissions/index.js').formatPermissionsReport>[0]
  setWorkingDirectory?(path: string, changeProjectRoot?: boolean): Promise<void>
  applyAgentConfig?(config: AgentConfig): Promise<void>
  getLastUserMessage?(): string | null
  getAvailableModels?(): Promise<string[]>
  addAdditionalDirectory?(path: string): Promise<string>
  removeAdditionalDirectory?(path: string): Promise<boolean>
  listAdditionalDirectories?(): string[]
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
  /** Session id shared with the CLI, used by workspace commands such as /worktree. */
  sessionId?: string
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
  private readonly unsubscribeWorkflows: () => void
  private readonly unsubscribeOrchestrator: () => void

  constructor(
    private readonly agent: WebAgent,
    private readonly transport: BridgeTransport,
    private readonly options: WebBridgeOptions = {},
  ) {
    this.installInteractiveHandlers()
    this.unsubscribeTodos = subscribeTodos(() => this.sendTodos())
    this.unsubscribeWorkflows = this.agent.workflows?.subscribe((event) => this.forwardWorkflowEvent(event)) ?? (() => {})
    this.unsubscribeOrchestrator = this.agent.orchestrator?.subscribe((event) => this.forwardBlockedState(event)) ?? (() => {})
  }

  /** Dynamic Workflow runs stream phase()/log() progress independent of the tool call's final return value. */
  private forwardWorkflowEvent(event: WorkflowManagerEvent): void {
    if (event.event?.type === 'log') {
      this.transport.send({ type: 'workflow_log', runId: event.run.runId, value: event.event.value })
      return
    }
    this.transport.send({
      type: 'workflow_update', runId: event.run.runId, name: event.run.meta.name, status: event.run.status,
      ...(event.run.phase ? { phase: event.run.phase } : {}), usage: event.run.usage,
      ...(event.run.error ? { error: event.run.error } : {}),
    })
  }

  /** OrchestratorCallbacks never routes the 'blocked' task state — only a raw subscribe() sees it (mirrors src/ui/App.tsx). */
  private forwardBlockedState(event: { type: string; taskId?: string }): void {
    if (event.type !== 'state_changed' || !event.taskId || !this.agent.orchestrator) return
    let record: ReturnType<OrchestratorView['registry']['getStatus']>
    try { record = this.agent.orchestrator.registry.getStatus(event.taskId) } catch { return }
    if (record.state !== 'blocked') return
    this.transport.send({ type: 'subagent_blocked', id: event.taskId, reason: record.error?.message ?? record.blockReason ?? 'Blocked' })
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
    // resolveCommand (not parseCommand) so saved workflows and user/project
    // custom commands resolve here exactly as they do in the terminal UI.
    const command = await resolveCommand(input, this.agent.getWorkingDirectory?.() ?? process.cwd())
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
        case 'workflows':
          this.commandResult(this.agent.workflows ? await this.agent.workflows.formatRuns() : 'Dynamic Workflows are unavailable.')
          return
        case 'workflow': {
          const workflows = this.agent.workflows
          if (!workflows) { this.commandResult('Dynamic Workflows are unavailable.'); return }
          if (command.action === 'pause') { const ok = await workflows.pause(command.id); this.commandResult(ok ? `Workflow ${command.id} paused.` : `Workflow ${command.id} is not running.`); return }
          if (command.action === 'resume') { const ok = await workflows.resume(command.id); this.commandResult(ok ? `Workflow ${command.id} resumed.` : `Workflow ${command.id} is not paused.`); return }
          if (command.action === 'stop') { const ok = await workflows.cancel(command.id); this.commandResult(ok ? `Workflow ${command.id} stopping.` : `Workflow ${command.id} is not active.`); return }
          if (command.action === 'save') { const path = await workflows.save(command.id, command.name); this.commandResult(`Workflow saved to ${path}`); return }
          if (command.action === 'restart') { const result = await (await workflows.restart(command.id)).result; this.commandResult(`Workflow ${result.runId} ${result.status}.\n\n${JSON.stringify(result.result, null, 2)}`); return }
          if (command.action === 'run') {
            const script = await readSavedWorkflow(command.name, this.agent.getWorkingDirectory?.() ?? process.cwd())
            const result = await (await workflows.start({ script, name: command.name, args: command.args ? JSON.parse(command.args) : {} })).result
            this.commandResult(`Workflow ${result.runId} ${result.status}.\n\n${JSON.stringify(result.result, null, 2)}`)
          }
          return
        }
        case 'btw': this.commandResult(await this.agent.askBtw?.(command.question) ?? 'Side questions are unavailable.'); return
        case 'effort':
          if (command.action === 'set') { this.agent.setEffortLevel?.(command.level); this.commandResult(`Effort level set to ${command.level}.`) }
          else this.commandResult('Effort level is configured from the CLI in this Web build.')
          return
        default: {
          const handled = await runWebCommand(command, {
            agent: this.agent,
            sessionId: this.options.sessionId ?? 'web',
            respond: (content) => this.commandResult(content),
            confirm: (message) => this.requestBoolean('confirm_response', (requestId) => ({ type: 'confirm_request', requestId, message })),
            run: (prompt) => this.run(prompt),
            workspaceChanged: () => this.options.onWorkspaceChanged?.(),
          })
          if (!handled) this.commandResult(`/${input.trim().slice(1).split(/\s+/)[0]} is recognized, but this command has no Web action yet.`)
        }
      }
    } catch (error) {
      this.commandResult('Command failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  stop(): void {
    this.agent.abort()
    this.unsubscribeTodos()
    this.unsubscribeWorkflows()
    this.unsubscribeOrchestrator()
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
