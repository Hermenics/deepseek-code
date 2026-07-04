export interface PluginManifest {
  name: string
  version?: string
  description?: string
  author?: { name: string; email?: string; url?: string }
  commands?: string | string[]
  agents?: string | string[]
  skills?: string | string[]
  hooks?: string
}

export interface PluginComponents {
  commands: string[]
  agents: string[]
  skills: string[]
  hasHooks: boolean
}

export interface PluginEntry {
  name: string
  repo: string
  version: string
  installedAt: string
  updatedAt: string
  commitHash: string
  description: string
  components: PluginComponents
}

export interface PluginRegistry {
  version: 1
  plugins: Record<string, PluginEntry>
}

export interface LoadedPlugin {
  entry: PluginEntry
  path: string
  manifest: PluginManifest
}
