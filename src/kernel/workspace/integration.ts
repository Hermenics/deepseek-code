import { createHash, randomUUID } from 'node:crypto'
import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'

// ── Integration Pipeline ────────────────────────────────────────────

export interface IntegrationRequest {
  task_id: string
  workspace_path: string
  project_root: string
  base_commit: string
  files_changed: string[]
  patch?: string
}

export type IntegrationStatus = 'pending' | 'checking' | 'applying' | 'verifying' | 'integrated' | 'conflict' | 'rolled_back'

export interface IntegrationResult {
  integration_id: string
  task_id: string
  status: IntegrationStatus
  patch_hash?: string
  conflict_reason?: string
  files_integrated: string[]
  verified: boolean
  rolled_back: boolean
  started_at: string
  completed_at?: string
}

export interface IntegrationVerifier {
  (result: IntegrationResult): Promise<{ passed: boolean; reason?: string }>
}

export class IntegrationPipeline {
  private readonly active = new Map<string, IntegrationResult>()

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  /** Begin integration of a workspace's changes. */
  async start(request: IntegrationRequest, verifier?: IntegrationVerifier): Promise<IntegrationResult> {
    const id = randomUUID()
    const now = new Date().toISOString()
    const patchHash = request.patch
      ? createHash('sha256').update(request.patch).digest('hex')
      : undefined

    const result: IntegrationResult = {
      integration_id: id,
      task_id: request.task_id,
      status: 'pending',
      patch_hash: patchHash,
      files_integrated: [],
      verified: false,
      rolled_back: false,
      started_at: now,
    }

    this.active.set(request.task_id, result)
    this.events.emit('IntegrationStarted', {
      integration_id: id, task_id: request.task_id, files: request.files_changed,
    }, { task_id: request.task_id })

    // Phase 1: Pre-check
    result.status = 'checking'
    this.events.emit('IntegrationChecking', { integration_id: id }, { task_id: request.task_id })

    // Simulate check (real implementation would run git apply --check, protected path checks, etc.)
    const checkOk = request.files_changed.length > 0 && request.patch
    if (!checkOk) {
      // Empty change set — integration is trivially complete
      result.status = 'integrated'
      result.files_integrated = request.files_changed
      result.verified = true
      result.completed_at = new Date().toISOString()
      this.events.emit('IntegrationCompleted', {
        integration_id: id, files: result.files_integrated, verified: result.verified,
      }, { task_id: request.task_id })
      return result
    }

    // Phase 2: Apply
    result.status = 'applying'
    this.events.emit('IntegrationApplying', { integration_id: id, patch_hash: patchHash }, { task_id: request.task_id })
    result.files_integrated = request.files_changed

    // Phase 3: Verify
    result.status = 'verifying'
    this.events.emit('IntegrationVerifying', { integration_id: id }, { task_id: request.task_id })

    if (verifier) {
      const verdict = await verifier(result)
      if (!verdict.passed) {
        // Rollback
        result.status = 'rolled_back'
        result.rolled_back = true
        result.conflict_reason = verdict.reason ?? 'Verification failed'
        result.completed_at = new Date().toISOString()
        this.events.emit('IntegrationRolledBack', {
          integration_id: id, reason: result.conflict_reason,
        }, { task_id: request.task_id })
        return result
      }
    }

    // Success
    result.status = 'integrated'
    result.verified = true
    result.completed_at = new Date().toISOString()
    this.events.emit('IntegrationCompleted', {
      integration_id: id, files: result.files_integrated, verified: result.verified,
    }, { task_id: request.task_id })

    return result
  }

  /** Roll back an integration manually. */
  rollback(taskId: string, reason: string): IntegrationResult | null {
    const result = this.active.get(taskId)
    if (!result || result.status === 'rolled_back') return null

    result.status = 'rolled_back'
    result.rolled_back = true
    result.conflict_reason = reason
    result.completed_at = new Date().toISOString()
    this.events.emit('IntegrationRolledBack', { integration_id: result.integration_id, reason }, { task_id: taskId })
    return result
  }

  /** Get integration status for a task. */
  get(taskId: string): IntegrationResult | undefined {
    return this.active.get(taskId)
  }

  /** List all integrations. */
  list(): IntegrationResult[] {
    return [...this.active.values()]
  }
}

// ── Worktree GC ─────────────────────────────────────────────────────

export interface GcResult {
  cleaned: string[]
  preserved: string[]
  errors: string[]
}

export class WorktreeGC {
  constructor(
    private readonly events: EventBus,
  ) {}

  /** Determine which worktrees can be safely cleaned and which must be preserved. */
  evaluate(worktrees: Array<{
    path: string
    integrated: boolean
    integrated_patch_hash?: string
    current_patch_hash?: string
    has_ignored_files: boolean
    task_id: string
  }>): GcResult {
    const result: GcResult = { cleaned: [], preserved: [], errors: [] }

    for (const wt of worktrees) {
      if (!wt.integrated) {
        result.preserved.push(`${wt.path} (not integrated)`)
        this.events.emit('WorktreePreserved', { reason: 'not integrated', task_id: wt.task_id }, { task_id: wt.task_id })
        continue
      }

      if (wt.has_ignored_files) {
        result.preserved.push(`${wt.path} (has ignored files)`)
        this.events.emit('WorktreePreserved', { reason: 'ignored files', task_id: wt.task_id }, { task_id: wt.task_id })
        continue
      }

      if (wt.integrated_patch_hash && wt.current_patch_hash && wt.integrated_patch_hash !== wt.current_patch_hash) {
        result.preserved.push(`${wt.path} (patch changed after integration)`)
        this.events.emit('WorktreePreserved', { reason: 'patch changed', task_id: wt.task_id }, { task_id: wt.task_id })
        continue
      }

      // Safe to clean
      result.cleaned.push(wt.path)
      this.events.emit('WorktreeRemoved', { path: wt.path, task_id: wt.task_id }, { task_id: wt.task_id })
    }

    return result
  }
}
