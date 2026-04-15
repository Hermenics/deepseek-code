#!/usr/bin/env bun
// Pipe mode: only when --pipe flag is explicitly passed
// (Bun returns undefined for isTTY so we can't auto-detect pipes reliably)
if (process.argv.includes('--pipe')) {
  const { default: runPipe } = await import('./pipe.js')
  await runPipe()
  process.exit(0)
}

import React, { useState, useEffect } from 'react'
import { render, Box, Text } from 'ink'
import { App } from './ui/App.js'
import { ApiKeySetup, loadSavedConfig, type ThemeName, type ProviderConfig } from './ui/setup/ApiKeySetup.js'
import { loadAgentConfig, type LoadedAgent } from './agent/config.js'
import pkg from '../package.json' with { type: 'json' }

// Parse argv:
//   deepseek                          → {}
//   deepseek "msg"                    → { initialMessage: "msg" }
//   deepseek agent <name>             → { agentName: "name" }
//   deepseek agent <name> "msg"       → { agentName: "name", initialMessage: "msg" }
function parseArgv(): { agentName: string | null; initialMessage: string | null } {
  const args = process.argv.slice(2).filter((a) => a !== '--pipe')
  if (args[0] === 'agent') {
    return { agentName: args[1] ?? null, initialMessage: args[2] ?? null }
  }
  return { agentName: null, initialMessage: args[0] ?? null }
}

function Root() {
  const [ready, setReady] = useState(false)
  const [checked, setChecked] = useState(false)
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null)
  const [initialAgent, setInitialAgent] = useState<LoadedAgent | null>(null)
  const [initialMessage, setInitialMessage] = useState<string | null>(null)

  useEffect(() => {
    const { agentName, initialMessage: msg } = parseArgv()
    loadSavedConfig().then(async ({ providerConfig: saved, theme: savedTheme }) => {
      setTheme(savedTheme)
      if (saved) {
        setProviderConfig(saved)
        if (saved.provider === 'deepseek' && saved.apiKey) process.env.DEEPSEEK_API_KEY = saved.apiKey
        setReady(true)
      } else if (process.env.DEEPSEEK_API_KEY) {
        setProviderConfig({ provider: 'deepseek', apiKey: process.env.DEEPSEEK_API_KEY })
        setReady(true)
      }
      if (agentName) {
        try { setInitialAgent(await loadAgentConfig(agentName)) } catch (e) { console.error((e as Error).message) }
      }
      if (msg) setInitialMessage(msg)
      setChecked(true)
    })
  }, [])

  if (!checked) return null

  if (!ready) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <ApiKeySetup onDone={(t, cfg) => { setTheme(t); setProviderConfig(cfg); setReady(true) }} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={2}>
        <Text bold color="cyan">◆ DeepSeek Code  </Text>
        <Text dimColor>v{pkg.version}  ·  /help for commands  ·  Ctrl+C twice to exit</Text>
      </Box>
      <App initialAgent={initialAgent} initialMessage={initialMessage} theme={theme} providerConfig={providerConfig} onThemeChange={setTheme} />
    </Box>
  )
}

const { waitUntilExit } = render(<Root />, { exitOnCtrlC: false })
waitUntilExit().then(() => process.exit(0))
