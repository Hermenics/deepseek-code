import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, dirname } from 'node:path'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { parseWorkflowSource } from './parser.js'
import type { WorkflowMeta } from './types.js'

export interface DiscoveredWorkflow {
  meta: WorkflowMeta
  path: string
  source: 'project' | 'user'
}

export interface WorkflowDiscoveryOptions {
  globalDirectory?: string
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch { return false }
}

function contained(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

async function projectDirectories(start: string): Promise<string[]> {
  const directories: string[] = []
  let current = resolve(start)
  while (true) {
    const candidate = join(current, '.deepseek', 'workflows')
    try { if ((await lstat(candidate)).isDirectory()) directories.push(candidate) } catch { /* absent */ }
    if (await exists(join(current, '.git'))) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return directories
}

async function readDirectory(directory: string, source: DiscoveredWorkflow['source']): Promise<DiscoveredWorkflow[]> {
  let root: string
  try {
    if ((await lstat(directory)).isSymbolicLink()) return []
    root = await realpath(directory)
  } catch { return [] }
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const workflows: DiscoveredWorkflow[] = []
  for (const entry of entries) {
    if (!entry.name.endsWith('.js') || (!entry.isFile() && !entry.isSymbolicLink())) continue
    const path = join(directory, entry.name)
    try {
      const resolvedPath = await realpath(path)
      if (!contained(root, resolvedPath)) continue
      const parsed = parseWorkflowSource(await readFile(resolvedPath, 'utf8'))
      workflows.push({ meta: parsed.meta, path, source })
    } catch { /* invalid workflows are omitted from discovery */ }
  }
  return workflows
}

export async function discoverWorkflows(cwd: string, options: WorkflowDiscoveryOptions = {}): Promise<DiscoveredWorkflow[]> {
  const directories = await projectDirectories(cwd)
  const globalDirectory = options.globalDirectory ?? join(homedir(), '.deepseek', 'workflows')
  const groups = [
    ...(await Promise.all(directories.map(directory => readDirectory(directory, 'project')))),
    await readDirectory(globalDirectory, 'user'),
  ]
  const selected = new Map<string, DiscoveredWorkflow>()
  for (const workflow of groups.flat()) if (!selected.has(workflow.meta.name)) selected.set(workflow.meta.name, workflow)
  return [...selected.values()]
}
