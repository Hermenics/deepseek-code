import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "model", label: "The mental model" },
  { id: "components", label: "Session components" },
  { id: "invariants", label: "The invariants" },
  { id: "profiles", label: "Permission profiles" },
  { id: "isolation", label: "Workspace isolation" },
  { id: "integration", label: "Integration" },
  { id: "context", label: "Fresh vs fork context" },
  { id: "sandbox", label: "The shell sandbox" },
  { id: "persistence", label: "Snapshots & recovery" },
  { id: "events", label: "Events & observability" },
  { id: "limits", label: "Limits" },
];

const COMPONENTS = [
  ["TaskRegistry", "Owns task records, the DAG, scheduling, claims, retries and per-task metrics."],
  ["TaskHandle", "The public face of a task: status, awaitResult, cancel, sendMessage, resume, getResult."],
  ["TaskMailbox", "Ordered, deduplicated, acknowledged messaging between coordinator and workers."],
  ["TaskEventSink", "Versioned events in memory and optionally as JSONL, with secret redaction."],
  ["TaskWorkspaceManager", "Creates per-task worktrees, translates paths, integrates patches back."],
  ["TaskSnapshotStore", "Atomic, schema-validated persistence of the whole session at mode 0600."],
  ["OrchestratorSession", "Composes the above and supplies the execution context passed to tools."],
];

const INVARIANTS = [
  ["One session, one task", "A task belongs to exactly one session and keeps a stable taskId for its whole life."],
  ["Terminal settles once", "A late or second completion for a settled attempt is rejected, not applied."],
  ["done is immutable", "There is no transition out of done. Resume is only possible from recoverable states."],
  ["Cancellation is idempotent", "Cancelling twice is safe. Timeout and cancellation produce distinct terminal states."],
  ["Cycles are rejected", "Dependencies are validated before mutation; self-dependency and cycles are refused."],
  ["Permits outlive aborts", "A cancelled runner keeps its concurrency permit until it is actually quiescent."],
  ["Privileges never widen", "Nested workers inherit the intersection of parent capabilities, profile and allowlist."],
  ["Failure is closed", "Invalid structured output or an internal verifier failure never produces success."],
  ["Candidates are data", "MoA candidate output is untrusted data in a user message, never a system instruction."],
  ["Secrets are redacted", "Events and snapshots redact credential-shaped values before persistence."],
];

const STATES = [
  ["queued", "running, blocked, cancelled"],
  ["blocked", "queued, failed, cancelled"],
  ["running", "done, failed, blocked, cancelled, timed_out"],
  ["failed", "queued (explicit resume or bounded retry)"],
  ["cancelled", "queued (explicit resume)"],
  ["timed_out", "queued (explicit resume)"],
  ["done", "— none —"],
];

const PROFILES = [
  ["researcher-readonly", "readonly-shared", "Read and search tools only. Shares the project without write access."],
  ["tester", "readonly-shared", "May run shell, but the project is mounted read-only."],
  ["writer-worktree", "git-worktree", "Writes inside its own worktree. Shell is writable only there."],
  ["coordinator-integrator", "—", "Integrates worker patches. Cannot be selected by a delegated config."],
];

const ISOLATION = [
  ["readonly-shared", "Readers and testers", "The real project, mounted without write access."],
  ["git-worktree", "Writers, normal case", "git worktree add --detach under .deepseek/worktrees/<session-task-random>."],
  ["serialized-writer", "Writers, fallback", "A project-scoped filesystem lease. Shell denied; only path-validated file tools may write."],
];

const EVENTS = [
  "task creation", "state transitions", "attempt start/end", "messages", "tool calls",
  "authorization", "retry", "block", "timeout", "cancellation", "completion",
  "workspace creation", "workspace fallback", "integration", "session root changes", "errors",
];

