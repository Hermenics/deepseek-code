import { join } from 'path'
import { homedir } from 'os'
import type { Model } from '../commands.js'
import { readJson, globFiles } from '../utils/fs.js'

export interface AgentConfig {
  name: string
  model?: Model
  systemPrompt: string
  files?: string[]
  /** Hex color for the agent label in the input chrome (e.g. "#ff6600") */
  color?: string
  /**
   * Tools that require user permission before execution.
   * - '*'           → all tools require permission (including dangerous ones)
   * - string[]      → only the listed tool names require permission
   * - omitted/null  → no tool permission prompts (default behavior)
   */
  allowedTools?: string[] | '*'
}

export interface LoadedAgent {
  config: AgentConfig
  source: 'local' | 'global'
}

const LOCAL_DIR = join(process.cwd(), '.deepseek', 'agents')
const GLOBAL_DIR = join(homedir(), '.deepseek', 'agents')

async function tryLoad(path: string): Promise<AgentConfig | null> {
  try {
    const cfg = await readJson<AgentConfig>(path)
    // Validate required fields
    if (!cfg || typeof cfg.name !== 'string' || typeof cfg.systemPrompt !== 'string') return null
    return cfg
  } catch {
    return null
  }
}

export async function loadAgentConfig(name: string): Promise<LoadedAgent> {
  const localPath = join(LOCAL_DIR, `${name}.json`)
  const globalPath = join(GLOBAL_DIR, `${name}.json`)

  const local = await tryLoad(localPath)
  if (local) return { config: local, source: 'local' }

  const global = await tryLoad(globalPath)
  if (global) return { config: global, source: 'global' }

  throw new Error(`Agent '${name}' not found in local or global agents directory.`)
}

export async function listAgents(): Promise<{ name: string; source: 'local' | 'global' }[]> {
  const results: { name: string; source: 'local' | 'global' }[] = []
  const seen = new Set<string>()

  for (const [dir, source] of [[LOCAL_DIR, 'local'], [GLOBAL_DIR, 'global']] as const) {
    const files = await globFiles(/\.json$/, dir)
    for (const file of files) {
      const name = file.replace(/\.json$/, '')
      if (!seen.has(name)) {
        seen.add(name)
        results.push({ name, source })
      }
    }
  }

  return results
}
