import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { PluginEntry, PluginRegistry } from './types.js'

// ponytail: function so env override works at call-time (test isolation)
export function getPluginsDir(): string {
  return process.env.DEEPSEEK_PLUGINS_DIR || join(homedir(), '.deepseek-code', 'plugins')
}

function registryPath(): string {
  return join(getPluginsDir(), 'registry.json')
}

export function readPluginRegistry(): PluginRegistry {
  try {
    const content = readFileSync(registryPath(), 'utf-8')
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

export function writePluginRegistry(registry: PluginRegistry): void {
  const dir = getPluginsDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'registry.json'), JSON.stringify(registry, null, 2))
}

export function addPluginToRegistry(entry: PluginEntry): void {
  const registry = readPluginRegistry()
  registry.plugins[entry.name] = entry
  writePluginRegistry(registry)
}

export function removePluginFromRegistry(name: string): void {
  const registry = readPluginRegistry()
  if (!(name in registry.plugins)) return
  delete registry.plugins[name]
  writePluginRegistry(registry)
}

export function getPluginEntry(name: string): PluginEntry | undefined {
  const registry = readPluginRegistry()
  return registry.plugins[name]
}
