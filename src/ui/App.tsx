import React, { useState, useCallback, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { Agent } from '../agent/agent.js'
import { MessageList } from './messages/MessageList.js'
import { ToolUseDisplay } from './messages/ToolUseDisplay.js'
import { InputBox } from './input/InputBox.js'
import { StatusBar } from './layout/StatusBar.js'
import { ThemeSelector } from './setup/ThemeSelector.js'
import { parseCommand, HELP_TEXT } from '../commands.js'
import { loadAgentConfig, listAgents, type LoadedAgent } from '../agent/config.js'
import type { ThemeName } from './setup/ApiKeySetup.js'

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

export function App({ initialAgent, initialMessage, theme: initialTheme, onThemeChange }: { initialAgent?: LoadedAgent | null; initialMessage?: string | null; theme: ThemeName; onThemeChange?: (t: ThemeName) => void }) {
  const { exit } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [streamText, setStreamText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null)
  const [tokenCount, setTokenCount] = useState(0)
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [toolCallCount, setToolCallCount] = useState(0)
  const [agent] = useState(() => new Agent())
  const [theme, setTheme] = useState<ThemeName>(initialTheme)
  const [showThemeSelector, setShowThemeSelector] = useState(false)

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
    if (key.escape) { exit(); process.exit(0) }
  })

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
        case 'unknown':
          setMessages((m) => [...m, { role: 'assistant', content: cmd.input }])
          return
        case 'theme':
          setShowThemeSelector(true)
          return
      }
    }

    setMessages((m) => [...m, { role: 'user', content: text }])
    setIsLoading(true)
    setStreamText('')

    await agent.run(text, {
      onToken(token) {
        setStreamText((s) => s + token)
      },
      onToolCall(name, args) {
        setToolCallCount((c) => c + 1)
        setToolStatus({ name, args: JSON.stringify(args).slice(0, 100), done: false })
        // Flush any streamed text before the tool call so order is preserved
        setStreamText((s) => {
          if (s) setMessages((m) => [...m, { role: 'assistant', content: s }])
          return ''
        })
      },
      onToolResult(name, result, args) {
        setToolStatus(null)
        // Show meaningful label instead of result content
        const label = args?.path ?? args?.pattern ?? args?.command ?? ''
        const display = name === 'write_file'
          ? result  // needs full JSON for diff rendering
          : label ? String(label) : ''
        setMessages((m) => [...m, { role: 'tool', content: `✓ ${name}${display ? ` → ${display}` : ''}` }])
      },
      onDone() {
        setToolStatus(null)
        setStreamText((s) => {
          if (s) setMessages((m) => [...m, { role: 'assistant', content: s }])
          return ''
        })
        setIsLoading(false)
        setTokenCount(agent.tokenCount)
      },
    })
  }, [agent, isLoading, exit])

  return (
    <Box flexDirection="column" width="100%">
      <MessageList messages={messages} streamText={streamText} theme={theme} />
      {toolStatus && <ToolUseDisplay tool={toolStatus} />}
      {showThemeSelector
        ? <ThemeSelector currentTheme={theme} onSelect={(t) => { setTheme(t); onThemeChange?.(t); setShowThemeSelector(false) }} onCancel={() => setShowThemeSelector(false)} />
        : <InputBox onSubmit={handleSubmit} isLoading={isLoading} toolCallCount={toolCallCount} />
      }
      <StatusBar tokenCount={tokenCount} model={agent.model} activeAgent={activeAgent} />
    </Box>
  )
}
