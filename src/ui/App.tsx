import { useState, useCallback, useEffect, useRef } from 'react'
import useInput from '../ink/hooks/use-input.js'
import { execa } from 'execa'
import type { Key } from '../ink/events/input-event.js'
import { Agent, type ToolPermissionResult } from '../agent/agent.js'
import { MessageList } from './messages/MessageList.js'
import { TodoPanel } from './messages/TodoPanel.js'
import { ToolUseDisplay } from './messages/ToolUseDisplay.js'
import { SubagentList, useSubagents } from './subagent/index.js'
import { setSubAgentCallbacks } from '../tools/SubAgent/SubAgent.js'
import { InputBox, LoadingSpinner } from './input/InputBox.js'
import { QueuedMessagesList } from './input/QueuedMessagesList.js'
import { enqueue } from './queueLogic.js'
import { StatusBar } from './layout/StatusBar.js'
import { ThemeSelector } from './setup/ThemeSelector.js'
import { ModelSelector } from './setup/ModelSelector.js'
import { LanguageInput } from './setup/LanguageInput.js'
import { parseCommand, HELP_TEXT, PLAN_PROMPT, REVIEW_PROMPT } from '../commands.js'
import { loadAgentConfig, listAgents, type LoadedAgent } from '../agent/config.js'
import { appendInputHistory } from '../agent/inputHistory.js'
import type { ThemeName, ProviderConfig } from '../types/provider.js'
import { saveConfig } from './setup/ApiKeySetup.js'
import { formatChatError } from '../utils/chatError.js'
import { saveSession, type SessionData } from '../agent/session.js'
import { DEFAULT_MODE, nextMode, isBuildMode, isAutoMode, type InteractionMode } from './interactionMode.js'
import Box from '../ink/components/Box.js'
import Text from '../ink/components/Text.js'

export type AgentPhase = 'idle' | 'refining' | 'executing'

/** Extracts thinking content and cleans response tags from streamed text */
function processStreamedText(text: string): { thinking: string; content: string } {
  let thinking = ''
  const thinkMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/)
  if (thinkMatch) thinking = thinkMatch[1]!.trim()
  const content = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<step>[\s\S]*?<\/step>/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<tool_call>[\s\S]*$/g, '')
    .replace(/<response>([\s\S]*?)<\/response>/g, '$1')
    .trim()
  return { thinking, content }
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'terminal' | 'thinking'
  content: string
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
  toolName: string
  args: object
  resolve: (result: ToolPermissionResult) => void
}

