import type { DeepSeekSettings } from './types.js'
import { getSettingsPath, loadSettingsSnapshot, mergeSettings } from './repository.js'

export { getSettingsPath, mergeSettings }

export async function loadUserSettings(): Promise<DeepSeekSettings> {
  return (await loadSettingsSnapshot()).levels.user.data
}

export async function loadProjectSettings(): Promise<DeepSeekSettings> {
  return (await loadSettingsSnapshot()).levels.project.data
}

export async function loadLocalSettings(): Promise<DeepSeekSettings> {
  return (await loadSettingsSnapshot()).levels.local.data
}

export async function loadMergedSettings(cwd?: string): Promise<DeepSeekSettings> {
  return (await loadSettingsSnapshot(cwd)).effective
}
