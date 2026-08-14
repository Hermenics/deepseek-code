import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { execa } from 'execa'
import { TaskEventSink } from './events.js'
import { acquireFileLease } from './fileLease.js'
import type { PermissionProfile, TaskWorkspaceV1 } from './types.js'
import { BLOCKED_DIRS, isSensitiveWorkspacePath } from '../tools/shared/pathSafety.js'
import { loadMergedSettings } from '../settings/loader.js'
import { runClaudeHookEvent } from '../hooks/lifecycle.js'

interface ManagedWorkspace extends TaskWorkspaceV1 {
  taskId: string
  integratedPatchHash?: string
  releaseLock?: () => Promise<void>
}

export interface WorkspaceLease {
  workspace: TaskWorkspaceV1
  release(): Promise<void>
}

export class WorktreeHookBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorktreeHookBlockedError'
  }
}

export interface IntegrationResult {
  integrated: boolean
  conflict?: string
  patchHash?: string
  files: string[]
}

export class TaskWorkspaceManager {
  private readonly workspaces = new Map<string, ManagedWorkspace>()

  constructor(
    public projectRoot: string,
    readonly sessionId: string,
    private readonly events: TaskEventSink,
  ) {}

  async acquire(taskId: string, profile: PermissionProfile, signal?: AbortSignal): Promise<WorkspaceLease> {
    const existing = this.workspaces.get(taskId)
    if (existing?.isolation === 'git-worktree' || existing?.isolation === 'readonly-shared') {
      return { workspace: this.snapshot(existing), release: async () => { existing.preserved = true } }
    }
    if (existing?.isolation === 'serialized-writer' && !existing.releaseLock) {
      existing.releaseLock = await this.acquireWriterLock(taskId, signal)
      return { workspace: this.snapshot(existing), release: async () => { await existing.releaseLock?.(); existing.releaseLock = undefined } }
    }
    if (existing?.isolation === 'serialized-writer') throw new Error(`Writer workspace for task '${taskId}' is already leased`)
    if (!['writer-worktree', 'coordinator-integrator'].includes(profile)) {
      const workspace: ManagedWorkspace = {
        taskId, path: this.projectRoot, projectRoot: this.projectRoot,
        isolation: 'readonly-shared', integrated: true,
      }
      this.workspaces.set(taskId, workspace)
      return { workspace: this.snapshot(workspace), release: async () => {} }
    }

    let isolated: ManagedWorkspace | null
    try {
      isolated = await this.createGitWorktree(taskId)
    } catch (error) {
      if (error instanceof WorktreeHookBlockedError) throw error
      this.events.emit('workspace_fallback', { reason: error instanceof Error ? error.message : String(error) }, taskId)
      isolated = null
    }
    if (isolated) {
      this.workspaces.set(taskId, isolated)
      this.events.emit('workspace_created', { workspace: isolated }, taskId)
      return { workspace: this.snapshot(isolated), release: async () => { isolated.preserved = true } }
    }

    const releaseLock = await this.acquireWriterLock(taskId, signal)
    const workspace: ManagedWorkspace = {
      taskId, path: this.projectRoot, projectRoot: this.projectRoot,
      isolation: 'serialized-writer', integrated: true, releaseLock,
    }
    this.workspaces.set(taskId, workspace)
    return {
      workspace: this.snapshot(workspace),
      release: async () => { await workspace.releaseLock?.(); workspace.releaseLock = undefined },
    }
  }

  get(taskId: string): TaskWorkspaceV1 | undefined {
    const workspace = this.workspaces.get(taskId)
    return workspace ? this.snapshot(workspace) : undefined
  }

  translatePath(inputPath: string, workspace: TaskWorkspaceV1): string {
    if (!isAbsolute(inputPath)) return resolve(workspace.path, inputPath)
    const rel = relative(workspace.projectRoot, inputPath)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return resolve(workspace.path, rel)
    return inputPath
  }

  async integrate(taskId: string): Promise<IntegrationResult> {
    const workspace = this.required(taskId)
    if (workspace.isolation === 'serialized-writer') return { integrated: true, files: [] }
    if (workspace.isolation !== 'git-worktree') return { integrated: false, conflict: 'Read-only workspace has nothing to integrate', files: [] }

    const releaseIntegration = await this.acquireProjectLease('integration', taskId)
    try {
      return await this.integrateWorktree(taskId, workspace)
    } finally {
      await releaseIntegration()
    }
  }

