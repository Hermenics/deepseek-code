import { existsSync } from 'fs'
import { resolve } from 'path'
import { useState, useCallback, useEffect, useRef } from 'react'
import useInput from '../ink/hooks/use-input.js'
import { execa } from 'execa'
import type { Key } from '../ink/events/input-event.js'
import { Agent, type ToolPermissionRequest, type ToolPermissionResult } from '../agent/agent.js'
import { MessageList, getDiffPayload } from './messages/MessageList.js'
import { DiffDialog, type DiffLine } from './messages/DiffDialog.js'
import { TodoPanel } from './messages/TodoPanel.js'
import { ToolUseDisplay } from './messages/ToolUseDisplay.js'
import { previewStreamingArgs, previewToolCallArgs, summarizeToolResult } from './messages/toolDisplay.js'
import { ignoreFileStatus, writeIgnoreDefaults, hasEditorAssociation, writeEditorAssociation, shouldOfferEditorAssociation, getEditorSettingsPath, IGNORE_FILE_NAME, shouldOfferIgnoreDefaults, markIgnoreDefaultsPrompted } from '../tools/shared/deepseekignore.js'
import { useSubagents } from './subagent/index.js'
import { useWorkflowRuns } from './workflows/WorkflowList.js'
import { WorkflowMonitor } from './workflows/WorkflowMonitor.js'
import { ActivityFooter } from './activity/index.js'
import { InputBox, LoadingSpinner } from './input/InputBox.js'
import { QueuedMessagesList } from './input/QueuedMessagesList.js'
import { enqueue, getImmediateBtwQuestion } from './queueLogic.js'
import { BtwSideQuestion, type BtwState } from './btw/BtwSideQuestion.js'
import { StatusBar } from './layout/StatusBar.js'
import { ModelSelector } from './setup/ModelSelector.js'
import { EffortSelector } from './setup/EffortSelector.js'
import ConfigMenu from './setup/ConfigMenu.js'
import MobileQRCode from './MobileQRCode.js'
import { resolveCommand, HELP_TEXT, REVIEW_PROMPT } from '../commands.js'
import { FEATURES, loadFeatures, saveFeatures, type FeatureName } from '../features.js'
import { loadAgentConfig, listAgents, type LoadedAgent } from '../agent/config.js'
import { appendInputHistory } from '../agent/inputHistory.js'
import type { ThemeName, ProviderConfig } from '../types/provider.js'
import type { DeepSeekSettings, InterfaceSettings } from '../settings/types.js'
import { formatChatError } from '../utils/chatError.js'
import { defaultShell, isWindows } from '../utils/platform.js'
import { saveSession, updateSessionTitle, type SessionData } from '../agent/session.js'
import { getGoal, getElapsedSeconds, resumeGoal, updateGoal, buildContinuationPrompt, GOAL_MAX_CONTINUATIONS } from '../agent/goal.js'
import { DEFAULT_MODE, nextMode, isBuildMode, isAutoMode, type InteractionMode } from './interactionMode.js'
import Box from '../ink/components/Box.js'
import Text from '../ink/components/Text.js'
import ScrollBox, { type ScrollBoxHandle } from '../ink/components/ScrollBox.js'
import { Scrollbar } from './layout/Scrollbar.js'
import { ThemeProvider } from './design-system/index.js'
import { PlanApprovalPrompt, type PlanApprovalResult } from './plan/PlanApprovalPrompt.js'
import { newPlanPath, buildPlanModeInjection } from '../agent/planMode.js'
import { readSavedWorkflow, refreshWorkflowCommands } from '../workflows/commands.js'
import { refreshCustomCommands } from '../commands/custom.js'
import { AskUserQuestionsPrompt } from './questions/AskUserQuestions.js'
import type { AskUserAnswers, AskUserQuestion } from '../tools/AskUserQuestions/types.js'

export type AgentPhase = 'idle' | 'refining' | 'executing'

/** Extracts thinking content and cleans response tags from streamed text */
function processStreamedText(text: string): { thinking: string; content: string } {
  let thinking = ''
  const thinkMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/)
  if (thinkMatch) thinking = thinkMatch[1]!.trim()
  const content = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<thinking>[\s\S]*$/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .replace(/<step>[\s\S]*?<\/step>/g, '')
    .replace(/<step>[\s\S]*$/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_call>[\s\S]*$/g, '')
    .replace(/<response>([\s\S]*?)<\/response>/g, '$1')
    .trim()
  return { thinking, content }
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'terminal' | 'thinking'
  content: string
  thinkingMs?: number
  workedMs?: number
}

export interface ToolStatus {
  name: string
  args: string
  done: boolean
  result?: string
}

interface ConfirmState {
  message: string
  resolve: (yes: boolean) => void
}

interface ToolPermissionState {
  request: ToolPermissionRequest
  resolve: (result: ToolPermissionResult) => void
}

interface AskUserState {
  questions: AskUserQuestion[]
  resolve: (answers: AskUserAnswers | null) => void
}

interface PlanApprovalState {
  planPath: string
  planContent: string
  summary?: string
  resolve(toolResult: string): void
  reject(reason: string): void
}

