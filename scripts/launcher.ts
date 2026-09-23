/**
 * Source of dist/deepseek.mjs, the cross-platform launcher. `bin` must point at a JS entry with a `bun`
 * shebang: npm reads that shebang to generate working .cmd/.ps1 shims on
 * Windows, which a `#!/bin/bash` wrapper could never produce.
 */
export const LAUNCHER_SOURCE = `#!/usr/bin/env bun
// DeepSeek Code launcher — runs on Linux, macOS and Windows.
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
