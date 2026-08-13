import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "Tasks, workflows, sub-agents" },
  { id: "commands", label: "The /task interface" },
  { id: "states", label: "Task states" },
  { id: "dag", label: "The dependency DAG" },
  { id: "policies", label: "Failure & cancellation policies" },
  { id: "scheduling", label: "Scheduling & concurrency" },
  { id: "attempts", label: "Attempts, timeouts & retries" },
  { id: "envelope", label: "The result envelope" },
  { id: "record", label: "Inspecting a task record" },
  { id: "patterns", label: "Patterns that work" },
];

const CONFUSION = [
  ["Task", "A unit of orchestrated work with a state, a workspace and a result envelope.", "/task, /tasks"],
  ["Sub-agent", "An agent loop that runs as a task. Most tasks are sub-agents; a task is the record.", "subagent tool, /agent"],
  ["Workflow", "A declarative script that coordinates steps, which may themselves spawn tasks.", "/workflow, /workflows"],
];

const COMMANDS = [
  ["/tasks", "Render a snapshot of the current session task tree."],
  ["/task <id> status", "The complete record: timestamps, attempts, errors, usage, workspace, artifacts."],
  ["/task <id> result", "The typed result envelope."],
  ["/task <id> cancel", "Cancel the attempt. Idempotent."],
  ["/task <id> resume", "Requeue from a recoverable terminal state."],
  ["/task <id> message <text>", "Send a message to the worker. Also allow <tool> / deny <tool>."],
  ["/task <id> integrate", "Apply the worker's patch back into the project."],
  ["/task <id> cleanup", "Remove the worktree, once it is safe to do so."],
];

const STATES = [
  ["queued", "Ready to run, waiting for a concurrency permit.", "running, blocked, cancelled"],
  ["blocked", "Waiting on dependencies, or stopped on a permission request.", "queued, failed, cancelled"],
  ["running", "An attempt is in flight with its own AbortController and deadline.", "done, failed, blocked, cancelled, timed_out"],
  ["done", "Settled successfully. Immutable.", "— none —"],
  ["failed", "Settled with a typed error. Partial output is retained.", "queued (resume or bounded retry)"],
  ["cancelled", "Aborted by the coordinator.", "queued (explicit resume)"],
  ["timed_out", "Exceeded its deadline. Distinct from cancelled.", "queued (explicit resume)"],
];

const POLICIES = [
  ["block", "Dependents stay blocked. The default — nothing proceeds on a broken premise, nothing is destroyed."],
  ["fail", "Dependents fail immediately. Use when downstream work is pointless without the dependency."],
  ["cancel", "Dependents are cancelled. Use when you intend to resume the whole branch after a fix."],
];

const ENVELOPE = [
  ["taskId, sessionId", "Identity of the task that produced this envelope."],
  ["status", "The terminal status it settled into."],
  ["value", "The typed result, validated against the task's output schema."],
  ["partial", "Whatever setPartial recorded before a failure. Retained in failure envelopes."],
  ["artifacts", "References to produced artifacts."],
  ["metrics", "Provider usage, when the provider reported it."],
  ["rawOutput", "Raw diagnostic output, preserved even when validation failed."],
  ["error", "A typed TaskErrorV1 when the task did not succeed."],
  ["completedAt", "Completion timestamp."],
];

const PATTERNS = [
  ["Fan out reads, not writes", "Readers share the project safely. Parallel writers each need a worktree — cheap, but not free."],
  ["Depend on facts, not on order", "Add a dependency because B needs A's output, not because you want B to run second."],
  ["Background for anything slow", "Foreground blocks your session. Background returns a handle you can check later."],
  ["Keep task descriptions self-contained", "A fresh worker has no conversation. Everything it needs must be in the task."],
  ["Integrate early", "An unintegrated worktree holds a lease and blocks cleanup. Land work as it completes."],
];

