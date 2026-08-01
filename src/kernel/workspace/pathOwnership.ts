import type { Store } from '../store/store.js'
import type { EventBus } from '../events/eventBus.js'

// ── Simple glob matching (no extra deps) ────────────────────────────

function matchGlob(pattern: string, filePath: string): boolean {
  // Exact match
  if (pattern === filePath) return true
  // Trailing ** matches everything under that directory
  if (pattern.endsWith('/**')) {
    const dir = pattern.slice(0, -3)
    return filePath.startsWith(dir + '/') || filePath === dir
  }
  // Leading ** matches any path ending with the suffix
  if (pattern.startsWith('**/')) {
    const suffix = pattern.slice(3)
    return filePath.endsWith('/' + suffix) || filePath === suffix
  }
  // Simple * wildcard (single segment)
  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'
    )
    return regex.test(filePath)
  }
  // Prefix match for directories
  if (pattern.endsWith('/')) {
    return filePath.startsWith(pattern)
  }
  return false
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

export class PathOwnership {
  private readonly claims = new Map<string, PathClaim>()

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

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

    this.claims.set(taskId, claim)
    this.events.emit('PathClaimed', { task_id: taskId, paths }, { task_id: taskId })
    return { ok: true }
  }

  /** Release all path claims for a task. */
  release(taskId: string): void {
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
    // Extract the static prefix (before any wildcard) and check if they share a root
    const staticPrefix = (s: string) => s.split(/[*?[]/)[0] ?? ''
    const prefixA = staticPrefix(a)
    const prefixB = staticPrefix(b)
    // If one static prefix starts with the other, they could intersect
    return prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA)
  }
}
