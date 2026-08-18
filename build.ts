import { resolve } from 'path'
import { chmodSync, writeFileSync } from 'fs'

const result = await Bun.build({
  entrypoints: ['src/index.tsx'],
  outdir: 'dist',
  naming: 'cli.mjs',
  target: 'bun',
  minify: true,
  external: [],
  alias: {
    'react-devtools-core': resolve('./src/stubs/react-devtools-core.ts'),
  },
} as Parameters<typeof Bun.build>[0])

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

chmodSync('dist/cli.mjs', 0o755)

// Cross-platform launcher. `bin` must point at a JS entry with a `bun`
// shebang: npm reads that shebang to generate working .cmd/.ps1 shims on
// Windows, which a `#!/bin/bash` wrapper could never produce.
const launcher = `#!/usr/bin/env bun
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

// Restore the terminal even when the app dies without running its own cleanup.
// (SIGKILL cannot be intercepted on any platform — bash traps could not either.)
const restore = () => {
  if (process.stdout.isTTY) process.stdout.write('\\u001b[?1000l\\u001b[?1002l\\u001b[?1003l\\u001b[?25h')
}
process.on('exit', restore)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  // Windows raises SIGINT/SIGTERM only in limited cases; registering is harmless.
  try { process.on(signal, restore) } catch {}
}

await import(join(dirname(fileURLToPath(import.meta.url)), 'cli.mjs'))
`

writeFileSync('dist/deepseek.mjs', launcher)
chmodSync('dist/deepseek.mjs', 0o755)

console.log('Build concluído com sucesso!')
