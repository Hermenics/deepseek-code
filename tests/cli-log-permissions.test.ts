import { describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function mode(filePath: string): number {
  return statSync(filePath).mode & 0o777
}

describe('development log permissions', () => {
  it('creates and repairs private directory and file modes', () => {
    if (process.platform === 'win32') return
    const home = mkdtempSync(join(tmpdir(), 'dsk-cli-log-'))
    const logDir = join(home, '.deepseek', 'logs')
    const logPath = join(logDir, 'dev.log')
    const run = () => Bun.spawnSync([process.execPath, 'src/entrypoints/cli.tsx', '--version'], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'development' },
      stdout: 'ignore',
      stderr: 'ignore',
    })

    try {
      mkdirSync(logDir, { recursive: true, mode: 0o755 })
      expect(run().exitCode).toBe(0)
      expect(mode(logDir)).toBe(0o700)
      expect(mode(logPath)).toBe(0o600)

      chmodSync(logDir, 0o755)
      writeFileSync(logPath, 'old log')
      chmodSync(logPath, 0o644)
      expect(run().exitCode).toBe(0)
      expect(mode(logDir)).toBe(0o700)
      expect(mode(logPath)).toBe(0o600)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 15000)

  it('does not follow a pre-existing dev.log symlink', () => {
    if (process.platform === 'win32') return
    const home = mkdtempSync(join(tmpdir(), 'dsk-cli-log-link-'))
    const logDir = join(home, '.deepseek', 'logs')
    const target = join(home, 'outside.log')
    const logPath = join(logDir, 'dev.log')
    try {
      mkdirSync(logDir, { recursive: true })
      writeFileSync(target, 'must survive')
      symlinkSync(target, logPath)
      const result = Bun.spawnSync([process.execPath, 'src/entrypoints/cli.tsx', '--version'], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'development' },
        stdout: 'ignore',
        stderr: 'ignore',
      })
      expect(result.exitCode).not.toBe(0)
      expect(readFileSync(target, 'utf8')).toBe('must survive')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('CLI trust-boundary wiring', () => {
  const source = readFileSync(join(process.cwd(), 'src/entrypoints/cli.tsx'), 'utf8')

  it('does not copy saved API credentials into the process environment', () => {
    expect(source).not.toContain('process.env.DEEPSEEK_API_KEY = saved.apiKey')
    expect(source).toContain('setProviderConfig(saved)')
  })

  it('loads the requested agent as an untrusted candidate for the TUI trust prompt', () => {
    expect(source).toMatch(/loadAgentConfig\(effectiveAgentName,\s*process\.cwd\(\),\s*\{\s*includeUntrusted:\s*true\s*\}\)/)
  })
})
