import { Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "contents", label: "What appears" },
  { id: "rows", label: "Read activity rows" },
  { id: "open", label: "Open & navigate" },
  { id: "agent-chat", label: "Subagent chat" },
  { id: "details", label: "Agent details" },
  { id: "controls", label: "Stop, pause & resume" },
  { id: "lifecycle", label: "Lifecycle & retention" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const CONTENTS = [
  ["Standalone subagent", "Every standalone entry currently retained by the session, including recently finished entries."],
  ["Workflow", "A workflow whose run status is queued, running or paused."],
  ["Workflow child agent", "Grouped into its workflow progress and excluded as a separate top-level row."],
  ["Main agent", "A permanent navigation row, labeled with the active main-agent identity when available."],
];

const CONTROLS = [
  ["↑ / ↓", "Move the selection. Down wraps from the last activity to main; Up from main closes the panel."],
  ["Enter on main", "Return input focus to the main agent and close the panel."],
  ["Enter on an agent", "Open that subagent's live conversation and route ordinary input to it."],
  ["Enter on a workflow", "Open the dedicated workflow monitor for that run."],
  ["v on an agent", "Open the compact metadata detail view."],
  ["x", "Cancel the selected active agent, or stop the selected queued, running or paused workflow."],
  ["p", "Pause the selected workflow when its status is running."],
  ["r", "Resume a selected paused workflow or blocked, failed, error, cancelled or timed-out agent."],
  ["Esc", "Leave detail view first; from the activity list, close the panel."],
];

const DETAIL_FIELDS = [
  ["Identity", "Display name, fixed or temporary classification, status and execution mode when available."],
  ["Task", "The instruction or task label assigned to the agent."],
  ["Work metrics", "Role, elapsed or final duration, tool-call count and token count when reported."],
  ["Latest activity", "The most recent tool or progress description."],
  ["Execution", "Model and workspace when the subagent runtime supplied them."],
  ["Outcome", "Result or error text after the task resolves."],
];

export default function ActivityPanel() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Activity panel</span>
        </nav>

        <div className="hero">
          <h1>Activity panel</h1>
          <p className="tagline">
            Inspect concurrent subagents and workflows, enter an agent conversation, and control background work from the bottom of the TUI.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Overview</h2>
          <p>
            The Activity panel is a live footer beneath the input area. It unifies standalone subagents and active
            workflows into one chronological list, with the oldest start time first. A persistent main-agent row makes
            the panel both a monitor and a focus switcher.
          </p>
          <p>
            When closed, it is still a passive summary: main plus as many as five activity rows. Opening it adds a
            selection cursor, contextual action hints and a scroll window of up to eight activities. An overflow line
            reports entries that remain after the visible slice.
          </p>
          <Note>
            The panel appears only when there is activity to display. Its counter also appears in the{" "}
            <a href="/docs/status-bar">status bar</a>, even if normal status items have been disabled.
          </Note>
        </section>

        <section id="contents">
          <h2><span className="anchor">#</span>What appears in the panel</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Entry</th><th>Inclusion rule</th></tr></thead>
              <tbody>
                {CONTENTS.map(([entry, rule]) => <tr key={entry}><td><b>{entry}</b></td><td>{rule}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Queued, running and blocked agents count as active. Other retained standalone agents render as idle rows.
            Workflow progress includes its child agents internally, but those children do not also appear as standalone
            activities. This prevents one workflow from flooding the footer with duplicate top-level entries.
          </p>
          <p>
            Queued, running and paused workflows appear here. Completed, failed, cancelled, timed-out and
            budget-exhausted workflow runs belong in the workflow history or monitor rather than this active footer.
          </p>
        </section>

        <section id="rows">
          <h2><span className="anchor">#</span>Read activity rows</h2>
          <p>
            A subagent row starts with its resolved display name and a shortened task description. Active agents append
            elapsed time and, once known, their token count. Resolved agents display <code className="inline">idle</code>
            instead of continuously increasing elapsed time.
          </p>
          <p>
            A workflow row shows its workflow name and description, then completed-agent progress such as{" "}
            <code className="inline">2/5 agents done</code>, elapsed time and total workflow tokens when reported. A child
            is considered done for this summary whenever it is no longer queued, running or blocked.
          </p>
          <p>
            At fewer than 55 content columns, the formatter keeps only the identity and first metric. At wider sizes it
            allocates the remaining space to the description. Long labels, descriptions and metrics are truncated with
            an ellipsis so a row never spills beyond the terminal width.
          </p>
        </section>

        <section id="open">
          <h2><span className="anchor">#</span>Open and navigate</h2>
          <p>
            Place the input cursor on an empty prompt, close any command or file dropdown, then press Down (or Left).
            The panel opens with the main row selected. Press Down to enter the activity list; continue pressing Down to move
            through entries and wrap back to main. Pressing Up while main is selected closes the panel immediately.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "24%" }}>Key</th><th>Action</th></tr></thead>
              <tbody>
                {CONTROLS.map(([key, action]) => (
                  <tr key={key}><td><code className="inline">{key}</code></td><td>{action}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The selected row uses a filled marker and leading cursor. The hint line at the bottom changes with the
            selected entry, exposing only actions valid for that status. Feedback from asynchronous stop, pause or
            resume requests replaces the hint until you move on or close the panel.
          </p>
        </section>

        <section id="agent-chat">
          <h2><span className="anchor">#</span>Enter a subagent conversation</h2>
          <p>
            Select an agent and press Enter to close the panel and focus its conversation. The prompt label changes to
            the subagent identity, and ordinary text is delivered to that agent&apos;s mailbox. This is useful for asking
            for clarification or supplying additional context while the task is running.
          </p>
          <p>
            Slash commands and <code className="inline">!</code> shell lines are main-agent operations. Submitting either
            while focused on a subagent leaves subagent focus first, then routes the input through the normal main-agent
            command path. To return without sending a command, reopen Activity and press Enter on main.
          </p>
          <Note>
            A message sent to an agent that is no longer executing can remain unread in its mailbox until that agent is
            resumed. Check the row status before treating a delivered message as an immediate interaction.
          </Note>
        </section>

        <section id="details">
          <h2><span className="anchor">#</span>Inspect agent details</h2>
          <p>
            With an agent selected, press <code className="inline">v</code> for a compact detail page. This view is
            intentionally different from Enter: details summarize execution metadata; Enter opens the live conversation.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "24%" }}>Line</th><th>Information</th></tr></thead>
              <tbody>
                {DETAIL_FIELDS.map(([field, detail]) => <tr key={field}><td><b>{field}</b></td><td>{detail}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Every detail line is width-constrained. Very long tasks, workspace paths, results and errors can therefore
            be abbreviated in this footer view. Use the subagent chat or workflow monitor when you need the full context.
            Press Esc to return from details to the open activity list.
          </p>
        </section>

        <section id="controls">
          <h2><span className="anchor">#</span>Stop, pause and resume work</h2>
          <p>
            Press <code className="inline">x</code> on a queued, running or blocked standalone agent to request
            cancellation. On a queued, running or paused workflow, the same key requests that the workflow stop. These are
            control requests: the row may remain active briefly while the runtime acknowledges and propagates the state.
          </p>
          <p>
            Press <code className="inline">p</code> to pause a workflow only while it is running. A paused workflow
            remains visible and controllable in this footer: press <code className="inline">x</code> to stop it or{" "}
            <code className="inline">r</code> to resume it. You can also enter its dedicated workflow monitor.
            Press <code className="inline">r</code> to resume a standalone agent in blocked, failed, error, cancelled
            or timed-out state. Resume is not offered for an agent that completed normally.
          </p>
          <Note>
            DeepSeek Code reports the runtime&apos;s response in the hint line. A control request can fail when the selected
            task changed status between rendering the row and handling the key; refresh the panel and check the new state.
          </Note>
        </section>

        <section id="lifecycle">
          <h2><span className="anchor">#</span>Lifecycle and retention</h2>
          <p>
            Live subagent events mutate row status, elapsed duration, tool count, latest activity, tokens and outcomes.
            The footer&apos;s clock continuously refreshes elapsed time for active entries. Items are sorted by original
            start time, so status changes do not reorder the list.
          </p>
          <p>
            At the start of the next main-agent turn, resolved standalone agents are cleared while queued, running and
            blocked standalone agents remain. Agents belonging to a workflow are preserved for workflow monitoring.
            Consequently, a finished standalone row can remain visible while you inspect it, then disappear when you
            send the next main-agent request.
          </p>
          <p>
            If the activity list becomes empty while open, the panel closes automatically and returns keyboard handling
            to the input editor. Closing the panel does not stop, pause or delete any task.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <h3>Down or Left moves through input history instead of opening Activity</h3>
          <p>
            Clear the prompt and close any slash-command or file-completion dropdown. Activity must also contain at least
            one retained standalone agent or queued, running or paused workflow before the empty-prompt shortcut is enabled.
          </p>
          <h3>A workflow disappeared after it finished</h3>
          <p>
            That is expected: this footer includes queued, running and paused workflows, but removes terminal runs.
            Open the workflow history or its monitor to inspect a completed, failed, cancelled, timed-out or
            budget-exhausted run.
          </p>
          <h3>An agent is marked idle</h3>
          <p>
            Idle means the retained agent is no longer in queued, running or blocked state. Select it and press{" "}
            <code className="inline">v</code> to inspect the result or error; use <code className="inline">r</code> only if
            its resolved status is resumable.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
