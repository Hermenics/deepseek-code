import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { delimiter, join } from 'path'
import { tmpdir } from 'os'
import {
  addPluginToRegistry,
  readPluginRegistry,
  removePluginFromRegistry,
} from '../../src/plugins/registry.js'

let testDir: string
let originalPath: string | undefined
let originalWindowsPath: string | undefined
const fakeGitTest = process.platform === 'win32' ? it.skip : it

function useCommand(name: string, script: string): void {
  const binDir = join(testDir, 'bin')
  mkdirSync(binDir, { recursive: true })
  const scriptPath = join(binDir, `${name}.sh`)
  writeFileSync(scriptPath, `#!/bin/sh\n${script}`, { mode: 0o755 })
  const commandPath = join(binDir, process.platform === 'win32' ? `${name}.cmd` : name)
  writeFileSync(commandPath, process.platform === 'win32'
    ? `@echo off\r\nbash "%~dp0${name}.sh" %*\r\n`
    : `#!/bin/sh\nexec "${scriptPath}" "$@"\n`, { mode: 0o755 })
  const pathValue = [binDir, originalPath ?? originalWindowsPath ?? ''].join(delimiter)
  process.env.PATH = pathValue
  if (process.platform === 'win32') process.env.Path = pathValue
}

function useSuccessfulGit(version = '2.0.0'): void {
  useCommand('git', `
if [ "$1" = "clone" ]; then
  mkdir -p "$5/.git"
  printf '%s' '{"name":"fixture-plugin","version":"${version}"}' > "$5/plugin.json"
  exit 0
fi
if [ "$1" = "rev-parse" ]; then
  printf '%s\\n' fixture-commit
  exit 0
fi
exit 1
`)
}

function addInstalledPlugin(version = '1.0.0'): void {
  const pluginDir = join(testDir, 'fixture-plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({ name: 'fixture-plugin', version }),
  )
  addPluginToRegistry({
    name: 'fixture-plugin', repo: 'fixture/plugin', version,
    installedAt: 'original-install', updatedAt: 'original-update',
    commitHash: 'original-commit', description: '',
    components: { commands: [], agents: [], skills: [], hasHooks: false },
  }, testDir)
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'dsk-plugin-install-'))
  originalPath = process.env.PATH
  originalWindowsPath = process.env.Path
  process.env.DEEPSEEK_PLUGINS_DIR = testDir
})

