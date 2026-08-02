import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import * as os from 'os'
import {
  SettingsRepository,
  DEFAULT_SETTINGS,
  createSettingsExport,
  loadSettingsSnapshot,
  mergeSettings,
  resolveSetting,
  validateSettings,
} from '../src/settings/repository.js'
import { getNextSettingOption, getSettingsLayout, getSettingsNavigationHeight, getSettingsWindow, SETTINGS_CATEGORIES } from '../src/ui/setup/ConfigMenu.js'

const temporary: string[] = []
async function project(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'deepseek-settings-'))
  temporary.push(path)
  return path
}
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('SettingsRepository', () => {
  it('defaults to native terminal scrollback', () => {
    expect(DEFAULT_SETTINGS.interface?.alternateScreen).toBe(false)
  })

  it('merges nested values and inherits permission arrays', () => {
    const merged = mergeSettings(
      { compaction: { enabled: true, threshold: 0.9 }, permissions: { allow: ['ReadFile'] } },
      { compaction: { threshold: 0.8 }, permissions: { allow: ['Shell(git *)'] } },
    )
    expect(merged.compaction).toEqual({ enabled: true, threshold: 0.8 })
    expect(merged.permissions?.allow).toEqual(['ReadFile', 'Shell(git *)'])
  })

  it('writes one field atomically and preserves unknown keys', async () => {
    const cwd = await project()
    const dir = join(cwd, '.deepseek')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ pluginFuture: { enabled: true }, compaction: { enabled: true } }))
    const repository = new SettingsRepository(cwd)
    await repository.set('project', 'compaction.threshold', 0.85)
    const raw = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    expect(raw.pluginFuture).toEqual({ enabled: true })
    expect(raw.compaction).toEqual({ enabled: true, threshold: 0.85 })
    expect((await import('fs/promises')).readdir(dir).then(files => files.some(file => file.endsWith('.tmp')))).resolves.toBe(false)
  })

  it('validates and commits batch updates as one write', async () => {
    const cwd = await project()
    const repository = new SettingsRepository(cwd)
    await expect(repository.setMany('project', [['interface.vim', true], ['agents.concurrency', 99]])).rejects.toThrow('agents.concurrency')
    expect((await repository.reload()).levels.project.data.interface?.vim).toBeUndefined()

    const snapshot = await repository.setMany('project', [['interface.vim', true], ['agents.concurrency', 16]])
    expect(snapshot.levels.project.data.interface?.vim).toBe(true)
    expect(snapshot.levels.project.data.agents?.concurrency).toBe(16)
  })

  it('rejects secret-shaped keys nested inside a setting value', async () => {
    const repository = new SettingsRepository(await project())
    await expect(repository.set('project', 'future', { nested: { apiKey: 'secret' } })).rejects.toThrow('Secrets must be stored')
  })

  it('blocks writes when the target JSON is invalid', async () => {
    const cwd = await project()
    const dir = join(cwd, '.deepseek')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.local.json'), '{ invalid')
    const repository = new SettingsRepository(cwd)
    await expect(repository.set('local', 'interface.vim', true)).rejects.toThrow('Cannot update invalid JSON')
  })

  it('suppresses inherited allow rules but never inherited deny rules', async () => {
    const cwd = await project()
    const dir = join(cwd, '.deepseek')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ permissions: { allow: ['ReadFile'], deny: ['Shell(rm *)'] } }))
    await writeFile(join(dir, 'settings.local.json'), JSON.stringify({ permissions: { suppress: ['ReadFile'] } }))
    const snapshot = await loadSettingsSnapshot(cwd)
    expect(snapshot.effective.permissions?.allow).not.toContain('ReadFile')
    expect(snapshot.effective.permissions?.deny).toContain('Shell(rm *)')
  })

  it('reports origins and validation constraints', async () => {
    const cwd = await project()
    const repository = new SettingsRepository(cwd)
    const snapshot = await repository.set('project', 'agents.concurrency', 7)
    expect(resolveSetting(snapshot, 'agents.concurrency').origin).toBe('project')
    expect(validateSettings({ compaction: { threshold: 0.5 } })[0]?.path).toBe('compaction.threshold')
    expect(validateSettings({ interaction: { defaultMode: 'auto' } }, 'project')[0]?.message).toContain('User scope')
  })

  it('reports legacy values as explicit overrides over defaults', async () => {
    const snapshot = await loadSettingsSnapshot(await project())
    for (const level of ['user', 'project', 'local'] as const) {
      if (snapshot.levels[level].data.interface) delete snapshot.levels[level].data.interface.theme
    }
    snapshot.legacy.interface = { theme: 'light' }
    snapshot.effective.interface = { ...snapshot.effective.interface, theme: 'light' }
    const resolution = resolveSetting(snapshot, 'interface.theme')
    expect(resolution.origin).toBe('legacy')
    expect(resolution.overrides[0]).toEqual({ level: 'legacy', value: 'light' })
  })

  it('returns validation issues for malformed permission and hook containers', () => {
    const issues = validateSettings({
      permissions: { allow: 'ReadFile' } as never,
      hooks: {
        PreToolUse: [null, { matcher: '*', hooks: 'bad' }],
        SessionStart: [null, { command: 42 }],
      } as never,
    })
    expect(issues.map(issue => issue.path)).toContain('permissions.allow')
    expect(issues.map(issue => issue.path)).toContain('hooks.PreToolUse.0')
    expect(issues.map(issue => issue.path)).toContain('hooks.PreToolUse.1.hooks')
    expect(issues.map(issue => issue.path)).toContain('hooks.SessionStart.1.command')
  })

  it('never activates Auto mode or executable configuration from project files', async () => {
    const cwd = await project()
    const fakeHome = await project()
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(fakeHome)
    const dir = join(cwd, '.deepseek')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.json'), JSON.stringify({
      interaction: { defaultMode: 'auto' },
      hooks: { SessionStart: [{ command: 'echo unsafe' }] },
      lsp: { servers: [{ name: 'unsafe', command: 'echo', extensions: ['.ts'] }] },
      mcp: { enabled: true },
    }))
    let snapshot
    try {
      snapshot = await loadSettingsSnapshot(cwd)
    } finally {
      homedirSpy.mockRestore()
    }
    expect(snapshot.effective.interaction?.defaultMode).toBe('build')
    expect(snapshot.effective.hooks?.SessionStart).toBeUndefined()
    expect(snapshot.effective.lsp?.servers).toEqual([])
    expect(snapshot.effective.mcp?.enabled).toBe(false)
    expect(snapshot.issues.some(issue => issue.path === 'interaction.defaultMode')).toBe(true)
    expect(snapshot.issues.some(issue => issue.path === 'lsp')).toBe(true)
    expect(snapshot.issues.some(issue => issue.path === 'mcp')).toBe(true)
  })

  it('removes secret-shaped keys from exports', async () => {
    const cwd = await project()
    const snapshot = await loadSettingsSnapshot(cwd)
    snapshot.effective.future = { apiKey: 'secret', safe: 'yes' }
    const exported = createSettingsExport(snapshot, {
      memory: { safe: 'remember this', accessToken: 'never export this' },
      sessions: [{ id: 'one', password: 'never export this either' }],
    })
    expect(exported.settings.future).toEqual({ safe: 'yes' })
    expect(exported.memory).toEqual({ safe: 'remember this' })
    expect(exported.sessions).toEqual([{ id: 'one' }])
  })
})

