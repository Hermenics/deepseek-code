import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface SkillEntry {
  name: string
  repo: string
  installedAt: string
  updatedAt: string
  commitHash: string
  description: string
}

export interface SkillRegistry {
  version: 1
  skills: Record<string, SkillEntry>
}

const REGISTRY_FILE = '.registry.json'

function registryPath(skillsDir: string): string {
  return join(skillsDir, REGISTRY_FILE)
}

export function readRegistry(skillsDir: string): SkillRegistry {
  try {
    const content = readFileSync(registryPath(skillsDir), 'utf-8')
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        parsed.version === 1 && parsed.skills && typeof parsed.skills === 'object' && !Array.isArray(parsed.skills)) {
      return parsed
    }
    throw new Error('Registry file has unexpected format')
  } catch (err: any) {
    if (err.code === 'ENOENT') return { version: 1, skills: {} }
    throw err
  }
}

export function writeRegistry(skillsDir: string, registry: SkillRegistry): void {
  mkdirSync(skillsDir, { recursive: true })
  writeFileSync(registryPath(skillsDir), JSON.stringify(registry, null, 2))
}

export function addToRegistry(skillsDir: string, entry: SkillEntry): void {
  const registry = readRegistry(skillsDir)
  registry.skills[entry.name] = entry
  writeRegistry(skillsDir, registry)
}

export function removeFromRegistry(skillsDir: string, name: string): void {
  const registry = readRegistry(skillsDir)
  if (!(name in registry.skills)) return
  delete registry.skills[name]
  writeRegistry(skillsDir, registry)
}