  restore(records: Array<{ taskId: string; workspace?: TaskWorkspaceV1; metadata?: Record<string, unknown> }>): void {
    if (this.workspaces.size > 0) throw new Error('Workspaces can only be restored into an empty manager')
    for (const record of records) {
      if (!record.workspace) continue
      this.assertRestoredWorkspace(record.workspace)
      const integration = record.metadata?.integration as { patchHash?: unknown } | undefined
      this.workspaces.set(record.taskId, {
        ...structuredClone(record.workspace), taskId: record.taskId,
        integratedPatchHash: typeof integration?.patchHash === 'string' ? integration.patchHash : undefined,
      })
    }
  }

  private async integrateWorktree(taskId: string, workspace: ManagedWorkspace): Promise<IntegrationResult> {

    const { patch, files } = await this.capturePatch(workspace)
    if (!patch) {
      workspace.integrated = true
      workspace.integratedPatchHash = createHash('sha256').update('').digest('hex')
      return { integrated: true, files: [], patchHash: workspace.integratedPatchHash }
    }
    const forbidden = files.find(file => BLOCKED_DIRS.includes(file.split('/')[0] ?? '') || isSensitiveWorkspacePath(file))
    if (forbidden) {
      const conflict = `Patch contains protected path '${forbidden}'`
      this.events.emit('integration', { integrated: false, conflict, files }, taskId)
      return { integrated: false, conflict, files }
    }
    const projectRoot = workspace.projectRoot
    const dirtyParent = await this.changedPaths(projectRoot)
    const overlap = files.find(file => dirtyParent.has(file))
    if (overlap) {
      const conflict = `Parent checkout has local changes in '${overlap}'`
      this.events.emit('integration', { integrated: false, conflict, files }, taskId)
      return { integrated: false, conflict, files }
    }

    const check = await execa('git', ['apply', '--check', '-'], { cwd: projectRoot, input: patch, reject: false })
    if (check.exitCode !== 0) {
      const conflict = check.stderr || check.stdout || 'Patch does not apply cleanly'
      this.events.emit('integration', { integrated: false, conflict, files }, taskId)
      return { integrated: false, conflict, files }
    }
    const apply = await execa('git', ['apply', '-'], { cwd: projectRoot, input: patch, reject: false })
    if (apply.exitCode !== 0) {
      const conflict = apply.stderr || apply.stdout || 'Patch application failed'
      this.events.emit('integration', { integrated: false, conflict, files }, taskId)
      return { integrated: false, conflict, files }
    }
    const patchHash = createHash('sha256').update(patch).digest('hex')
    workspace.integrated = true
    workspace.integratedPatchHash = patchHash
    this.events.emit('integration', { integrated: true, patchHash, files }, taskId)
    return { integrated: true, patchHash, files }
  }

  async cleanup(taskId: string): Promise<boolean> {
    const workspace = this.required(taskId)
    if (workspace.isolation !== 'git-worktree') return false
    if (!workspace.integrated || !workspace.integratedPatchHash) return false
    const settings = await loadMergedSettings(this.projectRoot)
    const worktreeName = basename(workspace.path)
    const hook = await runClaudeHookEvent(settings.hooks, 'WorktreeRemove', this.sessionId, {
      cwd: this.projectRoot, name: worktreeName, path: worktreeName,
    } as Record<string, unknown>)
    if (hook.decision === 'block') return false
    const { patch } = await this.capturePatch(workspace)
    const currentHash = createHash('sha256').update(patch).digest('hex')
    if (currentHash !== workspace.integratedPatchHash) return false
    const ignored = await execa('git', ['status', '--porcelain=v1', '--ignored', '-z'], { cwd: workspace.path, reject: false })
    if (ignored.stdout.split('\0').some(entry => entry.startsWith('!! '))) return false
    this.assertOwnedPath(workspace.path, workspace.projectRoot)
    const result = await execa('git', ['worktree', 'remove', '--force', workspace.path], { cwd: workspace.projectRoot, reject: false })
    if (result.exitCode !== 0) return false
    this.workspaces.delete(taskId)
    return true
  }

