import { describe, expect, it } from 'bun:test'
import { POD_SETTING_FIELDS, podSettingsView, validatePodSetting, validatePodSettingPath } from '../src/pods/pod-settings.js'
import type { SettingsSnapshot } from '../src/settings/types.js'

describe('Pod settings', () => {
  it('accepts only curated values within their supported ranges', () => {
    expect(() => validatePodSetting('budget', 'comfortable', 'project')).not.toThrow()
    expect(() => validatePodSetting('compaction.threshold', 0.85, 'user')).not.toThrow()
    expect(() => validatePodSetting('compaction.threshold', 0.99, 'user')).toThrow('between')
    expect(() => validatePodSetting('provider.timeoutMs', Infinity, 'user')).toThrow('between')
    expect(() => validatePodSetting('model.default', 'model-v2/fast', 'user')).not.toThrow()
    expect(() => validatePodSetting('model.default', 'contains spaces', 'user')).toThrow('model ID')
    expect(() => validatePodSetting('unrestricted.setting', true, 'user')).toThrow('not available')
  })

  it('keeps the default interaction mode user-scoped', () => {
    expect(() => validatePodSetting('interaction.defaultMode', 'plan', 'user')).not.toThrow()
    expect(() => validatePodSettingPath('interaction.defaultMode', 'project')).toThrow('User scope')
    expect(() => validatePodSettingPath('interaction.defaultMode', 'local')).toThrow('User scope')
  })

  it('validates model overrides, response language, and delegated turn budgets', () => {
    expect(() => validatePodSetting('promptRefiner.model', 'provider/refiner-v2', 'project')).not.toThrow()
    expect(() => validatePodSetting('agents.subagentModel', 'provider/worker-v2', 'user')).not.toThrow()
    expect(() => validatePodSetting('agents.subagentModel', 'invalid model', 'user')).toThrow('model ID')
    expect(() => validatePodSetting('interface.language', 'Brazilian Portuguese', 'project')).not.toThrow()
    expect(() => validatePodSetting('interface.language', '', 'project')).toThrow('language')
    expect(() => validatePodSetting('interface.language', 'English\nPortuguese', 'project')).toThrow('language')
    expect(() => validatePodSetting('agents.maxAggregateTokens', 1000, 'project')).not.toThrow()
    expect(() => validatePodSetting('agents.maxAggregateTokens', 1.5, 'project')).toThrow('integer')
    expect(() => validatePodSetting('agents.maxAggregateTokens', Number.MAX_SAFE_INTEGER + 1, 'project')).toThrow()
    expect(() => validatePodSetting('agents.maxAggregateCostUsd', 0.001, 'local')).not.toThrow()
    expect(() => validatePodSetting('agents.maxAggregateCostUsd', 0, 'local')).toThrow()
    expect(() => validatePodSetting('agents.maxAggregateCostUsd', Infinity, 'local')).toThrow()
  })

  it('exposes existing interface toggles and a bounded user-scoped LSP timeout', () => {
    expect(POD_SETTING_FIELDS.find(field => field.path === 'interface.vim')?.kind).toBe('boolean')
    expect(POD_SETTING_FIELDS.find(field => field.path === 'interface.alternateScreen')).toMatchObject({ kind: 'boolean', restart: true })
    expect(() => validatePodSetting('interface.vim', true, 'project')).not.toThrow()
    expect(() => validatePodSetting('interface.alternateScreen', false, 'local')).not.toThrow()
    expect(() => validatePodSetting('interface.vim', 'yes', 'user')).toThrow('true or false')

    expect(() => validatePodSetting('lsp.timeoutMs', 100, 'user')).not.toThrow()
    expect(() => validatePodSetting('lsp.timeoutMs', 60_000, 'user')).not.toThrow()
    expect(() => validatePodSetting('lsp.timeoutMs', 99, 'user')).toThrow('between 100 and 60000')
    expect(() => validatePodSetting('lsp.timeoutMs', 60_001, 'user')).toThrow('between 100 and 60000')
    expect(() => validatePodSetting('lsp.timeoutMs', Infinity, 'user')).toThrow('between 100 and 60000')
    expect(() => validatePodSettingPath('lsp.timeoutMs', 'project')).toThrow('User scope')
    expect(() => validatePodSettingPath('lsp.timeoutMs', 'local')).toThrow('User scope')
  })

  it('hides user-only fields outside User scope', () => {
    const snapshot = {
      effective: { interface: { vim: true, alternateScreen: false }, lsp: { timeoutMs: 10_000 } },
      levels: {
        user: { level: 'user', path: '', data: { lsp: { timeoutMs: 10_000 } } },
        project: { level: 'project', path: '', data: { interface: { vim: true, alternateScreen: false } } },
        local: { level: 'local', path: '', data: {} },
      },
      origins: { 'interface.vim': 'project', 'interface.alternateScreen': 'project', 'lsp.timeoutMs': 'user' },
      legacy: {},
      issues: [],
      unknownPaths: [],
      loadedAt: '2026-11-02T00:00:00.000Z',
    } satisfies SettingsSnapshot

    expect(podSettingsView(snapshot, 'project').find(field => field.path === 'interface.vim')).toMatchObject({ value: true, effective: true, origin: 'project' })
    expect(podSettingsView(snapshot, 'project').find(field => field.path === 'interface.alternateScreen')).toMatchObject({ value: false, effective: false, origin: 'project' })
    expect(podSettingsView(snapshot, 'user').find(field => field.path === 'lsp.timeoutMs')).toMatchObject({ value: 10_000, effective: 10_000, origin: 'user' })
    expect(podSettingsView(snapshot, 'project').some(field => field.path === 'lsp.timeoutMs')).toBe(false)
    expect(podSettingsView(snapshot, 'local').some(field => field.path === 'lsp.timeoutMs')).toBe(false)
  })
})
