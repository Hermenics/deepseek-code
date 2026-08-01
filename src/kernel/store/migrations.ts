import type { Database } from 'bun:sqlite'

export interface Migration {
  version: number
  name: string
  up: string
}

/** Ensures the schema_version meta table exists. */
function ensureMeta(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function appliedVersions(db: Database): Set<number> {
  ensureMeta(db)
  const rows = db.query('SELECT version FROM _schema_version').all() as { version: number }[]
  return new Set(rows.map((r) => r.version))
}

export function runMigrations(db: Database, migrations: Migration[]): void {
  const applied = appliedVersions(db)
  const sorted = [...migrations].sort((a, b) => a.version - b.version)

  for (const migration of sorted) {
    if (applied.has(migration.version)) continue
    db.exec(migration.up)
    db.run('INSERT INTO _schema_version (version, name) VALUES (?, ?)', [migration.version, migration.name])
  }
}

// ── Migration definitions ──────────────────────────────────────────

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up: `
      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        language TEXT,
        active_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Agent threads
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        parent_thread_id TEXT REFERENCES threads(id),
        agent_spec TEXT NOT NULL DEFAULT '{}',
        agent_name TEXT,
        role TEXT NOT NULL DEFAULT 'reader',
        context_mode TEXT NOT NULL DEFAULT 'fresh',
        status TEXT NOT NULL DEFAULT 'idle',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Turns within a thread
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        transcript_json TEXT NOT NULL DEFAULT '[]',
        started_at TEXT,
        completed_at TEXT,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        tokens_cache INTEGER DEFAULT 0,
        cost_usd REAL,
        UNIQUE(thread_id, sequence)
      );

      -- Tool calls within a turn
      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        tool_input TEXT NOT NULL,
        tool_result TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at TEXT,
        completed_at TEXT,
        error TEXT
      );

      -- Tasks (orchestration)
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        parent_task_id TEXT,
        type TEXT NOT NULL DEFAULT 'agent',
        mode TEXT NOT NULL DEFAULT 'foreground',
        context_mode TEXT NOT NULL DEFAULT 'fresh',
        state TEXT NOT NULL DEFAULT 'queued',
        depth INTEGER NOT NULL DEFAULT 0,
        attempt INTEGER NOT NULL DEFAULT 0,
        permission_profile TEXT NOT NULL DEFAULT 'researcher-readonly',
        max_tokens INTEGER,
        max_cost_usd REAL,
        timeout_ms INTEGER NOT NULL DEFAULT 120000,
        block_reason TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_code TEXT,
        error_message TEXT,
        tokens_used INTEGER DEFAULT 0,
        cost_usd REAL,
        latency_ms INTEGER,
        metadata TEXT DEFAULT '{}'
      );

      -- Task dependencies (DAG edges)
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
        dependency_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
        PRIMARY KEY(task_id, dependency_id)
      );

      -- Messages between agents
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      -- Goals
      CREATE TABLE IF NOT EXISTS goals (
        goal_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id),
        session_id TEXT NOT NULL REFERENCES sessions(id),
        revision INTEGER NOT NULL DEFAULT 1,
        objective TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        token_budget INTEGER,
        max_continuations INTEGER DEFAULT 3,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        time_used_seconds INTEGER NOT NULL DEFAULT 0,
        continuations INTEGER NOT NULL DEFAULT 0,
        consecutive_blocks INTEGER NOT NULL DEFAULT 0,
        block_reason TEXT,
        started_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        paused_at TEXT,
        resumed_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT
      );

      -- Goal criteria
      CREATE TABLE IF NOT EXISTS goal_criteria (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(goal_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'command',
        spec TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        evaluated_at TEXT,
        UNIQUE(goal_id, sequence)
      );

      -- Events (append-only log)
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 1,
        session_id TEXT NOT NULL,
        thread_id TEXT,
        task_id TEXT,
        goal_id TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        type TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'system',
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      -- Hook runs (audit)
      CREATE TABLE IF NOT EXISTS hook_runs (
        run_id TEXT PRIMARY KEY,
        hook_id TEXT,
        event TEXT NOT NULL,
        command TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'user',
        decision TEXT,
        exit_code INTEGER,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_threads_session ON threads(session_id);
      CREATE INDEX IF NOT EXISTS idx_turns_thread ON turns(thread_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);
      CREATE INDEX IF NOT EXISTS idx_goals_thread ON goals(thread_id);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_hook_runs_event ON hook_runs(event);
    `,
  },
]
