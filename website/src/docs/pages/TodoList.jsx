import { Note, Toc } from "../Layout";

const TOC = [
  { id: "purpose", label: "Purpose" },
  { id: "states", label: "States and display" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "modes", label: "Mode behavior" },
  { id: "todo-vs-task", label: "Todo vs task vs goal" },
  { id: "limits", label: "Limits" },
];

const STATES = [
  ["○", "pending", "Known work that has not started."],
  ["◉", "in_progress", "The item currently being worked."],
  ["●", "done", "Completed work; rendered dimmer in the panel."],
];

export default function TodoList() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Concepts</span><span className="sep">/</span><span className="current">Todo list</span>
        </nav>
        <div className="hero">
          <h1>The visible todo list</h1>
          <p className="tagline">A lightweight, in-memory checklist the agent can keep synchronized with multi-step foreground work.</p>
        </div>

        <section id="purpose">
          <h2><span className="anchor">#</span>Purpose</h2>
          <p>
            For a task with several meaningful steps, the agent can add short todo items and update their
            status as work progresses. The terminal renders them in a bordered panel so progress is visible
            without asking for a status message.
          </p>
          <p>
            Todos are coordination hints, not proof. An item marked done should correspond to actual changes
            and verification, but the checklist itself does not run checks or enforce completion criteria.
          </p>
        </section>

        <section id="states">
          <h2><span className="anchor">#</span>States and display</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th>Icon</th><th>Status</th><th>Meaning</th></tr></thead>
            <tbody>{STATES.map(([icon, status, meaning]) => <tr key={status}><td>{icon}</td><td><code className="inline">{status}</code></td><td>{meaning}</td></tr>)}</tbody>
          </table></div>
          <p>
            New items begin pending and receive an opaque identifier used for later updates. The list keeps
            insertion order; completed items remain visible until the whole list is cleared.
          </p>
        </section>

        <section id="lifecycle">
          <h2><span className="anchor">#</span>Lifecycle</h2>
          <p>
            The agent can add an item, change an existing item's status, list the current state, or clear the
            list. Updating an unknown identifier fails explicitly. Clearing removes every item at once—there
            is no single-item delete operation.
          </p>
          <Note>
            Todos live only in memory. They are not saved in session exports, restored after restart, shared
            with background tasks, or committed to the repository.
          </Note>
        </section>

        <section id="modes">
          <h2><span className="anchor">#</span>Mode behavior</h2>
          <p>
            Build and Auto modes can manage the list. Review and Plan modes may list existing todos but
            cannot add, update, or clear them. This preserves their read-only contract even though viewing
            progress is harmless.
          </p>
        </section>

        <section id="todo-vs-task">
          <h2><span className="anchor">#</span>Todo vs task vs goal</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th>Primitive</th><th>Use it for</th><th>Durability and execution</th></tr></thead>
            <tbody>
              <tr><td>Todo</td><td>Visible steps inside one foreground effort.</td><td>In memory; no independent runner.</td></tr>
              <tr><td>Task</td><td>Delegated work with state, result, limits, messages, and optional workspace.</td><td>Managed by the orchestrator; may run concurrently.</td></tr>
              <tr><td>Goal</td><td>An explicit objective spanning continuation turns and budgets.</td><td>Saved with the session; controls continuation lifecycle.</td></tr>
            </tbody>
          </table></div>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits</h2>
          <p>
            There is no persisted maximum, hierarchy, dependency graph, owner, deadline, or verification
            field. Keep the list short and outcome-oriented. Use <a href="/docs/agent-teams">orchestrated
            tasks</a> when work needs dependencies or isolation, and <a href="/docs/goals">goals</a> when it
            must survive multiple automatic turns.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
