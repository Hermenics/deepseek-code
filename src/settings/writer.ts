import type { DeepSeekSettings, SettingsLevel } from './types.js'
import { SettingsRepository } from './repository.js'

function flatten(object: Record<string, unknown>, prefix = ''): Array<[string, unknown]> {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return flatten(value as Record<string, unknown>, path)
    return [[path, value]]
  })
}

export async function saveSettings(level: SettingsLevel, partial: Partial<DeepSeekSettings>): Promise<void> {
  const repository = new SettingsRepository()
  await repository.setMany(level, flatten(partial as Record<string, unknown>))
}

export async function saveUserSettings(partial: Partial<DeepSeekSettings>): Promise<void> { return saveSettings('user', partial) }
export async function saveProjectSettings(partial: Partial<DeepSeekSettings>): Promise<void> { return saveSettings('project', partial) }
export async function saveLocalSettings(partial: Partial<DeepSeekSettings>): Promise<void> { return saveSettings('local', partial) }
