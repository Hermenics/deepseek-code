import { resolve } from 'path'
import { chmodSync, writeFileSync } from 'fs'
import { LAUNCHER_SOURCE } from './scripts/launcher.js'

const result = await Bun.build({
  entrypoints: ['src/index.tsx'],
  outdir: 'dist',
  naming: 'cli.mjs',
  target: 'bun',
  minify: true,
  // Without this Bun inlines NODE_ENV as "development": the shipped bundle ran
  // the dev-only block in cli.tsx (dev.log, swallowed exceptions) and React's
  // development build.
  define: { 'process.env.NODE_ENV': '"production"' },
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

writeFileSync('dist/deepseek.mjs', LAUNCHER_SOURCE)
chmodSync('dist/deepseek.mjs', 0o755)

console.log('Build concluído com sucesso!')
