import { resolve } from 'path'
import { chmodSync, writeFileSync } from 'fs'

const result = await Bun.build({
  entrypoints: ['src/index.tsx'],
  outdir: 'dist',
  naming: 'cli.mjs',
  target: 'bun',
  minify: true,
  external: ['playwright', 'playwright-core', '@hono/node-server'],
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

// Shell wrapper that exec's bun with process name "deepseek" (Linux + macOS)
const wrapper = `#!/bin/bash
SELF="$0"
while [ -L "$SELF" ]; do
  DIR="$(cd "$(dirname "$SELF")" && pwd -P)"
  SELF="$(readlink "$SELF")"
  [[ "$SELF" != /* ]] && SELF="$DIR/$SELF"
done
DIR="$(cd "$(dirname "$SELF")" && pwd -P)"
# Restore terminal on exit (handles SIGKILL where Node cleanup can't run)
_restore_terminal() { printf '\\033[?1000l\\033[?1002l\\033[?1003l\\033[?25h' > /dev/tty 2>/dev/null; }
trap _restore_terminal EXIT
bun "$DIR/cli.mjs" "$@"
`
writeFileSync('dist/deepseek', wrapper)
chmodSync('dist/deepseek', 0o755)

console.log('Build concluído com sucesso!')
