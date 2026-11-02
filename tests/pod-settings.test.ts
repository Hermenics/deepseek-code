import { describe, expect, it } from 'bun:test'
import { validatePodSetting, validatePodSettingPath } from '../src/pods/pod-settings.js'

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
})
