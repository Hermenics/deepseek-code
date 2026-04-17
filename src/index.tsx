#!/usr/bin/env bun
// Pipe mode: only when --pipe flag is explicitly passed
// (Bun returns undefined for isTTY so we can't auto-detect pipes reliably)
if (process.argv.includes('--pipe')) {
  const { default: runPipe } = await import('./pipe.js')
  await runPipe()
  process.exit(0)
}

import React, { useState, useEffect } from 'react'
import { render, Box, Text, Static } from 'ink'
import { App } from './ui/App.js'
import { DeepSeekMascot } from './ui/layout/Mascot.js'
import { ApiKeySetup, loadSavedConfig, saveConfig, type ThemeName, type ProviderConfig } from './ui/setup/ApiKeySetup.js'
import { LanguageSetup } from './ui/setup/LanguageSetup.js'
import { loadAgentConfig, type LoadedAgent } from './agent/config.js'
import { loadSession, newSessionId, type SessionData } from './agent/session.js'
import pkg from '../package.json' with { type: 'json' }

// Parse argv:
//   deepseek                          → {}
//   deepseek "msg"                    → { initialMessage: "msg" }
//   deepseek agent <name>             → { agentName: "name" }
//   deepseek agent <name> "msg"       → { agentName: "name", initialMessage: "msg" }
//   deepseek --resume <id>            → { resumeId: "id" }
function parseArgv(): { agentName: string | null; initialMessage: string | null; resumeId: string | null } {
  const args = process.argv.slice(2).filter((a) => a !== '--pipe')
  const resumeIdx = args.indexOf('--resume')
  if (resumeIdx !== -1) {
    return { agentName: null, initialMessage: null, resumeId: args[resumeIdx + 1] ?? null }
  }
  if (args[0] === 'agent') {
    return { agentName: args[1] ?? null, initialMessage: args[2] ?? null, resumeId: null }
  }
  return { agentName: null, initialMessage: args[0] ?? null, resumeId: null }
}

const SESSION_ID = newSessionId()

function Root() {
  const [ready, setReady] = useState(false)
  const [checked, setChecked] = useState(false)
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null)
  const [initialAgent, setInitialAgent] = useState<LoadedAgent | null>(null)
  const [initialMessage, setInitialMessage] = useState<string | null>(null)
  const [language, setLanguage] = useState<string | null>(null)
  const [languageChecked, setLanguageChecked] = useState(false)
  const [initialSession, setInitialSession] = useState<SessionData | null>(null)

  useEffect(() => {
    const { agentName, initialMessage: msg, resumeId } = parseArgv()
    loadSavedConfig().then(async ({ providerConfig: saved, theme: savedTheme, language: savedLanguage }) => {
      setTheme(savedTheme)
      if (saved) {
        setProviderConfig(saved)
        if (saved.provider === 'deepseek' && saved.apiKey) process.env.DEEPSEEK_API_KEY = saved.apiKey
        setReady(true)
      } else if (process.env.DEEPSEEK_API_KEY) {
        setProviderConfig({ provider: 'deepseek', apiKey: process.env.DEEPSEEK_API_KEY })
        setReady(true)
      }
      setLanguage(savedLanguage)
      setLanguageChecked(true)
      if (resumeId) {
        const session = await loadSession(resumeId)
        if (session) {
          setInitialSession(session)
          if (session.language) setLanguage(session.language)
        }
      }
      if (agentName) {
        try { setInitialAgent(await loadAgentConfig(agentName)) } catch (e) { console.error((e as Error).message) }
      }
      if (msg) setInitialMessage(msg)
      setChecked(true)
    })
  }, [])

  if (!checked) return null

  // Step 1: no provider configured → ApiKeySetup
  if (!ready) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <ApiKeySetup onDone={(t, cfg) => { setTheme(t); setProviderConfig(cfg); setReady(true) }} />
      </Box>
    )
  }

  // Step 2: provider configured but no language → LanguageSetup
  if (languageChecked && language === null) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <LanguageSetup onDone={(lang) => {
          setLanguage(lang)
          saveConfig({ LANGUAGE: lang })
        }} />
      </Box>
    )
  }

  // Step 3: everything configured → App
  return (
    <Box flexDirection="column">
      <Static items={['header']}>
        {() => (
          <Box key="header" flexDirection="row" paddingX={1} paddingTop={1} paddingBottom={0}>
            <Box marginRight={2}>
              <DeepSeekMascot />
            </Box>
            <Box flexDirection="column" justifyContent="center">
              <Box>
                <Text bold color="cyan">◆ DeepSeek Code  </Text>
                <Text dimColor>v{pkg.version}  ·  {providerConfig?.provider ?? 'deepseek'}</Text>
              </Box>
              <Text bold color="blueBright">Welcome to DeepSeek Code!</Text>
              <Text dimColor>/help for commands  ·  Ctrl+C twice to exit</Text>
              <Text color="cyan" dimColor>{`[${initialAgent?.config.name ?? 'deepseek'}] We're in `}<Text bold color="blueBright">{process.cwd()}</Text>{`, right?`}</Text>
            </Box>
          </Box>
        )}
      </Static>
      <App initialAgent={initialAgent} initialMessage={initialMessage} theme={theme} providerConfig={providerConfig} onThemeChange={setTheme} language={language} sessionId={SESSION_ID} initialSession={initialSession} />
    </Box>
  )
}

const { waitUntilExit } = render(<Root />, { exitOnCtrlC: false })
waitUntilExit().then(() => {
  process.stderr.write(`\n  Resume this session:\n  deepseek --resume ${SESSION_ID}\n\n`)
  process.exit(0)
})