  private async createGitWorktree(taskId: string): Promise<ManagedWorkspace> {
    const root = (await execa('git', ['rev-parse', '--show-toplevel'], { cwd: this.projectRoot })).stdout.trim()
    if (resolve(root) !== resolve(this.projectRoot)) throw new Error('Session root is not the Git repository root')
    if ((await this.changedPaths(this.projectRoot)).size > 0) throw new Error('Session checkout has uncommitted changes; writer fallback must be serialized')
    const baseHead = (await execa('git', ['rev-parse', 'HEAD'], { cwd: this.projectRoot })).stdout.trim()
    const path = join(this.projectRoot, '.deepseek', 'worktrees', `${this.sessionId.slice(0, 8)}-${taskId.slice(0, 8)}-${randomUUID().slice(0, 6)}`)
    this.assertOwnedPath(path)
    const settings = await loadMergedSettings(this.projectRoot)
    const worktreeName = basename(path)
    const hook = await runClaudeHookEvent(settings.hooks, 'WorktreeCreate', this.sessionId, {
      cwd: this.projectRoot, name: worktreeName, path: worktreeName,
    } as Record<string, unknown>)
    if (hook.decision === 'block') throw new WorktreeHookBlockedError(hook.reason ?? 'Worktree creation blocked by hook')
    await this.ensureWorktreeIgnored()
    await mkdir(join(this.projectRoot, '.deepseek', 'worktrees'), { recursive: true })
    await execa('git', ['worktree', 'add', '--detach', path, baseHead], { cwd: this.projectRoot })
    return { taskId, path, projectRoot: this.projectRoot, isolation: 'git-worktree', baseHead, integrated: false, preserved: true }
  }

  private async ensureWorktreeIgnored(): Promise<void> {
    const gitPath = (await execa('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: this.projectRoot })).stdout.trim()
    const excludePath = resolve(this.projectRoot, gitPath)
    const content = await readFile(excludePath, 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    })
    if (!content.split(/\r?\n/).includes('.deepseek/worktrees/')) await appendFile(excludePath, '\n.deepseek/worktrees/\n')
  }

  private async capturePatch(workspace: ManagedWorkspace): Promise<{ patch: string; files: string[] }> {
    const files = [...await this.changedPaths(workspace.path)]
    const untracked = await execa('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: workspace.path, reject: false })
    const untrackedFiles = untracked.stdout.split('\0').filter(Boolean)
    if (untrackedFiles.length > 0) await execa('git', ['add', '-N', '--', ...untrackedFiles], { cwd: workspace.path })
    const diff = await execa('git', ['diff', '--binary', 'HEAD'], { cwd: workspace.path, reject: false, stripFinalNewline: false })
    return { patch: diff.stdout, files: [...new Set([...files, ...untrackedFiles])] }
  }

  private async changedPaths(cwd: string): Promise<Set<string>> {
    const result = await execa('git', ['status', '--porcelain=v1', '-z'], { cwd, reject: false })
    const entries = result.stdout.split('\0').filter(Boolean)
    const paths = new Set<string>()
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!
      const status = entry.slice(0, 2)
      const path = entry.slice(3)
      if (path) paths.add(path)
      if (status.includes('R') || status.includes('C')) index++
    }
    return paths
  }

  private async acquireWriterLock(taskId: string, signal?: AbortSignal): Promise<() => Promise<void>> {
    return this.acquireProjectLease('writer', taskId, signal)
  }

  private async acquireProjectLease(kind: 'writer' | 'integration', taskId: string, signal?: AbortSignal): Promise<() => Promise<void>> {
    const canonicalRoot = await realpath(this.projectRoot).catch(() => resolve(this.projectRoot))
    const lease = await acquireFileLease(canonicalRoot, { kind, sessionId: this.sessionId, taskId }, signal)
    return () => lease.release()
  }

  private required(taskId: string): ManagedWorkspace {
    const workspace = this.workspaces.get(taskId)
    if (!workspace) throw new Error(`Workspace for task '${taskId}' was not found`)
    return workspace
  }

  private snapshot(workspace: ManagedWorkspace): TaskWorkspaceV1 {
    return structuredClone({
      path: workspace.path, projectRoot: workspace.projectRoot, isolation: workspace.isolation,
      baseHead: workspace.baseHead, integrated: workspace.integrated, preserved: workspace.preserved,
    })
  }

  private assertOwnedPath(path: string, projectRoot = this.projectRoot): void {
    const root = resolve(projectRoot, '.deepseek', 'worktrees')
    const target = resolve(path)
    if (target !== root && !target.startsWith(`${root}/`)) throw new Error(`Refused workspace path outside '${root}'`)
  }

  private assertRestoredWorkspace(workspace: TaskWorkspaceV1): void {
    if (resolve(workspace.projectRoot) !== resolve(this.projectRoot)) throw new Error('Restored workspace belongs to a different project root')
    if (workspace.isolation === 'git-worktree') this.assertOwnedPath(workspace.path, workspace.projectRoot)
    else if (resolve(workspace.path) !== resolve(workspace.projectRoot)) throw new Error('Shared restored workspace must equal the project root')
  }
}