afterEach(() => {
  delete process.env.DEEPSEEK_PLUGINS_DIR
  process.env.PATH = originalPath
  if (process.platform === 'win32') process.env.Path = originalWindowsPath
  rmSync(testDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('removePlugin', () => {
  it('should reject invalid name', async () => {
    const { removePlugin } = await import('../../src/plugins/installer.js')
    const result = await removePlugin('../escape')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  it('should reject uppercase name', async () => {
    const { removePlugin } = await import('../../src/plugins/installer.js')
    const result = await removePlugin('BAD')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  it('should return error for non-existent plugin', async () => {
    const { removePlugin } = await import('../../src/plugins/installer.js')
    const result = await removePlugin('ghost-plugin')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('should remove a registered plugin', async () => {
    const { removePlugin } = await import('../../src/plugins/installer.js')
    // Setup: create plugin dir and registry entry using testDir directly
    const pluginDir = join(testDir, 'my-plugin')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'my-plugin' }))
    addPluginToRegistry({
      name: 'my-plugin', repo: 'x/my-plugin', version: '1.0.0',
      installedAt: '', updatedAt: '', commitHash: '', description: '',
      components: { commands: [], agents: [], skills: [], hasHooks: false },
    }, testDir)
    const result = await removePlugin('my-plugin')
    expect(result.ok).toBe(true)
    expect(readPluginRegistry(testDir).plugins['my-plugin']).toBeUndefined()
  })
})

describe('updatePlugin', () => {
  it('should return error for non-installed plugin', async () => {
    const { updatePlugin } = await import('../../src/plugins/installer.js')
    const result = await updatePlugin('not-here')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not installed/i)
  })

  it('should reject invalid name', async () => {
    const { updatePlugin } = await import('../../src/plugins/installer.js')
    const result = await updatePlugin('../sneaky')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  fakeGitTest('updates a plugin cloned through local fake git', async () => {
    useSuccessfulGit('2.0.0')
    addInstalledPlugin()
    const { updatePlugin } = await import('../../src/plugins/installer.js')

    const result = await updatePlugin('fixture-plugin')

    expect(result).toEqual({ ok: true, name: 'fixture-plugin' })
    expect(readPluginRegistry(testDir).plugins['fixture-plugin']).toMatchObject({
      version: '2.0.0', commitHash: 'fixture-commit',
    })
    expect(JSON.parse(readFileSync(join(testDir, 'fixture-plugin', 'plugin.json'), 'utf8'))).toMatchObject({
      version: '2.0.0',
    })
  })

  fakeGitTest('restores the original plugin when moving the update fails', async () => {
    useSuccessfulGit('2.0.0')
    useCommand('mv', `
count_file="${testDir}/mv-count"
count=$(cat "$count_file" 2>/dev/null || printf 0)
count=$((count + 1))
printf '%s' "$count" > "$count_file"
if [ "$count" -eq 2 ]; then exit 1; fi
exec /bin/mv "$@"
`)
    addInstalledPlugin()
    const { updatePlugin } = await import('../../src/plugins/installer.js')

    const result = await updatePlugin('fixture-plugin')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/original restored/i)
    expect(readPluginRegistry(testDir).plugins['fixture-plugin']?.version).toBe('1.0.0')
    expect(JSON.parse(readFileSync(join(testDir, 'fixture-plugin', 'plugin.json'), 'utf8'))).toMatchObject({
      version: '1.0.0',
    })
  })
})

describe('installPlugin', () => {
  it('should reject invalid repo format', async () => {
    const { installPlugin } = await import('../../src/plugins/installer.js')
    const result = await installPlugin('no-slash')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid repo/i)
  })

  it('should reject repo with special chars', async () => {
    const { installPlugin } = await import('../../src/plugins/installer.js')
    const result = await installPlugin('owner/repo; rm -rf /')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid repo/i)
  })

  fakeGitTest('installs through local fake git and records the resolved commit', async () => {
    useSuccessfulGit('2.0.0')
    const { installPlugin } = await import('../../src/plugins/installer.js')

    const result = await installPlugin('fixture/plugin')

    expect(result).toEqual({ ok: true, name: 'fixture-plugin' })
    expect(readPluginRegistry(testDir).plugins['fixture-plugin']).toMatchObject({
      version: '2.0.0', commitHash: 'fixture-commit',
    })
  })

  fakeGitTest('reports a clone timeout and leaves no registry entry', async () => {
    useCommand('git', `
    if [ "$1" = "clone" ]; then exec /bin/sleep 60; fi
exit 1
`)
    const realSetTimeout = globalThis.setTimeout
    const fastSetTimeout = ((handler: (...args: any[]) => void, timeout?: number, ...args: any[]) =>
      realSetTimeout(handler, timeout === 60_000 ? 1 : timeout, ...args)
    ) as unknown as typeof setTimeout
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(fastSetTimeout)
    try {
      const { installPlugin } = await import('../../src/plugins/installer.js')

      const result = await installPlugin('fixture/plugin')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/timed out/i)
      expect(readPluginRegistry(testDir).plugins['fixture-plugin']).toBeUndefined()
    } finally {
      timeoutSpy.mockRestore()
    }
  })
})

describe('path safety', () => {
  it('should reject path traversal names in remove', async () => {
    const { removePlugin } = await import('../../src/plugins/installer.js')
    const result = await removePlugin('../escape')
    expect(result.ok).toBe(false)
  })

  it('should reject path traversal names in update', async () => {
    const { updatePlugin } = await import('../../src/plugins/installer.js')
    const result = await updatePlugin('../escape')
    expect(result.ok).toBe(false)
  })
})