export default function ParallelTasks() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Parallel tasks</span>
        </nav>

        <div className="hero">
          <h1>Parallel tasks</h1>
          <p className="tagline">
            Spawn work that runs alongside your session, wire dependencies into a DAG, and settle every task
            into exactly one terminal state.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>Tasks, workflows, sub-agents</h2>
          <p>
            Three words get used interchangeably and should not be:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Term</th><th style={{ width: "50%" }}>What it is</th><th>Interface</th></tr>
              </thead>
              <tbody>
                {CONFUSION.map(([t, w, i]) => (
                  <tr key={t}>
                    <td><b style={{ color: "var(--text-strong)" }}>{t}</b></td>
                    <td>{w}</td>
                    <td><code className="inline">{i}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The useful framing: a <b>task is the accounting record</b>. It has an id, a state, a deadline, a
            workspace, a permission profile and a result envelope. A sub-agent is one kind of thing that can
            occupy that record. This page is about the record and the machinery around it — see{" "}
            <a href="/docs/subagents">Sub-agents</a> for what runs inside, and{" "}
            <a href="/docs/agent-teams">Agent teams</a> for the runtime guarantees.
          </p>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>The /task interface</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Command</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {COMMANDS.map(([c, e]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="text">{`> /tasks
t-4f21  running  attempt 1/2 · git-worktree
t-91ac  blocked  attempt 0/2 · Waiting for dependencies: t-4f21
t-08de  done  attempt 1/2 · readonly-shared`}</CodeBlock>
          <p>
            The compact view shows task id, state, current attempt over maximum attempts, optional workspace
            isolation, and an error or block reason. It does not include the task description or elapsed
            duration; use <code className="inline">/task &lt;id&gt; status</code> for the full JSON record.
          </p>
          <p>
            Background tasks return a versioned handle immediately — schema version, session id, task id and
            state — rather than an untracked acknowledgement. That handle is what makes a task addressable
            later, which is the whole point of tracking them as records.
          </p>
        </section>

        <section id="states">
          <h2><span className="anchor">#</span>Task states</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "14%" }}>State</th><th style={{ width: "44%" }}>Meaning</th><th>Can transition to</th></tr>
              </thead>
              <tbody>
                {STATES.map(([s, m, t]) => (
                  <tr key={s}>
                    <td><code className="inline">{s}</code></td>
                    <td>{m}</td>
                    <td><code className="inline">{t}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">done</code> has no outgoing transitions. This is the invariant that makes
            results trustworthy: once a task reports success, nothing can rewrite it — not a late callback,
            not a retry, not a resume.
          </p>
          <p>
            <code className="inline">timed_out</code> and <code className="inline">cancelled</code> are kept
            distinct even though both stop a running attempt. They mean different things operationally: a
            timeout suggests the work was too large or the deadline too tight, a cancellation was a decision.
            Collapsing them would erase the signal.
          </p>
          <Note>
            A terminal attempt settles <b>once</b>. A second completion arriving late — from a runner that did
            not notice its abort — is rejected rather than applied.
          </Note>
        </section>

        <section id="dag">
          <h2><span className="anchor">#</span>The dependency DAG</h2>
          <p>
            Dependencies are task ids within the same session. Spawning validates that every dependency
            exists before the task is inserted, so you cannot create a task that waits on something that was
            never created.
          </p>
          <CodeBlock lang="json">{`{
  "task": "write the migration guide from the inventory",
  "dependencies": ["t-08de"],
  "mode": "background"
}`}</CodeBlock>
          <p>
            A task with unfinished dependencies enters <code className="inline">blocked</code>. When all of them
            complete it returns to <code className="inline">queued</code> and waits for a permit like anything
            else.
          </p>
          <p>
            <code className="inline">addDependency</code> rejects three things outright: self-dependencies,
            cycles, and any modification to a task that is already running or terminal. The cycle check runs{" "}
            <b>before</b> mutation — a rejected edge leaves the graph exactly as it was, rather than requiring
            a rollback.
          </p>
          <p>
            Inspection distinguishes five situations, which matters when a task is not progressing: ready,
            blocked by unfinished dependencies, blocked by an <em>impossible</em> dependency, running, or
            terminal. The third is the one worth catching early — a dependency that failed under a{" "}
            <code className="inline">block</code> policy will never complete, so its dependents will wait forever
            unless you intervene.
          </p>
        </section>

        <section id="policies">
          <h2><span className="anchor">#</span>Failure & cancellation policies</h2>
          <p>
            When a dependency fails, its dependents follow a configured policy:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Policy</th><th>Behavior</th></tr>
              </thead>
              <tbody>
                {POLICIES.map(([p, b]) => (
                  <tr key={p}>
                    <td><code className="inline">{p}</code></td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Parent cancellation is separately configurable as{" "}
            <code className="inline">cascade</code> — children are cancelled too — or{" "}
            <code className="inline">detach</code>, where children keep running independently. Detach is right
            when a parent was only a dispatcher; cascade is right when the children's work is meaningless
            without it.
          </p>
        </section>

        <section id="scheduling">
          <h2><span className="anchor">#</span>Scheduling & concurrency</h2>
          <p>
            The ready queue is <b>FIFO</b>, bounded by the session concurrency limit (default 5). There is no
            priority system, and that is a deliberate simplification: priorities require a policy for
            starvation, and FIFO with explicit dependencies expresses ordering more honestly than a priority
            number would.
          </p>
          <p>
            Limits are per session, not global. Two sessions each run up to their own concurrency; they do
            not contend for a shared pool, because they share no state at all.
          </p>
          <p>
            The permit-release rule from <a href="/docs/agent-teams#invariants">the invariants</a> shows up
            here as observable behavior: after cancelling a task you may briefly see fewer tasks start than
            the limit allows. The permit is still held by the aborting runner and is only released once that
            runner is genuinely finished.
          </p>
        </section>

        <section id="attempts">
          <h2><span className="anchor">#</span>Attempts, timeouts & retries</h2>
          <p>
            Each attempt gets its own <code className="inline">AbortController</code>, its own deadline, and its
            own <code className="inline">TaskRunContext</code>. Nothing is shared between attempt one and attempt
            two, which is what makes a retry a genuine retry rather than a resumption of damaged state.
          </p>
          <p>
            A deadline breach aborts with <code className="inline">TIMED_OUT</code>. A coordinator cancellation
            aborts with <code className="inline">CANCELLED</code>. Both preserve whatever the runner recorded
            through <code className="inline">setPartial</code> — partial output is carried in the failure
            envelope rather than discarded, so a task that got 80% of the way through is not a total loss.
          </p>
          <p>
            Retriable errors use <b>bounded exponential backoff</b>, and the task remains cancellable while
            it waits. Waiting for a retry is not a state that traps you.
          </p>
          <CodeBlock lang="bash">{`> /task t-4f21 status
state      failed
error      TIMED_OUT (attempt 2 of 2)
partial    "audited 14 of 22 files; findings recorded for 14"
workspace  .deepseek/worktrees/keen-hawk  (preserved)`}</CodeBlock>
        </section>

        <section id="envelope">
          <h2><span className="anchor">#</span>The result envelope</h2>
          <p>
            Every task settles into a <code className="inline">TaskResultEnvelopeV1</code>, validated before it
            is accepted:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Field</th><th>Contents</th></tr>
              </thead>
              <tbody>
                {ENVELOPE.map(([f, c]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Sub-agent workers terminate through a private{" "}
            <code className="inline">submit_result</code> tool whose default schema requires summary,
            confidence, files read and changed, findings, suggestions and metadata. The terminal call must be
            the <b>only</b> terminal effect and must pass Ajv validation.
          </p>
          <p>
            Missing, repeated, mixed, or invalid terminal calls get exactly <b>one correction attempt</b>,
            then fail as <code className="inline">INVALID_RESULT</code> — with the raw content preserved so you
            can see what the worker actually said. One retry is enough to fix a formatting slip and few
            enough that a worker cannot loop indefinitely trying to guess the schema.
          </p>
          <Note>
            Invalid structured output never produces success. This is the fail-closed rule: an unparseable
            result is a failure, not an ambiguous pass.
          </Note>
        </section>

        <section id="record">
          <h2><span className="anchor">#</span>Inspecting a task record</h2>
          <p>
            <code className="inline">TaskRecordV1</code> is the full picture: session and parent identity, type,
            foreground/background mode, fresh/fork context mode, state, graph edges, timestamps, attempt
            count and timeout, delegation limits, permission profile, workspace, artifact references,
            result or error or block reason, provider metrics, and metadata.
          </p>
          <p>
            <code className="inline">/task &lt;id&gt; status</code> renders that record. When something is stuck,
            read it in this order: <b>state</b> tells you the category,{" "}
            <b>block reason</b> or <b>error</b> tells you the cause, <b>attempts</b> tells you whether retries
            were spent, and <b>workspace</b> tells you whether there is work sitting in a worktree waiting to
            be integrated.
          </p>
        </section>

        <section id="patterns">
          <h2><span className="anchor">#</span>Patterns that work</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Pattern</th><th>Why</th></tr>
              </thead>
              <tbody>
                {PATTERNS.map(([p, w]) => (
                  <tr key={p}>
                    <td><b style={{ color: "var(--text-strong)" }}>{p}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The strongest of these is the third. A foreground task blocks your session for its entire
            duration, which converts parallel machinery into a slower version of doing it yourself. Reserve
            foreground for work whose answer you need before you can write the next sentence.
          </p>
          <p>
            Related: <a href="/docs/agent-messaging">Agent messaging</a> for coordinating with a running
            worker, <a href="/docs/code-review">Multi-agent review</a> for the built-in fan-out, and{" "}
            <a href="/docs/workflows">Workflows</a> for scripting the whole shape deterministically.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