export function App({ initialAgent, initialMessage, theme: initialTheme, providerConfig, onThemeChange, language, sessionId, initialSession, headerProvider, headerAgent }: {
  initialAgent?: LoadedAgent | null
  initialMessage?: string | null
  theme: ThemeName
  providerConfig?: ProviderConfig | null
  onThemeChange?: (t: ThemeName) => void
  language?: string | null
  sessionId?: string
  initialSession?: SessionData | null
  headerProvider?: string
  headerAgent?: string | null
}) {
  const initialSessionRef = useRef(initialSession)
  const handleSubmitRef = useRef<((text: string) => Promise<void>) | null>(null)
  const toolStatusClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [streamText, setStreamText] = useState('')
  const [thinkingText, setThinkingText] = useState('')
  const [streamRole, setStreamRole] = useState<'assistant' | 'terminal'>('assistant')
  const [isLoading, setIsLoading] = useState(false)
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null)
  const [tokenCount, setTokenCount] = useState(0)
  const [contextPct, setContextPct] = useState(0)
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [toolCallCount, setToolCallCount] = useState(0)
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle')
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(DEFAULT_MODE)
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [agent] = useState(() => new Agent(providerConfig ?? undefined))
  const [theme, setTheme] = useState<ThemeName>(initialTheme)
  const [showThemeSelector, setShowThemeSelector] = useState(false)
  const subagentsRef = useRef(useSubagents())
  const [subagentTick, setSubagentTick] = useState(0)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [showLanguageInput, setShowLanguageInput] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [toolPermissionState, setToolPermissionState] = useState<ToolPermissionState | null>(null)
  const [vimEnabled, setVimEnabled] = useState(false)

  useEffect(() => {
    agent.interactionMode = interactionMode
  }, [agent, interactionMode])

  useEffect(() => {
    const subs = subagentsRef.current
    setSubAgentCallbacks({
      onStart(id: string, task: string) {
        subs.onSubagentStart({ id, task })
        setSubagentTick((t) => t + 1)
      },
      onToolUse(id: string, tool: string, info?: string) {
        subs.onSubagentToolUse({ id, tool, info })
        setSubagentTick((t) => t + 1)
      },
      onDone(id: string, result: string) {
        subs.onSubagentDone({ id, result })
        setSubagentTick((t) => t + 1)
      },
      onError(id: string, error: string) {
        subs.onSubagentError({ id, error })
        setSubagentTick((t) => t + 1)
      },
    })
    return () => setSubAgentCallbacks(null)
  }, [])

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

  useEffect(() => {
    agent.setToolPermissionHandler((toolName, args) => {
      return new Promise<ToolPermissionResult>((resolve) => {
        setToolPermissionState({ toolName, args, resolve })
      })
    })
    return () => agent.setToolPermissionHandler(null)
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
      // Wait for async initialization (MCP tools, steering, DEEPSEEK.md) to complete
      await agent.readyPromise.catch(() => {})
      if (language) {
        agent.setLanguage(language)
      }
      const session = initialSessionRef.current
      if (session?.agentMessages?.length) {
        agent.loadSessionMessages(session.agentMessages)
      }
      if (session?.uiMessages?.length) {
        setMessages(session.uiMessages)
      }
      if (agent.mcpErrors.length > 0) {
        const errMsg = `⚠ MCP connection errors:\n${agent.mcpErrors.map((e) => `  • ${e}`).join('\n')}`
        setMessages((m) => [...m, { role: 'assistant', content: errMsg }])
      }
      if (initialAgent) {
        const { config, source } = initialAgent
        await agent.applyAgentConfig(config)
        setActiveAgent(config.name)
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
    if (shellProcRef.current) {
      shellProcRef.current.kill()
      shellProcRef.current = null
    }
    setQueuedMessages([])
  }, [agent])

  const handleQueue = useCallback((msg: string) => {
    // /msg should work immediately even during loading — it just adds a note
    const msgMatch = msg.match(/^\/msg\s+(.+)/)
    if (msgMatch) {
      agent.addNote(msgMatch[1])
      setMessages((m) => [...m, { role: 'assistant', content: `📝 Note queued: "${msgMatch[1]}"\nIt will be included as context in the next agent turn.` }])
      return
    }
    setQueuedMessages((q) => enqueue(q, msg))
  }, [agent])

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

  const runAgent = useCallback(async (prompt: string) => {
    let tokenBuffer = ''
    let streamTextAccum = ''
    let thinkingAccum = ''

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
      setMessages((m) => [...m, { role: 'thinking', content: finalThinking }])
      thinkingAccum = ''
    }

    const flushInterval = setInterval(() => {
      if (tokenBuffer) {
        const buf = tokenBuffer
        tokenBuffer = ''
        streamTextAccum += buf
        // Live-process: separate thinking from visible content
        const { thinking, content } = processStreamedText(streamTextAccum)
        if (thinking) {
          mergeThinking(thinking)
          setThinkingText(thinkingAccum)
        }
        setStreamText(content)
      }
    }, 50)

    try {
      await agent.run(prompt, {
        onPhaseChange(phase) { setAgentPhase(phase) },
        onToken(token) { tokenBuffer += token },
        onThinking(text) {
          thinkingAccum += text
          setThinkingText(thinkingAccum)
        },
        onToolCall(name, args) {
          clearInterval(flushInterval)
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
          setToolStatus({ name, args: JSON.stringify(args).slice(0, 100), done: false })
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
          } else if (!name.includes('__')) {
            // Show other built-in tools too
            setMessages((m) => [...m, { role: 'tool', content: `✓ ${name} → ${result.slice(0, 100)}` }])
          }
        },
        onDone() {
          clearInterval(flushInterval)
          const pending = (streamTextAccum + tokenBuffer).trim()
          tokenBuffer = ''
          streamTextAccum = ''
          setToolStatus(null)
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
          setIsLoading(false)
          setAgentPhase('idle')
          setTokenCount(agent.tokenCount)
          subagentsRef.current.clearResolved()
          setSubagentTick((t) => t + 1)
          setQueuedMessages((q) => {
            if (q.length === 0) return q
            const [first, ...rest] = q
            if (queuedSubmitTimerRef.current) {
              clearTimeout(queuedSubmitTimerRef.current)
            }
            queuedSubmitTimerRef.current = setTimeout(() => {
              queuedSubmitTimerRef.current = null
              void handleSubmit(first!)
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
                  createdAt: initialSession?.createdAt ?? new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  cwd: process.cwd(),
                  model: agent.model,
                  provider: agent.provider,
                  language: language ?? null,
                  activeAgent: agent.activeAgent,
                  agentMessages: agent.getRawMessages(),
                  uiMessages: current,
                  filesModified: agent.getFilesModified(),
                })
                return current
              })
            }, 100)
          }
        },
        onDenyAbort() {
          setMessages((m) => [...m, { role: 'assistant', content: '⛔ Execution aborted by user.' }])
        },
        onAutoCompact(summary) {
          setMessages((m) => [...m, { role: 'assistant', content: `⚡ Context compacted automatically.\n\n${summary}` }])
        },
      })
    } catch (e: unknown) {
      clearInterval(flushInterval)
      setStreamText('')
      setThinkingText('')
      setToolStatus(null)
      setIsLoading(false)
      setAgentPhase('idle')
      subagentsRef.current.clearResolved()
      setSubagentTick((t) => t + 1)
      const provider = providerConfig?.provider ?? 'deepseek'
      const message = e instanceof Error
        ? formatChatError(e, provider)
        : String(e)
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ Error: ${message}` }])
    }
  }, [agent, sessionId, language, initialSession, providerConfig])

  const runWithPrompt = useCallback(async (label: string, prompt: string) => {
    if (isLoading) return
    setMessages((m) => [...m, { role: 'user', content: label }])
    setIsLoading(true)
    setAgentPhase('refining')
    setStreamText('')
    await runAgent(prompt)
  }, [isLoading, runAgent])

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return

    const cmd = parseCommand(text)
    if (cmd) {
      switch (cmd.type) {
        case 'quit':
          process.stdout.write('\x1b[?25h\n')
          process.exit(0)
        case 'clear':
          agent.clearHistory()
          setMessages([])
          return
        case 'compact': {
          setIsLoading(true)
          const summary = await agent.compact()
          setMessages([{ role: 'assistant', content: `**Context compacted.** Summary:\n\n${summary}` }])
          setIsLoading(false)
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
          setShowModelSelector(true)
          return
        }
        case 'language':
          setShowLanguageInput(true)
          return
        case 'agents': {
          const agents = await listAgents()
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
            const { config, source } = await loadAgentConfig(cmd.name)
            await agent.applyAgentConfig(config)
            setActiveAgent(config.name)
            const sourceMsg = source === 'local' ? 'local (overrides global)' : 'global'
            setMessages((m) => [...m, { role: 'assistant', content: `Agent '${config.name}' loaded from ${sourceMsg}.` }])
          } catch (e) {
            setMessages((m) => [...m, { role: 'assistant', content: (e as Error).message }])
          }
          return
        }
        case 'undo': {
          const result = await agent.undo()
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
        case 'system': {
          const prompt = agent.getSystemPrompt()
          const preview = prompt.length > 2000 ? prompt.slice(0, 2000) + '\n\n...(truncated)' : prompt
          setMessages((m) => [...m, { role: 'assistant', content: `**Active system prompt:**\n\n\`\`\`\n${preview}\n\`\`\`` }])
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
        case 'theme':
          setShowThemeSelector(true)
          return
        case 'sessions': {
          const { listSessions } = await import('../agent/session.js')
          const sessions = await listSessions()
          if (!sessions.length) {
            setMessages((m) => [...m, { role: 'assistant', content: 'No saved sessions.' }])
          } else {
            const lines = sessions.slice(0, 10).map((s) => {
              const date = new Date(s.updatedAt).toLocaleString()
              const msgs = s.uiMessages.filter((m) => m.role === 'user').length
              return `  ${s.id}  ${date}  ${msgs} messages  ${s.cwd}`
            })
            setMessages((m) => [...m, { role: 'assistant', content: `Recent sessions:\n${lines.join('\n')}\n\nResume: deepseek --resume <id>` }])
          }
          return
        }
        case 'plan': {
          const label = `/plan ${cmd.task}`
          const prompt = PLAN_PROMPT(cmd.task)
          await runWithPrompt(label, prompt)
          return
        }
        case 'review': {
          const label = cmd.target ? `/review ${cmd.target}` : '/review'
          const prompt = REVIEW_PROMPT(cmd.target)
          await runWithPrompt(label, prompt)
          return
        }
        case 'permissions': {
          const info = agent.getPermissionsInfo()
          const lines: string[] = []
          lines.push(`**Current mode:** ${info.mode}`)
          lines.push(`**Tools allowed in mode:** ${info.modeTools.sort().join(', ')}`)
          if (info.allowedTools === null) {
            lines.push(`**Agent permissions:** no agent loaded (no additional restrictions)`)
          } else if (info.allowedTools === '*') {
            lines.push(`**Agent permissions:** all tools require confirmation`)
          } else {
            lines.push(`**Agent permissions:** ${info.allowedTools.join(', ')}`)
          }
          if (info.sessionApproved.length > 0) {
            lines.push(`**Approved this session:** ${info.sessionApproved.join(', ')}`)
          } else {
            lines.push(`**Approved this session:** none`)
          }
          setMessages((m) => [...m, { role: 'assistant', content: lines.join('\n') }])
          return
        }
        case 'msg': {
          agent.addNote(cmd.note)
          setMessages((m) => [...m, { role: 'assistant', content: `📝 Note queued: "${cmd.note}"\nIt will be included as context in the next agent turn.` }])
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
        case 'stats': {
          const stats = agent.getStats()
          setMessages((m) => [...m, { role: 'assistant', content: stats }])
          return
        }
        case 'unknown':
          setMessages((m) => [...m, { role: 'assistant', content: cmd.input }])
          return
      }
    }

    await appendInputHistory(text)

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
        const proc = execa('sh', ['-c', shellCmd], { reject: false })
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

    setMessages((m) => [...m, { role: 'user', content: text }])
    setIsLoading(true)
    setAgentPhase('refining')
    setStreamText('')
    await runAgent(text)
  }, [agent, isLoading, runWithPrompt, runAgent])

  // Keep ref in sync so the init effect always calls the latest handleSubmit
  handleSubmitRef.current = handleSubmit

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Messages area */}
      <Box flexGrow={1}>
        <Box flexDirection="column">
          <MessageList messages={messages} streamText={streamText} thinkingText={thinkingText} streamRole={streamRole} theme={theme} activeAgent={activeAgent} headerProvider={headerProvider} headerAgent={headerAgent} />
          {toolStatus && <ToolUseDisplay tool={toolStatus} />}
          {subagentsRef.current.agents.length > 0 && <SubagentList agents={subagentsRef.current.agents} theme={theme} />}
          <TodoPanel />
          {isLoading && <LoadingSpinner toolCallCount={toolCallCount} phase={agentPhase} />}
          {queuedMessages.length > 0 && <QueuedMessagesList messages={queuedMessages} />}
        </Box>
      </Box>

      {/* Footer */}
      <Box flexDirection="column" flexShrink={0}>
        {showThemeSelector ? (
          <ThemeSelector
            currentTheme={theme}
            onSelect={(t) => { setTheme(t); onThemeChange?.(t); setShowThemeSelector(false) }}
            onCancel={() => setShowThemeSelector(false)}
          />
        ) : showModelSelector ? (
          <ModelSelector
            currentModel={agent.model}
            models={availableModels}
            onSelect={(m) => {
              agent.setModel(m)
              setMessages((prev) => [...prev, { role: 'assistant', content: `Model switched to ${m}` }])
              setShowModelSelector(false)
            }}
            onCancel={() => setShowModelSelector(false)}
          />
        ) : showLanguageInput ? (
          <LanguageInput
            currentLanguage={language ?? null}
            onDone={(lang) => {
              agent.setLanguage(lang)
              saveConfig({ LANGUAGE: lang })
              setMessages((prev) => [...prev, { role: 'assistant', content: `Language set to ${lang}` }])
              setShowLanguageInput(false)
            }}
            onCancel={() => setShowLanguageInput(false)}
          />
        ) : toolPermissionState ? (
          <ToolPermissionPrompt
            toolName={toolPermissionState.toolName}
            args={toolPermissionState.args}
            onDecide={handleToolPermission}
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
            onQueue={handleQueue}
            phase={agentPhase}
            contextPct={contextPct}
            agentLabel={activeAgent ?? 'deepseek'}
            interactionMode={interactionMode}
            onModeChange={handleModeChange}
            sessionId={sessionId}
            vimEnabled={vimEnabled}
          />
        )}
        <StatusBar tokenCount={tokenCount} model={agent.model} activeAgent={activeAgent} provider={agent.provider} contextPct={contextPct} interactionMode={interactionMode} />
      </Box>
    </Box>
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

