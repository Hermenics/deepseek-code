import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { DeepSeekSettings, SettingsLevel } from './types.js'
import { getSettingsPath, mergeSettings } from './loader.js'

async function readExisting(path: string): Promise<DeepSeekSettings> {
  try {
    const text = await readFile(path, 'utf-8')
    return JSON.parse(text) as DeepSeekSettings
  } catch {
    return {}
  }
}

async function writeSettings(
  path: string,
  data: DeepSeekSettings,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
}

export async function saveSettings(
  level: SettingsLevel,
  partial: Partial<DeepSeekSettings>,
): Promise<void> {
  const path = getSettingsPath(level)
  const existing = await readExisting(path)
  const merged = mergeSettings(existing, partial as DeepSeekSettings)
  await writeSettings(path, merged)
}

export async function saveUserSettings(
  partial: Partial<DeepSeekSettings>,
): Promise<void> {
  return saveSettings('user', partial)
}

export async function saveProjectSettings(
  partial: Partial<DeepSeekSettings>,
): Promise<void> {
  return saveSettings('project', partial)
}

export async function saveLocalSettings(
  partial: Partial<DeepSeekSettings>,
): Promise<void> {
  return saveSettings('local', partial)
}
