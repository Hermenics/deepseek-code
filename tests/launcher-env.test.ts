import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { BUN_RUNNER_SOURCE, LAUNCHER_SOURCE } from '../scripts/launcher.js'

test('runtime rejects unsupported Bun versions before loading the CLI', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-bun-version-'))
  try {
    const runner = join(root, 'runtime.mjs')
    writeFileSync(runner, BUN_RUNNER_SOURCE)
    writeFileSync(join(root, 'cli.mjs'), 'console.log("CLI loaded")')
    for (const [version, accepted] of [['1.3.13', false], ['1.4.0', true], ['2.0.0', true]] as const) {
      const result = await execa('node', ['--input-type=module', '-e', `globalThis.Bun = { version: ${JSON.stringify(version)} }; await import(${JSON.stringify(pathToFileURL(runner).href)})`], { reject: false })
      expect(result.exitCode).toBe(accepted ? 0 : 1)
      if (accepted) expect(result.stdout).toContain('CLI loaded')
      else expect(result.stderr).toContain('requires Bun 1.4+')
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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
