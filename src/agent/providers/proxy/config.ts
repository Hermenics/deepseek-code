import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ProxyConfig } from './types/index.js'

const CONFIG_DIR = join(homedir(), '.deepsproxy')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

const DEFAULTS: ProxyConfig = {
  proxyApiKey: '',
  rateLimit: 20,
  cacheTtl: 300,
  poolSize: 2,
  responseTimeout: 60000,
  port: 29483,
  host: '127.0.0.1',
  logLevel: 'info',
  corsOrigins: '*',
}

export function loadConfig(): ProxyConfig {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })

  let fileConfig: Partial<ProxyConfig> = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    } catch {
      log('warn', `Invalid config at ${CONFIG_PATH}, using defaults`)
    }
  }

  const env = process.env
  const merged: ProxyConfig = {
    ...DEFAULTS,
    ...fileConfig,
    ...(env.PROXY_API_KEY && { proxyApiKey: env.PROXY_API_KEY }),
    ...(env.RATE_LIMIT && { rateLimit: Number(env.RATE_LIMIT) }),
    ...(env.CACHE_TTL && { cacheTtl: Number(env.CACHE_TTL) }),
    ...(env.POOL_SIZE && { poolSize: Number(env.POOL_SIZE) }),
    ...(env.RESPONSE_TIMEOUT && { responseTimeout: Number(env.RESPONSE_TIMEOUT) }),
    ...(env.PORT && { port: Number(env.PORT) }),
    ...(env.HOST && { host: env.HOST }),
    ...(env.LOG_LEVEL && { logLevel: env.LOG_LEVEL as ProxyConfig['logLevel'] }),
  }

  return merged
}

export function saveConfig(config: ProxyConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
let currentLevel: LogLevel = 'info'

export function setLogLevel(level: LogLevel) { currentLevel = level }

export function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[currentLevel]) return
  const ts = new Date().toISOString().slice(11, 19)
  const prefix = { debug: '🔍', info: '📋', warn: '⚠️', error: '❌' }[level]
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : ''
  console.log(`  ${ts} ${prefix} ${msg}${metaStr}`)
}

export { CONFIG_DIR, CONFIG_PATH }
