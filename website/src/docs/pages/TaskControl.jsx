import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "surface", label: "The control surface" },
  { id: "list", label: "Read the task tree" },
  { id: "states", label: "States and transitions" },
  { id: "inspect", label: "Status vs result" },
  { id: "cancel", label: "Cancel and resume" },
  { id: "message", label: "Message a worker" },
  { id: "permission", label: "Resolve permission blocks" },
  { id: "dependencies", label: "Dependencies and retries" },
  { id: "workspace", label: "Integrate and clean up" },
  { id: "recovery", label: "Recovery playbooks" },
  { id: "limits", label: "Limits and caveats" },
];

const COMMANDS = [
  ["/tasks", "List every task in this session as a parent/child tree."],
  ["/task <id>", "Alias for status."],
  ["/task <id> status", "Print the complete current task record."],
  ["/task <id> result", "Print the terminal result envelope, or report that none exists."],
  ["/task <id> cancel", "Cancel queued, blocked, retrying, or running work."],
  ["/task <id> resume", "Requeue a blocked or eligible failed/cancelled/timed-out task."],
  ["/task <id> message <text>", "Deliver user text to that worker's mailbox."],
  ["/task <id> message allow <tool>", "Answer one matching pending permission request."],
  ["/task <id> message deny <tool>", "Return a denial for one matching pending permission request."],
  ["/task <id> integrate", "Apply a registered Git-worktree patch to the parent checkout."],
  ["/task <id> cleanup", "Remove an integrated, unchanged, safe worker worktree."],
];

const STATES = [
  ["queued", "Eligible for scheduling, or waiting for a concurrency permit.", "running, blocked, cancelled"],
  ["running", "One attempt is executing with a deadline and cancellation signal.", "done, failed, blocked, cancelled, timed_out"],
  ["blocked", "Stopped for dependencies, permission, missing runner, or an explicit block.", "queued, failed, cancelled"],
  ["done", "Successful terminal result accepted.", "none"],
  ["failed", "Terminal failure after retries or a non-retryable error.", "queued by eligible explicit resume"],
  ["cancelled", "Coordinator cancellation settled the task.", "queued by eligible explicit resume"],
  ["timed_out", "The attempt exceeded its deadline.", "queued by eligible explicit resume"],
];

const STATUS_FIELDS = [
  ["identity", "taskId, sessionId, parentTaskId, type, mode, contextMode, depth."],
  ["graph", "dependencies and dependents."],
  ["lifecycle", "state, timestamps, deadline, attempt, retry and timeout limits."],
  ["capabilities", "permissionProfile, allowedTools, delegation, depth/fan-out and resource budgets."],
  ["diagnosis", "error or blockReason, plus provider metrics when available."],
  ["workspace", "Path, project root, isolation, base revision, integration and preservation flags."],
  ["output", "Artifact references and a terminal result only after settlement."],
];

