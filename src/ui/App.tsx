import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { execa } from 'execa'
import stripAnsi from 'strip-ansi'
import wrapAnsi from 'wrap-ansi'
import { Agent, type ToolPermissionResult } from '../agent/agent.js'
import { MessageList } from './messages/MessageList.js'
import { TodoPanel } from './messages/TodoPanel.js'
import { ToolUseDisplay } from './messages/ToolUseDisplay.js'
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
import type { ThemeName, ProviderConfig } from './setup/ApiKeySetup.js'
import { saveConfig } from './setup/ApiKeySetup.js'
import { formatChatError } from '../utils/chatError.js'
import { saveSession, type SessionData } from '../agent/session.js'
import { DEFAULT_MODE, nextMode, isAutoAccept, type InteractionMode } from './interactionMode.js'

export type AgentPhase = 'idle' | 'refining' | 'executing'

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'terminal'
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
  const { exit } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [streamText, setStreamText] = useState('')
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
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [showLanguageInput, setShowLanguageInput] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [toolPermissionState, setToolPermissionState] = useState<ToolPermissionState | null>(null)

  // Sync interaction mode to agent so the loop enforces tool restrictions
  useEffect(() => {
    agent.interactionMode = interactionMode
  }, [agent, interactionMode])

  // Wire up the agent's confirm handler for destructive shell commands
  useEffect(() => {
    agent.setConfirmHandler((message) => {
      // Auto-accept mode bypasses confirmation prompts
      if (isAutoAccept(interactionMode)) {
        return Promise.resolve(true)
      }
      return new Promise<boolean>((resolve) => {
        setConfirmState({ message, resolve })
      })
    })
    return () => agent.setConfirmHandler(null)
  }, [agent, interactionMode])

  // Wire up the tool permission handler
  useEffect(() => {
    agent.setToolPermissionHandler((toolName, args) => {
      return new Promise<ToolPermissionResult>((resolve) => {
        setToolPermissionState({ toolName, args, resolve })
      })
    })
    return () => agent.setToolPermissionHandler(null)
  }, [agent])

  useEffect(() => {
    // Set terminal title
    process.stdout.write('\x1b]0;deepseek\x07')
    return () => { process.stdout.write('\x1b]0;\x07') }
  }, [])

  useEffect(() => {
    // Update terminal title based on loading state
    if (isLoading) {
      process.stdout.write('\x1b]0;deepseek — working...\x07')
    } else {
      process.stdout.write('\x1b]0;deepseek\x07')
    }
  }, [isLoading])

  useEffect(() => {
    const init = async () => {
      // Wait for agent initialization then surface any MCP connection errors
      await new Promise<void>((resolve) => {
        const check = () => {
          if (agent.mcpErrors !== undefined) resolve()
          else setTimeout(check, 50)
        }
        check()
      })
      if (language) {
        agent.setLanguage(language)
      }
      if (initialSession?.agentMessages?.length) {
        agent.loadSessionMessages(initialSession.agentMessages)
      }
      if (initialSession?.uiMessages?.length) {
        setMessages(initialSession.uiMessages)
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
        await handleSubmit(initialMessage)
      }
    }
    init()
  }, [])

  useInput((_, key) => {
    if (key.ctrl && key.return) return
    // Escape clears input (handled in InputBox) — don't exit here
    // Exit is handled by double Ctrl-C in InputBox
  })

  const shellProcRef = useRef<ReturnType<typeof execa> | null>(null)

  const handleAbort = useCallback(() => {
    agent.abort()
    if (shellProcRef.current) {
      shellProcRef.current.kill()
      shellProcRef.current = null
    }
    setQueuedMessages([])
  }, [agent])

  const handleQueue = useCallback((msg: string) => {
    setQueuedMessages((q) => enqueue(q, msg))
  }, [])

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

  // ── runAgent: shared helper that drives agent.run with streaming callbacks ──
  const runAgent = useCallback(async (prompt: string) => {
    let tokenBuffer = ''
    let streamTextAccum = ''
    const flushInterval = setInterval(() => {
      if (tokenBuffer) {
        const buf = tokenBuffer
        tokenBuffer = ''
        streamTextAccum += buf
        setStreamText((s) => s + buf)
      }
    }, 50)

    try {
      await agent.run(prompt, {
        onPhaseChange(phase) { setAgentPhase(phase) },
        onToken(token) { tokenBuffer += token },
        onToolCall(name, args) {
          clearInterval(flushInterval)
          // Commit any pending stream text before switching to tool display
          const pending = (streamTextAccum + tokenBuffer).trim()
          tokenBuffer = ''
          streamTextAccum = ''
          setStreamText('')
          if (pending) setMessages((m) => [...m, { role: 'assistant', content: pending }])
          setToolCallCount((c) => c + 1)
          setToolStatus({ name, args: JSON.stringify(args).slice(0, 100), done: false })
        },
        onToolResult(name, result, args) {
          setToolStatus(null)
          if (name === 'write_file') {
            setMessages((m) => [...m, { role: 'tool', content: `✓ write_file → ${result}` }])
          } else if (name === 'subagent') {
            setMessages((m) => [...m, { role: 'tool', content: `✓ subagent → ${result}` }])
          } else {
            const argLabel = args?.path ?? args?.pattern ?? args?.command ?? ''
            const payload = JSON.stringify({ arg: argLabel ? String(argLabel) : '', output: result ?? '' })
            setMessages((m) => [...m, { role: 'tool', content: `✓ ${name} → ${payload}` }])
          }
        },
        onDone() {
          clearInterval(flushInterval)
          const pending = (streamTextAccum + tokenBuffer).trim()
          tokenBuffer = ''
          streamTextAccum = ''
          setToolStatus(null)
          // Clear stream BEFORE committing to Static — prevents 1-frame duplication
          setStreamText('')
          if (pending) setMessages((m) => [...m, { role: 'assistant', content: pending }])
          setIsLoading(false)
          setAgentPhase('idle')
          setTokenCount(agent.tokenCount)
          // Process queued messages — setTimeout avoids re-entrant setState loop
          setQueuedMessages((q) => {
            if (q.length === 0) return q
            const [first, ...rest] = q
            setTimeout(() => handleSubmit(first!), 0)
            return rest
          })
          const pct = agent.contextLimit > 0 ? Math.round((agent.contextUsage / agent.contextLimit) * 100) : 0
          setContextPct(pct)
          if (sessionId) {
            setTimeout(() => {
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
      setToolStatus(null)
      setIsLoading(false)
      setAgentPhase('idle')
      const provider = providerConfig?.provider ?? 'deepseek'
      const message = e instanceof Error
        ? formatChatError(e, provider)
        : String(e)
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ Error: ${message}` }])
    }
  }, [agent, sessionId, language, initialSession, providerConfig])

  // ── runWithPrompt: runs an internal prompt without exposing the text to the user ──
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
        case 'quit': exit(); process.exit(0)
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
          // Remove last user+assistant exchange from display and re-run
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
        case 'unknown':
          setMessages((m) => [...m, { role: 'assistant', content: cmd.input }])
          return
      }
    }

    await appendInputHistory(text)

    // ── Shell execution with ! ────────────────────────────────────────────
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
  }, [agent, isLoading, exit, runWithPrompt, runAgent])

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Área de mensagens — cresce pra ocupar todo espaço disponível */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <MessageList messages={messages} streamText={streamText} streamRole={streamRole} theme={theme} activeAgent={activeAgent} headerProvider={headerProvider} headerAgent={headerAgent} />
        {toolStatus && <ToolUseDisplay tool={toolStatus} />}
        <TodoPanel />
        {isLoading && <LoadingSpinner toolCallCount={toolCallCount} phase={agentPhase} />}
        {queuedMessages.length > 0 && <QueuedMessagesList messages={queuedMessages} />}
      </Box>

      {/* Rodapé fixo no final */}
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
          />
        )}
        <StatusBar tokenCount={tokenCount} model={agent.model} activeAgent={activeAgent} provider={agent.provider} contextPct={contextPct} interactionMode={interactionMode} />
      </Box>
    </Box>
  )
}

function ConfirmPrompt({ message, onConfirm }: { message: string; onConfirm: (yes: boolean) => void }) {
  useInput((input, key) => {
    if (key.ctrl && input === 'c') { onConfirm(false); return }
    if (input === 'y' || input === 'Y') onConfirm(true)
    else if (input === 'n' || input === 'N' || key.escape) onConfirm(false)
  })

  return (
    <Box flexDirection="column" marginY={1}>
      <Box borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow">⚠ {message}</Text>
      </Box>
      <Text dimColor>  [y] confirm  [n/Esc] cancel</Text>
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

  useInput((input, key) => {
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
  const plainPreview = stripAnsi(argsPreview)
  const preview = plainPreview.length > cols ? argsPreview.slice(0, cols) + '…' : argsPreview

  return (
    <Box flexDirection="column" marginY={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0} flexDirection="column">
        <Box gap={1}>
          <Text color="cyan" bold>◆ Tool permission</Text>
        </Box>
        <Box marginTop={1} gap={1}>
          <Text dimColor>tool:</Text>
          <Text color="yellow" bold>{toolName}</Text>
        </Box>
        <Box gap={1}>
          <Text dimColor>args:</Text>
          <Text dimColor>{preview}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        {PERMISSION_OPTIONS.map((opt, i) => (
          <Box key={opt.key} gap={2}>
            <Text color={i === selected ? 'cyan' : 'white'} bold={i === selected}>
              {i === selected ? '❯' : ' '} [{opt.key}]
            </Text>
            <Text color={i === selected ? 'cyan' : undefined} dimColor={i !== selected}>
              {opt.label}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>  ↑↓ navigate  ·  Enter confirm  ·  Esc deny  ·  [3] aborts agent</Text>
      </Box>
    </Box>
  )
}