export function App({ initialAgent, initialMessage, theme: initialTheme, providerConfig, onThemeChange, onLogout, onExit, language, enchant, sessionId, initialSession, headerProvider, headerAgent, initialSettings, alternateScreen = false }: {
  initialAgent?: LoadedAgent | null
  initialMessage?: string | null
  theme: ThemeName
  providerConfig?: ProviderConfig | null
  onThemeChange?: (t: ThemeName) => void
  onLogout?: () => void
  onExit?: () => void
  language?: string | null
  enchant?: boolean
  sessionId?: string
  initialSession?: SessionData | null
  headerProvider?: string
  headerAgent?: string | null
  initialSettings?: DeepSeekSettings
  alternateScreen?: boolean
}) {
  const transcriptRef = useRef<ScrollBoxHandle | null>(null)
  const initialSessionRef = useRef(initialSession)
  const handleSubmitRef = useRef<((text: string) => Promise<void>) | null>(null)
  const projectRootRef = useRef(initialSession?.cwd && existsSync(initialSession.cwd) ? initialSession.cwd : process.cwd())
  const originalProjectRoot = useRef(process.cwd())  // never changes — used to scope worktree isolation
  const toolStatusClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTurnTokenCountRef = useRef(0)
  const compactBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const btwAbortRef = useRef<AbortController | null>(null)
  const goalContinuationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const guiProcessRef = useRef<ReturnType<typeof Bun.spawn> | null>(null)
  const stopGuiProcess = useCallback(() => {
    const child = guiProcessRef.current
    guiProcessRef.current = null
    child?.kill()
  }, [])
  const sessionTitleRef = useRef<string | null>(initialSession?.title ?? null)
  const titleRequestedRef = useRef(Boolean(initialSession?.title))
  const [messages, setMessages] = useState<Message[]>([])
  const [streamText, setStreamText] = useState('')
  const [thinkingText, setThinkingText] = useState('')
  const [streamRole, setStreamRole] = useState<'assistant' | 'terminal'>('assistant')
  const [isLoading, setIsLoading] = useState(false)
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null)
  const [tokenCount, setTokenCount] = useState(0)
  const [contextPct, setContextPct] = useState(0)
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [activeAgentColor, setActiveAgentColor] = useState<string | undefined>(undefined)
  const [toolCallCount, setToolCallCount] = useState(0)
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle')
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(initialSettings?.interaction?.defaultMode ?? DEFAULT_MODE)
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [btw, setBtw] = useState<BtwState | null>(null)
  const [agent] = useState(() => new Agent(providerConfig ?? undefined, { sessionId, projectRoot: projectRootRef.current }))
  const workflowRuns = useWorkflowRuns(agent.workflows)
  const [theme, setTheme] = useState<ThemeName>(initialTheme)
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [showMobileQR, setShowMobileQR] = useState(false)
  const [currentLanguage, setCurrentLanguage] = useState<string | null>(language ?? null)
  const subagentsRef = useRef(useSubagents())
  const [, setSubagentTick] = useState(0)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelDescriptions, setModelDescriptions] = useState<Record<string, string>>({})
  const [showEffortSelector, setShowEffortSelector] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [toolPermissionState, setToolPermissionState] = useState<ToolPermissionState | null>(null)
  const [askUserState, setAskUserState] = useState<AskUserState | null>(null)
  const [planApprovalState, setPlanApprovalState] = useState<PlanApprovalState | null>(null)
  const [vimEnabled, setVimEnabled] = useState(initialSettings?.interface?.vim ?? false)
  const [interfaceSettings, setInterfaceSettings] = useState<InterfaceSettings>(initialSettings?.interface ?? {})
  const [featureFlags, setFeatureFlags] = useState(() => loadFeatures())
  const [compactBadge, setCompactBadge] = useState<{ type: 'micro' | 'full'; triggeredAt: number } | null>(null)
  const [diffDialog, setDiffDialog] = useState<{ path: string; lines: DiffLine[] } | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [workflowMonitor, setWorkflowMonitor] = useState<{ runId?: string } | null>(null)
  const [focusedSubagent, setFocusedSubagent] = useState<{ id: string; agentName: string | null } | null>(null)
  const [fullMode, setFullMode] = useState(false)
  const thinkingStartedAtRef = useRef<number | null>(null)
  const turnStartedAtRef = useRef<number | null>(null)
  const askUserResolverRef = useRef<((answers: AskUserAnswers | null) => void) | null>(null)

  const showCompactBadge = useCallback((type: 'micro' | 'full') => {
    if (compactBadgeTimerRef.current) clearTimeout(compactBadgeTimerRef.current)
    setCompactBadge({ type, triggeredAt: Date.now() })
    const timer = setTimeout(() => {
      if (compactBadgeTimerRef.current !== timer) return
      compactBadgeTimerRef.current = null
      setCompactBadge(null)
    }, 4000)
    compactBadgeTimerRef.current = timer
  }, [])

  useInput((input: string, key: Key, event) => {
    if (!key.ctrl || input !== 'd') return
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!
      if (message.role !== 'tool') continue
      const diff = getDiffPayload(message.content)
      if (!diff) continue
      event.stopImmediatePropagation()
      setDiffDialog({ path: diff.path, lines: diff.lines })
      return
    }
  })

  // Ctrl+O toggles full mode: expanded thinking and untruncated tool output.
  // Pure display toggle — never aborts the agent.
  useInput((input: string, key: Key, event) => {
    if (!key.ctrl || input !== 'o') return
    event.stopImmediatePropagation()
    setFullMode((v) => !v)
  })

  // Fullscreen replaces the terminal's own scrollback, so the transcript needs
  // its own scroll keys: wheel notches move 3 lines, PageUp/PageDown move half a
  // viewport. stickyScroll re-pins to the bottom once the user scrolls back down.
  useInput((_input, key, event) => {
    const transcript = transcriptRef.current
    if (!transcript) return
    const halfPage = Math.max(1, Math.floor(transcript.getViewportHeight() / 2))
    if (key.wheelUp) transcript.scrollBy(-3)
    else if (key.wheelDown) transcript.scrollBy(3)
    else if (key.pageUp) transcript.scrollBy(-halfPage)
    else if (key.pageDown) transcript.scrollBy(halfPage)
    else return
    event.stopImmediatePropagation()
  }, { isActive: alternateScreen })

  // Esc while focused on a subagent returns to the main conversation. InputBox's
  // own Esc handler does not stopImmediatePropagation, so this fires after it.
  useInput((_input, key, event) => {
    if (!key.escape) return
    event.stopImmediatePropagation()
    setFocusedSubagent(null)
    setActivityOpen(false)
  }, { isActive: Boolean(focusedSubagent) })

  useEffect(() => {
    agent.interactionMode = interactionMode
  }, [agent, interactionMode])

  useEffect(() => {
    void agent.readyPromise.then(async () => {
      await refreshWorkflowCommands(agent.getWorkingDirectory())
      await refreshCustomCommands(agent.getWorkingDirectory())
    })
  }, [agent])

  useEffect(() => () => {
    btwAbortRef.current?.abort()
    if (compactBadgeTimerRef.current) clearTimeout(compactBadgeTimerRef.current)
    stopGuiProcess()
    void agent.shutdown()
  }, [agent, stopGuiProcess])

  useEffect(() => {
    const subs = subagentsRef.current
    const findTask = (id: string) => {
      try { return { task: agent.orchestrator.registry.getStatus(id), workflowRunId: null, workflowPhase: null } }
      catch { return agent.workflows.findTask(id) }
    }
    const syncTask = (id: string) => {
      const located = findTask(id)
      if (!located) return false
      const record = located.task
      subs.onSubagentState({
        id, status: record.state, task: String(record.metadata.task ?? record.type),
        role: record.metadata.role as string | undefined,
        agentName: record.metadata.agentName as string | undefined,
        mode: record.mode, model: record.metadata.model as string | undefined,
        workspace: record.workspace?.path, workflowRunId: located.workflowRunId,
        workflowPhase: located.workflowPhase,
        prompt: typeof record.metadata.prompt === 'string' ? record.metadata.prompt : undefined,
        error: record.error?.message ?? record.blockReason,
      })
      return true
    }
    agent.setSubAgentCallbacks({
      onStart(id: string, task: string, agentName?: string) {
        const located = findTask(id)
        if (!located) return
        const record = located.task
        subs.onSubagentStart({
          id, task, agentName,
          role: record.metadata.role as string | undefined,
          mode: record.mode,
          model: record.metadata.model as string | undefined,
          workspace: record.workspace?.path,
          workflowRunId: located.workflowRunId,
          workflowPhase: located.workflowPhase,
          prompt: typeof record.metadata.prompt === 'string' ? record.metadata.prompt : undefined,
        })
        setSubagentTick((t) => t + 1)
      },
      onToolUse(id: string, tool: string, info?: string) {
        subs.onSubagentToolUse({ id, tool, info })
        setSubagentTick((t) => t + 1)
      },
      onTokens(id: string, tokens: number) {
        if (!findTask(id)) return
        subs.onSubagentState({ id, tokens })
        setSubagentTick((t) => t + 1)
      },
      onMessage(id: string, role: 'user' | 'assistant' | 'thinking', content: string) {
        subs.onSubagentMessage({ id, role, content })
        setSubagentTick((t) => t + 1)
      },
      onDone(id: string, result: string, tokens?: number, costUsd?: number) {
        syncTask(id)
        subs.onSubagentDone({ id, result, tokens, costUsd })
        setSubagentTick((t) => t + 1)
      },
      onError(id: string, error: string) {
        if (!syncTask(id)) subs.onSubagentError({ id, error })
        setSubagentTick((t) => t + 1)
      },
    })
    return () => agent.setSubAgentCallbacks(null)
  }, [agent])

  useEffect(() => agent.orchestrator.subscribe(event => {
    if (event.type !== 'state_changed' || !event.taskId) return
    // Workflow agents live in their own session registry, so fall back to the workflow-aware
    // lookup: a workflow agent first seen through a state change must still carry the run and
    // phase the monitor groups by.
    const taskId = event.taskId
    const located = (() => {
      try { return { task: agent.orchestrator.registry.getStatus(taskId), workflowRunId: null, workflowPhase: null } }
      catch { return agent.workflows.findTask(taskId) }
    })()
    if (!located) return
    const record = located.task
    subagentsRef.current.onSubagentState({
      id: record.taskId,
      status: record.state,
      workflowRunId: located.workflowRunId,
      workflowPhase: located.workflowPhase,
      task: String(record.metadata.task ?? record.type),
      prompt: typeof record.metadata.prompt === 'string' ? record.metadata.prompt : undefined,
      role: record.metadata.role as string | undefined,
      agentName: record.metadata.agentName as string | undefined,
      mode: record.mode,
      model: record.metadata.model as string | undefined,
      workspace: record.workspace?.path,
      error: record.error?.message ?? record.blockReason,
    })
    setSubagentTick(tick => tick + 1)
  }), [agent])

  useEffect(() => {
    agent.setConfirmHandler((message) => {
      if (isBuildMode(interactionMode) || isAutoMode(interactionMode)) {
        return Promise.resolve(true)
      }
      return new Promise<boolean>((resolve) => {
        setConfirmState({ message, resolve })
      })
    })
    return () => agent.setConfirmHandler(null)
  }, [agent, interactionMode])

  // One-time setup offer: materialize the built-in ignore defaults into the
  // project's .deepseekignore so the user can see and edit them. Editor
  // association is a second, separate ask — writing to global editor settings
  // touches the user's editor config, so it never rides on the first yes.
  useEffect(() => {
    let cancelled = false
    const note = (content: string) => setMessages((m) => [...m, { role: 'assistant', content }])

    const offerEditorAssociation = (root: string) => {
      const settingsPath = getEditorSettingsPath()
      if (cancelled || !settingsPath || !shouldOfferEditorAssociation(root) || hasEditorAssociation(root)) return
      setConfirmState({
        message: `Also map ${IGNORE_FILE_NAME} to the "ignore" language in your global editor settings (${settingsPath})? It gives the file your theme's ignore-file icon and syntax highlighting.`,
        resolve: (yes) => {
          if (cancelled || !yes) return
          try {
            writeEditorAssociation(root)
            note(`✓ Added files.associations for ${IGNORE_FILE_NAME} in global editor settings.`)
          } catch (e) {
            note(`⚠ Could not update global editor settings: ${e instanceof Error ? e.message : String(e)}`)
          }
        },
      })
    }

    try {
      const root = agent.getWorkingDirectory()
      const status = ignoreFileStatus(root)
      if (status.missingDefaults.length === 0 || !shouldOfferIgnoreDefaults(root)) {
        offerEditorAssociation(root)
        return
      }
      const verb = status.exists ? 'update' : 'create'
      setConfirmState({
        message: `${verb === 'create' ? 'Create' : 'Update'} ${IGNORE_FILE_NAME} with DeepSeek Code's default ignore list (${status.missingDefaults.length} entries: node_modules, dist, caches…)? Until then, the defaults apply in memory.`,
        resolve: (yes) => {
          if (cancelled) return
          markIgnoreDefaultsPrompted(root)
          if (yes) {
            try {
              writeIgnoreDefaults(root)
              note(`✓ ${IGNORE_FILE_NAME} ${verb}d with the default ignore entries.`)
            } catch (e) {
              note(`⚠ Could not write ${IGNORE_FILE_NAME}: ${e instanceof Error ? e.message : String(e)}`)
              return
            }
          }
          // Queue after the current prompt clears, so both don't render at once
          setTimeout(() => offerEditorAssociation(root), 0)
        },
      })
    } catch { /* never block startup over the setup offer */ }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    agent.setToolPermissionHandler((request) => {
      return new Promise<ToolPermissionResult>((resolve) => {
        setToolPermissionState({ request, resolve })
      })
    })
    return () => agent.setToolPermissionHandler(null)
  }, [agent])

  useEffect(() => {
    agent.setAskUserHandler((questions, signal) => new Promise<AskUserAnswers | null>((resolve) => {
      askUserResolverRef.current?.(null)
      let settled = false
      const finish = (answers: AskUserAnswers | null) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        if (askUserResolverRef.current === finish) askUserResolverRef.current = null
        setAskUserState(null)
        resolve(answers)
      }
      const onAbort = () => finish(null)
      askUserResolverRef.current = finish
      if (signal?.aborted) { finish(null); return }
      signal?.addEventListener('abort', onAbort, { once: true })
      setAskUserState({ questions, resolve: finish })
    }))
    return () => {
      agent.setAskUserHandler(null)
      askUserResolverRef.current?.(null)
      askUserResolverRef.current = null
    }
  }, [agent])

  useEffect(() => {
    agent.setDiffReviewHandler((summary) => new Promise<boolean>((resolve) => {
      setConfirmState({ message: `Review changes before completing this turn:\n\n${summary}\n\nContinue?`, resolve })
    }))
    return () => agent.setDiffReviewHandler(null)
  }, [agent])

  useEffect(() => {
    agent.setVerificationHandler(async (files) => {
      const { detectVerificationCommand, runVerification } = await import('../agent/verify.js')
      const command = await detectVerificationCommand(agent.getWorkingDirectory())
      if (!command) return
      const approved = await new Promise<boolean>((resolve) => {
        setConfirmState({ message: `Files changed this turn:\n${files.map(file => `  ${file}`).join('\n')}\n\nRun verification?\n\n${command.display}`, resolve })
      })
      if (!approved) return
      const result = await runVerification(command, agent.getWorkingDirectory())
      setMessages((m) => [...m, { role: 'assistant', content: `${result.ok ? '✓' : '✗'} ${command.display}\n\n${result.output}` }])
    })
    return () => agent.setVerificationHandler(null)
  }, [agent])

  useEffect(() => {
    agent.setPlanSubmitHandler(async (planPath: string, summary?: string) => {
      const { readFile } = await import('fs/promises')
      let planContent = ''
      try { planContent = await readFile(planPath, 'utf-8') } catch { planContent = '(plan file could not be read)' }
      return new Promise<string>((resolve, reject) => {
        setPlanApprovalState({ planPath, planContent, summary, resolve, reject })
      })
    })
    return () => agent.setPlanSubmitHandler(null)
  }, [agent])

  useEffect(() => {
    process.stdout.write('\x1b]0;deepseek\x07')
    return () => { process.stdout.write('\x1b]0;\x07') }
  }, [])

  useEffect(() => {
    if (isLoading) {
      process.stdout.write('\x1b]0;deepseek — working...\x07')
    } else {
      process.stdout.write('\x1b]0;deepseek\x07')
    }
  }, [isLoading])

  useEffect(() => {
    const init = async () => {
      // Wait for async initialization (MCP tools, steering, AGENTS.md, DEEPSEEK.md) to complete
      await agent.readyPromise.catch(() => {})
      if (language) {
        agent.setLanguage(language)
      }
      if (enchant !== undefined) {
        agent.setPromptRefinerEnabled(enchant)
      }
      const session = initialSessionRef.current
      if (session?.agentMessages?.length) {
        agent.loadSessionMessages(session.agentMessages)
      }
      if (session?.uiMessages?.length) {
        setMessages(session.uiMessages)
      }
      if (session?.goal) {
        const { setGoal } = await import('../agent/goal.js')
        setGoal(session.goal)
      }
      if (agent.mcpErrors.length > 0) {
        const errMsg = `⚠ MCP connection errors:\n${agent.mcpErrors.map((e) => `  • ${e}`).join('\n')}`
        setMessages((m) => [...m, { role: 'assistant', content: errMsg }])
      }
      if (initialAgent) {
        const { config, source } = initialAgent
        await agent.applyAgentConfig(config)
        setActiveAgent(config.name)
        setActiveAgentColor(config.color)
        const sourceMsg = source === 'local' ? 'local (overrides global)' : 'global'
        setMessages((m) => [...m, { role: 'assistant', content: `Agent '${config.name}' loaded from ${sourceMsg}.` }])
      }
      if (initialMessage) {
        await handleSubmitRef.current?.(initialMessage)
      }
    }
    init()
  }, [])

  const shellProcRef = useRef<ReturnType<typeof execa> | null>(null)

  useEffect(() => {
    return () => {
      if (toolStatusClearTimerRef.current) {
        clearTimeout(toolStatusClearTimerRef.current)
        toolStatusClearTimerRef.current = null
      }
      if (queuedSubmitTimerRef.current) {
        clearTimeout(queuedSubmitTimerRef.current)
        queuedSubmitTimerRef.current = null
      }
      if (saveSessionTimerRef.current) {
        clearTimeout(saveSessionTimerRef.current)
        saveSessionTimerRef.current = null
      }
    }
  }, [])

  const handleAbort = useCallback(() => {
    agent.abort()
    if (goalContinuationTimerRef.current) {
      clearTimeout(goalContinuationTimerRef.current)
      goalContinuationTimerRef.current = null
    }
    if (shellProcRef.current) {
      shellProcRef.current.kill()
      shellProcRef.current = null
    }
    setQueuedMessages([])
  }, [agent])

  const runBtw = useCallback((question: string) => {
    if (!question.trim()) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Usage: /btw <question>' }])
      return
    }
    btwAbortRef.current?.abort()
    const controller = new AbortController()
    btwAbortRef.current = controller
    setBtw({ question })
    void agent.askBtw(question, controller.signal).then(
      (response) => !controller.signal.aborted && setBtw((current) => current?.question === question ? { ...current, response } : current),
      (error: unknown) => !controller.signal.aborted && setBtw((current) => current?.question === question ? { ...current, error: (error as Error).message || 'Failed to get response' } : current),
    ).finally(() => {
      if (btwAbortRef.current === controller) btwAbortRef.current = null
    })
  }, [agent])

  const handleQueue = useCallback((msg: string) => {
    const question = getImmediateBtwQuestion(msg)
    if (question !== undefined) {
      runBtw(question)
      return
    }
    setQueuedMessages((q) => enqueue(q, msg))
  }, [runBtw])

  const handleModeChange = useCallback(() => {
    setInteractionMode((current) => nextMode(current))
  }, [])

  const handleConfirm = useCallback((yes: boolean) => {
    if (!confirmState) return
    confirmState.resolve(yes)
    setConfirmState(null)
  }, [confirmState])

  const handleToolPermission = useCallback((result: ToolPermissionResult) => {
    if (!toolPermissionState) return
    toolPermissionState.resolve(result)
    setToolPermissionState(null)
  }, [toolPermissionState])

  const handlePlanDecision = useCallback((result: PlanApprovalResult) => {
    if (!planApprovalState) return
    if (result.approved) {
      planApprovalState.resolve(JSON.stringify({ approved: true, message: 'Plan accepted. Now switch to Build mode and implement it.' }))
      agent.interactionMode = 'build'
      setInteractionMode('build')
    } else if ('aborted' in result && result.aborted) {
      planApprovalState.reject('aborted')
      agent.interactionMode = 'build'
      setInteractionMode('build')
    } else {
      const feedback = 'feedback' in result ? result.feedback : ''
      planApprovalState.resolve(JSON.stringify({
        approved: false,
        feedback,
        message: `Plan rejected. User feedback: ${feedback}. Revise the plan file and call submit_plan again when done.`,
      }))
    }
    setPlanApprovalState(null)
  }, [planApprovalState, agent])

  const runAgent = useCallback(async (prompt: string) => {
    turnStartedAtRef.current = Date.now()
    subagentsRef.current.clearResolved()
    setSubagentTick((tick) => tick + 1)
    lastTurnTokenCountRef.current = agent.tokenCount
    let tokenBuffer = ''
    let streamTextAccum = ''
    let thinkingAccum = ''
    thinkingStartedAtRef.current = null

    const mergeThinking = (next: string) => {
      const trimmed = next.trim()
      if (!trimmed) return
      if (!thinkingAccum) {
        thinkingAccum = trimmed
        return
      }
      if (trimmed.includes(thinkingAccum)) {
        thinkingAccum = trimmed
        return
      }
      if (!thinkingAccum.includes(trimmed)) {
        thinkingAccum = `${thinkingAccum}\n${trimmed}`
      }
    }

    const flushThinkingMessage = () => {
      const finalThinking = thinkingAccum.trim()
      if (!finalThinking) return
      if (thinkingStartedAtRef.current == null) thinkingStartedAtRef.current = Date.now()
      const thinkingMs = Date.now() - thinkingStartedAtRef.current
      thinkingStartedAtRef.current = null
      setMessages((m) => [...m, { role: 'thinking', content: finalThinking, thinkingMs }])
      thinkingAccum = ''
    }

    // Live tool call being streamed by the model. Coalesced into the 50ms flush
    // below instead of re-rendering on every argument delta.
    let pendingTool: { name: string; args: string } | null = null

    // Shows a tool as active, cancelling any pending clear from the previous
    // tool — otherwise that 800ms timer would wipe this one's card.
    const showActiveTool = (status: ToolStatus) => {
      if (toolStatusClearTimerRef.current) {
        clearTimeout(toolStatusClearTimerRef.current)
        toolStatusClearTimerRef.current = null
      }
      setToolStatus(status)
    }

    const flushInterval = setInterval(() => {
      if (tokenBuffer) {
        const buf = tokenBuffer
        tokenBuffer = ''
        streamTextAccum += buf
        // Live-process: separate thinking from visible content
        const { thinking, content } = processStreamedText(streamTextAccum)
        if (thinking) {
          if (thinkingStartedAtRef.current == null) thinkingStartedAtRef.current = Date.now()
          mergeThinking(thinking)
          setThinkingText(thinkingAccum)
        }
        setStreamText(content)
      }
      if (pendingTool) {
        const { name, args } = pendingTool
        pendingTool = null
        showActiveTool({ name, args: previewStreamingArgs(args), done: false })
      }
    }, 50)

    try {
      await agent.run(prompt, {
        onPhaseChange(phase) { setAgentPhase(phase) },
        onToken(token) { tokenBuffer += token },
        onToolPending(name, argsText) { pendingTool = { name, args: argsText } },
        onThinking(text) {
          if (thinkingStartedAtRef.current == null) thinkingStartedAtRef.current = Date.now()
          thinkingAccum += text
          setThinkingText(thinkingAccum)
        },
        onToolCall(name, args) {
          const pending = (streamTextAccum + tokenBuffer).trim()
          tokenBuffer = ''
          streamTextAccum = ''
          setStreamText('')
          if (pending) {
            const { thinking, content } = processStreamedText(pending)
            if (thinking) mergeThinking(thinking)
            flushThinkingMessage()
            setThinkingText('')
            if (content) setMessages((m) => [...m, { role: 'assistant', content }])
          } else {
            flushThinkingMessage()
            setThinkingText('')
          }
          setToolCallCount((c) => c + 1)
          // Streamed preview is superseded by the real args — drop it so a late
          // flush cannot overwrite them.
          pendingTool = null
          // For subagent, show the task text instead of raw JSON
          const argsPreview = name === 'subagent' && typeof (args as Record<string, unknown>)?.task === 'string'
            ? (() => {
                const task = (args as Record<string, unknown>).task as string
                const firstLine = task.split('\n').map(l => l.replace(/^#+\s*/, '').trim()).find(l => l.length > 0) ?? task
                return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine
              })()
            : previewToolCallArgs(name, args as Record<string, unknown>)
          showActiveTool({ name, args: argsPreview, done: false })
        },
        onToolResult(name, result, args) {
          // Mark tool as done (shows checkmark briefly) then clear
          setToolStatus((prev) => prev?.name === name ? { ...prev, done: true, result: result.slice(0, 200) } : null)
          if (toolStatusClearTimerRef.current) {
            clearTimeout(toolStatusClearTimerRef.current)
          }
          toolStatusClearTimerRef.current = setTimeout(() => {
            setToolStatus(null)
            toolStatusClearTimerRef.current = null
          }, 800)
          if (name === 'shell') {
            const cmd = args?.command ?? ''
            const payload = JSON.stringify({ arg: String(cmd), output: result ?? '' })
            setMessages((m) => [...m, { role: 'tool', content: `✓ shell → ${payload}` }])
          } else if (name === 'write_file' || name === 'patch_file') {
            setMessages((m) => [...m, { role: 'tool', content: `✓ ${name} → ${result}` }])
          } else if (name === 'read_file' || name === 'read_folder' || name === 'glob' || name === 'grep') {
            const argPreview = args?.path ?? args?.pattern ?? ''
            setMessages((m) => [...m, { role: 'tool', content: `✓ ${name} → ${String(argPreview)}` }])
          } else if (name === 'ask_user_questions') {
            setMessages((m) => [...m, { role: 'tool', content: `✓ ${name} → ${summarizeToolResult(name, result)}` }])
          } else if (!name.includes('__')) {
            // Show other built-in tools too
            setMessages((m) => [...m, { role: 'tool', content: `✓ ${name} → ${result.slice(0, 100)}` }])
          }
        },
        onDone() {
          clearInterval(flushInterval)
          const workedMs = turnStartedAtRef.current == null ? undefined : Date.now() - turnStartedAtRef.current
          turnStartedAtRef.current = null
          const pending = (streamTextAccum + tokenBuffer).trim()
          tokenBuffer = ''
          streamTextAccum = ''
          pendingTool = null
          setToolStatus(null)
          setStreamText('')
          if (pending) {
            const { thinking, content } = processStreamedText(pending)
            if (thinking) mergeThinking(thinking)
            flushThinkingMessage()
            setThinkingText('')
            if (content) setMessages((m) => [...m, { role: 'assistant', content, workedMs }])
          } else {
            flushThinkingMessage()
            setThinkingText('')
          }
          setIsLoading(false)
          setAgentPhase('idle')
          setTokenCount(agent.tokenCount)
          setSubagentTick((t) => t + 1)
          void refreshCustomCommands(agent.getWorkingDirectory())
          setQueuedMessages((q) => {
            if (q.length === 0) return q
            const [first, ...rest] = q
            if (queuedSubmitTimerRef.current) {
              clearTimeout(queuedSubmitTimerRef.current)
            }
            queuedSubmitTimerRef.current = setTimeout(() => {
              queuedSubmitTimerRef.current = null
              void handleSubmitRef.current!(first!)
            }, 0)
            return rest
          })
          const pct = agent.contextLimit > 0 ? Math.round((agent.contextUsage / agent.contextLimit) * 100) : 0
          setContextPct(pct)
          if (sessionId) {
            if (saveSessionTimerRef.current) {
              clearTimeout(saveSessionTimerRef.current)
            }
            saveSessionTimerRef.current = setTimeout(() => {
              saveSessionTimerRef.current = null
              setMessages((current) => {
                saveSession({
                  id: sessionId,
                  title: sessionTitleRef.current ?? undefined,
                  createdAt: initialSession?.createdAt ?? new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  cwd: agent.getWorkingDirectory(),
                  model: agent.model,
                  provider: agent.provider,
                  language: language ?? null,
                  activeAgent: agent.activeAgent,
                  agentMessages: agent.getRawMessages(),
                  uiMessages: current,
                  filesModified: agent.getFilesModified(),
                  goal: (() => {
                    const g = getGoal()
                    if (!g) return undefined
                    // Only touch active goals: freeze elapsed time and reset the
                    // active interval so a reload does not double-count it.
                    if (g.status !== 'active') return g
                    const now = new Date().toISOString()
                    return { ...g, timeUsedSeconds: getElapsedSeconds(g), startedAt: now, updatedAt: now }
                  })(),
                })
                return current
              })
            }, 100)
          }
          // Auto-continuation: if goal is active, schedule next turn
          import('../agent/goal.js').then(({ getGoal, updateGoal, buildContinuationPrompt, GOAL_MAX_CONTINUATIONS }) => {
            const activeGoal = getGoal()
            const maxTurns = activeGoal?.maxContinuations ?? GOAL_MAX_CONTINUATIONS
            if (activeGoal?.status !== 'active') return
            const turnTokens = agent.tokenCount - lastTurnTokenCountRef.current
            const now = new Date().toISOString()
            updateGoal({
              tokensUsed: activeGoal.tokensUsed + Math.max(0, turnTokens),
              updatedAt: now,
            })
            if (activeGoal.continuations >= maxTurns) {
              updateGoal({ status: 'budget_limited', updatedAt: new Date().toISOString() })
              setMessages((m) => [...m, { role: 'assistant', content: `⚠ Goal turn limit reached (${activeGoal.continuations}/${maxTurns} turns). Goal paused.` }])
              return
            }
            const updated = getGoal()!
            if (updated.tokenBudget !== undefined && updated.tokensUsed >= updated.tokenBudget) {
              updateGoal({ status: 'budget_limited', updatedAt: new Date().toISOString() })
              setMessages((m) => [...m, { role: 'assistant', content: `⚠ Goal budget limit reached (${updated.tokensUsed}/${updated.tokenBudget} tokens). Goal paused.` }])
            } else {
              updated.continuations++
              const prompt = buildContinuationPrompt(updated, updated.continuations)
              goalContinuationTimerRef.current = setTimeout(() => {
                goalContinuationTimerRef.current = null
                setQueuedMessages((q) => {
                  const next = enqueue(q, prompt)
                  // Queue processing already ran earlier in onDone, so if
                  // the queue was empty before this enqueue we must trigger
                  // the dequeue ourselves.
                  if (q.length === 0 && next.length > 0) {
                    if (queuedSubmitTimerRef.current) clearTimeout(queuedSubmitTimerRef.current)
                    queuedSubmitTimerRef.current = setTimeout(() => {
                      queuedSubmitTimerRef.current = null
                      void handleSubmitRef.current!(next[0]!)
                    }, 0)
                  }
                  return next
                })
              }, 200)
            }
          })
        },
        onDenyAbort() {
          const workedMs = turnStartedAtRef.current == null ? undefined : Date.now() - turnStartedAtRef.current
          turnStartedAtRef.current = null
          setMessages((m) => [...m, { role: 'assistant', content: '⛔ Execution aborted by user.', workedMs }])
        },
        onMicroCompact() {
          showCompactBadge('micro')
        },
        onAutoCompact(summary) {
          setMessages((m) => [...m, { role: 'assistant', content: `⚡ Context compacted automatically.\n\n${summary}` }])
          showCompactBadge('full')
        },
      })
    } catch (e: unknown) {
      clearInterval(flushInterval)
      const workedMs = turnStartedAtRef.current == null ? undefined : Date.now() - turnStartedAtRef.current
      turnStartedAtRef.current = null
      setStreamText('')
      setThinkingText('')
      setToolStatus(null)
      setIsLoading(false)
      setAgentPhase('idle')
      setSubagentTick((t) => t + 1)
      const provider = providerConfig?.provider ?? 'deepseek'
      const message = e instanceof Error
        ? formatChatError(e, provider)
        : String(e)
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ Error: ${message}`, workedMs }])
    }
  }, [agent, sessionId, language, initialSession, providerConfig, showCompactBadge])

  const generateSessionTitle = useCallback(() => {
    if (!sessionId) return
    void agent.askBtw('Create a concise title for this conversation. Return exactly one plain-text title, in the user language, with 3 to 7 words and no quotes, markdown, prefix, punctuation at the end, or explanation.')
      .then(raw => {
        const title = raw.split('\n').map(line => line.trim()).find(Boolean)
          ?.replace(/^[-*#`]+\s*/, '').replace(/^['"]|['"]$/g, '').replace(/[.!?]+$/, '').trim().slice(0, 80)
        if (!title) { titleRequestedRef.current = false; return }
        sessionTitleRef.current = title
        void updateSessionTitle(sessionId, title, agent.getWorkingDirectory())
      })
      .catch(() => { titleRequestedRef.current = false })
  }, [agent, sessionId])

  const runWithPrompt = useCallback(async (label: string, prompt: string, intendedMode: InteractionMode) => {
    if (isLoading) return
    const shouldGenerateTitle = Boolean(sessionId && !sessionTitleRef.current && !titleRequestedRef.current && !agent.getLastUserMessage())
    if (shouldGenerateTitle) titleRequestedRef.current = true
    setMessages((m) => [...m, { role: 'user', content: label }])
    setIsLoading(true)
    setAgentPhase('refining')
    setStreamText('')

    const worktreePolicy = agent.settings.git?.worktree ?? 'ask'
    const cwdChanged = projectRootRef.current !== originalProjectRoot.current
    if (!cwdChanged && (isBuildMode(intendedMode) || isAutoMode(intendedMode)) && worktreePolicy !== 'off') {
      try {
        const { createWorktree, getActiveWorktree, isInsideWorktree, isGitRepository } = await import('../agent/worktree.js')
        const projectRoot = originalProjectRoot.current
        if (!isGitRepository(projectRoot)) {
          await runAgent(prompt)
          if (shouldGenerateTitle) generateSessionTitle()
          return
        }
        const active = await getActiveWorktree(projectRoot)
        if (active && active.sessionId != null && active.sessionId === sessionId && existsSync(active.path) && !isInsideWorktree(projectRoot, agent.getWorkingDirectory())) {
          await agent.setWorkingDirectory(active.path)
          await refreshCustomCommands(active.path)
        }
        let isolate = worktreePolicy === 'auto'
        if (!active && worktreePolicy === 'ask') {
          isolate = await new Promise<boolean>((resolve) => {
            setConfirmState({ message: 'Run this mutating turn in an isolated Git worktree?', resolve })
          })
        }
        if (!active && isolate) {
          const info = await createWorktree(projectRoot, sessionId)
          await agent.setWorkingDirectory(info.path)
          await refreshCustomCommands(info.path)
          setMessages((m) => [...m, { role: 'assistant', content: `Worktree "${info.name}" created on ${info.branch ?? 'an isolated copy'} at ${info.path}.` }])
        }
      } catch (error) {
        setIsLoading(false)
        setAgentPhase('idle')
        setMessages((m) => [...m, { role: 'assistant', content: `△ Worktree isolation failed; turn aborted: ${(error as Error).message}\n  Use /cwd <path> to change directory, or /worktree exit to clear the stale worktree.` }])
        return
      }
    }
    await runAgent(prompt)
    if (shouldGenerateTitle) generateSessionTitle()
  }, [isLoading, runAgent, agent, generateSessionTitle, sessionId])

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim()) return

    // While focused on a subagent, plain text goes to that subagent via its
    // mailbox ('question' messages are drained by the executor each iteration);
    // slash commands and `!` shell lines still hit the main agent.
    // ponytail: a message sent to a finished/blocked agent sits in the mailbox
    // unread (executor not running) — acceptable v1, surfaces on resume.
    if (focusedSubagent) {
      const msg = text.trim()
      if (!msg.startsWith('/') && !msg.startsWith('!')) {
        const a = subagentsRef.current.agents.find(x => x.id === focusedSubagent.id)
        if (a) { a.messages = [...(a.messages ?? []), { role: 'user', content: msg }]; setSubagentTick(t => t + 1) }
        void agent.controlTask(focusedSubagent.id, 'message', msg)
        return
      }
      // Slash command or `!` shell line routes to the MAIN agent — leave
      // subagent focus so the main-agent progress UI is not masked.
      setFocusedSubagent(null)
      setActivityOpen(false)
    }

    const cmd = await resolveCommand(text, agent.getWorkingDirectory())
    const liveWorkflowControl = cmd?.type === 'workflows' || (cmd?.type === 'workflow' && ['pause', 'resume', 'stop'].includes(cmd.action))
    if (isLoading && !liveWorkflowControl) return
    if (cmd) {
      switch (cmd.type) {
        case 'quit':
          stopGuiProcess()
          if (onExit) {
            onExit()
            return
          }
          process.exit(0)
        case 'logout': {
          const { logout } = await import('../utils/credentials.js')
          await logout()
          onLogout?.()
          return
        }
        case 'clear':
          agent.clearHistory()
          setMessages([])
          return
        case 'compact': {
          setIsLoading(true)
          const summary = await agent.compact()
          setMessages([{ role: 'assistant', content: `**Context compacted.** Summary:\n\n${summary}` }])
          setIsLoading(false)
          showCompactBadge('full')
          return
        }
        case 'help':
          setMessages((m) => [...m, { role: 'assistant', content: HELP_TEXT }])
          return
        case 'model':
          agent.setModel(cmd.model)
          setMessages((m) => [...m, { role: 'assistant', content: `Model switched to ${cmd.model}` }])
          return
        case 'models': {
          setIsLoading(true)
          const models = await agent.getAvailableModels()
          setIsLoading(false)
          setAvailableModels(models)
          // Generate descriptions for unknown models (background, non-blocking)
          agent.generateDescriptions(models).then(setModelDescriptions)
          setShowModelSelector(true)
          return
        }
        case 'config':
          setShowConfigMenu(true)
          return
        case 'agents': {
          const agents = await listAgents(agent.getWorkingDirectory())
          if (!agents.length) {
            setMessages((m) => [...m, { role: 'assistant', content: 'No agents found. Create .deepseek/agents/<name>.json or ~/.deepseek/agents/<name>.json' }])
          } else {
            const list = agents.map((a) => `  ${a.name} (${a.source})`).join('\n')
            setMessages((m) => [...m, { role: 'assistant', content: `Available agents:\n${list}` }])
          }
          return
        }
        case 'agent': {
          try {
            const { config, source } = await loadAgentConfig(cmd.name, agent.getWorkingDirectory())
            await agent.applyAgentConfig(config)
            setActiveAgent(config.name)
            setActiveAgentColor(config.color)
            const sourceMsg = source === 'local' ? 'local (overrides global)' : 'global'
            setMessages((m) => [...m, { role: 'assistant', content: `Agent '${config.name}' loaded from ${sourceMsg}.` }])
          } catch (e) {
            setMessages((m) => [...m, { role: 'assistant', content: (e as Error).message }])
          }
          return
        }
        case 'undo': {
          let result: string
          if ('action' in cmd && cmd.action === 'all') {
            result = await agent.undoAll()
          } else if ('action' in cmd && cmd.action === 'list') {
            result = await agent.undoList()
          } else {
            result = await agent.undo()
          }
          setMessages((m) => [...m, { role: 'assistant', content: result }])
          return
        }
        case 'retry': {
          const last = agent.getLastUserMessage()
          if (!last) {
            setMessages((m) => [...m, { role: 'assistant', content: 'Nothing to retry.' }])
            return
          }
          setMessages((m) => {
            const idx = [...m].reverse().findIndex((msg) => msg.role === 'user')
            if (idx === -1) return m
            return m.slice(0, m.length - 1 - idx)
          })
          await handleSubmit(last)
          return
        }
        case 'cost': {
          const summary = agent.getCostSummary()
          setMessages((m) => [...m, { role: 'assistant', content: summary }])
          return
        }
        case 'mobile': {
          setShowMobileQR(true)
          return
        }
        case 'gui': {
          if (guiProcessRef.current && guiProcessRef.current.exitCode === null) {
            setMessages((m) => [...m, { role: 'assistant', content: 'The GUI is already running.' }])
            return
          }
          const entrypoint = process.argv[1]
          if (!entrypoint) {
            setMessages((m) => [...m, { role: 'assistant', content: 'Could not determine the DeepSeek entrypoint.' }])
            return
          }
          const absoluteEntrypoint = resolve(process.cwd(), entrypoint)
          let child: ReturnType<typeof Bun.spawn> | null = null
          try {
            child = Bun.spawn([process.execPath, absoluteEntrypoint, '--web'], {
              cwd: agent.getWorkingDirectory(),
              stdin: 'ignore',
              stdout: 'ignore',
              stderr: 'ignore',
              detached: true,
            })
            guiProcessRef.current = child
            setMessages((m) => [...m, { role: 'assistant', content: 'Opening the DeepSeek Code GUI in your browser…' }])
            const exitCode = await child.exited
            if (guiProcessRef.current !== child) return
            guiProcessRef.current = null
            if (exitCode !== 0) setMessages((m) => [...m, { role: 'assistant', content: `The GUI process exited with code ${exitCode}.` }])
          } catch (error) {
            if (child && guiProcessRef.current !== child) return
            if (guiProcessRef.current === child) guiProcessRef.current = null
            setMessages((m) => [...m, { role: 'assistant', content: `Could not start the GUI: ${(error as Error).message}` }])
          }
          return
        }
        case 'files': {
          const files = agent.getFilesModified()
          const content = files.length
            ? `Files modified this session:\n${files.map((f) => `  ${f}`).join('\n')}`
            : 'No files modified this session.'
          setMessages((m) => [...m, { role: 'assistant', content: content }])
          return
        }
        case 'tools': {
          const names = agent.getToolNames()
          const builtIn = names.filter((n) => !n.includes('__'))
          const mcp = names.filter((n) => n.includes('__'))
          const lines = [
            `Built-in tools (${builtIn.length}):`,
            ...builtIn.map((n) => `  ${n}`),
            ...(mcp.length ? [`\nMCP tools (${mcp.length}):`, ...mcp.map((n) => `  ${n}`)] : []),
          ]
          setMessages((m) => [...m, { role: 'assistant', content: lines.join('\n') }])
          return
        }
        case 'doctor': {
          const { formatDoctorReport, runDoctor } = await import('../doctor.js')
          setIsLoading(true)
          try {
            const report = await runDoctor(agent.getWorkingDirectory())
            setMessages((m) => [...m, { role: 'assistant', content: formatDoctorReport(report) }])
          } finally {
            setIsLoading(false)
          }
          return
        }
        case 'verify': {
          const { detectVerificationCommand, runVerification } = await import('../agent/verify.js')
          const command = await detectVerificationCommand(agent.getWorkingDirectory())
          if (!command) {
            setMessages((m) => [...m, { role: 'assistant', content: 'No supported project test command found.' }])
            return
          }
          const approved = await new Promise<boolean>((resolve) => {
            setConfirmState({ message: `Run verification?\n\n${command.display}`, resolve })
          })
          if (!approved) return
          setIsLoading(true)
          try {
            const result = await runVerification(command, agent.getWorkingDirectory())
            setMessages((m) => [...m, { role: 'assistant', content: `${result.ok ? '✓' : '✗'} ${command.display}\n\n${result.output}` }])
          } catch (error) {
            setMessages((m) => [...m, { role: 'assistant', content: `✗ ${command.display}\n\n${(error as Error).message}` }])
          } finally {
            setIsLoading(false)
          }
          return
        }
        case 'catalog': {
          const { formatCatalog } = await import('../catalog.js')
          setMessages((m) => [...m, { role: 'assistant', content: formatCatalog(cmd.kind) }])
          return
        }
        case 'system': {
          const summary = agent.getSystemPrompt()
          setMessages((m) => [...m, { role: 'assistant', content: `**Active mode & permissions:**\n\n\`\`\`\n${summary}\n\`\`\`` }])
          return
        }
        case 'checkpoint': {
          if (cmd.action === 'save') {
            const id = await agent.saveCheckpoint(cmd.label)
            setMessages((m) => [...m, { role: 'assistant', content: `Checkpoint saved (id: ${id})` }])
          } else if (cmd.action === 'list') {
            const cps = await agent.listCheckpoints()
            if (!cps.length) {
              setMessages((m) => [...m, { role: 'assistant', content: 'No checkpoints saved.' }])
            } else {
              const list = cps.map((c) => `  ${c.id}  ${c.label}  (${c.filesModified.length} files)`).join('\n')
              setMessages((m) => [...m, { role: 'assistant', content: `Checkpoints:\n${list}` }])
            }
          } else if (cmd.action === 'restore') {
            const result = await agent.restoreCheckpoint(cmd.id)
            setMessages([{ role: 'assistant', content: result }])
          }
          return
        }
        case 'sessions': {
          if ('action' in cmd && cmd.action === 'export') {
            try {
              const { exportSession } = await import('../agent/session.js')
              const path = await exportSession(cmd.id, cmd.format, agent.getWorkingDirectory())
              setMessages((m) => [...m, { role: 'assistant', content: `Sanitized session export written to ${path}` }])
            } catch (error) {
              setMessages((m) => [...m, { role: 'assistant', content: `✗ ${(error as Error).message}` }])
            }
            return
          }
          const { listSessions } = await import('../agent/session.js')
          const sessions = await listSessions()
          if (!sessions.length) {
            setMessages((m) => [...m, { role: 'assistant', content: 'No saved sessions.' }])
          } else {
            const lines = sessions.slice(0, 10).map((s) => {
              const date = new Date(s.updatedAt).toLocaleString()
              const msgs = s.uiMessages.filter((m) => m.role === 'user').length
              return `  ${s.title ?? s.uiMessages.find(m => m.role === 'user')?.content?.split('\n')[0] ?? 'New conversation'}  ${date}  ${msgs} messages  ${s.cwd}`
            })
            setMessages((m) => [...m, { role: 'assistant', content: `Recent sessions:\n${lines.join('\n')}\n\nResume: deepseek --resume <id>\nExport: /sessions export <id> [json|md]` }])
          }
          return
        }
        case 'plan': {
          if (isLoading) return
          const { mkdir } = await import('fs/promises')
          const { dirname } = await import('path')
          const planPath = newPlanPath(cmd.task, agent.getWorkingDirectory())
          await mkdir(dirname(planPath), { recursive: true })
          // Set plan mode synchronously on both agent and React state
          agent.interactionMode = 'plan'
          agent.planFilePath = planPath
          setInteractionMode('plan')
          const injection = buildPlanModeInjection(cmd.task, planPath)
          const label = `/plan ${cmd.task}`
          setMessages((m) => [...m, { role: 'user', content: label }])
          setIsLoading(true)
          setAgentPhase('refining')
          setStreamText('')
          try {
            await runAgent(injection)
          } finally {
            setIsLoading(false)
            agent.planFilePath = null
          }
          return
        }
        case 'review': {
          const label = cmd.target ? `/review ${cmd.target}` : '/review'
          const prompt = REVIEW_PROMPT(cmd.target)
          agent.interactionMode = 'review'
          setInteractionMode('review')
          await runWithPrompt(label, prompt, 'review')
          return
        }
        case 'permissions': {
          const { formatPermissionsReport } = await import('../permissions/index.js')
          const info = agent.getPermissionsInfo()
          setMessages((m) => [...m, { role: 'assistant', content: formatPermissionsReport(info) }])
          return
        }
        case 'btw': {
          runBtw(cmd.question)
          return
        }
        case 'vim': {
          setVimEnabled((v) => {
            const next = !v
            setMessages((m) => [...m, { role: 'assistant', content: `Vim mode ${next ? 'enabled' : 'disabled'}. ${next ? 'Esc = NORMAL, i/a/I/A = INSERT, h/j/k/l/w/b/0/$/x/D to navigate.' : ''}` }])
            return next
          })
          return
        }
        case 'effort': {
          const EFFORT_DESCRIPTIONS: Record<string, string> = {
            low: 'Quick, straightforward responses',
            high: 'Comprehensive responses with extensive thinking',
            max: 'Maximum reasoning depth (best with deepseek-reasoner)',
          }
          if (cmd.action === 'status') {
            setMessages((m) => [...m, { role: 'user', content: text }])
            setShowEffortSelector(true)
          } else {
            setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: `Effort: ${cmd.level} — ${EFFORT_DESCRIPTIONS[cmd.level]}` }])
            agent.setEffortLevel(cmd.level)
          }
          return
        }
        case 'stats': {
          const stats = agent.getStats()
          setMessages((m) => [...m, { role: 'assistant', content: stats }])
          return
        }
        case 'memory': {
          await agent.readyPromise.catch(() => {})
          if ((cmd as any).action === 'clear') {
            const target = (cmd as any).target
            await agent.orchestrator.memory.clear(target)
            setMessages((m) => [...m, { role: 'assistant', content: `Memory cleared${target ? ` (${target})` : ''}.` }])
          } else {
            const [agentEntries, userEntries] = await Promise.all([
              agent.orchestrator.memory.load('agent'),
              agent.orchestrator.memory.load('user'),
            ])
            const lines: string[] = []
            lines.push('**Agent Memory** (' + agentEntries.length + ' entries)')
            if (agentEntries.length) agentEntries.forEach((e, i) => lines.push(`  ${i + 1}. ${e}`))
            else lines.push('  (empty)')
            lines.push('')
            lines.push('**User Preferences** (' + userEntries.length + ' entries)')
            if (userEntries.length) userEntries.forEach((e, i) => lines.push(`  ${i + 1}. ${e}`))
            else lines.push('  (empty)')
            setMessages((m) => [...m, { role: 'assistant', content: lines.join('\n') }])
          }
          return
        }
        case 'skill': {
          if (cmd.action === 'help') {
            setMessages((m) => [...m, { role: 'assistant', content: `Skill commands:\n  /skill install <owner/repo>  install a skill from GitHub\n  /skill list                  list installed skills\n  /skill remove <name>         remove an installed skill\n  /skill update <name>         update a skill to latest` }])
          } else if (cmd.action === 'error') {
            setMessages((m) => [...m, { role: 'assistant', content: `Error: ${cmd.message}` }])
          } else if (cmd.action === 'list') {
            setIsLoading(true)
            try {
              const { listSkills } = await import('../skills/installer.js')
              const { join } = await import('path')
              const cwd = agent.getWorkingDirectory()
              const primary = join(cwd, '.deepseek', 'skills')
              const legacy = join(cwd, '.claude', 'skills')
              const [primarySkills, legacySkills] = await Promise.all([
                listSkills(primary).catch(() => []),
                listSkills(legacy).catch(() => []),
              ])
              const merged = [...primarySkills]
              const migrated: string[] = []
              for (const ls of legacySkills) {
                if (!merged.some(s => s.name === ls.name)) {
                  merged.push(ls)
                  migrated.push(ls.name)
                }
              }
              if (!merged.length) {
                setMessages((m) => [...m, { role: 'assistant', content: 'No skills installed via /skill. Use /skill install <owner/repo> to add one.' }])
              } else {
                const lines = merged.map((s) => `  ${s.name}  (${s.repo})  ${s.description}`)
                const notice = migrated.length ? `\n\n⚠️ ${migrated.join(', ')} still in legacy .claude/skills. Reinstall to migrate to .deepseek/skills.` : ''
                setMessages((m) => [...m, { role: 'assistant', content: `Installed skills:\n${lines.join('\n')}${notice}` }])
              }
            } catch (e) {
              setMessages((m) => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'install') {
            setMessages((m) => [...m, { role: 'assistant', content: `Installing skill from ${cmd.repo}...` }])
            setIsLoading(true)
            try {
              const { installSkill, listSkills } = await import('../skills/installer.js')
              const { join } = await import('path')
              const cwd = agent.getWorkingDirectory()
              const primary = join(cwd, '.deepseek', 'skills')
              const legacy = join(cwd, '.claude', 'skills')
              const [primarySkills, legacySkills] = await Promise.all([
                listSkills(primary).catch(() => []),
                listSkills(legacy).catch(() => []),
              ])
              const nameFromRepo = cmd.repo.split('/')[1]
              if (nameFromRepo && [...primarySkills, ...legacySkills].some(s => s.name === nameFromRepo)) {
                setMessages((m) => [...m, { role: 'assistant', content: `✗ Skill from '${cmd.repo}' already installed (found in .deepseek/skills or legacy .claude/skills). Use /skill update or remove first.` }])
                setIsLoading(false)
              } else {
                const result = await installSkill(cmd.repo, primary)
                if (result.ok) {
                  setMessages((m) => [...m, { role: 'assistant', content: `✓ Skill '${result.name}' installed successfully.` }])
                } else {
                  setMessages((m) => [...m, { role: 'assistant', content: `✗ ${result.error}` }])
                }
              }
            } catch (e) {
              setMessages((m) => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'remove') {
            setIsLoading(true)
            try {
              const { removeSkill } = await import('../skills/installer.js')
              const { join } = await import('path')
              const cwd = agent.getWorkingDirectory()
              const primary = join(cwd, '.deepseek', 'skills')
              const legacy = join(cwd, '.claude', 'skills')
              let result = await removeSkill(cmd.name, primary)
              if (!result.ok) result = await removeSkill(cmd.name, legacy)
              if (result.ok) {
                setMessages((m) => [...m, { role: 'assistant', content: `✓ Skill '${result.name}' removed.` }])
              } else {
                setMessages((m) => [...m, { role: 'assistant', content: `✗ Skill '${cmd.name}' not found in .deepseek/skills or .claude/skills.` }])
              }
            } catch (e) {
              setMessages((m) => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'update') {
            setIsLoading(true)
            try {
              const { updateSkill, installSkill, removeSkill } = await import('../skills/installer.js')
              const { join } = await import('path')
              const cwd = agent.getWorkingDirectory()
              const primary = join(cwd, '.deepseek', 'skills')
              const legacy = join(cwd, '.claude', 'skills')
              let result = await updateSkill(cmd.name, primary)
              if (!result.ok) {
                result = await updateSkill(cmd.name, legacy)
                if (result.ok) {
                  const { readRegistry } = await import('../skills/registry.js')
                  const reg = readRegistry(legacy)
                  const entry = reg.skills[cmd.name]
                  if (!entry?.repo) throw new Error(`Cannot migrate skill '${cmd.name}': registry entry is missing.`)
                  const installed = await installSkill(entry.repo, primary)
                  if (!installed.ok) throw new Error(installed.error ?? `Failed to install skill '${cmd.name}' in .deepseek/skills.`)
                  const removed = await removeSkill(cmd.name, legacy)
                  if (!removed.ok) throw new Error(removed.error ?? `Failed to remove legacy skill '${cmd.name}'.`)
                  setMessages((m) => [...m, { role: 'assistant', content: `✓ Skill '${cmd.name}' migrated from .claude/skills to .deepseek/skills and updated.` }])
                  setIsLoading(false)
                  return
                }
              }
              if (result.ok) {
                setMessages((m) => [...m, { role: 'assistant', content: `✓ Skill '${result.name}' updated.` }])
              } else {
                setMessages((m) => [...m, { role: 'assistant', content: `✗ ${result.error}` }])
              }
            } catch (e) {
              setMessages((m) => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          }
          return
        }
        case 'plugin': {
          if (cmd.action === 'help') {
            setMessages((m) => [...m, { role: 'assistant', content: `Plugin commands:\n  /plugin install <owner/repo>  install a plugin from GitHub\n  /plugin list                  list installed plugins\n  /plugin remove <name>         remove a plugin\n  /plugin update <name>         update a plugin to latest` }])
          } else if (cmd.action === 'error') {
            setMessages((m) => [...m, { role: 'assistant', content: `Error: ${cmd.message}` }])
          } else if (cmd.action === 'list') {
            setIsLoading(true)
            try {
              const { loadInstalledPlugins } = await import('../plugins/index.js')
              const plugins = loadInstalledPlugins()
              if (!plugins.length) {
                setMessages((m) => [...m, { role: 'assistant', content: 'No plugins installed. Use /plugin install <owner/repo> to add one.' }])
              } else {
                const lines = plugins.map((p) => {
                  const c = p.entry.components
                  const parts: string[] = []
                  if (c.commands.length) parts.push(`${c.commands.length} cmd`)
                  if (c.agents.length) parts.push(`${c.agents.length} agents`)
                  if (c.skills.length) parts.push(`${c.skills.length} skills`)
                  if (c.hasHooks) parts.push('hooks')
                  return `  ${p.entry.name}  (${p.entry.repo})  [${parts.join(', ')}]`
                })
                setMessages((m) => [...m, { role: 'assistant', content: `Installed plugins:\n${lines.join('\n')}` }])
              }
            } catch (e) {
              setMessages((m) => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'install') {
            setMessages((m) => [...m, { role: 'assistant', content: `Installing plugin from ${cmd.repo}...` }])
            setIsLoading(true)
            try {
              const { installPlugin } = await import('../plugins/index.js')
              const result = await installPlugin(cmd.repo)
              if (result.ok) {
                setMessages((m) => [...m, { role: 'assistant', content: `✓ Plugin '${result.name}' installed successfully.` }])
              } else {
                setMessages((m) => [...m, { role: 'assistant', content: `✗ ${result.error}` }])
              }
            } catch (e) {
              setMessages((m) => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'remove') {
            setIsLoading(true)
            try {
              const { removePlugin } = await import('../plugins/index.js')
              const result = await removePlugin(cmd.name)
              if (result.ok) {
                setMessages((m) => [...m, { role: 'assistant', content: `✓ Plugin '${result.name}' removed.` }])
              } else {
                setMessages((m) => [...m, { role: 'assistant', content: `✗ ${result.error}` }])
              }
            } catch (e) {
              setMessages((m) => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'update') {
            setMessages((m) => [...m, { role: 'assistant', content: `Updating plugin '${cmd.name}'...` }])
            setIsLoading(true)
            try {
              const { updatePlugin } = await import('../plugins/index.js')
              const result = await updatePlugin(cmd.name)
              if (result.ok) {
                setMessages((m) => [...m, { role: 'assistant', content: `✓ Plugin '${result.name}' updated.` }])
              } else {
                setMessages((m) => [...m, { role: 'assistant', content: `✗ ${result.error}` }])
              }
            } catch (e) {
              setMessages((m) => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          }
          return
        }
        case 'context': {
          const { formatContextBreakdown } = await import('../agent/contextBreakdown.js')
          const breakdown = agent.getContextBreakdown()
          setMessages(m => [...m, { role: 'assistant', content: formatContextBreakdown(breakdown) }])
          return
        }
        case 'features': {
          if (cmd.action === 'error') {
            setMessages(m => [...m, { role: 'assistant', content: `Error: ${cmd.message}` }])
            return
          }

          const flags = loadFeatures()
          if (cmd.action === 'list') {
            const lines = (Object.keys(FEATURES) as FeatureName[])
              .map((flag) => `  ${flags[flag] ? '✓' : '○'} ${flag} — ${FEATURES[flag].description}`)
            setMessages(m => [...m, { role: 'assistant', content: `Experimental features:\n${lines.join('\n')}\n\nUse /features <flag> on|off.` }])
            return
          }

          const flag = cmd.flag as FeatureName
          const value = cmd.action === 'toggle' ? !flags[flag] : cmd.value
          const next = { ...flags, [flag]: value }
          saveFeatures(next)
          setFeatureFlags(next)
          setMessages(m => [...m, { role: 'assistant', content: `Feature ${flag} ${value ? 'enabled' : 'disabled'}.` }])
          return
        }
        case 'goal': {
          const { getGoal, createGoal, setGoal, resumeGoal, updateGoal, buildContinuationPrompt, GOAL_MAX_CONTINUATIONS } = await import('../agent/goal.js')
          const goal = getGoal()

          if (cmd.action === 'show') {
            if (!goal) {
              setMessages((m) => [...m, { role: 'assistant', content: 'No goal is currently set. Usage: /goal <objective>' }])
            } else {
              const budgetLine = goal.tokenBudget !== undefined
                ? `\nToken budget: ${goal.tokenBudget}`
                : ''
              const statusLine = goal.status === 'blocked' && goal.blockReason
                ? `blocked (${goal.blockReason})`
                : goal.status
              const maxTurns = goal.maxContinuations ?? GOAL_MAX_CONTINUATIONS
              setMessages((m) => [...m, { role: 'assistant', content: [
                `Goal: ${goal.objective}`,
                `Status: ${statusLine}`,
                `Tokens: ${goal.tokensUsed}${budgetLine}`,
                `Turns: ${goal.continuations}/${maxTurns}`,
                '',
                `Commands: /goal edit, /goal pause, /goal resume, /goal clear`,
              ].join('\n') }])
            }
            return
          }

          if (cmd.action === 'set') {
            const unfinished = new Set(['active', 'paused', 'blocked', 'budget_limited', 'usage_limited'])
            if (goal && unfinished.has(goal.status)) {
              setMessages((m) => [...m, { role: 'assistant', content: `An unfinished goal already exists: "${goal.objective}" (${goal.status}). Complete or clear it first with /goal clear.` }])
              return
            }
            const maxContinuations = cmd.maxContinuations ?? agent.settings.goal?.maxContinuations
            const newGoal = createGoal(cmd.objective, undefined, maxContinuations)
            const injection = `Execute the following goal: "${cmd.objective}". When the goal is achieved, call update_goal with status "complete". If you are stuck on the same blocker for 3 consecutive turns, call update_goal with status "blocked" and describe the blocker.`
            await runWithPrompt(`/goal ${cmd.objective}`, injection, interactionMode)
            return
          }

          if (cmd.action === 'edit') {
            if (!goal) {
              setMessages((m) => [...m, { role: 'assistant', content: 'No goal to edit. Use /goal <objective> to set one.' }])
            } else {
              setMessages((m) => [...m, { role: 'assistant', content: `Current goal: "${goal.objective}"\nTo edit, use /goal <new objective> to replace it.` }])
            }
            return
          }

          if (cmd.action === 'pause') {
            if (!goal) {
              setMessages((m) => [...m, { role: 'assistant', content: 'No active goal to pause.' }])
            } else {
              if (goalContinuationTimerRef.current) {
                clearTimeout(goalContinuationTimerRef.current)
                goalContinuationTimerRef.current = null
              }
              updateGoal({ status: 'paused', updatedAt: new Date().toISOString() })
              setMessages((m) => [...m, { role: 'assistant', content: `Goal paused: "${goal.objective}"` }])
            }
            return
          }

          if (cmd.action === 'resume') {
            if (!goal) {
              setMessages((m) => [...m, { role: 'assistant', content: 'No goal to resume.' }])
            } else if (goal.status === 'complete') {
              setMessages((m) => [...m, { role: 'assistant', content: 'Goal is already complete. Use /goal <new objective> to set a new one.' }])
            } else if (goal.status === 'budget_limited' || goal.status === 'usage_limited') {
              setMessages((m) => [...m, { role: 'assistant', content: `Goal is ${goal.status}. Use /goal <new objective> to set a new goal.` }])
            } else {
              // Enforce the same limits as automatic continuation before resuming.
              const maxTurns = goal.maxContinuations ?? GOAL_MAX_CONTINUATIONS
              if (goal.continuations >= maxTurns) {
                updateGoal({ status: 'budget_limited', updatedAt: new Date().toISOString() })
                setMessages((m) => [...m, { role: 'assistant', content: `⚠ Goal turn limit reached (${goal.continuations}/${maxTurns} turns). Goal paused.` }])
                return
              }
              if (goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) {
                updateGoal({ status: 'budget_limited', updatedAt: new Date().toISOString() })
                setMessages((m) => [...m, { role: 'assistant', content: `⚠ Goal budget limit reached (${goal.tokensUsed}/${goal.tokenBudget} tokens). Goal paused.` }])
                return
              }

              const resumed = resumeGoal()
              // Increment continuations so the displayed turn matches the scheduled turn.
              updateGoal({ continuations: resumed.continuations + 1, updatedAt: new Date().toISOString() })
              const nextTurn = resumed.continuations + 1
              const prompt = buildContinuationPrompt(getGoal() ?? resumed, nextTurn)
              setMessages((m) => [...m, { role: 'assistant', content: `Goal resumed: "${resumed.objective}" (turn ${nextTurn}/${maxTurns})\n\nResuming...` }])
              // Schedule continuation immediately
              if (goalContinuationTimerRef.current) clearTimeout(goalContinuationTimerRef.current)
              goalContinuationTimerRef.current = setTimeout(() => {
                goalContinuationTimerRef.current = null
                setQueuedMessages((q) => {
                  const next = enqueue(q, prompt)
                  if (q.length === 0 && next.length > 0) {
                    if (queuedSubmitTimerRef.current) clearTimeout(queuedSubmitTimerRef.current)
                    queuedSubmitTimerRef.current = setTimeout(() => {
                      queuedSubmitTimerRef.current = null
                      void handleSubmitRef.current!(next[0]!)
                    }, 0)
                  }
                  return next
                })
              }, 200)
            }
            return
          }

          if (cmd.action === 'clear') {
            if (!goal) {
              setMessages((m) => [...m, { role: 'assistant', content: 'No goal to clear.' }])
            } else {
              if (goalContinuationTimerRef.current) {
                clearTimeout(goalContinuationTimerRef.current)
                goalContinuationTimerRef.current = null
              }
              setGoal(null)
              setMessages((m) => [...m, { role: 'assistant', content: 'Goal cleared.' }])
            }
            return
          }
          return
        }
        case 'tasks': {
          setMessages(m => [...m, { role: 'assistant', content: agent.formatTasks() }])
          return
        }
        case 'workflows': {
          setActivityOpen(false)
          setWorkflowMonitor({})
          return
        }
        case 'workflow': {
          try {
            if (cmd.action === 'pause') {
              const ok = await agent.workflows.pause(cmd.id)
              setMessages(m => [...m, { role: 'assistant', content: ok ? `Workflow ${cmd.id} paused.` : `Workflow ${cmd.id} is not running.` }])
            } else if (cmd.action === 'resume') {
              const ok = await agent.workflows.resume(cmd.id)
              setMessages(m => [...m, { role: 'assistant', content: ok ? `Workflow ${cmd.id} resumed.` : `Workflow ${cmd.id} is not paused.` }])
            } else if (cmd.action === 'stop') {
              const ok = await agent.workflows.cancel(cmd.id)
              setMessages(m => [...m, { role: 'assistant', content: ok ? `Workflow ${cmd.id} stopping.` : `Workflow ${cmd.id} is not active.` }])
            } else if (cmd.action === 'save') {
              const path = await agent.workflows.save(cmd.id, cmd.name)
              await refreshWorkflowCommands(agent.getWorkingDirectory())
              setMessages(m => [...m, { role: 'assistant', content: `Workflow saved to ${path}` }])
            } else if (cmd.action === 'restart') {
              setIsLoading(true)
              const handle = await agent.restartWorkflow(cmd.id)
              const result = await handle.result
              setMessages(m => [...m, { role: 'assistant', content: `Workflow ${result.runId} ${result.status}.\n\n${JSON.stringify(result.result, null, 2)}` }])
              setIsLoading(false)
            } else if (cmd.action === 'run') {
              setIsLoading(true)
              const handle = await agent.startWorkflow({
                script: await readSavedWorkflow(cmd.name, agent.getWorkingDirectory()),
                name: cmd.name,
                args: cmd.args ? JSON.parse(cmd.args) : {},
              })
              const result = await handle.result
              setMessages(m => [...m, { role: 'assistant', content: `Workflow ${result.runId} ${result.status}.\n\n${JSON.stringify(result.result, null, 2)}` }])
              setIsLoading(false)
            }
          } catch (error) {
            setIsLoading(false)
            setMessages(m => [...m, { role: 'assistant', content: `Workflow error: ${(error as Error).message}` }])
          }
          return
        }
        case 'custom':
          await runWithPrompt(text, cmd.prompt, interactionMode)
          return
        case 'task': {
          const result = await agent.controlTask(cmd.id, cmd.action, 'message' in cmd ? cmd.message : undefined)
          setMessages(m => [...m, { role: 'assistant', content: result }])
          return
        }
        case 'cwd': {
          if (!cmd.path) {
            setMessages(m => [...m, { role: 'assistant', content: `cwd: ${agent.getWorkingDirectory()}` }])
            return
          }
          const { resolve: resolvePath } = await import('path')
          const { statSync } = await import('fs')
          const target = resolvePath(cmd.path.replace(/^~/, process.env.HOME ?? ''))
          try {
            const s = statSync(target)
            if (!s.isDirectory()) {
              setMessages(m => [...m, { role: 'assistant', content: `✗ Not a directory: ${target}` }])
              return
            }
          } catch {
            setMessages(m => [...m, { role: 'assistant', content: `✗ Cannot access: ${target}` }])
            return
          }
          try {
            await agent.setWorkingDirectory(target, true)
            await refreshWorkflowCommands(target)
            await refreshCustomCommands(target)
            projectRootRef.current = target
          } catch (error) {
            setMessages(m => [...m, { role: 'assistant', content: `✗ Cannot change directory: ${(error as Error).message}` }])
            return
          }
          setMessages(m => [...m, { role: 'assistant', content: `cwd: ${target}` }])
          return
        }
        case 'worktree': {
          const projectRoot = projectRootRef.current
          const { createWorktree, enterWorktree, exitWorktree, listWorktrees, getActiveWorktree } = await import('../agent/worktree.js')
          if (cmd.action === 'create') {
            setIsLoading(true)
            try {
              const info = await createWorktree(projectRoot, sessionId)
              await agent.setWorkingDirectory(info.path)
              await refreshWorkflowCommands(info.path)
              await refreshCustomCommands(info.path)
              setMessages(m => [...m, { role: 'assistant', content: `Worktree "${info.name}" created at ${info.path}\nTool workspace changed to the worktree.` }])
            } catch (e) {
              setMessages(m => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'enter') {
            if (!cmd.name) {
              setMessages(m => [...m, { role: 'assistant', content: 'Usage: /worktree enter <name>' }])
              return
            }
            setIsLoading(true)
            try {
              const info = await enterWorktree(projectRoot, cmd.name, sessionId)
              await agent.setWorkingDirectory(info.path)
              await refreshWorkflowCommands(info.path)
              await refreshCustomCommands(info.path)
              setMessages(m => [...m, { role: 'assistant', content: `Entered worktree "${info.name}" at ${info.path}` }])
            } catch (e) {
              setMessages(m => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'exit') {
            setIsLoading(true)
            try {
              const result = await exitWorktree(projectRoot, cmd.keep)
              await agent.setWorkingDirectory(projectRoot)
              await refreshWorkflowCommands(projectRoot)
              await refreshCustomCommands(projectRoot)
              setMessages(m => [...m, { role: 'assistant', content: result }])
            } catch (e) {
              setMessages(m => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'list') {
            setIsLoading(true)
            try {
              const worktrees = await listWorktrees(projectRoot)
              if (!worktrees.length) {
                setMessages(m => [...m, { role: 'assistant', content: 'No worktrees found.' }])
              } else {
                const lines = worktrees.map(w => `  ${w.name}  ${w.path}  (${w.isGitWorktree ? 'git' : 'copy'})`)
                setMessages(m => [...m, { role: 'assistant', content: `Worktrees:\n${lines.join('\n')}` }])
              }
            } catch (e) {
              setMessages(m => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          } else if (cmd.action === 'status') {
            setIsLoading(true)
            try {
              const active = await getActiveWorktree(projectRoot)
              if (!active) {
                setMessages(m => [...m, { role: 'assistant', content: 'No active worktree.' }])
              } else {
                setMessages(m => [...m, { role: 'assistant', content: `Active worktree: "${active.name}"\nPath: ${active.path}\nCreated: ${active.createdAt}` }])
              }
            } catch (e) {
              setMessages(m => [...m, { role: 'assistant', content: `✗ ${(e as Error).message}` }])
            } finally {
              setIsLoading(false)
            }
          }
          return
        }
        case 'unknown':
          setMessages((m) => [...m, { role: 'assistant', content: cmd.input }])
          return
      }
    }

    void appendInputHistory(text).catch(() => {})

    // Shell execution with !
    if (text.trimStart().startsWith('!')) {
      const shellCmd = text.trimStart().slice(1).trim()
      if (!shellCmd) return
      setMessages((m) => [...m, { role: 'user', content: text }])
      setIsLoading(true)
      setStreamRole('terminal')
      setStreamText('')
      let output = ''
      try {
        const proc = execa(defaultShell(), isWindows ? ['/d', '/s', '/c', shellCmd] : ['-c', shellCmd], { cwd: agent.getWorkingDirectory(), reject: false })
        shellProcRef.current = proc
        const flush = (chunk: string) => {
          output += chunk
          setStreamText(output)
        }
        proc.stdout?.on('data', (d: Buffer) => flush(d.toString()))
        proc.stderr?.on('data', (d: Buffer) => flush(d.toString()))
        const result = await proc
        shellProcRef.current = null
        const exitInfo = result.exitCode !== 0 ? `\n[exited with code ${result.exitCode}]` : ''
        setMessages((m) => [...m, { role: 'terminal', content: (output || '(no output)') + exitInfo }])
      } catch (e) {
        shellProcRef.current = null
        setMessages((m) => [...m, { role: 'terminal', content: `Error: ${(e as Error).message}` }])
      }
      setStreamText('')
      setStreamRole('assistant')
      setIsLoading(false)
      return
    }

    await runWithPrompt(text, text, interactionMode)
  }, [agent, isLoading, onExit, runWithPrompt, runAgent, runBtw, interactionMode, focusedSubagent])

  // Keep ref in sync so the init effect always calls the latest handleSubmit
  handleSubmitRef.current = handleSubmit

  const restartWorkflowFromUi = useCallback(async (runId: string) => {
    setActivityOpen(false)
    setWorkflowMonitor(null)
    try {
      const handle = await agent.restartWorkflow(runId)
      const result = await handle.result
      setMessages(messages => [...messages, { role: 'assistant', content: `Workflow ${result.runId} ${result.status}.\n\n${JSON.stringify(result.result, null, 2)}` }])
    } catch (error) {
      setMessages(messages => [...messages, { role: 'assistant', content: `Workflow error: ${(error as Error).message}` }])
    }
  }, [agent])

  const saveWorkflowFromUi = useCallback(async (runId: string, name: string) => {
    const path = await agent.workflows.save(runId, name)
    await refreshWorkflowCommands(agent.getWorkingDirectory())
    return path
  }, [agent])

  if (workflowMonitor) {
    return (
      <ThemeProvider value={theme}>
        <WorkflowMonitor
          runs={workflowRuns}
          agents={subagentsRef.current.agents}
          initialRunId={workflowMonitor.runId}
          theme={theme}
          onClose={() => setWorkflowMonitor(null)}
          onPause={runId => agent.workflows.pause(runId)}
          onResume={runId => agent.workflows.resume(runId)}
          onStop={runId => agent.workflows.cancel(runId)}
          onRestart={restartWorkflowFromUi}
          onSave={saveWorkflowFromUi}
        />
      </ThemeProvider>
    )
  }

  if (showMobileQR) {
    return <ThemeProvider value={theme}><MobileQRCode onClose={() => setShowMobileQR(false)} theme={theme} /></ThemeProvider>
  }

  if (diffDialog) {
    return (
      <ThemeProvider value={theme}>
        <DiffDialog {...diffDialog} theme={theme} onClose={() => setDiffDialog(null)} />
      </ThemeProvider>
    )
  }

  if (showConfigMenu) {
    return (
      <ConfigMenu
        currentTheme={theme}
        currentLanguage={currentLanguage}
        enchantEnabled={agent.promptRefinerEnabled}
        onThemeSelect={(nextTheme) => { setTheme(nextTheme); onThemeChange?.(nextTheme) }}
        onLanguageSet={(nextLanguage) => { agent.setLanguage(nextLanguage); setCurrentLanguage(nextLanguage) }}
        onEnchantToggle={(enabled) => agent.setPromptRefinerEnabled(enabled)}
        onSettingsChanged={async (settings) => {
          await agent.applySettings(settings)
          setInterfaceSettings(settings.interface ?? {})
          const nextTheme = settings.interface?.theme
          if (nextTheme) { setTheme(nextTheme); onThemeChange?.(nextTheme) }
          agent.setLanguage(settings.interface?.language)
          setCurrentLanguage(settings.interface?.language ?? null)
          if (settings.interface?.vim !== undefined) setVimEnabled(settings.interface.vim)
        }}
        onTestConnection={(settings, credentials) => agent.testProviderSettings(settings, credentials)}
        onPreviewRefiner={async (prompt) => {
          const preview = await agent.previewPromptRefiner(prompt)
          if (preview.status === 'skip') return `SKIP · original preserved: ${preview.original}`
          if (preview.status === 'error') return `Error · ${preview.error}`
          return `Refined · ${preview.refined}`
        }}
        onClearApprovals={() => agent.clearSessionApprovals()}
        onPermissionsHelp={() => {
          const info = agent.getPermissionsInfo()
          return `${info.mode} · allow ${info.permissions?.allow?.length ?? 0} · deny ${info.permissions?.deny?.length ?? 0} · session ${info.sessionApproved.length}`
        }}
        onClose={() => setShowConfigMenu(false)}
        onThemeChange={onThemeChange}
      />
    )
  }

  const termRows = process.stdout.rows || 24
  const activityCount = subagentsRef.current.agents.filter(subagent => !subagent.workflowRunId).length +
    workflowRuns.filter(run => ['queued', 'running'].includes(run.status)).length
  const focusedAgent = focusedSubagent ? subagentsRef.current.agents.find(a => a.id === focusedSubagent.id) ?? null : null

  // Fullscreen has no native scrollback: the root is pinned to exactly termRows
  // and the transcript lives in a ScrollBox that keeps itself pinned to the
  // bottom as content grows. Outside fullscreen the terminal scrolls for us, so
  // the transcript stays a plain Box and grows past the viewport as before.
  const TranscriptArea = alternateScreen ? ScrollBox : Box
  const transcriptProps = alternateScreen
    ? { stickyScroll: true, flexDirection: 'column' as const, width: '100%', ref: transcriptRef }
    : {}

  return (
    <ThemeProvider value={theme}>
    <Box flexDirection="column" width="100%" height={alternateScreen ? termRows : undefined}>
      <Box flexDirection="row" flexGrow={1}>
      <TranscriptArea flexGrow={1} {...transcriptProps}>
        <Box flexDirection="column">
          <MessageList
            messages={focusedSubagent
              ? (focusedAgent?.messages ?? [])
              : interfaceSettings.showThoughts === false ? messages.filter(message => message.role !== 'thinking') : messages}
            streamText={focusedSubagent ? '' : streamText}
            thinkingText={focusedSubagent ? '' : (interfaceSettings.showThoughts === false ? '' : thinkingText)}
            streamRole={streamRole}
            theme={theme}
            activeAgent={focusedSubagent ? (focusedSubagent.agentName ?? 'subagent') : activeAgent}
            headerProvider={headerProvider}
            headerAgent={focusedSubagent ? '@' + (focusedSubagent.agentName ?? 'subagent') : headerAgent}
            showToolCalls={interfaceSettings.showToolCalls}
            showDiffs={interfaceSettings.showDiffs}
            showWordDiff={featureFlags.wordDiff}
            density={interfaceSettings.density}
            onOpenDiff={(diff) => setDiffDialog(diff)}
            fullMode={fullMode}
            thinkingStartedAt={thinkingStartedAtRef.current}
          />
          {focusedSubagent && focusedAgent && (focusedAgent.status === 'running' || focusedAgent.status === 'queued' || focusedAgent.status === 'blocked') && (
            <Text color="#888888">
              {`  ◌ ${focusedAgent.lastToolInfo ? `⚙ ${focusedAgent.lastToolInfo} · ` : ''}${focusedAgent.toolCount} tools${focusedAgent.tokens != null ? ` · ↓ ${focusedAgent.tokens >= 1000 ? `${(focusedAgent.tokens / 1000).toFixed(1)}k` : focusedAgent.tokens} tok` : ''}`}
            </Text>
          )}
          {!focusedSubagent && toolStatus && interfaceSettings.showToolCalls !== false && <ToolUseDisplay tool={toolStatus} />}
          {!focusedSubagent && <TodoPanel />}
          {!focusedSubagent && isLoading && (interfaceSettings.reducedMotion
            ? <Text dimColor>{agentPhase === 'refining' ? 'Refining…' : 'Working…'}</Text>
            : <LoadingSpinner toolCallCount={toolCallCount} phase={agentPhase} activeTool={toolStatus && !toolStatus.done ? toolStatus.name : null} />)}
          {btw && <BtwSideQuestion btw={btw} theme={theme} onDismiss={() => { btwAbortRef.current?.abort(); setBtw(null) }} />}
          {queuedMessages.length > 0 && <QueuedMessagesList messages={queuedMessages} />}
        </Box>
      </TranscriptArea>
      {alternateScreen && (
        <Scrollbar
          target={transcriptRef}
          revision={`${messages.length}:${streamText.length}:${thinkingText.length}:${toolCallCount}:${queuedMessages.length}`}
        />
      )}
      </Box>

      {/* Footer */}
      <Box flexDirection="column" flexShrink={0}>
        {btw ? (
          <Text dimColor>{isLoading ? 'The main agent is still working.' : 'Side question active.'}</Text>
        ) : showModelSelector ? (
          <ModelSelector
            currentModel={agent.model}
            models={availableModels}
            descriptions={modelDescriptions}
            onSelect={(m) => {
              agent.setModel(m)
              setMessages((prev) => [...prev, { role: 'assistant', content: `Model switched to ${m}` }])
              setShowModelSelector(false)
            }}
            onCancel={() => setShowModelSelector(false)}
          />
        ) : showEffortSelector ? (
          <EffortSelector
            currentLevel={agent.effortLevel}
            onSelect={(level) => {
              const EFFORT_DESCRIPTIONS: Record<string, string> = {
                low: 'Quick, straightforward responses',
                high: 'Comprehensive responses with extensive thinking',
                max: 'Maximum reasoning depth (best with deepseek-reasoner)',
              }
              agent.setEffortLevel(level)
              setMessages((prev) => [...prev, { role: 'assistant', content: `Effort: ${level} — ${EFFORT_DESCRIPTIONS[level]}` }])
              setShowEffortSelector(false)
            }}
            onCancel={() => setShowEffortSelector(false)}
          />
        ) : askUserState ? (
          <AskUserQuestionsPrompt
            questions={askUserState.questions}
            onSubmit={(answers) => askUserState.resolve(answers)}
            onCancel={() => askUserState.resolve(null)}
          />
        ) : toolPermissionState ? (
          <ToolPermissionPrompt
            request={toolPermissionState.request}
            onDecide={handleToolPermission}
          />
        ) : planApprovalState ? (
          <PlanApprovalPrompt
            planContent={planApprovalState.planContent}
            planSummary={planApprovalState.summary}
            theme={theme}
            onDecide={handlePlanDecision}
          />
        ) : confirmState ? (
          <ConfirmPrompt
            message={confirmState.message}
            onConfirm={handleConfirm}
          />
        ) : (
          <InputBox
            onSubmit={handleSubmit}
            isLoading={isLoading}
            toolCallCount={toolCallCount}
            onAbort={handleAbort}
            onQueue={focusedSubagent ? (t) => void handleSubmit(t) : handleQueue}
            phase={agentPhase}
            contextPct={contextPct}
            agentLabel={focusedSubagent ? '@' + (focusedSubagent.agentName ?? 'subagent') : (activeAgent ?? 'deepseek')}
            agentColor={activeAgentColor}
            interactionMode={interactionMode}
            onModeChange={handleModeChange}
            sessionId={sessionId}
            vimEnabled={vimEnabled}
            workingDirectory={agent.getWorkingDirectory()}
            fuzzyFileSearch={featureFlags.fuzzyFileSearch}
            activityAvailable={activityCount > 0}
            onActivityOpen={() => setActivityOpen(true)}
            isActive={!activityOpen}
            showFullscreenHint={messages.length === 0}
            onExit={onExit}
            placeholderOverride={focusedSubagent ? `Message @${focusedSubagent.agentName ?? 'subagent'}…` : undefined}
          />
        )}
        <StatusBar tokenCount={tokenCount} model={agent.model} activeAgent={activeAgent} provider={agent.provider} contextPct={contextPct} interactionMode={interactionMode} theme={theme} items={interfaceSettings.statusBar} narrowPriority={interfaceSettings.narrowPriority} compactBadge={compactBadge} activityCount={activityCount} />
        {!btw && !showModelSelector && !showEffortSelector && !askUserState && !toolPermissionState && !planApprovalState && !confirmState && (
          <ActivityFooter
            agents={subagentsRef.current.agents}
            workflows={workflowRuns}
            open={activityOpen}
            onClose={() => setActivityOpen(false)}
            onOpenWorkflow={runId => { setActivityOpen(false); setWorkflowMonitor({ runId }) }}
            onOpenSubagent={(id) => {
              const a = subagentsRef.current.agents.find(x => x.id === id)
              setActivityOpen(false)
              setFocusedSubagent({ id, agentName: a?.agentName ?? null })
            }}
            onSelectMain={() => { setFocusedSubagent(null); setActivityOpen(false) }}
            onTaskAction={(taskId, action) => agent.controlTask(taskId, action)}
            onWorkflowAction={async (runId, action) => {
              if (action === 'stop') return await agent.workflows.cancel(runId) ? `Workflow ${runId.slice(0, 8)} stopping.` : 'Workflow is not active.'
              return await agent.workflows.pause(runId) ? `Workflow ${runId.slice(0, 8)} paused.` : 'Workflow is not running.'
            }}
            theme={theme}
            mainLabel={activeAgent ?? 'main'}
          />
        )}
      </Box>
    </Box>
    </ThemeProvider>
  )
}

function ConfirmPrompt({ message, onConfirm }: { message: string; onConfirm: (yes: boolean) => void }) {
  useInput((input: string, key: Key) => {
    if (key.ctrl && input === 'c') { onConfirm(false); return }
    if (input === 'y') onConfirm(true)
    else if (input === 'n' || key.escape) onConfirm(false)
  })

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box border borderStyle="rounded" borderColor="yellow" paddingLeft={1} paddingRight={1}>
        <Text color="yellow">{'⚠ ' + message}</Text>
      </Box>
      <Text color="#888888">{'  [y] confirm  [n/Esc] cancel'}</Text>
    </Box>
  )
}

function permissionOptions(request: ToolPermissionRequest) {
  if (request.reason === 'workflow') {
    return [
      { key: '1', label: 'Execute this workflow once', result: 'once' as ToolPermissionResult },
      { key: '2', label: 'View workflow code' },
      { key: '3', label: 'Always allow this exact script', result: 'always' as ToolPermissionResult },
      { key: '4', label: 'Deny', result: 'deny' as ToolPermissionResult },
    ]
  }
  const externalDirectory = request.reason === 'outside_workspace' ? request.externalDirectory : undefined
  const sessionLabel = externalDirectory
    ? `Allow file actions in ${externalDirectory} this session`
    : request.reason === 'risk'
      ? 'Do not ask again for this action this session'
      : `Allow ${request.toolName} in this project this session`
  const options = [
    { key: '1', label: 'Allow this action', result: 'once' as ToolPermissionResult },
    { key: '2', label: sessionLabel, result: (externalDirectory ? 'directory' : 'session') as ToolPermissionResult },
    { key: '3', label: 'Deny (tell DeepSeek what to do instead)', result: 'deny' as ToolPermissionResult },
  ]
  if (request.reason === 'permission') {
    options.push({ key: '4', label: `Always allow ${request.toolName}`, result: 'always' as ToolPermissionResult })
  }
  return options
}

function toolPermissionSummary({ toolName, args }: ToolPermissionRequest): string {
  const input = args as Record<string, unknown>
  if (toolName === 'workflow' && typeof input.script === 'string') {
    const name = /"name"\s*:\s*"([^"]+)"/.exec(input.script)?.[1]
    return name ? `Dynamic Workflow → ${name}` : 'Dynamic Workflow'
  }
  if (typeof input.command === 'string') return `$ ${input.command}`
  if (typeof input.path === 'string') return `${toolName} → ${input.path}`
  if (typeof input.cwd === 'string') return `${toolName} → ${input.cwd}`
  if (typeof input.action === 'string') return `${toolName} → ${input.action}`
  return toolName
}

function ToolPermissionPrompt({
  request,
  onDecide,
}: {
  request: ToolPermissionRequest
  onDecide: (result: ToolPermissionResult) => void
}) {
  const [selected, setSelected] = useState(0)
  const [showWorkflowCode, setShowWorkflowCode] = useState(false)
  const options = permissionOptions(request)

  const choose = (option: typeof options[number]) => {
    if (!('result' in option) || !option.result) { setShowWorkflowCode(value => !value); return }
    onDecide(option.result)
  }

  useInput((input: string, key: Key) => {
    if (key.ctrl && input === 'c') { onDecide('deny'); return }
    const option = options.find(option => option.key === input)
    if (option) { choose(option); return }
    if (key.upArrow) { setSelected((i) => (i - 1 + options.length) % options.length); return }
    if (key.downArrow) { setSelected((i) => (i + 1) % options.length); return }
    if (key.return) { choose(options[selected]!); return }
    if (key.escape) { onDecide('deny'); return }
  })

  const cols = Math.max((process.stdout.columns ?? 80) - 10, 30)
  const summary = toolPermissionSummary(request)
  const preview = summary.length > cols ? summary.slice(0, cols) + '…' : summary
  const reason = request.reason === 'outside_workspace'
    ? 'This action accesses a directory outside the project.'
    : request.riskDescription ?? 'This action needs your confirmation.'

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box border borderStyle="rounded" borderColor="cyan" paddingLeft={2} paddingRight={2} flexDirection="column">
        <Text color="cyan">{'◆ Confirmation required'}</Text>
        <Box marginTop={1} flexDirection="row" gap={1}>
          <Text color="#888888">tool:</Text>
          <Text color="yellow">{request.toolName}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color="#888888">action:</Text>
          <Text color="#888888">{preview}</Text>
        </Box>
        <Text color="yellow">{reason}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        {options.map((opt, i) => (
          <Box key={opt.key} flexDirection="row" gap={2}>
            <Text color={i === selected ? 'cyan' : 'white'}>
              {i === selected ? '❯' : ' '} [{opt.key}]
            </Text>
            <Text color={i === selected ? 'cyan' : '#888888'}>
              {opt.label}
            </Text>
          </Box>
        ))}
      </Box>
      {showWorkflowCode && request.reason === 'workflow' && (
        <Box borderStyle="round" borderColor="#666666" paddingLeft={1} paddingRight={1} marginTop={1} flexDirection="column">
          <Text color="#888888">workflow.js</Text>
          <Text>{String((request.args as Record<string, unknown>).script ?? '')}</Text>
        </Box>
      )}
      <Box marginLeft={2}>
        <Text color="#888888">{'  ↑↓ navigate  ·  Enter confirm  ·  Esc deny  ·  [3] aborts agent'}</Text>
      </Box>
    </Box>
  )
}
