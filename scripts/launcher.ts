/** Node starts without reading the project's .env or bunfig.toml. npm uses this shebang for Windows shims. */
export const LAUNCHER_SOURCE = `#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants } from 'node:os'

const dir = dirname(fileURLToPath(import.meta.url))
const config = join(dir, 'runtime.bunfig.toml')
const child = spawn('bun', ['--env-file=' + config, '--config=' + config, join(dir, 'runtime.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? [] : ['SIGHUP'])]) {
  process.on(signal, () => { if (!child.killed) child.kill(signal) })
}
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1) })
`

/** Bun starts only after the safe flags above have taken effect. */
export const BUN_RUNNER_SOURCE = `#!/usr/bin/env bun
// DeepSeek Code runtime — runs on Linux, macOS and Windows.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIN_BUN = [1, 1]
const version = typeof Bun !== 'undefined' ? Bun.version : undefined
if (!version) {
  console.error('DeepSeek Code requires Bun 1.1+ at runtime. Install Bun: https://bun.sh')
  process.exit(1)
}
const [major = 0, minor = 0] = version.split('.').map(Number)
if (major < MIN_BUN[0] || (major === MIN_BUN[0] && minor < MIN_BUN[1])) {
  console.error(\`DeepSeek Code requires Bun 1.1+ (found \${version}).\`)
  process.exit(1)
}

// Restore the terminal on every exit path, even when the app dies without
// running its own cleanup. (SIGKILL cannot be intercepted on any platform.)
// No signal listeners here: registering one cancels the signal's default exit,
// so a SIGHUP/SIGTERM would only restore and leave the process running forever.
// The app itself turns SIGINT/SIGTERM/SIGHUP into a clean exit.
const restore = () => {
  // The terminal may already be gone (EIO); exiting must not fail on it.
  try {
    if (process.stdout.isTTY) process.stdout.write('\\u001b[?1000l\\u001b[?1002l\\u001b[?1003l\\u001b[?25h')
  } catch {}
}
process.on('exit', restore)

await import(join(dirname(fileURLToPath(import.meta.url)), 'cli.mjs'))
`
