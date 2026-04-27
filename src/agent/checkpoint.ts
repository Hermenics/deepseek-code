import { join } from 'path'
import { homedir } from 'os'
import { mkdir, readdir, unlink } from 'fs/promises'
import { readJson, writeJson } from '../utils/fs.js'
import type { MessageOrBoundary } from './compactBoundary.js'
import { CHECKPOINT_MAX } from '../constants.js'

const DIR = join(homedir(), '.deepseek', 'checkpoints')

export interface Checkpoint {
  id: string
  timestamp: string
  label: string
  messages: MessageOrBoundary[]
  filesModified: string[]
}

export async function saveCheckpoint(
  messages: MessageOrBoundary[],
  filesModified: string[],
  label?: string,
): Promise<string> {
  await mkdir(DIR, { recursive: true })
  const id = Date.now().toString()
  const cp: Checkpoint = {
    id,
    timestamp: new Date().toISOString(),
    label: label ?? new Date().toLocaleString(),
    messages,
    filesModified,
  }
  await writeJson(join(DIR, `${id}.json`), cp)
  await prune()
  return id
}

export async function listCheckpoints(): Promise<Checkpoint[]> {
  try {
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort().reverse()
    const result: Checkpoint[] = []
    for (const f of files) {
      try { result.push(await readJson<Checkpoint>(join(DIR, f))) } catch { /* skip */ }
    }
    return result
  } catch {
    return []
  }
}

export async function loadCheckpoint(id: string): Promise<Checkpoint | null> {
  try { return await readJson<Checkpoint>(join(DIR, `${id}.json`)) } catch { return null }
}

async function prune() {
  try {
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort()
    for (const f of files.slice(0, Math.max(0, files.length - CHECKPOINT_MAX))) {
      await unlink(join(DIR, f)).catch(() => {})
    }
  } catch { /* ignore */ }
}
