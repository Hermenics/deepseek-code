import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { PluginManifest, LoadedPlugin, PluginComponents } from './types.js'
import { readPluginRegistry, getPluginsDir } from './registry.js'

export function discoverComponents(pluginDir: string): PluginComponents {
  const commands: string[] = []
  const agents: string[] = []
  const skills: string[] = []
  let hasHooks = false

  const cmdsDir = join(pluginDir, 'commands')
  if (existsSync(cmdsDir)) {
    for (const f of readdirSync(cmdsDir)) {
      if (f.endsWith('.md')) commands.push(f.replace(/\.md$/, ''))
    }
  }

  const agentsDir = join(pluginDir, 'agents')
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (f.endsWith('.md')) agents.push(f.replace(/\.md$/, ''))
    }
  }

  const skillsDir = join(pluginDir, 'skills')
  if (existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(skillsDir, d.name, 'SKILL.md'))) {
        skills.push(d.name)
      }
    }
  }

  if (existsSync(join(pluginDir, 'hooks', 'hooks.json'))) {
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

export function loadInstalledPlugins(): LoadedPlugin[] {
  const registry = readPluginRegistry()
  const loaded: LoadedPlugin[] = []

  for (const entry of Object.values(registry.plugins)) {
    const pluginDir = join(getPluginsDir(), entry.name)
    if (!existsSync(pluginDir)) continue
    const manifest = readPluginManifest(pluginDir)
    if (!manifest) continue
    loaded.push({ entry, path: pluginDir, manifest })
  }

  return loaded
}
