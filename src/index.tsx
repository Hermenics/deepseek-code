#!/usr/bin/env bun
// Pipe mode: only when --pipe flag is explicitly passed
if (process.argv.includes('--pipe')) {
  const { default: runPipe } = await import('./pipe.js')
  await runPipe()
  process.exit(0)
}

// Set terminal title
process.title = 'deepseek'
process.stdout.write('\x1b]0;DeepSeek\x07')

import { useState, useEffect } from 'react'
import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import { App } from './ui/App.js'
import { ApiKeySetup, loadSavedConfig, saveConfig, type ThemeName, type ProviderConfig } from './ui/setup/ApiKeySetup.js'
import { migrateConfigIfNeeded, logout as doLogout } from './utils/credentials.js'
import { LanguageSetup } from './ui/setup/LanguageSetup.js'
import { loadAgentConfig, type LoadedAgent } from './agent/config.js'
import { loadSession, newSessionId, type SessionData } from './agent/session.js'
import pkg from '../package.json' with { type: 'json' }

// ── deepseek update ───────────────────────────────────────────────────────────
const { update, logout } = parseArgv()
if (update) {
  const name = pkg.name
  const current = pkg.version
  process.stdout.write(`Checking for updates to ${name}...\n`)
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`)
    if (!res.ok) throw new Error(`Registry returned ${res.status}`)
    const data = await res.json() as { version: string }
    const latest = data.version
    if (latest === current) {
      process.stdout.write(`Already up to date (${current}).\n`)
    } else {
      process.stdout.write(`Updating ${current} → ${latest}...\n`)
      const { execa } = await import('execa')
      const pm = process.env.npm_execpath?.includes('bun') ? 'bun' : 'npm'
      const { stdout, stderr } = await execa(pm, ['install', '-g', `${name}@${latest}`], { reject: false })
      if (stdout) process.stdout.write(stdout + '\n')
      if (stderr) process.stderr.write(stderr + '\n')
      process.stdout.write(`Updated to ${latest}. Restart deepseek to use the new version.\n`)
    }
  } catch (e) {
    process.stderr.write(`Update failed: ${(e as Error).message}\n`)
    process.exit(1)
  }
  process.exit(0)
}

// ── deepseek logout ──────────────────────────────────────────────────────────
if (logout) {
  const deleted = await doLogout()
  if (deleted.length > 0) {
    process.stdout.write(`Logged out. Deleted:\n`)
    for (const f of deleted) process.stdout.write(`  ${f}\n`)
  } else {
    process.stdout.write(`Already logged out (no credentials found).\n`)
  }
  process.exit(0)
}

function parseArgv(): { agentName: string | null; initialMessage: string | null; resumeId: string | null; update: boolean; logout: boolean } {
  const args = process.argv.slice(2).filter((a) => a !== '--pipe')
  if (args[0] === 'update') {
    return { agentName: null, initialMessage: null, resumeId: null, update: true, logout: false }
  }
  if (args[0] === 'logout') {
    return { agentName: null, initialMessage: null, resumeId: null, update: false, logout: true }
  }
  const resumeIdx = args.indexOf('--resume')
  if (resumeIdx !== -1) {
    return { agentName: null, initialMessage: null, resumeId: args[resumeIdx + 1] ?? null, update: false, logout: false }
  }
  if (args[0] === 'agent') {
    return { agentName: args[1] ?? null, initialMessage: args[2] ?? null, resumeId: null, update: false, logout: false }
  }
  return { agentName: null, initialMessage: args[0] ?? null, resumeId: null, update: false, logout: false }
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
    migrateConfigIfNeeded().then(() => loadSavedConfig()).then(async ({ providerConfig: saved, theme: savedTheme, language: savedLanguage }) => {
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

  if (!ready) {
    return (
      <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <ApiKeySetup onDone={(t, cfg) => { setTheme(t); setProviderConfig(cfg); setReady(true) }} />
      </box>
    )
  }

  if (languageChecked && language === null) {
    return (
      <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <LanguageSetup onDone={(lang) => {
          setLanguage(lang)
          saveConfig({ LANGUAGE: lang })
        }} />
      </box>
    )
  }

  return (
    <App
      initialAgent={initialAgent}
      initialMessage={initialMessage}
      theme={theme}
      providerConfig={providerConfig}
      onThemeChange={setTheme}
      language={language}
      sessionId={SESSION_ID}
      initialSession={initialSession}
      headerProvider={providerConfig?.provider ?? 'deepseek'}
      headerAgent={initialAgent?.config.name ?? null}
    />
  )
}

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  clearOnShutdown: true,
  useMouse: false,
  enableMouseMovement: false,
})

const root = createRoot(renderer)
root.render(<Root />)

// Handle clean exit
renderer.on('exit', () => {
  process.stdout.write(`\n  Resume this session:\n  deepseek --resume ${SESSION_ID}\n\n`)
  process.exit(0)
})
