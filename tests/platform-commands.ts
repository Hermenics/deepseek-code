import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const commandCache = new Map<string, string>()

/** Build a shell command that runs the current Bun executable on every OS. */
export function runScript(script: string): string {
  const cached = commandCache.get(script)
  if (cached) return cached
  const scriptPath = join(tmpdir(), `deepseek-test-command-${randomUUID()}.js`)
  writeFileSync(scriptPath, script)
  const quote = (value: string): string => value.includes(' ') ? `"${value}"` : value
  const command = `${quote(process.execPath)} ${quote(scriptPath)}`
  commandCache.set(script, command)
  return command
}

export function printOutput(output: string): string {
  return runScript(`process.stdout.write(Buffer.from('${Buffer.from(output).toString('base64')}', 'base64'))`)
}

export function printLines(expression: string): string {
  return runScript(`process.stdout.write(${expression})`)
}
