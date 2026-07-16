import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { PluginManifest, LoadedPlugin, PluginComponents } from './types.js'
import { readPluginRegistry, getPluginsDir } from './registry.js'

export function discoverComponents(pluginDir: string, manifest?: PluginManifest): PluginComponents {
  const commands: string[] = []
  const agents: string[] = []
  const skills: string[] = []
  let hasHooks = false

  // Helper: resolve a manifest path field to a directory under pluginDir
  function resolveDir(field: string | string[] | undefined, fallback: string): string {
    if (!field) return join(pluginDir, fallback)
    const first = Array.isArray(field) ? field[0] : field
    // If it looks like a bare name (no slashes), treat as subdirectory
    if (first && !first.includes('/')) return join(pluginDir, first)
    return join(pluginDir, first ?? fallback)
  }

  const cmdsDir = manifest?.commands ? resolveDir(manifest.commands, 'commands') : join(pluginDir, 'commands')
  if (existsSync(cmdsDir)) {
    for (const f of readdirSync(cmdsDir)) {
      if (f.endsWith('.md')) commands.push(f.replace(/\.md$/, ''))
    }
  }

  const agentsDir = manifest?.agents ? resolveDir(manifest.agents, 'agents') : join(pluginDir, 'agents')
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (f.endsWith('.md')) agents.push(f.replace(/\.md$/, ''))
    }
  }

  const skillsDir = manifest?.skills ? resolveDir(manifest.skills, 'skills') : join(pluginDir, 'skills')
  if (existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(skillsDir, d.name, 'SKILL.md'))) {
        skills.push(d.name)
      }
    }
  }

  const hooksPath = manifest?.hooks
    ? join(pluginDir, manifest.hooks)
    : join(pluginDir, 'hooks', 'hooks.json')
  if (existsSync(hooksPath)) {
    hasHooks = true
  }

  return { commands, agents, skills, hasHooks }
}

export function readPluginManifest(dir: string): PluginManifest | null {
  // ponytail: try root plugin.json first, then .claude-plugin/plugin.json (monorepo layout)
  const candidates = [join(dir, 'plugin.json'), join(dir, '.claude-plugin', 'plugin.json')]
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed.name !== 'string') continue
      return parsed as PluginManifest
    } catch {
      continue
    }
  }
  return null
}

export function loadInstalledPlugins(dir?: string): LoadedPlugin[] {
  const registry = readPluginRegistry(dir)
  const base = dir ?? getPluginsDir()
  const loaded: LoadedPlugin[] = []

  for (const entry of Object.values(registry.plugins)) {
    const pluginDir = join(base, entry.name)
    if (!existsSync(pluginDir)) {
      console.warn(`[plugins] skipping '${entry.name}': directory not found at ${pluginDir}`)
      continue
    }
    const manifest = readPluginManifest(pluginDir)
    if (!manifest) {
      console.warn(`[plugins] skipping '${entry.name}': could not read plugin.json in ${pluginDir}`)
      continue
    }
    loaded.push({ entry, path: pluginDir, manifest })
  }

  return loaded
}
