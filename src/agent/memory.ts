import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'

const DELIMITER = '\n§\n'
const MAX_CHARS = 2000

export type MemoryTarget = 'agent' | 'user'

let memoryDirOverride: string | null = null

export function setMemoryDir(dir: string | null): void {
  memoryDirOverride = dir
}

export function getMemoryDir(): string {
  return memoryDirOverride ?? join(homedir(), '.deepseek-code', 'memory')
}

function getFilePath(target: MemoryTarget): string {
  return join(getMemoryDir(), target === 'agent' ? 'MEMORY.md' : 'USER.md')
}

async function ensureDir(): Promise<void> {
  await mkdir(getMemoryDir(), { recursive: true })
}

export async function loadMemory(target: MemoryTarget): Promise<string[]> {
  try {
    const raw = await readFile(getFilePath(target), 'utf-8')
    if (!raw.trim()) return []
    return raw.split(DELIMITER).filter((e) => e.trim().length > 0)
  } catch {
    return []
  }
}

async function saveMemory(target: MemoryTarget, entries: string[]): Promise<void> {
  await ensureDir()
  const content = entries.join(DELIMITER)
  await writeFile(getFilePath(target), content, 'utf-8')
}

export async function addEntry(target: MemoryTarget, content: string): Promise<string> {
  const entries = await loadMemory(target)
  const newEntries = [...entries, content]
  const total = newEntries.join(DELIMITER).length
  if (total > MAX_CHARS) {
    return 'Memory full. Remove old entries first.'
  }
  await saveMemory(target, newEntries)
  return `Added to ${target} memory.`
}

export async function replaceEntry(target: MemoryTarget, match: string, content: string): Promise<string> {
  const entries = await loadMemory(target)
  const idx = entries.findIndex((e) => e.includes(match))
  if (idx === -1) return `No entry matching "${match}" found.`
  entries[idx] = content
  const total = entries.join(DELIMITER).length
  if (total > MAX_CHARS) {
    return 'Memory full after replace. Revert or remove entries.'
  }
  await saveMemory(target, entries)
  return `Replaced entry in ${target} memory.`
}

export async function removeEntry(target: MemoryTarget, match: string): Promise<string> {
  const entries = await loadMemory(target)
  const idx = entries.findIndex((e) => e.includes(match))
  if (idx === -1) return `No entry matching "${match}" found.`
  entries.splice(idx, 1)
  await saveMemory(target, entries)
  return `Removed entry from ${target} memory.`
}

export async function getMemorySnapshot(): Promise<string> {
  const [agentEntries, userEntries] = await Promise.all([
    loadMemory('agent'),
    loadMemory('user'),
  ])
  if (agentEntries.length === 0 && userEntries.length === 0) return ''

  const parts: string[] = []
  if (agentEntries.length > 0) {
    parts.push('## Agent Memory\n' + agentEntries.map((e) => `- ${e}`).join('\n'))
  }
  if (userEntries.length > 0) {
    parts.push('## User Preferences\n' + userEntries.map((e) => `- ${e}`).join('\n'))
  }
  return parts.join('\n\n')
}
