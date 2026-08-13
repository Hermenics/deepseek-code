import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "status", label: "Status: not wired in" },
  { id: "why", label: "The problem it addresses" },
  { id: "today", label: "How persistence works today" },
  { id: "store", label: "The store" },
  { id: "pragmas", label: "The four PRAGMAs" },
  { id: "schema", label: "The schema" },
  { id: "migrations", label: "Migrations" },
  { id: "events", label: "The event bus" },
  { id: "leases", label: "Leases & path ownership" },
  { id: "reading", label: "Reading it as a reference" },
];

const TODAY = [
  ["Conversation sessions", "~/.deepseek/sessions/", "JSON", "Resume, /sessions and transcript export"],
  ["Compatibility history", "~/.deepseek/history.json", "JSON", "Bounded copy of recent agent messages"],
  ["Orchestrator tasks", "In memory, per OrchestratorSession", "—", "Live task state, /tasks"],
  ["Task snapshots", "~/.deepseek/task-snapshots/", "JSON, mode 0600", "Restoring an orchestration session"],
  ["Audit trail", "~/.deepseek/logs/*.jsonl", "JSONL", "What the agent did"],
  ["Conversation checkpoints", "~/.deepseek/checkpoints/", "JSON", "/checkpoint save/list/restore"],
  ["File checkpoints", "~/.deepseek-code/checkpoints/", "Manifest + .bak files", "/undo"],
];

const PRAGMAS = [
  ["journal_mode = WAL", "Readers do not block the writer — a UI could render task state while work is recorded."],
  ["busy_timeout = 5000", "Wait up to 5s for a lock instead of failing on transient contention."],
  ["foreign_keys = ON", "Referential integrity enforced by the database. SQLite defaults this OFF."],
  ["secure_delete = ON", "Deleted pages are zeroed rather than left readable in the file."],
];

const TABLES = [
  ["sessions", "Top-level session identity and metadata."],
  ["threads", "Conversation threads within a session."],
  ["turns", "Individual turns inside a thread."],
  ["tool_calls", "Every tool invocation, linked to its turn."],
  ["tasks", "Orchestrator task records."],
  ["task_dependencies", "The DAG edges between tasks."],
  ["messages", "Mailbox messages between coordinator and workers."],
  ["goals", "Long-running goals."],
  ["goal_criteria", "The checkable criteria attached to a goal."],
  ["events", "The append-only event log."],
  ["hook_runs", "Hook executions and their outcomes."],
  ["leases", "Held leases — the concurrency control substrate."],
  ["path_claims", "Which task owns which paths, for conflict detection."],
  ["integration_results", "Outcomes of integrating worker patches back."],
  ["workflow_runs", "Workflow execution records."],
];

const LESSONS = [
  ["Query shape drives storage choice", "Conversations are read whole → JSON. Task state is queried many ways → SQL."],
  ["Correct the defaults explicitly", "foreign_keys OFF is a SQLite default that silently disables every REFERENCES clause."],
  ["Append-only makes a log evidence", "A log that can be corrected cannot be used to establish what happened."],
  ["Record the pid with a lease", "A lease held by a dead process is reclaimable; a boolean flag is not."],
  ["Migrate on open for local tools", "There is no operator to run a deploy step on a developer's machine."],
];

