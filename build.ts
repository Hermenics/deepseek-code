import { resolve } from 'path'
import { chmodSync } from 'fs'

const result = await Bun.build({
  entrypoints: ['src/index.tsx'],
  outdir: 'dist',
  naming: 'cli.mjs',
  target: 'node',
  minify: true,
  alias: {
    'react-devtools-core': resolve('./src/stubs/react-devtools-core.ts'),
  },
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

chmodSync('dist/cli.mjs', 0o755)
console.log('Build concluído com sucesso!')