describe('settings center topology', () => {
  it('uses the confirmed layouts at 50, 80 and 140 columns', () => {
    expect(getSettingsLayout(50)).toBe('narrow')
    expect(getSettingsLayout(80)).toBe('medium')
    expect(getSettingsLayout(140)).toBe('wide')
  })

  it('exposes all ten requested categories with searchable rows', () => {
    expect(SETTINGS_CATEGORIES).toHaveLength(10)
    expect(SETTINGS_CATEGORIES.every(category => category.items.length > 0)).toBe(true)
  })

  it('keeps the medium selector stable until the selection reaches the viewport edge', () => {
    const items = ['provider', 'model', 'endpoint', 'timeout', 'profile', 'location']

    expect(getSettingsWindow(items, 0, 4)).toMatchObject({ start: 0, before: false, after: true })
    expect(getSettingsWindow(items, 3, 4)).toMatchObject({ start: 0, values: items.slice(0, 4) })
    expect(getSettingsWindow(items, 4, 4)).toMatchObject({ start: 1, values: items.slice(1, 5) })
  })

  it('shrinks the navigation pane and reserves both category scroll indicators', () => {
    expect(getSettingsNavigationHeight(24)).toBe(9)
    expect(getSettingsNavigationHeight(18)).toBe(6)
    expect(getSettingsWindow(SETTINGS_CATEGORIES, 4, getSettingsNavigationHeight(18) - 2).values).toHaveLength(4)
  })

  it('cycles the refiner model through provider models and back to inherit', () => {
    const models = ['', 'deepseek-chat', 'deepseek-reasoner']

    expect(getNextSettingOption(undefined, models)).toBe('deepseek-chat')
    expect(getNextSettingOption('deepseek-chat', models)).toBe('deepseek-reasoner')
    expect(getNextSettingOption('deepseek-reasoner', models)).toBe('')
  })

  it('changes every API model setting with Enter instead of text input', () => {
    const items = SETTINGS_CATEGORIES.flatMap(category => category.items)
    for (const path of ['model.default', 'promptRefiner.model', 'agents.subagentModel']) {
      expect(items.find(item => item.path === path)?.kind).toBe('enum')
    }
  })

  it('exposes the user-scoped MCP opt-in', () => {
    const item = SETTINGS_CATEGORIES.flatMap(category => category.items).find(item => item.path === 'mcp.enabled')
    expect(item).toMatchObject({ kind: 'boolean', restart: true })
  })
})
