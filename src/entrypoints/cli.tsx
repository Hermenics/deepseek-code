// Pipe mode: only when --pipe flag is explicitly passed.
// --json keeps assistant text out of stdout until the final JSON object.
if (process.argv.includes('--pipe')) {
  const { default: runPipe } = await import('./pipe.js')
  await runPipe()
  process.exit(Number(process.exitCode ?? 0))
}

if (process.argv.includes('--web')) {
  const { default: runWeb } = await import('./web.js')
  await runWeb()
  process.exit(Number(process.exitCode ?? 0))
}

// Suppress noisy react-reconciler dev warnings ASAP — before any imports.
// These fire during reconciler initialization and pollute the TUI output.
const _origConsoleError = console.error.bind(console)
const _origConsoleWarn = console.warn.bind(console)
const _SUPPRESSED = [
  'Encountered two children with the same key',
  'Each child in a list should have a unique',
  'Raw mode is not supported',
]
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '')
  if (_SUPPRESSED.some(s => msg.includes(s))) return
  _origConsoleError(...args)
}
console.warn = (...args: unknown[]) => {
  const msg = String(args[0] ?? '')
  if (_SUPPRESSED.some(s => msg.includes(s))) return
  _origConsoleWarn(...args)
}

// Dev logging: redirect stderr + uncaught errors to ~/.deepseek/logs/dev.log
// Also filter out noisy react-reconciler dev warnings from the terminal.
if (process.env.NODE_ENV === 'development') {
  const { chmodSync, constants, createWriteStream, lstatSync, mkdirSync, openSync } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')
  const logDir = join(homedir(), '.deepseek', 'logs')
  mkdirSync(logDir, { recursive: true, mode: 0o700 })
  chmodSync(logDir, 0o700)
  const logPath = join(logDir, 'dev.log')
  try {
    if (lstatSync(logPath).isSymbolicLink()) throw new Error(`Refusing symbolic-link development log: ${logPath}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const safeOpenFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0)
  const logFd = openSync(logPath, safeOpenFlags, 0o600)
  chmodSync(logPath, 0o600)
  const logStream = createWriteStream(logPath, { fd: logFd, autoClose: true })
  const write = (data: unknown) => logStream.write(`[${new Date().toISOString()}] ${String(data)}\n`)
  const origStderr = process.stderr.write.bind(process.stderr)
  process.stderr.write = (data: unknown, ...args: unknown[]) => {
    const str = String(data)
    // Suppress noisy react-reconciler dev warnings
    if (_SUPPRESSED.some(s => str.includes(s))) {
      write(data)
      return true
    }
    write(data)
    return (origStderr as Function)(data, ...args)
  }
  process.on('uncaughtException', (err) => write(`uncaughtException: ${err.stack ?? err}`))
  process.on('unhandledRejection', (reason) => write(`unhandledRejection: ${reason}`))
}

// Force chalk color level based on terminal capabilities.
// Bun doesn't set isTTY correctly in all cases, so chalk defaults to level 0.
// We detect color support manually and set it before any UI renders.
{
  const { default: chalk } = await import('chalk')
  if (chalk.level === 0) {
    const colorterm = process.env.COLORTERM
    const term = process.env.TERM ?? ''
    if (colorterm === 'truecolor' || colorterm === '24bit') {
      chalk.level = 3
    } else if (colorterm === 'ansi256' || term.includes('256color')) {
      chalk.level = 2
    } else if (process.stdout.isTTY || term !== '') {
      chalk.level = 1
    }
  }
}

// Set terminal title
process.title = 'deepseek'
if (process.stdout.isTTY) process.stdout.write('\x1b]0;DeepSeek\x07')

import { useState, useEffect } from 'react'
import { writeSync } from 'fs'
import { createRoot } from '../ink/root.js'
import { App, getTrustedUserStatusLineConfig } from '../ui/App.js'
import Box from '../ink/components/Box.js'
import Text from '../ink/components/Text.js'
import { AlternateScreen } from '../ink/components/AlternateScreen.js'
import { resolveFullscreen, setFullscreenActive } from '../utils/fullscreen.js'
import { ApiKeySetup, loadSavedConfig } from '../ui/setup/ApiKeySetup.js'
import { ResumePicker } from '../ui/setup/ResumePicker.js'
import type { ThemeName, ProviderConfig } from '../types/provider.js'
import { migrateConfigIfNeeded, logout as doLogout } from '../utils/credentials.js'
import { getGlobalPackageManagers } from '../utils/bun-global-package.js'
import { loadAgentConfig, type LoadedAgent } from '../agent/config.js'
import { getLastProjectSession, listSessions, loadSession, newSessionId, type SessionData } from '../agent/session.js'
import { loadSettingsSnapshot } from '../settings/repository.js'
import type { DeepSeekSettings } from '../settings/types.js'
import { formatExitScreen } from '../utils/exitScreen.js'
import { relaunchCurrentInvocation } from '../utils/relaunch.js'
import pkg from '../../package.json' with { type: 'json' }

function parseArgv(): { agentName: string | null; initialMessage: string | null; resumeId: string | null; resumePicker: boolean; update: boolean; logout: boolean; doctor: boolean; help: boolean; version: boolean } {
  const args = process.argv.slice(2).filter((a) => a !== '--pipe' && a !== '--json')
  if (args[0] === 'update') {
    return { agentName: null, initialMessage: null, resumeId: null, resumePicker: false, update: true, logout: false, doctor: false, help: false, version: false }
  }
  if (args[0] === 'logout') {
    return { agentName: null, initialMessage: null, resumeId: null, resumePicker: false, update: false, logout: true, doctor: false, help: false, version: false }
  }
  if (args[0] === 'doctor') {
    return { agentName: null, initialMessage: null, resumeId: null, resumePicker: false, update: false, logout: false, doctor: true, help: false, version: false }
  }
  if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    return { agentName: null, initialMessage: null, resumeId: null, resumePicker: false, update: false, logout: false, doctor: false, help: true, version: false }
  }
  if (args[0] === 'version' || args[0] === 'v' || args[0] === '--version' || args[0] === '-v') {
    return { agentName: null, initialMessage: null, resumeId: null, resumePicker: false, update: false, logout: false, doctor: false, help: false, version: true }
  }
  const resumeIdx = args.indexOf('--resume')
  if (resumeIdx !== -1) {
    return { agentName: null, initialMessage: null, resumeId: args[resumeIdx + 1] ?? null, resumePicker: args[resumeIdx + 1] === undefined, update: false, logout: false, doctor: false, help: false, version: false }
  }
  if (args[0] === 'agent') {
    return { agentName: args[1] ?? null, initialMessage: args[2] ?? null, resumeId: null, resumePicker: false, update: false, logout: false, doctor: false, help: false, version: false }
  }
  return { agentName: null, initialMessage: args[0] ?? null, resumeId: null, resumePicker: false, update: false, logout: false, doctor: false, help: false, version: false }
}

// Parse once at startup — reused by Root component
const ARGV = parseArgv()

// ── deepseek update ───────────────────────────────────────────────────────────
const { update, logout } = ARGV

if (ARGV.doctor) {
  const { formatDoctorReport, runDoctor } = await import('../doctor.js')
  const report = await runDoctor()
  process.stdout.write(`${formatDoctorReport(report)}\n`)
  process.exit(report.checks.some(check => !check.ok) ? 1 : 0)
}

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
  deepseek --web [--port <port>]    Open the local browser workspace
  deepseek doctor                   Diagnose local setup
  deepseek update                   Update to latest version
  deepseek logout                   Remove saved credentials
  deepseek help                     Show this help

Pipe mode:
  echo "task" | deepseek --pipe             Run headlessly from stdin
  cat file.ts | deepseek --pipe "explain"   Pipe file content with prompt
  echo "task" | deepseek --pipe --json      Return {"ok", "output", "tools"} JSON

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
      const managers = await getGlobalPackageManagers(name)
      if (managers.length === 2) process.stdout.write(`Warning: ${name} is installed globally with npm and Bun; updating both in parallel.\n`)
      const results = await Promise.all(managers.map(async (pm) => ({
        pm,
        result: await execa(pm, pm === 'bun' ? ['add', '-g', `${name}@${latest}`] : ['install', '-g', `${name}@${latest}`], { reject: false }),
      })))
      for (const { result } of results) {
        if (result.stdout) process.stdout.write(result.stdout + '\n')
        if (result.stderr) process.stderr.write(result.stderr + '\n')
      }
      if (results.some(({ result }) => result.exitCode !== 0)) {
        process.stderr.write('Update failed. Check the errors above.\n')
        process.exit(1)
      }
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

// ── Update check ────────────────────────────────────────────────────────────
if (!ARGV.update) {
  const { checkForUpdate, isDismissed } = await import('../utils/update-notifier.js')
  const update = await checkForUpdate()
  if (update && !isDismissed(update.latest)) {
    const { UpdatePrompt } = await import('../ui/setup/UpdatePrompt.js')
    const { renderSync } = await import('../ink/root.js')
    const managers = await getGlobalPackageManagers(pkg.name)
    const choice = await new Promise<'update' | 'skip' | 'dismiss'>((resolve) => {
      const instance = renderSync(
        <UpdatePrompt
          current={update.current}
          latest={update.latest}
          packageManagers={managers}
          onChoice={(c) => { instance.unmount(); resolve(c) }}
        />,
        { exitOnCtrlC: false, patchConsole: false }
      )
    })
    if (choice === 'update') {
      const { execa } = await import('execa')
      process.stdout.write(`\nUpdating to ${update.latest}...\n`)
      if (managers.length === 2) process.stdout.write(`Warning: ${pkg.name} is installed globally with npm and Bun; updating both in parallel.\n`)
      const results = await Promise.all(managers.map(async (pm) => ({
        result: await execa(pm, pm === 'bun' ? ['add', '-g', `${pkg.name}@${update.latest}`] : ['install', '-g', `${pkg.name}@${update.latest}`], { reject: false }),
      })))
      for (const { result } of results) {
        if (result.stdout) process.stdout.write(result.stdout + '\n')
        if (result.stderr) process.stderr.write(result.stderr + '\n')
      }
      if (results.some(({ result }) => result.exitCode !== 0)) {
        process.stderr.write('Update failed. Check the errors above.\n')
        process.exit(1)
      } else {
        process.stdout.write(`Updated! Launching DeepSeek Code ${update.latest}...\n`)
        try {
          const exitCode = await relaunchCurrentInvocation()
          process.exit(exitCode)
        } catch (error) {
          process.stderr.write(`Could not relaunch DeepSeek Code: ${(error as Error).message}\n`)
          process.exit(1)
        }
      }
    } else if (choice === 'dismiss') {
      const { dismissVersion } = await import('../utils/update-notifier.js')
      dismissVersion(update.latest)
    }
  }
}

function Root() {
  const [ready, setReady] = useState(false)
  const [checked, setChecked] = useState(false)
  const [theme, setTheme] = useState<ThemeName>('dark')
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null)
  const [initialAgent, setInitialAgent] = useState<LoadedAgent | null>(null)
  const [initialMessage, setInitialMessage] = useState<string | null>(null)
  const [initialSession, setInitialSession] = useState<SessionData | null>(null)
  const [resumeNotFound, setResumeNotFound] = useState(false)
  const [resumeChoices, setResumeChoices] = useState<SessionData[] | null>(null)
  const [savedLanguage, setSavedLanguage] = useState<string | null>(null)
  const [savedEnchant, setSavedEnchant] = useState<boolean>(false)
  const [initialSettings, setInitialSettings] = useState<DeepSeekSettings>({})
  const [alternateScreen, setAlternateScreen] = useState(false)
  const [workspaceTrusted, setWorkspaceTrusted] = useState(false)

  useEffect(() => {
    const init = async () => {
      try {
        const { agentName, initialMessage: msg, resumeId, resumePicker } = ARGV
        await migrateConfigIfNeeded()
        const [{ providerConfig: saved, theme: savedTheme, language, enchant }, settingsSnapshot] = await Promise.all([
          loadSavedConfig(),
          loadSettingsSnapshot(),
        ])
        const settings = settingsSnapshot.effective
        // Executable status-line commands are trusted only from the user
        // scope. Project/local values are omitted from effective settings by
        // the repository and never enable this flag.
        setWorkspaceTrusted(getTrustedUserStatusLineConfig(settingsSnapshot.levels.user.data) !== undefined)

        setTheme(savedTheme)
        setInitialSettings(settings)
        // Resolve once, here, rather than in render: the probe can shell out to
        // tmux and builds a fresh cache per call, so running it every render
        // would repeat that work. Publishing to module state is a side effect
        // and belongs in the effect too — and it lands before setChecked(true)
        // below, so the first frame that reads isFullscreenActive() sees it.
        const fullscreen = resolveFullscreen(settings)
        setFullscreenActive(fullscreen.enabled)
        setAlternateScreen(fullscreen.enabled)
        setSavedLanguage(language)
        setSavedEnchant(enchant)
        if (saved) {
          setProviderConfig(saved)
          setReady(true)
        } else if (process.env.DEEPSEEK_API_KEY) {
          setProviderConfig({ provider: 'deepseek', apiKey: process.env.DEEPSEEK_API_KEY })
          setReady(true)
        }

        if (resumeId) {
          const session = await loadSession(resumeId, process.cwd())
          if (session) {
            setInitialSession(session)
          } else {
            setResumeNotFound(true)
          }
        } else if (resumePicker) {
          const sessions = await listSessions(process.cwd())
          if (sessions.length > 0) setResumeChoices(sessions)
          else setResumeNotFound(true)
        } else if (settings.sessions?.autoResume === 'project-last') {
          const session = await getLastProjectSession(process.cwd())
          if (session) setInitialSession(session)
        }
        const effectiveAgentName = agentName ?? settings.agents?.default ?? null
        if (effectiveAgentName) {
          try {
            setInitialAgent(await loadAgentConfig(effectiveAgentName, process.cwd(), { includeUntrusted: true }))
          } catch (e) { console.error((e as Error).message) }
        }
        if (msg) setInitialMessage(msg)
      } catch (e) {
        console.error('App initialization failed:', (e as Error).message)
        setReady(false)
        setProviderConfig(null)
      } finally {
        setChecked(true)
      }
    }

    void init()
  }, [])

  if (!checked) return null

  if (resumeNotFound) {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <Text color="yellow">{'⚠ Session not found. Starting a new session.'}</Text>
      </Box>
    )
  }

  if (resumeChoices) {
    return <ResumePicker sessions={resumeChoices} theme={theme} onSelect={(session) => { setInitialSession(session); setResumeChoices(null) }} onCancel={() => setResumeChoices(null)} />
  }

  if (!ready) {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <ApiKeySetup onDone={(t, cfg) => { setTheme(t); setProviderConfig(cfg); setReady(true) }} />
      </Box>
    )
  }

  const application = (
    <App
      initialAgent={initialAgent}
      initialMessage={initialMessage}
      theme={theme}
      providerConfig={providerConfig}
      onThemeChange={setTheme}
      onLogout={() => { setReady(false); setProviderConfig(null) }}
      language={savedLanguage}
      enchant={savedEnchant}
      sessionId={SESSION_ID}
      initialSession={initialSession}
      headerProvider={providerConfig?.provider ?? 'deepseek'}
      headerAgent={initialAgent?.config.name ?? null}
      initialSettings={initialSettings}
      alternateScreen={alternateScreen}
      workspaceTrusted={workspaceTrusted}
      onExit={() => cleanExit(0)}
    />
  )
  return alternateScreen
    ? <AlternateScreen><Box flexDirection="column" width="100%" height="100%">{application}</Box></AlternateScreen>
    : application
}

const root = await createRoot({
  exitOnCtrlC: false,
  patchConsole: false,
})
root.render(<Root />)

let exiting = false

function cleanExit(code = 0): void {
  if (exiting) return
  exiting = true
  root.unmount()
  // Sync write is intentional: process.exit must not interrupt the banner.
  // Ink already restored the alternate screen during unmount; sending a
  // second ?1049l would restore the shell's old cursor position on top.
  writeSync(1, formatExitScreen(SESSION_ID, false))
  process.exit(code)
}

// Handle clean exit
process.on('SIGINT', () => cleanExit(0))
process.on('SIGTERM', () => cleanExit(0))