const PERMISSION_OPTIONS = [
  { key: '1', label: 'Allow this time', result: 'once' as ToolPermissionResult },
  { key: '2', label: 'Allow for all session', result: 'session' as ToolPermissionResult },
  { key: '3', label: 'Deny (say what DeepSeek should do instead)', result: 'deny' as ToolPermissionResult },
]

function ToolPermissionPrompt({
  toolName,
  args,
  onDecide,
}: {
  toolName: string
  args: object
  onDecide: (result: ToolPermissionResult) => void
}) {
  const [selected, setSelected] = useState(0)

  useInput((input: string, key: Key) => {
    if (key.ctrl && input === 'c') { onDecide('deny'); return }
    if (input === '1') { onDecide('once'); return }
    if (input === '2') { onDecide('session'); return }
    if (input === '3') { onDecide('deny'); return }
    if (key.upArrow) { setSelected((i) => (i - 1 + PERMISSION_OPTIONS.length) % PERMISSION_OPTIONS.length); return }
    if (key.downArrow) { setSelected((i) => (i + 1) % PERMISSION_OPTIONS.length); return }
    if (key.return) { onDecide(PERMISSION_OPTIONS[selected]!.result); return }
    if (key.escape) { onDecide('deny'); return }
  })

  const argsPreview = JSON.stringify(args, null, 0)
  const cols = Math.max((process.stdout.columns ?? 80) - 10, 30)
  const preview = argsPreview.length > cols ? argsPreview.slice(0, cols) + '…' : argsPreview

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box border borderStyle="rounded" borderColor="cyan" paddingLeft={2} paddingRight={2} flexDirection="column">
        <Text color="cyan">{'◆ Tool permission'}</Text>
        <Box marginTop={1} flexDirection="row" gap={1}>
          <Text color="#888888">tool:</Text>
          <Text color="yellow">{toolName}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color="#888888">args:</Text>
          <Text color="#888888">{preview}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        {PERMISSION_OPTIONS.map((opt, i) => (
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
      <Box marginLeft={2}>
        <Text color="#888888">{'  ↑↓ navigate  ·  Enter confirm  ·  Esc deny  ·  [3] aborts agent'}</Text>
      </Box>
    </Box>
  )
}
