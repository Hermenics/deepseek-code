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

interface IntegrationRow {
  integration_id: string
  task_id: string
  status: string
  patch_hash: string | null
  conflict_reason: string | null
  files_integrated: string
  verified: number
  rolled_back: number
  started_at: string
  completed_at: string | null
}

/**
 * Durable integration pipeline. Results are persisted to the
 * `integration_results` table (migration v4) and rehydrated on construction,
 * so active and terminal integration state survives restarts.
 */
export class IntegrationPipeline {
  private readonly active = new Map<string, IntegrationResult>()

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {
    this.rehydrate()
  }

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
    this.persistResult(result)
    this.events.emit('IntegrationStarted', {
      integration_id: id, task_id: request.task_id, files: request.files_changed,
    }, { task_id: request.task_id })

    // Phase 1: Pre-check
    result.status = 'checking'
    this.persistResult(result)
    this.events.emit('IntegrationChecking', { integration_id: id }, { task_id: request.task_id })

    if (request.files_changed.length === 0) {
      // Empty change set — trivially successful integration.
      result.status = 'integrated'
      result.files_integrated = []
      result.verified = true
      result.completed_at = new Date().toISOString()
      this.persistResult(result)
      this.events.emit('IntegrationCompleted', {
        integration_id: id, files: [], verified: true,
      }, { task_id: request.task_id })
      return result
    }

    if (!request.patch) {
      // Non-empty change set without a patch is a conflict, not a success.
      result.status = 'conflict'
      result.conflict_reason = 'Changed files declared but no patch was provided'
      result.completed_at = new Date().toISOString()
      this.persistResult(result)
      this.events.emit('IntegrationConflict', {
        integration_id: id, reason: result.conflict_reason, files: request.files_changed,
      }, { task_id: request.task_id })
      return result
    }

    // Phase 2: Apply
    result.status = 'applying'
    this.persistResult(result)
    this.events.emit('IntegrationApplying', { integration_id: id, patch_hash: patchHash }, { task_id: request.task_id })
    result.files_integrated = request.files_changed

    // Phase 3: Verify
    result.status = 'verifying'
    this.persistResult(result)
    this.events.emit('IntegrationVerifying', { integration_id: id }, { task_id: request.task_id })

    if (verifier) {
      const verdict = await verifier(result)
      // Detect a concurrent rollback that happened while we awaited.
      if (result.rolled_back) return result
      if (!verdict.passed) {
        result.status = 'rolled_back'
        result.rolled_back = true
        result.conflict_reason = verdict.reason ?? 'Verification failed'
        result.completed_at = new Date().toISOString()
        this.persistResult(result)
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
    this.persistResult(result)
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
    this.persistResult(result)
    this.events.emit('IntegrationRolledBack', { integration_id: result.integration_id, reason }, { task_id: taskId })
    return result
  }

  /** Get integration status (defensive copy so callers cannot mutate active state). */
  get(taskId: string): IntegrationResult | undefined {
    const r = this.active.get(taskId)
    return r ? structuredClone(r) : undefined
  }

  /** List all integrations (defensive copies). */
  list(): IntegrationResult[] {
    return [...this.active.values()].map(r => structuredClone(r))
  }

  private persistResult(result: IntegrationResult): void {
    this.store.run(
      `INSERT OR REPLACE INTO integration_results
        (integration_id, task_id, status, patch_hash, conflict_reason, files_integrated,
         verified, rolled_back, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      result.integration_id, result.task_id, result.status, result.patch_hash ?? null,
      result.conflict_reason ?? null, JSON.stringify(result.files_integrated),
      result.verified ? 1 : 0, result.rolled_back ? 1 : 0,
      result.started_at, result.completed_at ?? null,
    )
  }

  private rehydrate(): void {
    // Order by started_at ASC so later attempts overwrite earlier results for the same task_id.
    const rows = this.store.query<IntegrationRow>('SELECT * FROM integration_results ORDER BY started_at ASC')
    for (const row of rows) {
      const result: IntegrationResult = {
        integration_id: row.integration_id,
        task_id: row.task_id,
        status: row.status as IntegrationStatus,
        patch_hash: row.patch_hash ?? undefined,
        conflict_reason: row.conflict_reason ?? undefined,
        files_integrated: this.parseJsonArray(row.files_integrated),
        verified: row.verified === 1,
        rolled_back: row.rolled_back === 1,
        started_at: row.started_at,
        completed_at: row.completed_at ?? undefined,
      }
      this.active.set(row.task_id, result)
    }
  }

  private parseJsonArray(value: string): string[] {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
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

      // Fail safe on unknown hashes: if either hash is missing, we cannot prove
      // the worktree still matches what was integrated, so preserve it.
      if (!wt.integrated_patch_hash) {
        result.preserved.push(`${wt.path} (unknown integrated patch hash)`)
        this.events.emit('WorktreePreserved', { reason: 'unknown integrated patch hash', task_id: wt.task_id }, { task_id: wt.task_id })
        continue
      }

      if (!wt.current_patch_hash) {
        result.preserved.push(`${wt.path} (unknown current patch hash)`)
        this.events.emit('WorktreePreserved', { reason: 'unknown current patch hash', task_id: wt.task_id }, { task_id: wt.task_id })
        continue
      }

      if (wt.integrated_patch_hash !== wt.current_patch_hash) {
        result.preserved.push(`${wt.path} (patch changed after integration)`)
        this.events.emit('WorktreePreserved', { reason: 'patch changed', task_id: wt.task_id }, { task_id: wt.task_id })
        continue
      }

      // Both known hashes match — safe to clean.
      result.cleaned.push(wt.path)
      this.events.emit('WorktreeRemoved', { path: wt.path, task_id: wt.task_id }, { task_id: wt.task_id })
    }

    return result
  }
}
