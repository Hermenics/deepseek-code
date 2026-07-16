import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import type { PluginEntry, PluginRegistry } from './types.js'

export function getPluginsDir(): string {
  return process.env.DEEPSEEK_PLUGINS_DIR || join(homedir(), '.deepseek-code', 'plugins')
}

export function readPluginRegistry(dir?: string): PluginRegistry {
  const registryPath = join(dir ?? getPluginsDir(), 'registry.json')
  try {
    const content = readFileSync(registryPath, 'utf-8')
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        parsed.version === 1 && parsed.plugins && typeof parsed.plugins === 'object' && !Array.isArray(parsed.plugins)) {
      return parsed
    }
    throw new Error('Plugin registry has unexpected format')
  } catch (err: any) {
    if (err.code === 'ENOENT') return { version: 1, plugins: {} }
    throw err
  }
}

export function writePluginRegistry(registry: PluginRegistry, dir?: string): void {
  const d = dir ?? getPluginsDir()
  mkdirSync(d, { recursive: true })
  const tmp = join(d, `.registry-${randomBytes(6).toString('hex')}.json`)
  writeFileSync(tmp, JSON.stringify(registry, null, 2))
  renameSync(tmp, join(d, 'registry.json'))
}

export function addPluginToRegistry(entry: PluginEntry, dir?: string): void {
  const registry = readPluginRegistry(dir)
  registry.plugins[entry.name] = entry
  writePluginRegistry(registry, dir)
}

export function removePluginFromRegistry(name: string, dir?: string): void {
  const registry = readPluginRegistry(dir)
  if (!(name in registry.plugins)) return
  delete registry.plugins[name]
  writePluginRegistry(registry, dir)
}

export function getPluginEntry(name: string, dir?: string): PluginEntry | undefined {
  const registry = readPluginRegistry(dir)
  return registry.plugins[name]
}
