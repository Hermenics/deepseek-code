#!/usr/bin/env bun
import React, { useState, useEffect } from 'react'
import { render, Box, Text } from 'ink'
import { App } from './ui/App.js'
import { ApiKeySetup, loadSavedConfig, type ThemeName } from './ui/ApiKeySetup.js'
import { DeepSeekMascot } from './ui/Mascot.js'
import { loadAgentConfig, type LoadedAgent } from './agentConfig.js'

// Parse argv:
//   deepseek                          → {}
//   deepseek "msg"                    → { initialMessage: "msg" }
//   deepseek agent <name>             → { agentName: "name" }
//   deepseek agent <name> "msg"       → { agentName: "name", initialMessage: "msg" }
function parseArgv(): { agentName: string | null; initialMessage: string | null } {
  const args = process.argv.slice(2)
  if (args[0] === 'agent') {
    return { agentName: args[1] ?? null, initialMessage: args[2] ?? null }
  }
  return { agentName: null, initialMessage: args[0] ?? null }
}

function Root() {
  const [ready, setReady] = useState(false)
  const [checked, setChecked] = useState(false)
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [initialAgent, setInitialAgent] = useState<LoadedAgent | null>(null)
  const [initialMessage, setInitialMessage] = useState<string | null>(null)

  useEffect(() => {
    const { agentName, initialMessage: msg } = parseArgv()
    loadSavedConfig().then(async ({ apiKey, theme: savedTheme }) => {
      setTheme(savedTheme)
      if (process.env.DEEPSEEK_API_KEY) {
        setReady(true)
      } else if (apiKey) {
        process.env.DEEPSEEK_API_KEY = apiKey
        setReady(true)
      }
      if (agentName) {
        try {
          const loaded = await loadAgentConfig(agentName)
          setInitialAgent(loaded)
        } catch (e) {
          console.error((e as Error).message)
        }
      }
      if (msg) setInitialMessage(msg)
      setChecked(true)
    })
  }, [])

  if (!checked) return null

  if (!ready) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <ApiKeySetup onDone={(t) => { setTheme(t); setReady(true) }} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Box flexDirection="row" paddingX={1} gap={2} alignItems="center">
        <DeepSeekMascot />
        <Box flexDirection="column" justifyContent="center">
          <Text bold color="cyan">DeepSeek Code <Text dimColor>v0.1.0</Text></Text>
          <Text dimColor>deepseek-chat · {process.cwd()}</Text>
          <Text dimColor>Type your message and press Enter. /quit or Esc to exit.</Text>
        </Box>
      </Box>
      <App initialAgent={initialAgent} initialMessage={initialMessage} />
    </Box>
  )
}

const { waitUntilExit } = render(<Root />)
waitUntilExit().then(() => process.exit(0))
