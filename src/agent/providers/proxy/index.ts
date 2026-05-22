import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { execSync } from 'node:child_process'
import { loadConfig, setLogLevel, log } from './config.js'
import { initPlaywright, closePlaywright, BROWSER_PROFILE_PATH } from './browser/playwright.js'
import { PagePool } from './browser/pool.js'
import { authMiddleware } from './middleware/auth.js'
import { rateLimitMiddleware } from './middleware/rate-limit.js'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/error-handler.js'
import { requestLogger } from './middleware/request-logger.js'
import { createOpenAIRouter } from './routes/openai.js'
import { createAnthropicRouter } from './routes/anthropic.js'
import { existsSync } from 'node:fs'

const VERSION = '1.0.0'

export async function startProxyServer(): Promise<void> {
  const config = loadConfig()
  setLogLevel(config.logLevel)

  if (!existsSync(BROWSER_PROFILE_PATH)) {
    log('warn', 'No browser profile found. OAuth login may be required.')
  }

  try {
    await initPlaywright()
    log('info', 'Browser initialized (headless Chromium)')
  } catch (e: any) {
    log('error', `Failed to initialize browser: ${e.message}`)
    log('error', 'Ensure Playwright browsers are installed: npx playwright install chromium')
    process.exit(1)
  }

  const pool = new PagePool(config.poolSize)
  await pool.init()
  log('info', `Page pool ready (${config.poolSize} pages), warming up...`)
  pool.warmup().then(() => log('info', 'Pages pre-loaded ✓'))

  const app = new Hono()

  app.use('*', errorHandler())
  app.use('*', corsMiddleware(config.corsOrigins))
  app.use('*', requestLogger())
  app.use('/v1/*', authMiddleware(config.proxyApiKey))
  app.use('/v1/*', rateLimitMiddleware(config.rateLimit))

  app.get('/', (c) => c.json({ status: 'ok', message: 'DeepSproxy is running', version: VERSION }))
  app.get('/health', (c) => c.json({
    status: 'healthy',
    version: VERSION,
    deepseekVersion: process.env.DEEPSEEK_VERSION ?? '',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    pool: { size: config.poolSize },
    auth: config.proxyApiKey ? 'enabled' : 'disabled',
  }))

  app.route('/', createOpenAIRouter(pool, config))
  app.route('/', createAnthropicRouter(pool, config))

  app.notFound((c) => c.json({
    error: { message: `Not found: ${c.req.method} ${c.req.path}`, type: 'invalid_request_error' },
  }, 404))

  try {
    execSync(`lsof -ti:${config.port} | xargs -r kill -9`, { stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 500))
  } catch {}

  const { host, port } = config
  serve({ fetch: app.fetch, hostname: host, port })

  log('info', `Proxy server running at http://${host}:${port}`)

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log('info', `${signal} received, shutting down gracefully...`)
    try {
      await pool.destroy()
      await closePlaywright()
      log('info', 'Cleanup complete')
    } catch (e: any) {
      log('error', `Cleanup error: ${e.message}`)
    }
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('uncaughtException', (err) => {
    log('error', `Uncaught exception: ${err.message}`)
    shutdown('uncaughtException')
  })
  process.on('unhandledRejection', (reason: any) => {
    log('error', `Unhandled rejection: ${reason?.message || reason}`)
  })
}
