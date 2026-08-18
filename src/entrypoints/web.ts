// Web mode: serve a localhost GUI with a WebSocket bridge to the Agent.
// Usage: deepseek --web [--port <n>]
import { randomUUID } from 'crypto'
import { Agent } from '../agent/agent.js'
import { loadSavedConfig } from '../ui/setup/ApiKeySetup.js'
import { migrateConfigIfNeeded } from '../utils/credentials.js'
import { startWebServer } from '../web/server.js'

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = Bun.spawn([command, ...args], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', detached: true })
    child.unref()
  } catch {
    // The URL remains printed for headless environments without a launcher.
  }
}

function parsePort(argv = process.argv.slice(2)): number | undefined {
  const idx = argv.indexOf('--port')
  if (idx === -1) return undefined
  const raw = argv[idx + 1]
  if (!raw) return undefined
  const port = Number(raw)
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined
}

export default async function runWeb(): Promise<void> {
  await migrateConfigIfNeeded()
  const { providerConfig, language, enchant } = await loadSavedConfig()

  if (!providerConfig) {
    console.error('No provider configured. Run `deepseek` once to configure a provider.')
    process.exitCode = 1
    return
  }

  const sessionId = randomUUID()
  const agent = new Agent(providerConfig, { sessionId, projectRoot: process.cwd() })
  await agent.readyPromise.catch(() => {})

  if (language) agent.setLanguage(language)
  if (!enchant) agent.setPromptRefinerEnabled(false)

  const handle = startWebServer({
    agent,
    sessionId,
    model: agent.model,
    cwd: agent.getWorkingDirectory(),
    port: parsePort(),
  })

  console.log('')
  console.log('  DeepSeek Code — web UI')
  console.log(`  ${handle.url}`)
  console.log('')
  console.log('  Press Ctrl+C to stop.')
  console.log('')

  openBrowser(handle.url)

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    handle.stop()
    // Best-effort graceful shutdown. A stuck subsystem (e.g. an orchestrator
    // worker or a SessionEnd hook) must never make Ctrl+C hang.
    void Promise.race([
      agent.shutdown().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]).then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // Keep the process alive until a shutdown signal arrives.
  await new Promise<never>(() => {})
}
