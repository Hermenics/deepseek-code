import { join, resolve } from 'node:path'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { acquireFileLease } from '../orchestration/fileLease.js'

const DELIMITER = '\n§\n'
const MAX_CHARS = 2000
export type MemoryTarget = 'agent' | 'user'
export interface MemoryConfig { enabled?: boolean; scope?: 'user' | 'project' }

export class MemoryStore {
  private directoryOverride: string | null = null
  private enabled = true
  private scope: 'user' | 'project' = 'user'
  private cwd: string
  private mutationChain = Promise.resolve()

  constructor(cwd = process.cwd()) { this.cwd = resolve(cwd) }

  async configure(config: MemoryConfig, cwd = this.cwd): Promise<void> {
    this.enabled = config.enabled !== false
    this.scope = config.scope ?? 'user'
    this.cwd = resolve(cwd)
    if (!this.enabled || this.directoryOverride) return
    const legacy = join(homedir(), '.deepseek-code', 'memory')
    const destination = this.getDirectory()
    await mkdir(destination, { recursive: true })
    if (this.scope === 'project') return
    for (const file of ['MEMORY.md', 'USER.md']) {
      try { await readFile(join(destination, file), 'utf8') }
      catch { await copyFile(join(legacy, file), join(destination, file)).catch(() => undefined) }
    }
  }

  setDirectory(directory: string | null): void { this.directoryOverride = directory ? resolve(directory) : null }

  getDirectory(): string {
    if (this.directoryOverride) return this.directoryOverride
    return this.scope === 'project' ? join(this.cwd, '.deepseek', 'memory') : join(homedir(), '.deepseek', 'memory')
  }

  async load(target: MemoryTarget): Promise<string[]> {
    if (!this.enabled) return []
    try {
      const raw = await readFile(this.file(target), 'utf8')
      return raw.trim() ? raw.split(DELIMITER).filter(entry => entry.trim()) : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  add(target: MemoryTarget, content: string): Promise<string> {
    return this.mutate(async () => {
      if (!this.enabled) return 'Memory is disabled in settings.'
      const entries = [...await this.load(target), content]
      if (entries.join(DELIMITER).length > MAX_CHARS) return 'Memory full. Remove old entries first.'
      await this.save(target, entries)
      return `Added to ${target} memory.`
    })
  }

  replace(target: MemoryTarget, match: string, content: string): Promise<string> {
    return this.mutate(async () => {
      const entries = await this.load(target)
      const index = entries.findIndex(entry => entry.includes(match))
      if (index === -1) return `No entry matching "${match}" found.`
      entries[index] = content
      if (entries.join(DELIMITER).length > MAX_CHARS) return 'Memory full after replace. Revert or remove entries.'
      await this.save(target, entries)
      return `Replaced entry in ${target} memory.`
    })
  }

  remove(target: MemoryTarget, match: string): Promise<string> {
    return this.mutate(async () => {
      const entries = await this.load(target)
      const index = entries.findIndex(entry => entry.includes(match))
      if (index === -1) return `No entry matching "${match}" found.`
      entries.splice(index, 1)
      await this.save(target, entries)
      return `Removed entry from ${target} memory.`
    })
  }

  async snapshot(): Promise<string> {
    if (!this.enabled) return ''
    const [agent, user] = await Promise.all([this.load('agent'), this.load('user')])
    const parts: string[] = []
    if (agent.length) parts.push(`## Agent Memory\n${agent.map(entry => `- ${entry}`).join('\n')}`)
    if (user.length) parts.push(`## User Preferences\n${user.map(entry => `- ${entry}`).join('\n')}`)
    return parts.join('\n\n')
  }

  clear(): Promise<void> { return this.mutate(() => rm(this.getDirectory(), { recursive: true, force: true })) }

  private file(target: MemoryTarget): string { return join(this.getDirectory(), target === 'agent' ? 'MEMORY.md' : 'USER.md') }
  private async save(target: MemoryTarget, entries: string[]): Promise<void> {
    await mkdir(this.getDirectory(), { recursive: true })
    await writeFile(this.file(target), entries.join(DELIMITER), { encoding: 'utf8', mode: 0o600 })
  }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const locked = async () => {
      const lease = await acquireFileLease(`memory:${resolve(this.getDirectory())}`, { scope: this.scope })
      try { return await operation() } finally { await lease.release() }
    }
    const result = this.mutationChain.then(locked, locked)
    this.mutationChain = result.then(() => undefined, () => undefined)
    return result
  }
}

// Compatibility API for external consumers. Agent runtimes own a MemoryStore instance.
const legacyStore = new MemoryStore()
/** @deprecated Use OrchestratorSession.memory. */
export const configureMemory = (config: MemoryConfig, cwd?: string) => legacyStore.configure(config, cwd)
/** @deprecated Use OrchestratorSession.memory. */
export const setMemoryDir = (directory: string | null) => legacyStore.setDirectory(directory)
export const getMemoryDir = () => legacyStore.getDirectory()
export const loadMemory = (target: MemoryTarget) => legacyStore.load(target)
export const addEntry = (target: MemoryTarget, content: string) => legacyStore.add(target, content)
export const replaceEntry = (target: MemoryTarget, match: string, content: string) => legacyStore.replace(target, match, content)
export const removeEntry = (target: MemoryTarget, match: string) => legacyStore.remove(target, match)
export const getMemorySnapshot = () => legacyStore.snapshot()
export const clearMemory = () => legacyStore.clear()
