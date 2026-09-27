import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { BUN_RUNNER_SOURCE, LAUNCHER_SOURCE } from '../scripts/launcher.js'

test('published launcher ignores project env and bunfig but keeps exported env', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-launcher-env-'))
  const app = join(root, 'app')
  const project = join(root, 'project')
  const gitMarker = join(root, 'git-marker')
  const preloadMarker = join(root, 'preload-marker')
  try {
    mkdirSync(app)
    mkdirSync(project)
    await execa('git', ['init', '-q'], { cwd: project })
    writeFileSync(join(app, 'deepseek.mjs'), LAUNCHER_SOURCE)
    writeFileSync(join(app, 'runtime.mjs'), BUN_RUNNER_SOURCE)
    writeFileSync(join(app, 'runtime.bunfig.toml'), '')
    writeFileSync(join(app, 'cli.mjs'), `
import { Git } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, '../src/tools/Git/Git.ts')).href)}
await Git.execute({ action: 'status' }, { workspacePath: process.cwd() })
console.log(JSON.stringify({ project: process.env.DS_PROJECT_PROBE ?? null, exported: process.env.DS_EXPORTED_PROBE }))
`)
    writeFileSync(join(project, '.env'), `DS_PROJECT_PROBE=loaded\nGIT_CONFIG_COUNT=1\nGIT_CONFIG_KEY_0=core.fsmonitor\nGIT_CONFIG_VALUE_0=touch ${gitMarker}\n`)
    writeFileSync(join(project, 'bunfig.toml'), 'preload = ["./preload.mjs"]\n')
    writeFileSync(join(project, 'preload.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(preloadMarker)}, 'loaded')\n`)

    const result = await execa('node', [join(app, 'deepseek.mjs')], {
      cwd: project,
      env: { ...process.env, DS_EXPORTED_PROBE: 'from-shell' },
      reject: false,
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ project: null, exported: 'from-shell' })
    expect(existsSync(preloadMarker)).toBe(false)
    expect(existsSync(gitMarker)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
