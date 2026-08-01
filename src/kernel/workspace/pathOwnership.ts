import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'

// ── Simple glob matching (no extra deps) ────────────────────────────

function matchGlob(pattern: string, filePath: string): boolean {
  if (pattern === filePath) return true
  if (pattern.endsWith('/**')) {
    const dir = pattern.slice(0, -3)
    return filePath.startsWith(dir + '/') || filePath === dir
  }
  if (pattern.startsWith('**/')) {
    const suffix = pattern.slice(3)
    return filePath.endsWith('/' + suffix) || filePath === suffix
  }
  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'
    )
    return regex.test(filePath)
  }
  if (pattern.endsWith('/')) return filePath.startsWith(pattern)
  return false
}

/**
 * Static root of a pattern, split into path segments, or null when the pattern
 * begins with a wildcard (which can match anywhere).
 */
function staticSegments(pattern: string): string[] | null {
  const beforeWildcard = pattern.split(/[*?[]/)[0]
  if (!beforeWildcard) return null
  return beforeWildcard.split('/').filter(Boolean)
}

function isSegmentPrefixOf(a: string[], b: string[]): boolean {
  if (a.length > b.length) return false
  return a.every((seg, i) => seg === b[i])
}

// ── Path Ownership ──────────────────────────────────────────────────

export interface PathClaim {
  task_id: string
  paths: string[]  // glob patterns
  acquired_at: string
}

export interface OverlapReport {
  task_a: string
  task_b: string
  overlapping_paths: string[]
}

/**
 * Durable path ownership. Claims are persisted to the `path_claims` table
 * (migration v4) and rehydrated on construction, so active claims survive
 * process restarts.
 */
export class PathOwnership {
  private readonly claims = new Map<string, PathClaim>()

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {
    this.rehydrate()
  }

  /** Declare path ownership for a task. Fails if overlap with another active task. */
  declare(taskId: string, paths: string[]): { ok: true } | { ok: false; overlaps: OverlapReport[] } {
    const claim: PathClaim = { task_id: taskId, paths, acquired_at: new Date().toISOString() }

    const overlaps: OverlapReport[] = []
    for (const [otherId, existing] of this.claims) {
      if (otherId === taskId) continue
      const overlapping = this.findOverlap(paths, existing.paths)
      if (overlapping.length > 0) {
        overlaps.push({ task_a: taskId, task_b: otherId, overlapping_paths: overlapping })
      }
    }

    if (overlaps.length > 0) {
      this.events.emit('PathOverlapDetected', { task_id: taskId, overlaps }, { task_id: taskId })
      return { ok: false, overlaps }
    }

    // Persist before advertising the claim.
    this.store.run(
      'INSERT OR REPLACE INTO path_claims (task_id, paths, acquired_at) VALUES (?, ?, ?)',
      taskId, JSON.stringify(paths), claim.acquired_at,
    )
    this.claims.set(taskId, claim)
    this.events.emit('PathClaimed', { task_id: taskId, paths }, { task_id: taskId })
    return { ok: true }
  }

  /** Release all path claims for a task. */
  release(taskId: string): void {
    if (!this.claims.has(taskId)) return
    this.store.run('DELETE FROM path_claims WHERE task_id = ?', taskId)
    this.claims.delete(taskId)
    this.events.emit('PathReleased', { task_id: taskId }, { task_id: taskId })
  }

  /** Check if a specific file matches any claimed path. */
  isClaimed(filePath: string, excludeTaskId?: string): string | null {
    for (const [taskId, claim] of this.claims) {
      if (taskId === excludeTaskId) continue
      for (const pattern of claim.paths) {
        if (matchGlob(pattern, filePath)) return taskId
      }
    }
    return null
  }

  /** Get all active claims. */
  listClaims(): PathClaim[] {
    return [...this.claims.values()]
  }

  /** Rehydrate claims from durable storage (restart recovery). */
  private rehydrate(): void {
    const rows = this.store.query<{ task_id: string; paths: string; acquired_at: string }>(
      'SELECT task_id, paths, acquired_at FROM path_claims',
    )
    for (const row of rows) {
      try {
        this.claims.set(row.task_id, {
          task_id: row.task_id,
          paths: JSON.parse(row.paths) as string[],
          acquired_at: row.acquired_at,
        })
      } catch { /* skip corrupt rows */ }
    }
  }

  private findOverlap(pathsA: string[], pathsB: string[]): string[] {
    const overlapping: string[] = []
    for (const a of pathsA) {
      for (const b of pathsB) {
        if (matchGlob(a, b) || matchGlob(b, a) || this.globsIntersect(a, b)) {
          overlapping.push(`${a} ↔ ${b}`)
        }
      }
    }
    return overlapping
  }

  private globsIntersect(a: string, b: string): boolean {
    const segmentsA = staticSegments(a)
    const segmentsB = staticSegments(b)

    // A pattern with no static root (starts with a wildcard) can match anywhere.
    if (segmentsA === null || segmentsB === null) return true

    // Compare static roots by complete path segments, not raw string prefixes,
    // so 'src/a/**' and 'src/ab/**' do not overlap.
    return isSegmentPrefixOf(segmentsA, segmentsB) || isSegmentPrefixOf(segmentsB, segmentsA)
  }
}
