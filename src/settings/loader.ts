import { homedir } from 'os'
import { join } from 'path'
import { readFile } from 'fs/promises'
import type { DeepSeekSettings, SettingsLevel } from './types.js'

const SETTINGS_FILE = 'settings.json'

export function getSettingsPath(level: SettingsLevel): string {
  switch (level) {
    case 'user':
      return join(homedir(), '.deepseek', SETTINGS_FILE)
    case 'project':
      return join(process.cwd(), '.deepseek', SETTINGS_FILE)
    case 'local':
      return join(process.cwd(), '.deepseek', 'settings.local.json')
  }
}

async function loadSettingsFile(path: string): Promise<DeepSeekSettings> {
  try {
    const text = await readFile(path, 'utf-8')
    return JSON.parse(text) as DeepSeekSettings
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    // JSON parse error or other — warn and return defaults
    console.error(`[settings] Warning: Failed to parse ${path}: ${(err as Error).message}`)
    return {}
  }
}

export async function loadUserSettings(): Promise<DeepSeekSettings> {
  return loadSettingsFile(getSettingsPath('user'))
}

export async function loadProjectSettings(): Promise<DeepSeekSettings> {
  return loadSettingsFile(getSettingsPath('project'))
}

export async function loadLocalSettings(): Promise<DeepSeekSettings> {
  return loadSettingsFile(getSettingsPath('local'))
}

/**
 * Merge settings from multiple levels. Later entries override earlier ones.
 * Arrays: concat + dedup. Objects: deep merge. Scalars: higher priority wins.
 */
export function mergeSettings(...levels: DeepSeekSettings[]): DeepSeekSettings {
  const result: DeepSeekSettings = {}
  for (const level of levels) {
    for (const [key, value] of Object.entries(level)) {
      if (value === undefined) continue
      const existing = result[key]
      if (Array.isArray(value) && Array.isArray(existing)) {
        // Arrays: concat + dedup
        result[key] = [...new Set([...existing, ...value])]
      } else if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        existing !== null &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        // Objects: deep merge (one level — for permissions.allow/deny arrays)
        const merged: Record<string, unknown> = {
          ...(existing as Record<string, unknown>),
        }
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          const ex = merged[k]
          if (Array.isArray(v) && Array.isArray(ex)) {
            merged[k] = [...new Set([...ex, ...v])]
          } else {
            merged[k] = v
          }
        }
        result[key] = merged
      } else {
        // Scalars: higher priority wins
        result[key] = value
      }
    }
  }
  return result
}

/**
 * Load and merge all settings levels (user < project < local).
 */
export async function loadMergedSettings(): Promise<DeepSeekSettings> {
  const [user, project, local] = await Promise.all([
    loadUserSettings(),
    loadProjectSettings(),
    loadLocalSettings(),
  ])
  // Security: strip hooks from project-level and local-level settings to prevent
  // malicious repos from executing arbitrary commands via .deepseek/settings.json
  // or .deepseek/settings.local.json (both live in the project directory)
  const { hooks: _projectHooks, ...safeProject } = project
  const { hooks: _localHooks, ...safeLocal } = local
  return mergeSettings(user, safeProject, safeLocal)
}
