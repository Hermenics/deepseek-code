import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { execa } from 'execa'

export interface VerificationCommand {
  command: string
  args: string[]
  display: string
}

export interface VerificationResult {
  command: VerificationCommand
  ok: boolean
  output: string
}

/** Return one existing project test command; never invent a new test setup. */
export async function detectVerificationCommand(cwd = process.cwd()): Promise<VerificationCommand | null> {
  const packagePath = join(cwd, 'package.json')
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { scripts?: Record<string, unknown> }
      if (typeof pkg.scripts?.test === 'string') {
        if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return { command: 'bun', args: ['test'], display: 'bun test' }
        if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return { command: 'pnpm', args: ['test'], display: 'pnpm test' }
        if (existsSync(join(cwd, 'yarn.lock'))) return { command: 'yarn', args: ['test'], display: 'yarn test' }
        return { command: 'npm', args: ['test'], display: 'npm test' }
      }
    } catch {
      // An invalid package manifest is reported by the actual package manager.
    }
  }
  if (existsSync(join(cwd, 'Cargo.toml'))) return { command: 'cargo', args: ['test'], display: 'cargo test' }
  if (existsSync(join(cwd, 'go.mod'))) return { command: 'go', args: ['test', './...'], display: 'go test ./...' }
  return null
}

export async function runVerification(command: VerificationCommand, cwd = process.cwd()): Promise<VerificationResult> {
  const result = await execa(command.command, command.args, { cwd, reject: false, timeout: 120_000 })
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  return { command, ok: result.exitCode === 0, output: output || '(no output)' }
}