export default function KernelPersistence() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Concepts</span><span className="sep">/</span><span className="current">Kernel & persistence</span>
        </nav>

        <div className="hero">
          <h1>Kernel & persistence</h1>
          <p className="tagline">
            A designed and implemented persistence layer — SQLite store, append-only event bus, leases —
            that nothing imports yet. This page documents what it is and why it exists.
          </p>
        </div>

        <section id="status">
          <h2><span className="anchor">#</span>Status: not wired in</h2>
          <Note>
            <b><code className="inline">src/kernel/</code> is a reference subsystem.</b> No module outside it
            imports it, <code className="inline">~/.deepseek/kernel.db</code> is never created during normal
            use, and no runtime behavior depends on it. Everything below describes code that exists and
            compiles, not code that runs in your session.
          </Note>
          <p>
            It is documented rather than hidden for two reasons. It is a substantial, finished piece of the
            repository that anyone reading the source will find and wonder about. And it is the target
            architecture for persistence — knowing its shape explains several decisions in the code that{" "}
            <em>is</em> wired in.
          </p>
          <p>
            If you are looking for how your sessions, tasks and logs are actually stored today, jump to{" "}
            <a href="#today">How persistence works today</a>.
          </p>
        </section>

        <section id="why">
          <h2><span className="anchor">#</span>The problem it addresses</h2>
          <p>
            Persistence in the running system is spread across mechanisms that each solved one problem well:
            conversation history in JSON, orchestrator task state in memory, snapshots as separate files,
            audit as JSONL. That works, and it has a ceiling.
          </p>
          <p>
            The ceiling is <b>querying across those boundaries</b>. "How many tool calls did this turn make",
            "which tasks exceeded their deadline this week", "replay what happened in session X" are all
            questions that require parsing whole files, and some of them cross files that were never designed
            to be joined.
          </p>
          <p>
            The kernel is the answer to that: one framework-independent layer with <b>no UI imports at
            all</b>, owning the store, an event bus, threads, tasks, goals, hooks, workflows and workspace
            path ownership. The TUI would become one consumer rather than the owner.
          </p>
          <p>
            <code className="inline">docs/mission-control/ARCHITECTURE.md</code> in the repository frames this
            explicitly as current architecture versus target architecture.
          </p>
        </section>

        <section id="today">
          <h2><span className="anchor">#</span>How persistence works today</h2>
          <p>
            For orientation, this is the actual layout your session uses:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>What</th>
                  <th style={{ width: "30%" }}>Where</th>
                  <th style={{ width: "16%" }}>Format</th>
                  <th>Used for</th>
                </tr>
              </thead>
              <tbody>
                {TODAY.map(([w, wh, f, u]) => (
                  <tr key={w}>
                    <td><b style={{ color: "var(--text-strong)" }}>{w}</b></td>
                    <td><code className="inline">{wh}</code></td>
                    <td>{f}</td>
                    <td>{u}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Note the one that is not on disk at all: <b>orchestrator task state is in memory</b>, per{" "}
            <code className="inline">OrchestratorSession</code>. It survives a crash only if the session was
            given a <code className="inline">snapshotFile</code>. That is precisely the gap the kernel is
            designed to close — see <a href="/docs/agent-teams#persistence">Snapshots & recovery</a>.
          </p>
          <p>
            Full map: <a href="/docs/deepseek-directory">The .deepseek directory</a>.
          </p>
        </section>

        <section id="store">
          <h2><span className="anchor">#</span>The store</h2>
          <p>
            <code className="inline">Store</code> wraps a single SQLite database, intended to live at{" "}
            <code className="inline">~/.deepseek/kernel.db</code>. SQLite is chosen for specific reasons rather
            than habit: it is a file with no daemon to install or keep running, it gives real transactions,
            it supports concurrent readers under WAL, and it is inspectable with tooling you already have.
          </p>
          <p>
            A broker or client-server database is explicitly <b>out of scope</b> until there is a requirement
            for it — namely multi-host coordination. Adding one earlier would trade an operational dependency
            for a capability nobody needs.
          </p>
        </section>

        <section id="pragmas">
          <h2><span className="anchor">#</span>The four PRAGMAs</h2>
          <p>
            Four settings are applied on open, and each is a deliberate correction to a SQLite default:
          </p>
          <CodeBlock lang="sql">{`PRAGMA journal_mode  = WAL
PRAGMA busy_timeout  = 5000
PRAGMA foreign_keys  = ON
PRAGMA secure_delete = ON`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Pragma</th><th>Why</th></tr>
              </thead>
              <tbody>
                {PRAGMAS.map(([p, w]) => (
                  <tr key={p}>
                    <td><code className="inline">{p}</code></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">foreign_keys = ON</code> is the one that surprises people. SQLite ships
            with foreign key enforcement <em>disabled</em> for backward compatibility, so a schema full of{" "}
            <code className="inline">REFERENCES</code> clauses does nothing unless you turn it on. A schema that
            documents relationships it does not enforce is worse than one that never claimed to.
          </p>
          <p>
            <code className="inline">secure_delete = ON</code> costs some write performance and buys something
            worth the price: deleted content is zeroed rather than left in free pages. The database is
            designed to hold tool arguments and event payloads, and "deleted" should mean gone.
          </p>
        </section>

        <section id="schema">
          <h2><span className="anchor">#</span>The schema</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Table</th><th>Would hold</th></tr>
              </thead>
              <tbody>
                {TABLES.map(([t, h]) => (
                  <tr key={t}>
                    <td><code className="inline">{t}</code></td>
                    <td>{h}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The shape tells you how the system thinks about itself.{" "}
            <code className="inline">sessions → threads → turns → tool_calls</code> is the conversation
            hierarchy. <code className="inline">tasks + task_dependencies + messages</code> is the orchestrator.{" "}
            <code className="inline">leases + path_claims + integration_results</code> is concurrency control.{" "}
            <code className="inline">events</code> cuts across all of it.
          </p>
          <p>
            <code className="inline">path_claims</code> is the quiet one. It records which task owns which
            paths, so overlapping writes become a detected conflict rather than a corrupted file discovered
            after both workers finish. The running system solves the same problem today with in-memory
            registries and filesystem leases.
          </p>
        </section>

        <section id="migrations">
          <h2><span className="anchor">#</span>Migrations</h2>
          <p>
            Schema changes run through an ordered migration list tracked in a{" "}
            <code className="inline">_schema_version</code> table. Every statement is{" "}
            <code className="inline">CREATE TABLE IF NOT EXISTS</code>, so running migrations against an
            already-current database is a no-op rather than an error.
          </p>
          <CodeBlock lang="text">{`open kernel.db
  → apply PRAGMAs
  → ensure _schema_version exists
  → apply any migration newer than the recorded version
  → record the new version`}</CodeBlock>
          <p>
            Migrating on open is the correct default for a local, single-user database. There is no operator
            to run a deploy step, and a version mismatch between the code and the file would otherwise be a
            hard failure at startup — on a developer's machine, at the least convenient moment.
          </p>
        </section>

        <section id="events">
          <h2><span className="anchor">#</span>The event bus</h2>
          <p>
            <code className="inline">EventBus</code> is append-only and replayable. Events are emitted as
            envelopes carrying identity, correlation ids (session, task, parent), an ordering timestamp and
            sequence, and a structured payload. They are persisted and delivered to listeners, never mutated
            or deleted in place.
          </p>
          <p>
            Append-only is what would make the log trustworthy as an account of what happened. A mutable log
            can be corrected, and a log that can be corrected cannot establish anything. It is also what
            makes replay possible: reprocessing the same events in the same order reconstructs the same
            state.
          </p>
          <p>
            The running system has the same idea in two narrower forms — the{" "}
            <a href="/docs/monitoring-audit">audit log</a> and{" "}
            <a href="/docs/agent-teams#events">orchestrator events</a>. Both are append-only JSONL with secret
            redaction. The kernel version adds queryability and cross-session scope.
          </p>
        </section>

        <section id="leases">
          <h2><span className="anchor">#</span>Leases & path ownership</h2>
          <p>
            A <b>lease</b> is a time-bound claim on a resource, recorded with the owner's token and process
            id. It is the general form of the mechanism the orchestrator already uses concretely in the{" "}
            <a href="/docs/worktrees#nofallback">serialized-writer fallback</a>, where a single writer holds
            a project-scoped lease keyed on the canonical project root.
          </p>
          <p>
            Recording the pid is the detail that makes leases survivable. A lease held by a process that no
            longer exists can be identified as stale and reclaimed; a lease that is just a flag in a file
            cannot, and one crash leaves the resource locked forever.
          </p>
        </section>

        <section id="reading">
          <h2><span className="anchor">#</span>Reading it as a reference</h2>
          <p>
            The subsystem is worth reading even though it does not run, because several of its decisions are
            the reasoning behind code that does:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Decision</th><th>Generalizes to</th></tr>
              </thead>
              <tbody>
                {LESSONS.map(([d, g]) => (
                  <tr key={d}>
                    <td><b style={{ color: "var(--text-strong)" }}>{d}</b></td>
                    <td>{g}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="text">{`src/kernel/
├── store/        store.ts, migrations.ts, repositories.ts
├── events/       eventBus.ts
├── threads/      threadRuntime.ts, agentSpec.ts
├── tasks/        taskBoard.ts, messageRouter.ts
├── goals/        goalEngine.ts
├── hooks/        hookRuntime.ts
├── workflows/    workflowEngine.ts
├── workspace/    integration.ts, pathOwnership.ts
└── compat/       import.ts`}</CodeBlock>
          <p>
            Related: <a href="/docs/agent-teams">Agent teams</a> for the orchestration runtime that is
            live today, and <a href="/docs/deepseek-directory">The .deepseek directory</a> for what is
            actually written to disk.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
