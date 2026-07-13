import { join, resolve } from 'path'
import { mkdir, rm, readFile, writeFile, readdir, realpath, stat, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { execa } from 'execa'

const ADJECTIVES = [
  'swift', 'bold', 'calm', 'dark', 'keen', 'warm', 'wild', 'sure', 'vast', 'pure',
  'crisp', 'fresh', 'brave', 'sharp', 'clear', 'quick', 'neat', 'soft', 'bright', 'light',
  'deep', 'thin', 'free', 'cool', 'fair', 'gold', 'iron', 'jade', 'lean', 'raw',
]
const NOUNS = [
  'fox', 'owl', 'elk', 'wolf', 'bear', 'hawk', 'lynx', 'crow', 'deer', 'hare',
  'eagle', 'otter', 'raven', 'tiger', 'crane', 'bison', 'puma', 'dove', 'seal', 'wren',
  'finch', 'viper', 'moth', 'bass', 'carp', 'lark', 'swan', 'toad', 'mole', 'wasp',
]

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.deepseek', '.next', 'build',
  '__pycache__', '.venv', 'target', '.turbo', '.cache',
])

const WORKTREES_DIR = '.deepseek/worktrees'
const STATE_FILE = '.deepseek/worktree-state.json'

export interface WorktreeInfo {
  name: string
  path: string
  originalCwd: string
  createdAt: string
  isGitWorktree: boolean
}

export interface WorktreeState {
  active: WorktreeInfo | null
  history: WorktreeInfo[]
}

export function generateWorktreeName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!
  return `${adj}-${noun}`
}

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

async function loadState(projectRoot: string): Promise<WorktreeState> {
  const stateFile = join(projectRoot, STATE_FILE)
  try {
    const raw = await readFile(stateFile, 'utf-8')
    return JSON.parse(raw) as WorktreeState
  } catch {
    return { active: null, history: [] }
  }
}

async function saveState(projectRoot: string, state: WorktreeState): Promise<void> {
  const stateFile = join(projectRoot, STATE_FILE)
  const dir = join(projectRoot, '.deepseek')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(stateFile, JSON.stringify(state, null, 2))
}

export function validatePathUnderWorktrees(targetPath: string, projectRoot: string): boolean {
  const worktreesRoot = resolve(projectRoot, WORKTREES_DIR)
  const resolved = resolve(targetPath)
  return resolved.startsWith(worktreesRoot + '/') || resolved === worktreesRoot
}

/**
 * Recursively copies src → dest, skipping excluded directories and the
 * destination directory itself (to avoid "copy into self" errors).
 */
async function copyDirRecursive(src: string, dest: string, destRoot: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)

    // Never descend into the worktree destination itself
    if (srcPath === destRoot || srcPath.startsWith(destRoot + '/')) continue

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      await mkdir(destPath, { recursive: true })
      await copyDirRecursive(srcPath, destPath, destRoot)
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath)
    }
    // skip symlinks and other special files
  }
}

export async function createWorktree(projectRoot: string): Promise<WorktreeInfo> {
  const useGit = isGitRepo(projectRoot)

  // Generate unique name with retry
  let name = ''
  let worktreePath = ''
  for (let attempt = 0; attempt < 10; attempt++) {
    name = generateWorktreeName()
    worktreePath = join(projectRoot, WORKTREES_DIR, name)
    if (!existsSync(worktreePath)) break
    if (attempt === 9) throw new Error('Failed to generate unique worktree name after 10 attempts.')
  }

  if (useGit) {
    // Use git worktree
    const worktreesDir = join(projectRoot, WORKTREES_DIR)
    if (!existsSync(worktreesDir)) await mkdir(worktreesDir, { recursive: true })
    try {
      await execa('git', ['worktree', 'add', '--detach', worktreePath], { cwd: projectRoot, stdio: 'pipe' })
    } catch (e) {
      throw new Error(`git worktree add failed: ${(e as Error).message}`)
    }
  } else {
    // Manual recursive copy — fs.cp refuses to copy a directory into its own subdirectory
    // even with a filter, because it performs the self-subdirectory check before calling the filter.
    await mkdir(worktreePath, { recursive: true })
    await copyDirRecursive(projectRoot, worktreePath, worktreePath)
  }

  const info: WorktreeInfo = {
    name,
    path: worktreePath,
    originalCwd: projectRoot,
    createdAt: new Date().toISOString(),
    isGitWorktree: useGit,
  }

  const state = await loadState(projectRoot)
  if (state.active) state.history.push(state.active)
  state.active = info
  await saveState(projectRoot, state)

  return info
}

