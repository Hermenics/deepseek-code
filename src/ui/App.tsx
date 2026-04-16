import React, { useState, useCallback, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { Agent, type ToolPermissionResult } from '../agent/agent.js'
import { MessageList } from './messages/MessageList.js'
import { ToolUseDisplay } from './messages/ToolUseDisplay.js'
import { InputBox } from './input/InputBox.js'
import { StatusBar } from './layout/StatusBar.js'
import { ThemeSelector } from './setup/ThemeSelector.js'
import { parseCommand, HELP_TEXT } from '../commands.js'
import { loadAgentConfig, listAgents, type LoadedAgent } from '../agent/config.js'
import { appendInputHistory } from '../agent/inputHistory.js'
import type { ThemeName, ProviderConfig } from './setup/ApiKeySetup.js'

export type AgentPhase = 'idle' | 'refining' | 'executing'

export interface Message {
  role: 'user' | 'assistant' | 'tool'
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

export function App({ initialAgent, initialMessage, theme: initialTheme, providerConfig, onThemeChange }: {
  initialAgent?: LoadedAgent | null
  initialMessage?: string | null
  theme: ThemeName
  providerConfig?: ProviderConfig | null
  onThemeChange?: (t: ThemeName) => void
}) {
  const { exit } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [streamText, setStreamText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null)
  const [tokenCount, setTokenCount] = useState(0)
  const [contextPct, setContextPct] = useState(0)
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [toolCallCount, setToolCallCount] = useState(0)
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle')
  const [agent] = useState(() => new Agent(providerConfig ?? undefined))
  const [theme, setTheme] = useState<ThemeName>(initialTheme)
  const [showThemeSelector, setShowThemeSelector] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [toolPermissionState, setToolPermissionState] = useState<ToolPermissionState | null>(null)

  // Wire up the agent's confirm handler for destructive shell commands
  useEffect(() => {
    agent.setConfirmHandler((message) => {
      return new Promise<boolean>((resolve) => {
        setConfirmState({ message, resolve })
      })
    })
    return () => agent.setConfirmHandler(null)
  }, [agent])

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
    const init = async () => {
      if (initialAgent) {
        const { config, source } = initialAgent
        await agent.applyAgentConfig(config)
        setActiveAgent(config.name)
        const sourceMsg = source === 'local' ? 'local (overrides global)' : 'global'
        setMessages([{ role: 'assistant', content: `Agent '${config.name}' loaded from ${sourceMsg}.` }])
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

  const handleAbort = useCallback(() => {
    agent.abort()
  }, [agent])

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
        case 'refine': {
          agent.refineEnabled = !agent.refineEnabled
          setMessages((m) => [...m, { role: 'assistant', content: `Prompt refinement ${agent.refineEnabled ? 'enabled ✓' : 'disabled ✗'}` }])
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
        case 'unknown':
          setMessages((m) => [...m, { role: 'assistant', content: cmd.input }])
          return
      }
    }

    await appendInputHistory(text)
    setMessages((m) => [...m, { role: 'user', content: text }])
    setIsLoading(true)
    setAgentPhase('refining')
    setStreamText('')

    let tokenBuffer = ''
    const flushInterval = setInterval(() => {
      if (tokenBuffer) {
        const buf = tokenBuffer
        tokenBuffer = ''
        setStreamText((s) => s + buf)
      }
    }, 150)

    await agent.run(text, {
      onPhaseChange(phase) {
        setAgentPhase(phase)
      },
      onToken(token) {
        tokenBuffer += token
      },
      onToolCall(name, args) {
        clearInterval(flushInterval)
        if (tokenBuffer) { setStreamText((s) => s + tokenBuffer); tokenBuffer = '' }
        setToolCallCount((c) => c + 1)
        setToolStatus({ name, args: JSON.stringify(args).slice(0, 100), done: false })
        setStreamText((s) => {
          if (s) setMessages((m) => [...m, { role: 'assistant', content: s }])
          return ''
        })
      },
      onToolResult(name, result, args) {
        setToolStatus(null)
        const label = args?.path ?? args?.pattern ?? args?.command ?? ''
        const display = name === 'write_file'
          ? result
          : name === 'subagent'
          ? result
          : label ? String(label) : ''
        setMessages((m) => [...m, { role: 'tool', content: `✓ ${name}${display ? ` → ${display}` : ''}` }])
      },
      onDone() {
        clearInterval(flushInterval)
        if (tokenBuffer) { setStreamText((s) => s + tokenBuffer); tokenBuffer = '' }
        setToolStatus(null)
        setStreamText((s) => {
          if (s) setMessages((m) => [...m, { role: 'assistant', content: s }])
          return ''
        })
        setIsLoading(false)
        setAgentPhase('idle')
        setTokenCount(agent.tokenCount)
        const pct = agent.contextLimit > 0
          ? Math.round((agent.contextUsage / agent.contextLimit) * 100)
          : 0
        setContextPct(pct)
      },
      onAutoCompact(summary) {
        setMessages((m) => [...m, { role: 'assistant', content: `⚡ Contexto compactado automaticamente (>85%).\n\n${summary}` }])
      },
    })
  }, [agent, isLoading, exit])

  if (showThemeSelector) {
    return (
      <Box flexDirection="column" width="100%">
        <ThemeSelector
          currentTheme={theme}
          onSelect={(t) => { setTheme(t); onThemeChange?.(t); setShowThemeSelector(false) }}
          onCancel={() => setShowThemeSelector(false)}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width="100%">
      <MessageList messages={messages} streamText={streamText} theme={theme} activeAgent={activeAgent} />
      {toolStatus && <ToolUseDisplay tool={toolStatus} />}
      {toolPermissionState ? (
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
          phase={agentPhase}
          contextPct={contextPct}
        />
      )}
      <StatusBar tokenCount={tokenCount} model={agent.model} activeAgent={activeAgent} provider={agent.provider} />
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
  { key: '1', label: 'Permitir só esta vez', result: 'once' as ToolPermissionResult },
  { key: '2', label: 'Permitir nesta sessão', result: 'session' as ToolPermissionResult },
  { key: '3', label: 'Negar', result: 'deny' as ToolPermissionResult },
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
  const preview = argsPreview.length > 120 ? argsPreview.slice(0, 120) + '…' : argsPreview

  return (
    <Box flexDirection="column" marginY={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0} flexDirection="column">
        <Box gap={1}>
          <Text color="cyan" bold>◆ Permissão de tool</Text>
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
        <Text dimColor>  ↑↓ navegar  ·  Enter confirmar  ·  Esc negar</Text>
      </Box>
    </Box>
  )
}
