import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Store } from '../store/store.js'
import { EventBus } from '../events/eventBus.js'
import { SessionRepo, GoalRepo } from '../store/repositories.js'
import { MIGRATIONS } from '../store/migrations.js'

// ── Compat: Read old JSON sessions ──────────────────────────────────

export interface LegacySessionData {
  id: string
  title?: string
  createdAt: string
  updatedAt: string
  cwd: string
  model: string
  provider: string
  language: string | null
  activeAgent: string | null
  goal?: LegacyGoalData
}

export interface LegacyGoalData {
  objective: string
  status: string
  tokenBudget?: number
  maxContinuations?: number
  tokensUsed: number
  timeUsedSeconds: number
  consecutiveBlockCount: number
  continuations: number
  blockReason?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
}

/**
 * List legacy session JSON files. When `baseDir` is provided it is used as
 * the sessions directory (top-level files plus one level of subdirectories);
 * otherwise the default `~/.deepseek/sessions` is scanned.
 */
export function listLegacySessionFiles(baseDir?: string): { file: string; id: string }[] {
  const sessionsDir = baseDir ? resolve(baseDir) : join(homedir(), '.deepseek', 'sessions')
  if (!existsSync(sessionsDir)) return []

  const results: { file: string; id: string }[] = []
  try {
    const entries = readdirSync(sessionsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        results.push({ file: join(sessionsDir, entry.name), id: entry.name.replace('.json', '') })
      }
      if (entry.isDirectory()) {
        try {
          const subs = readdirSync(join(sessionsDir, entry.name), { withFileTypes: true })
          for (const sub of subs) {
            if (sub.isFile() && sub.name.endsWith('.json')) {
              results.push({ file: join(sessionsDir, entry.name, sub.name), id: sub.name.replace('.json', '') })
            }
          }
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* sessions dir may not exist */ }
  return results
}

export function readLegacySession(filePath: string): LegacySessionData | null {
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as LegacySessionData
    if (!parsed.id || !parsed.cwd) return null
    return parsed
  } catch {
    return null
  }
}

// ── Import to SQLite ────────────────────────────────────────────────

export interface ImportResult {
  sessions: number
  goals: number
  errors: string[]
}

export interface ImportOptions {
  /** Legacy sessions directory. Defaults to ~/.deepseek/sessions. */
  cwd?: string
  /** Discover, parse, and validate without writing anything to the store. */
  dryRun?: boolean
}

export function importLegacySessions(
  store: Store,
  events: EventBus,
  options: ImportOptions = {},
): ImportResult {
  const result: ImportResult = { sessions: 0, goals: 0, errors: [] }

  // Dry-run performs discovery, parsing, and validation only — no writes.
  if (options.dryRun) {
    const files = listLegacySessionFiles(options.cwd)
    for (const { file } of files) {
      const legacy = readLegacySession(file)
      if (!legacy) { result.errors.push(`Failed to read: ${file}`); continue }
      // Validation of parsed legacy data (session identity + optional goal shape).
      if (!legacy.id || !legacy.cwd) { result.errors.push(`Invalid session in: ${file}`); continue }
      result.sessions++
      if (legacy.goal) result.goals++
    }
    return result
  }

  store.migrate(MIGRATIONS)
  const sessions = new SessionRepo(store, events)

  const files = listLegacySessionFiles(options.cwd)
  for (const { file } of files) {
    const legacy = readLegacySession(file)
    if (!legacy) { result.errors.push(`Failed to read: ${file}`); continue }

    try {
      const threadId = `imported-${legacy.id}`
      // Create the session and its root thread first so imported goals have a
      // valid FK target.
      sessions.create({
        id: legacy.id,
        title: legacy.title ?? null,
        cwd: resolve(legacy.cwd),
        model: legacy.model,
        provider: legacy.provider,
        language: legacy.language ?? null,
        active_agent: legacy.activeAgent ?? null,
      })
      store.run(
        `INSERT INTO threads (id, session_id, agent_spec, agent_name, role, context_mode, status, created_at, updated_at)
         VALUES (?, ?, '{}', 'imported', 'reader', 'fresh', 'idle', ?, ?)`,
        threadId, legacy.id, legacy.createdAt, legacy.updatedAt,
      )
      result.sessions++

      // Import goal if present. Goals belong to the imported session, so use
      // an EventBus scoped to that session for the GoalRepo.
      if (legacy.goal) {
        const sessionEvents = new EventBus(store, legacy.id)
        const sessionGoals = new GoalRepo(store, sessionEvents)
        sessionGoals.create({
          goal_id: `imported-goal-${legacy.id}`,
          thread_id: threadId,
          objective: legacy.goal.objective,
          token_budget: legacy.goal.tokenBudget,
          max_continuations: legacy.goal.maxContinuations,
        })
        // Restore goal state
        const active = sessionGoals.getActive(threadId)
        if (active) {
          sessionGoals.update(active.goal_id, {
            status: mapLegacyStatus(legacy.goal.status),
            tokens_used: legacy.goal.tokensUsed,
            time_used_seconds: legacy.goal.timeUsedSeconds,
            continuations: legacy.goal.continuations,
            consecutive_blocks: legacy.goal.consecutiveBlockCount,
            block_reason: legacy.goal.blockReason ?? null,
            started_at: legacy.goal.startedAt ?? legacy.goal.createdAt,
            updated_at: legacy.goal.updatedAt,
          })
        }
        result.goals++
      }
    } catch (err) {
      result.errors.push(`Import failed for ${legacy.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return result
}

function mapLegacyStatus(status: string): 'active' | 'paused' | 'blocked' | 'budget_limited' | 'complete' {
  const map: Record<string, 'active' | 'paused' | 'blocked' | 'budget_limited' | 'complete'> = {
    active: 'active', paused: 'paused', blocked: 'blocked',
    budget_limited: 'budget_limited', usage_limited: 'budget_limited',
    complete: 'complete',
  }
  return map[status] ?? 'active'
}