export async function enterWorktree(projectRoot: string, name: string): Promise<WorktreeInfo> {
  const worktreePath = join(projectRoot, WORKTREES_DIR, name)

  if (!validatePathUnderWorktrees(worktreePath, projectRoot)) {
    throw new Error(`Invalid worktree name: "${name}" resolves outside worktrees directory`)
  }

  if (!existsSync(worktreePath)) {
    throw new Error(`Worktree "${name}" not found at ${worktreePath}`)
  }

  const info: WorktreeInfo = {
    name,
    path: worktreePath,
    originalCwd: projectRoot,
    createdAt: new Date().toISOString(), // approximate
    isGitWorktree: existsSync(join(worktreePath, '.git')),
  }

  const state = await loadState(projectRoot)
  if (state.active) state.history.push(state.active)
  state.active = info
  await saveState(projectRoot, state)

  return info
}

export async function exitWorktree(projectRoot: string, keep: boolean): Promise<string> {
  const state = await loadState(projectRoot)
  if (!state.active) return 'No active worktree.'

  const { name, path, isGitWorktree } = state.active

  // chdir BEFORE removing
  process.chdir(projectRoot)

  if (!keep) {
    // Validate path is under worktrees dir
    const realTarget = await realpath(path).catch(() => path)
    if (!validatePathUnderWorktrees(realTarget, projectRoot)) {
      throw new Error(`Refused: path "${path}" is not under ${WORKTREES_DIR}`)
    }

    if (isGitWorktree) {
      try {
        await execa('git', ['worktree', 'remove', '--force', path], { cwd: projectRoot, stdio: 'pipe' })
      } catch {
        // Prune stale metadata before removing directory
        await execa('git', ['worktree', 'prune'], { cwd: projectRoot, stdio: 'pipe' }).catch(() => {})
        await rm(path, { recursive: true, force: true })
      }
    } else {
      await rm(path, { recursive: true, force: true })
    }
  }

  state.history.push(state.active)
  state.active = null
  await saveState(projectRoot, state)

  return keep
    ? `Worktree "${name}" kept at ${path}. Use /worktree enter ${name} to return.`
    : `Worktree "${name}" removed.`
}

export async function listWorktrees(projectRoot: string): Promise<WorktreeInfo[]> {
  const worktreesDir = join(projectRoot, WORKTREES_DIR)
  if (!existsSync(worktreesDir)) return []

  const entries = await readdir(worktreesDir, { withFileTypes: true })
  const results: WorktreeInfo[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const fullPath = join(worktreesDir, entry.name)
      const stats = await stat(fullPath).catch(() => null)
      results.push({
        name: entry.name,
        path: fullPath,
        originalCwd: projectRoot,
        createdAt: stats?.birthtime?.toISOString() ?? 'unknown',
        isGitWorktree: existsSync(join(fullPath, '.git')),
      })
    }
  }

  return results
}

export async function getActiveWorktree(projectRoot: string): Promise<WorktreeInfo | null> {
  const state = await loadState(projectRoot)
  return state.active
}

export function isInsideWorktree(projectRoot: string): boolean {
  const cwd = process.cwd()
  const worktreesRoot = resolve(projectRoot, WORKTREES_DIR)
  return cwd.startsWith(worktreesRoot)
}
