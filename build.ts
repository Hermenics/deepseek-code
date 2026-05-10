import { resolve } from 'path'
import { chmodSync, writeFileSync } from 'fs'

const result = await Bun.build({
  entrypoints: ['src/index.tsx'],
  outdir: 'dist',
  naming: 'cli.mjs',
  target: 'bun',
  minify: true,
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
exec -a deepseek bun "$DIR/cli.mjs" "$@"
`
writeFileSync('dist/deepseek', wrapper)
chmodSync('dist/deepseek', 0o755)

console.log('Build concluído com sucesso!')
