import React, { useState, useCallback, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { Agent } from '../agent.js'
import { MessageList } from './MessageList.js'
import { ToolUseDisplay } from './ToolUseDisplay.js'
import { InputBox } from './InputBox.js'
import { StatusBar } from './StatusBar.js'
import { parseCommand, HELP_TEXT } from '../commands.js'
import { loadAgentConfig, listAgents, type LoadedAgent } from '../agentConfig.js'

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

export function App({ initialAgent, initialMessage }: { initialAgent?: LoadedAgent | null; initialMessage?: string | null }) {
  const { exit } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [streamText, setStreamText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null)
  const [tokenCount, setTokenCount] = useState(0)
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [agent] = useState(() => new Agent())

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
        setToolStatus({ name, args: JSON.stringify(args).slice(0, 100), done: false })
      },
      onToolResult(name, result) {
        setToolStatus({ name, args: '', done: true, result: result.slice(0, 200) })
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
      <MessageList messages={messages} streamText={streamText} />
      {toolStatus && <ToolUseDisplay tool={toolStatus} />}
      <InputBox onSubmit={handleSubmit} isLoading={isLoading} />
      <StatusBar tokenCount={tokenCount} model={agent.model} activeAgent={activeAgent} />
    </Box>
  )
}
