import type { DeepSeekSettings } from './types.js'
import { getSettingsPath, loadSettingsSnapshot, mergeSettings } from './repository.js'

export { getSettingsPath, mergeSettings }

/** Raw User-level settings file contents for the current working directory's snapshot. */
export async function loadUserSettings(): Promise<DeepSeekSettings> {
  return (await loadSettingsSnapshot()).levels.user.data
}

/** Raw Project-level settings file contents (unsanitised) for the current working directory. */
export async function loadProjectSettings(): Promise<DeepSeekSettings> {
  return (await loadSettingsSnapshot()).levels.project.data
}

/** Raw Local-level settings file contents (unsanitised) for the current working directory. */
export async function loadLocalSettings(): Promise<DeepSeekSettings> {
  return (await loadSettingsSnapshot()).levels.local.data
}

/** Effective settings after defaults, all levels and the project-safety filters have been merged. */
export async function loadMergedSettings(cwd?: string): Promise<DeepSeekSettings> {
  return (await loadSettingsSnapshot(cwd)).effective
}
