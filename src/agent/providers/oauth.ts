import { join, dirname } from 'path'
import { homedir } from 'os'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, openSync } from 'fs'

export const OAUTH_STORAGE_PATH = join(homedir(), '.deepseek', 'oauth-storage.json')
export const DEEPSPROXY_DIR = join(homedir(), 'deepsproxy')

export function installPlaywright(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['playwright', 'install', 'chromium'], {
      stdio: 'ignore',
      shell: true,
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Playwright install failed (exit ${code})`))))
    child.on('error', reject)
  })
}

export function runOAuthLogin(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', join(DEEPSPROXY_DIR, 'src', 'scripts', 'login.ts')], {
      stdio: 'pipe',
      shell: true,
      env: {
        ...process.env,
        STORAGE_STATE_PATH: OAUTH_STORAGE_PATH,
      },
    })
    child.on('close', (code) => {
      if (code === 0 && existsSync(OAUTH_STORAGE_PATH)) resolve()
      else reject(new Error('Login failed or was cancelled'))
    })
    child.on('error', reject)
  })
}

export function startProxy(): ChildProcess {
  const logDir = join(homedir(), '.deepseek', 'logs')
  const logFile = join(logDir, 'proxy.log')
  mkdirSync(logDir, { recursive: true })
  const logFd = openSync(logFile, 'a')

  const child = spawn('npx', ['tsx', join(DEEPSPROXY_DIR, 'src', 'index.ts')], {
    stdio: ['ignore', logFd, logFd],
    shell: true,
    detached: true,
    env: {
      ...process.env,
      STORAGE_STATE_PATH: OAUTH_STORAGE_PATH,
      PROXY_API_KEY: '',
      PORT: '3000',
      HOST: '127.0.0.1',
      LOG_LEVEL: isDev ? 'debug' : 'info',
      DEEPSEEK_VERSION: pkg.version,
    },
  })

  child.unref()
  return child
}

export async function waitForProxy(timeout = 150000): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:3000/health')
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

export function isOAuthReady(): boolean {
  return existsSync(OAUTH_STORAGE_PATH)
}
