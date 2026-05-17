#!/usr/bin/env bun
// Pipe mode: only when --pipe flag is explicitly passed
if (process.argv.includes('--pipe')) {
  const { default: runPipe } = await import('./pipe.js')
  await runPipe()
  process.exit(0)
}

// Dev logging: redirect stderr + uncaught errors to ~/.deepseek/logs/dev.log
if (process.env.NODE_ENV === 'development') {
  const { createWriteStream } = await import('fs')
  const { mkdirSync } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')
  const logDir = join(homedir(), '.deepseek', 'logs')
  mkdirSync(logDir, { recursive: true })
  const logStream = createWriteStream(join(logDir, 'dev.log'), { flags: 'w' })
  const write = (data: unknown) => logStream.write(`[${new Date().toISOString()}] ${String(data)}\n`)
  const origStderr = process.stderr.write.bind(process.stderr)
  process.stderr.write = (data: unknown, ...args: unknown[]) => {
    write(data)
    return (origStderr as Function)(data, ...args)
  }
  process.on('uncaughtException', (err) => write(`uncaughtException: ${err.stack ?? err}`))
  process.on('unhandledRejection', (reason) => write(`unhandledRejection: ${reason}`))
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
import { startProxy, waitForProxy, isOAuthReady } from './agent/providers/oauth.js'
import type { ChildProcess } from 'child_process'
import pkg from '../package.json' with { type: 'json' }

function parseArgv(): { agentName: string | null; initialMessage: string | null; resumeId: string | null; update: boolean; logout: boolean; help: boolean; version: boolean } {
  const args = process.argv.slice(2).filter((a) => a !== '--pipe')
  if (args[0] === 'update') {
    return { agentName: null, initialMessage: null, resumeId: null, update: true, logout: false, help: false, version: false }
  }
  if (args[0] === 'logout') {
    return { agentName: null, initialMessage: null, resumeId: null, update: false, logout: true, help: false, version: false }
  }
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    return { agentName: null, initialMessage: null, resumeId: null, update: false, logout: false, help: true, version: false }
  }
  if (args[0] === 'version' || args[0] === 'v' || args[0] === '--version' || args[0] === '-v') {
    return { agentName: null, initialMessage: null, resumeId: null, update: false, logout: false, help: false, version: true }
  }
  const resumeIdx = args.indexOf('--resume')
  if (resumeIdx !== -1) {
    return { agentName: null, initialMessage: null, resumeId: args[resumeIdx + 1] ?? null, update: false, logout: false, help: false, version: false }
  }
  if (args[0] === 'agent') {
    return { agentName: args[1] ?? null, initialMessage: args[2] ?? null, resumeId: null, update: false, logout: false, help: false, version: false }
  }
  return { agentName: null, initialMessage: args[0] ?? null, resumeId: null, update: false, logout: false, help: false, version: false }
}

// Parse once at startup — reused by Root component
const ARGV = parseArgv()

// ── deepseek update ───────────────────────────────────────────────────────────
const { update, logout } = ARGV

if (ARGV.version) {
  process.stdout.write(`${pkg.version}\n`)
  process.exit(0)
}


if (ARGV.help) {
  process.stdout.write(`
DeepSeek Code v${pkg.version} — AI coding agent for the terminal

Usage:
  deepseek                          Start interactive session
  deepseek "fix the bug in app.ts"  Start with an initial message
  deepseek agent <name>             Load a custom agent
  deepseek agent <name> "message"   Load agent with initial message
  deepseek --resume <session-id>    Resume a previous session
  deepseek update                   Update to latest version
  deepseek logout                   Remove saved credentials
  deepseek help                     Show this help

Pipe mode:
  echo "task" | deepseek            Run headlessly from stdin
  cat file.ts | deepseek "explain"  Pipe file content with prompt

In-app commands (type / to see all):
  /help        Show all slash commands
  /model       Switch AI model
  /agent       Load a custom agent
  /clear       Clear conversation history
  /compact     Summarize history to save context
  /plan        Plan implementation of a task
  /review      Review project code
  /quit        Exit

`)
  process.exit(0)
}

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
      // Detect package manager: prefer bun if running under bun, else npm
      const isBun = typeof Bun !== 'undefined' || process.versions?.bun != null
      const pm = isBun ? 'bun' : (process.env.npm_execpath?.includes('yarn') ? 'yarn' : 'npm')
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

const SESSION_ID = newSessionId()
let proxyChild: ChildProcess | null = null

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
  const [resumeNotFound, setResumeNotFound] = useState(false)

  useEffect(() => {
    const { agentName, initialMessage: msg, resumeId } = ARGV
    migrateConfigIfNeeded().then(() => loadSavedConfig()).then(async ({ providerConfig: saved, theme: savedTheme, language: savedLanguage }) => {
      setTheme(savedTheme)
      if (saved) {
        setProviderConfig(saved)
        if (saved.provider === 'deepseek' && saved.apiKey) process.env.DEEPSEEK_API_KEY = saved.apiKey
        if (saved.provider === 'oauth' && isOAuthReady()) {
          // Only start proxy if not already running
          const alreadyUp = await fetch('http://127.0.0.1:3000/health').then(r => r.ok).catch(() => false)
          if (!alreadyUp) {
            proxyChild = startProxy()
            const ok = await waitForProxy(150000)
            if (!ok) console.error('Warning: proxy failed to start within 15s')
          }
        }
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
        } else {
          setResumeNotFound(true)
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

  if (resumeNotFound) {
    // Show error inline — don't crash, just start fresh
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg="yellow">{'⚠ Session not found. Starting a new session.'}</text>
      </box>
    )
  }

  if (!ready) {
    return (
      <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <ApiKeySetup onDone={(t, cfg) => { setTheme(t); setProviderConfig(cfg); setReady(true) }} />
      </box>
    )
  }

  if (languageChecked && language === null && !ARGV.resumeId) {
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

function cleanExit(code = 0): never {
  // Disable mouse tracking and restore cursor before exit
  process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?25h')
  // Do NOT kill the proxy — keep it alive for the next session
  process.stdout.write(`\n  Resume this session:\n  deepseek --resume ${SESSION_ID}\n\n`)
  process.exit(code)
}

// Handle clean exit
renderer.on('exit', () => cleanExit(0))

process.on('SIGINT', () => cleanExit(0))
process.on('SIGTERM', () => cleanExit(0))