const LIMITS = [
  ["concurrency", "5", "Tasks running at once per session."],
  ["maxTasks", "17", "Total tasks a session may ever create."],
  ["maxDepth", "2", "How deep delegation may nest."],
  ["maxFanOut", "5", "Children a single parent may spawn."],
  ["maxRetries", "1", "Bounded retry attempts per task."],
  ["timeoutMs", "120000", "Per-attempt deadline."],
];

export default function AgentTeams() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Concepts</span><span className="sep">/</span><span className="current">Agent teams</span>
        </nav>

        <div className="hero">
          <h1>Agent teams & the orchestrator</h1>
          <p className="tagline">
            The runtime that lets one session run many bounded workers — with isolated workspaces,
            non-widening permissions, and terminal states that settle exactly once.
          </p>
        </div>

        <section id="model">
          <h2><span className="anchor">#</span>The mental model</h2>
          <p>
            Every <code className="inline">Agent</code> owns exactly one{" "}
            <code className="inline">OrchestratorSession</code>. That session owns its task registry,
            scheduler, dependency graph, mailbox, event sink, workspace manager and optional snapshot store.
            There are no cross-session singletons: two agents running side by side share nothing.
          </p>
          <p>
            Inside a session, work is modeled as <b>tasks</b>. A task has a stable id, a state, a permission
            profile, a workspace, and at most one running attempt. A <b>coordinator</b> — your main session —
            spawns tasks and receives typed results. A <b>worker</b> executes one task and terminates by
            submitting a validated result.
          </p>
          <p>
            The design follows a small number of principles that show up everywhere in the implementation:
            explicit identity, bounded concurrency, isolated mutable work, structured terminal protocols,
            fail-closed verification, and auditable state changes.
          </p>
          <Note>
            This page describes the runtime. For the day-to-day interface, see{" "}
            <a href="/docs/parallel-tasks">Parallel tasks</a> and <a href="/docs/subagents">Sub-agents</a>.
          </Note>
        </section>

        <section id="components">
          <h2><span className="anchor">#</span>Session components</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Component</th><th>Responsibility</th></tr>
              </thead>
              <tbody>
                {COMPONENTS.map(([c, r]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The public entry point is <code className="inline">src/orchestration/index.ts</code>. Everything a
            tool needs is delivered through a <code className="inline">ToolExecutionContext</code>, which is how
            a tool knows which session and task it is running inside without reaching for a global.
          </p>
        </section>

        <section id="invariants">
          <h2><span className="anchor">#</span>The invariants</h2>
          <p>
            These are the properties the runtime enforces rather than hopes for. They are the reason
            parallel agent work is safe to run unattended:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Invariant</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {INVARIANTS.map(([i, m]) => (
                  <tr key={i}>
                    <td><b style={{ color: "var(--text-strong)" }}>{i}</b></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Two deserve elaboration. <b>Permits outlive aborts</b>: when a task is cancelled or times out, its
            public result settles immediately, but the scheduler does not release its concurrency permit
            until the underlying runner is actually quiescent. Releasing early would let a non-cooperative
            runner keep working while a replacement started — hidden concurrency beyond the configured limit.
          </p>
          <p>
            <b>Privileges never widen</b> is the security backbone. A worker cannot broaden its own
            permissions through prompt text, tool arguments, project allow rules, or by declaring itself{" "}
            <code className="inline">coordinator-integrator</code>. Nested workers receive the{" "}
            <em>intersection</em> of the parent's capabilities, the profile, and the task allowlist.
          </p>
          <p>
            The state machine backing this is small and total:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>From</th><th>To</th></tr>
              </thead>
              <tbody>
                {STATES.map(([f, t]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{t}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="profiles">
          <h2><span className="anchor">#</span>Permission profiles</h2>
          <p>
            A profile is a capability envelope, checked <b>before</b> declarative allow rules. Rules can
            narrow a profile; they can never open it.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Profile</th><th style={{ width: "20%" }}>Isolation</th><th>Capabilities</th></tr>
              </thead>
              <tbody>
                {PROFILES.map(([p, i, c]) => (
                  <tr key={p}>
                    <td><code className="inline">{p}</code></td>
                    <td><code className="inline">{i}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            An <code className="inline">ask</code> decision behaves differently here than in an interactive
            session. It <b>stops the entire tool-call batch</b>, blocks the task, and emits a{" "}
            <code className="inline">permission</code> message to the coordinator. It is never silently treated
            as an approval, because there is no human attached to the worker to answer it.
          </p>
          <p>
            You answer from the coordinator:
          </p>
          <CodeBlock lang="bash">{`/task <id> message allow shell
/task <id> resume`}</CodeBlock>
          <p>
            Grants are structured, sender-checked, acknowledged, and bound to the <b>exact request id, tool
            and arguments</b>. A grant for one <code className="inline">shell</code> call does not authorize the
            next one, and no amount of agent-authored text can synthesize a grant.
          </p>
          <p>
            High-risk operations require a decision outside agent text entirely. Git{" "}
            <code className="inline">push</code>, force-push and <code className="inline">pull</code> count as
            high-risk even when invoked through the Git tool rather than the shell.
          </p>
        </section>

        <section id="isolation">
          <h2><span className="anchor">#</span>Workspace isolation</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Isolation</th><th style={{ width: "22%" }}>Used by</th><th>Mechanism</th></tr>
              </thead>
              <tbody>
                {ISOLATION.map(([i, u, m]) => (
                  <tr key={i}>
                    <td><code className="inline">{i}</code></td>
                    <td>{u}</td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Writers get a worktree by default. Absolute paths from the parent are translated into the
            assigned worktree, so a worker writing{" "}
            <code className="inline">/home/you/proj/src/a.ts</code> actually writes inside its own directory.
          </p>
          <p>
            The dirty-parent case is handled explicitly rather than ignored. Cloning from a stale{" "}
            <code className="inline">HEAD</code> when the parent has uncommitted changes would give the worker a
            view of the code that does not match reality, so that case takes the serialized fallback instead —
            the worker sees current state, at the cost of parallelism.
          </p>
          <p>
            When a worktree cannot be created for any reason, a{" "}
            <code className="inline">workspace_fallback</code> event records why. Degradation is always visible
            in the event log, never silent. See <a href="/docs/worktrees">Worktrees</a>.
          </p>
        </section>

        <section id="integration">
          <h2><span className="anchor">#</span>Integration</h2>
          <p>
            Work done in a worktree has to come back. Integration holds a{" "}
            <b>project-scoped lease</b> across the whole operation — dirty check,{" "}
            <code className="inline">git apply --check</code>, then apply — so two workers can never integrate
            into the same tree at once.
          </p>
          <p>
            Before applying, the patch is inspected and rejected if it overlaps another integration, contains
            secrets, or touches runtime-control paths. A binary patch and a content hash are captured so the
            result is reproducible and verifiable after the fact.
          </p>
          <CodeBlock lang="bash">{`/task <id> integrate     # apply the worker's patch to the project
/task <id> cleanup       # remove the worktree, only when safe`}</CodeBlock>
          <p>
            Failure preserves the worktree and reports the conflict rather than discarding the work. Cleanup
            is deliberately narrow: it is allowed only after integration, only for the registered path, only
            while the patch hash still matches, and only when no ignored work remains. Any dirty or
            changed-after-integration state means the worktree stays.
          </p>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Fresh vs fork context</h2>
          <p>
            A worker never inherits your conversation. There are exactly two context modes:
          </p>
          <p>
            <b>fresh</b> — the worker receives its specialization, a working directory, and a self-contained
            task description. Nothing else.
          </p>
          <p>
            <b>fork</b> — the worker additionally receives selected structured summaries, delivered as{" "}
            <b>labeled, untrusted JSON in a user message</b>. Prior results never become system instructions.
          </p>
          <p>
            That distinction is a security boundary, not a formatting choice. If an earlier worker's output
            were injected as a system instruction, a compromised or confused worker could rewrite the
            behavior of every worker downstream of it. As user-role data, its output is something the next
            worker <em>reads</em>, not something it <em>obeys</em>.
          </p>
          <p>
            Full chat history and repository contents are never copied into worker prompts. Nested delegation
            is denied by default and requires an explicit{" "}
            <code className="inline">allowDelegation: true</code>, bounded by the depth and fan-out limits.
          </p>
        </section>

        <section id="sandbox">
          <h2><span className="anchor">#</span>The shell sandbox</h2>
          <p>
            Worker shell commands do not run the way yours do. They execute through <b>Bubblewrap</b> with:
          </p>
          <CodeBlock lang="text">{`cleared environment      no inherited secrets or tokens
private home and tmp     no access to ~/.deepseek or your dotfiles
no network               a worker cannot exfiltrate or fetch
namespace isolation      a separate mount and process view`}</CodeBlock>
          <p>
            Testers additionally receive a <b>read-only project mount</b> — they can run the suite, they
            cannot rewrite the code they are testing.
          </p>
          <p>
            If sandbox support is missing on the host, the tool returns an explicit error. There is{" "}
            <b>no unsandboxed worker fallback</b>. This mirrors the worktree decision: silently degrading a
            safety boundary is worse than failing loudly, because the caller keeps operating on the
            assumption the boundary is there.
          </p>
        </section>

        <section id="persistence">
          <h2><span className="anchor">#</span>Snapshots & recovery</h2>
          <p>
            Give a session a <code className="inline">snapshotFile</code> and its tasks, mailbox and workspaces
            are persisted atomically at mode <code className="inline">0600</code>. The{" "}
            <code className="inline">Agent</code> assigns a hashed snapshot path automatically when the host
            supplies a stable session id, and restores it during initialization.
          </p>
          <p>
            Restore validates session and project identity and the complete task, message, result and
            workspace schemas <b>before</b> mutating anything. A snapshot from a different project cannot be
            loaded into this one.
          </p>
          <p>
            Restored tasks do not silently start executing. The host must reattach a compatible runner and
            explicitly resume each task, so recovery cannot accidentally duplicate work after a crash.
          </p>
          <p>
            A task captured as <code className="inline">running</code> restores as{" "}
            <code className="inline">failed / INTERRUPTED</code> with its partial data retained — the runtime
            will not claim a task is still running when the process that was running it is gone.
          </p>
          <p>
            Runners are <b>deliberately not serialized</b>. They are arbitrary JavaScript, and deserializing
            executable code from disk is a vulnerability rather than a feature. The host must reattach a
            trusted runner before resuming.
          </p>
        </section>

        <section id="events">
          <h2><span className="anchor">#</span>Events & observability</h2>
          <p>
            Every meaningful transition emits a versioned event carrying session and correlation ids, plus
            task and parent ids where applicable:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th>Event coverage</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{EVENTS.map((e) => <code className="inline" key={e} style={{ marginRight: 6 }}>{e}</code>)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Events go to memory and optionally to JSONL. Credential-shaped values are redacted before
            anything is written — the same guarantee the{" "}
            <a href="/docs/monitoring-audit">audit log</a> provides.
          </p>
          <p>
            From the TUI:
          </p>
          <CodeBlock lang="bash">{`/tasks                       # the task tree with live state
/task <id> status            # full record: attempts, errors, usage, workspace, artifacts
/task <id> result            # the typed result envelope`}</CodeBlock>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Limit</th><th style={{ width: "16%" }}>Default</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([l, d, m]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{d}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Settings under <code className="inline">agents</code> and validated agent definitions may{" "}
            <b>narrow</b> these values. They cannot raise them, which is the same non-widening rule applied to
            resource limits rather than permissions.
          </p>
          <p>
            One reporting decision worth knowing: a task record exposes whether provider usage metrics were
            actually available, and <b>monetary cost is never estimated</b> when the provider did not report
            it. An absent number is shown as absent rather than guessed. See{" "}
            <a href="/docs/costs">Costs & usage</a>.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