export default function TaskControl() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Agents</span><span className="sep">/</span><span className="current">Task control</span>
        </nav>

        <div className="hero">
          <h1>Inspect and control tasks</h1>
          <p className="tagline">
            Follow the session task graph, intervene in a running worker, answer permission requests, recover
            stopped attempts, and land isolated work without guessing what state the runtime is in.
          </p>
        </div>

        <section id="surface">
          <h2><span className="anchor">#</span>The control surface</h2>
          <p>
            A task is the runtime record around delegated work. The worker is the agent loop; the task carries
            its state, graph position, attempt count, limits, mailbox, workspace, metrics, and terminal result.
            The commands below operate on that record inside the current session.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "40%" }}>Command</th><th>Effect</th></tr></thead>
            <tbody>{COMMANDS.map(([command, effect]) => <tr key={command}><td><code className="inline">{command}</code></td><td>{effect}</td></tr>)}</tbody>
          </table></div>
          <Note>
            Task IDs are session-local. A valid ID copied from another session returns
            <code className="inline">TASK_NOT_FOUND</code> here, even if both sessions use the same project.
          </Note>
        </section>

        <section id="list">
          <h2><span className="anchor">#</span>Read the task tree</h2>
          <p>
            <code className="inline">/tasks</code> prints one line per record. Children are indented beneath
            their parent. Each line contains the full task ID, state, current attempt over maximum failure
            attempts, optional workspace isolation, then the current error or block reason.
          </p>
          <CodeBlock lang="text">{`> /tasks
6f2a7c1e  running  attempt 1/2 · readonly-shared
9bd14370  blocked  attempt 0/2 · Waiting for dependencies: 6f2a7c1e
aa83d5c2  done  attempt 1/2 · git-worktree
  c5e09144  failed  attempt 2/2 · TASK_FAILED: verification failed`}</CodeBlock>
          <p>
            The tree is an operational summary, not a transcript. It does not include the task prompt, elapsed
            duration, token total, result body, or mailbox contents. Use <code className="inline">status</code>
            for the record and the Activity panel for live worker conversation.
          </p>
        </section>

        <section id="states">
          <h2><span className="anchor">#</span>States and transitions</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "15%" }}>State</th><th>Meaning</th><th style={{ width: "30%" }}>Next states</th></tr></thead>
            <tbody>{STATES.map(([state, meaning, next]) => <tr key={state}><td><code className="inline">{state}</code></td><td>{meaning}</td><td>{next}</td></tr>)}</tbody>
          </table></div>
          <p>
            <code className="inline">done</code>, <code className="inline">failed</code>,
            <code className="inline">cancelled</code>, and <code className="inline">timed_out</code> are terminal
            because they carry a settled result envelope. The latter three may be requeued explicitly when the
            attempt budget permits; <code className="inline">done</code> never reopens.
          </p>
          <p>
            <code className="inline">blocked</code> is not terminal and has no result envelope. It preserves a
            reason and waits for a dependency, runner, answer, grant, or explicit resume.
          </p>
        </section>

        <section id="inspect">
          <h2><span className="anchor">#</span>Status vs result</h2>
          <p>
            Status is always available and returns the complete versioned record. It is the right first command
            for a task that is not moving.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "24%" }}>Record area</th><th>What to inspect</th></tr></thead>
            <tbody>{STATUS_FIELDS.map(([area, value]) => <tr key={area}><td><code className="inline">{area}</code></td><td>{value}</td></tr>)}</tbody>
          </table></div>
          <CodeBlock lang="bash">{`/task 9bd14370 status
/task 9bd14370 result`}</CodeBlock>
          <p>
            Result returns only the terminal envelope: status, value or partial output, artifact references,
            metrics, typed error, raw output when supplied, and completion time. Before settlement it returns
            <code className="inline">Task 9bd14370 has no result.</code>. A blocked task can have valuable
            progress in its live transcript or workspace even though result is empty.
          </p>
          <Note>
            Status and result are raw JSON views. They can contain prompts, absolute paths, errors, model output,
            or repository details. Review before sharing them outside the project.
          </Note>
        </section>

        <section id="cancel">
          <h2><span className="anchor">#</span>Cancel and resume</h2>
          <p>
            Cancel aborts the active attempt, clears a pending retry timer, settles a cancellation envelope, and
            notifies dependents. Cancelling an already-cancelled task is harmless. Cancelling a different terminal
            state reports that it is already terminal.
          </p>
          <CodeBlock lang="text">{`> /task 6f2a7c1e cancel
Task 6f2a7c1e cancelled.

> /task 6f2a7c1e resume
Task 6f2a7c1e queued for resume.`}</CodeBlock>
          <p>
            Cancellation requests immediate stop, but the scheduler keeps that concurrency permit until the
            underlying runner actually quiesces. A process that is slow to honor cancellation can therefore delay
            the next queued task without changing the cancelled state you see.
          </p>
          <p>
            Resume always works from a resolvable block. From failed, cancelled, or timed-out states, it works only
            while another attempt remains. It clears the old terminal result and error, creates a new completion
            wait, and rechecks dependencies. If the cause still exists, the task can block or fail again.
          </p>
        </section>

        <section id="message">
          <h2><span className="anchor">#</span>Message a worker</h2>
          <p>
            Ordinary message text is stored as a structured <code className="inline">question</code> addressed
            to the task. A running sub-agent drains pending questions before each model call. The message becomes
            a user-role input in that worker's conversation and is then acknowledged.
          </p>
          <CodeBlock lang="text">{`> /task 6f2a7c1e message Do not edit the generated manifest. Verify it only.
Message 13dc9b6d-... sent to task 6f2a7c1e.`}</CodeBlock>
          <p>
            A message is steering, not a replacement task and not a privilege grant. It cannot widen the worker's
            profile, tool allowlist, workspace, budget, or mode. If the worker is blocked, the message remains
            pending until you resolve the block and resume it.
          </p>
          <p>
            The command also accepts terminal task IDs, but no finished worker remains to drain that mailbox.
            Check status first; do not mistake “message sent” for “message consumed.”
          </p>
        </section>

        <section id="permission">
          <h2><span className="anchor">#</span>Resolve permission blocks</h2>
          <p>
            When a worker's declarative permission result is <code className="inline">ask</code>, it sends a
            permission request to the coordinator, blocks the task, and stops the current attempt. The request is
            bound to the exact tool name and arguments.
          </p>
          <CodeBlock lang="text">{`> /task 6f2a7c1e status
... "state": "blocked",
... "blockReason": "Tool 'write_file' requires coordinator permission"

> /task 6f2a7c1e message allow write_file
Message 92b48b10-... sent to task 6f2a7c1e.

> /task 6f2a7c1e resume
Task 6f2a7c1e queued for resume.`}</CodeBlock>
          <p>
            Use the canonical internal tool name and answer only a request you recognize. The worker verifies the
            grant against the pending request, task identity, sender, tool, and deep-equal arguments. A stale or
            mismatched grant does not authorize a different call.
          </p>
          <p>
            Denial uses the same two-step flow. Send <code className="inline">deny &lt;tool&gt;</code>, then resume.
            The restarted worker receives a denied result for the matching call and may choose a lower-privilege
            route. No pending request produces an explicit error instead of a free-standing grant.
          </p>
          <Note>
            Worker risk checks are separate. A high- or medium-risk worker operation can be refused after ordinary
            permission resolution; a mailbox allow does not override the risk floor.
          </Note>
        </section>

        <section id="dependencies">
          <h2><span className="anchor">#</span>Dependencies and retries</h2>
          <p>
            A task with unfinished dependencies blocks before execution. When every dependency reaches
            <code className="inline">done</code>, it returns to the queue automatically. If one fails, is
            cancelled, or times out, the dependent follows its configured policy: remain blocked, fail, or cancel.
          </p>
          <p>
            Retriable execution failures use bounded exponential backoff. The default is one retry after the first
            attempt. The task is shown as queued during backoff and remains cancellable. Permission blocking is not
            a failed retry: repeated block/resume cycles can make the displayed attempt exceed the failure-attempt
            denominator because each resume starts a fresh runner attempt.
          </p>
          <p>
            A manual resume does not repair a failed dependency. Inspect the dependency first; otherwise dependency
            evaluation immediately blocks the task again.
          </p>
        </section>

        <section id="workspace">
          <h2><span className="anchor">#</span>Integrate and clean up</h2>
          <p>
            Writer workers prefer detached Git worktrees. A completed task does not automatically apply that work
            to your checkout. Inspect the task result and diff, then integrate deliberately.
          </p>
          <CodeBlock lang="bash">{`/task aa83d5c2 result
/task aa83d5c2 integrate
git diff --check
/task aa83d5c2 cleanup`}</CodeBlock>
          <p>
            Integration captures tracked and untracked changes as a binary-capable patch. It refuses protected or
            sensitive paths, overlap with local parent changes, or a patch that does not apply cleanly. Serialized
            writers already operate in the parent checkout; read-only tasks have nothing to integrate.
          </p>
          <p>
            Cleanup removes only a registered Git worktree whose patch was integrated, whose current patch hash
            still matches, and which contains no ignored files. Any doubt preserves the workspace. A “workspace
            was preserved” response is a safety decision, not a cleanup failure to bypass with deletion.
          </p>
        </section>

        <section id="recovery">
          <h2><span className="anchor">#</span>Recovery playbooks</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "30%" }}>Situation</th><th>Safe sequence</th></tr></thead>
            <tbody>
              <tr><td>Permission block</td><td>Inspect status and the request, send allow or deny for the exact tool, then resume.</td></tr>
              <tr><td>Dependency block</td><td>Inspect the named dependency and its result; repair or rerun it before resuming the dependent.</td></tr>
              <tr><td>Timeout</td><td>Read partial output, narrow the task or raise its configured timeout, then resume only if an attempt remains.</td></tr>
              <tr><td>Cancelled by mistake</td><td>Confirm the workspace is intact, then resume if the attempt budget allows.</td></tr>
              <tr><td>Integration conflict</td><td>Preserve both sides, inspect overlapping paths, resolve in the parent checkout, and integrate again only when clean.</td></tr>
              <tr><td>Interrupted restore</td><td>A formerly running task restores as failed with <code className="inline">INTERRUPTED</code>; it also needs a runner reattached before useful resume.</td></tr>
            </tbody>
          </table></div>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and caveats</h2>
          <p>
            The default session limits are five concurrent tasks, seventeen total tasks, depth two, fan-out five,
            one retry, and a 120-second timeout. Settings can change them within runtime bounds. Token and cost
            budgets are enforced only when the provider reports the corresponding usage; unavailable cost data
            remains explicitly unavailable rather than guessed.
          </p>
          <p>
            Task snapshots preserve records, messages, and workspace references only for sessions configured with
            snapshot persistence. Restore validates session and project identity. It cannot resurrect an executing
            process: running work becomes <code className="inline">INTERRUPTED</code>, and queued work without a
            reattached runner blocks.
          </p>
          <p>
            See <a href="/docs/agent-messaging">Agent messaging</a>, <a href="/docs/parallel-tasks">Parallel
            tasks</a>, and <a href="/docs/worktrees">Worktrees</a> for the surrounding runtime.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
