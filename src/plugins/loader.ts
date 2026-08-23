import { readdirSync, readFileSync, existsSync, realpathSync } from 'fs'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import type { PluginManifest, LoadedPlugin, PluginComponents } from './types.js'
import { readPluginRegistry, getPluginsDir } from './registry.js'

export function discoverComponents(pluginDir: string, manifest?: PluginManifest): PluginComponents {
  const commands: string[] = []
  const agents: string[] = []
  const skills: string[] = []
  let hasHooks = false

  let canonicalRoot: string
  try {
    canonicalRoot = realpathSync(pluginDir)
  } catch {
    return { commands, agents, skills, hasHooks }
  }

  function isContained(root: string, target: string): boolean {
    const path = relative(root, target)
    return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  }

  function resolvePluginPath(requested: string, base = pluginDir): string | null {
    if (isAbsolute(requested) || requested === '..' || requested.startsWith(`..${sep}`)) return null
    const candidate = resolve(base, requested)
    try {
      const canonical = realpathSync(candidate)
      return isContained(canonicalRoot, canonical) ? canonical : null
    } catch {
      return null
    }
  }

  // Helper: resolve a manifest path field to a directory under pluginDir
  function resolveDir(field: string | string[] | undefined, fallback: string): string | null {
    const first = Array.isArray(field) ? field[0] : field
    return resolvePluginPath(first || fallback)
  }

  const cmdsDir = resolveDir(manifest?.commands, 'commands')
  if (cmdsDir && existsSync(cmdsDir)) {
    for (const f of readdirSync(cmdsDir)) {
      if (f.endsWith('.md') && resolvePluginPath(f, cmdsDir)) commands.push(f.replace(/\.md$/, ''))
    }
  }

  const agentsDir = resolveDir(manifest?.agents, 'agents')
  if (agentsDir && existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (f.endsWith('.md') && resolvePluginPath(f, agentsDir)) agents.push(f.replace(/\.md$/, ''))
    }
  }

  const skillsDir = resolveDir(manifest?.skills, 'skills')
  if (skillsDir && existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
      const skillDir = d.isDirectory() ? resolvePluginPath(d.name, skillsDir) : null
      if (skillDir && resolvePluginPath('SKILL.md', skillDir)) {
        skills.push(d.name)
      }
    }
  }

  const hooksPath = resolvePluginPath(manifest?.hooks ?? join('hooks', 'hooks.json'))
  if (hooksPath && existsSync(hooksPath)) {
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
