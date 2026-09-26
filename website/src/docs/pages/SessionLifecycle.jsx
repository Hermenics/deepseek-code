import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "definition", label: "What a session contains" },
  { id: "start", label: "Start a session" },
  { id: "save", label: "When sessions are saved" },
  { id: "ids", label: "Session IDs" },
  { id: "list", label: "List saved sessions" },
  { id: "command-center", label: "Command center" },
  { id: "resume", label: "Resume by ID or picker" },
  { id: "restored", label: "What resume restores" },
  { id: "auto", label: "Automatic project resume" },
  { id: "storage", label: "Storage and retention" },
  { id: "export", label: "Export vs resume" },
  { id: "unsupported", label: "Unsupported lifecycle operations" },
  { id: "recovery", label: "Recovery and limitations" },
];

const SESSION_FIELDS = [
  ["Identity", "A 12-character hexadecimal ID, creation/update timestamps and an optional generated title."],
  ["Workspace", "The absolute working directory used when the record was last saved."],
  ["Conversation", "Separate model-facing history and terminal-visible UI history."],
  ["Runtime metadata", "The provider, model, preferred language and active-agent name recorded at save time."],
  ["Activity metadata", "The paths tracked as modified and an optional persistent goal."],
];

const RESUME_BEHAVIOR = [
  ["Model-facing messages", "Yes", "Loaded into the new process so the conversation can continue."],
  ["Visible transcript", "Yes", "Rendered again in the terminal."],
  ["Goal", "Yes", "The saved goal object is restored when present."],
  ["Saved workspace", "Yes, when it still exists", "It becomes the agent project root."],
  ["Saved provider and model", "Metadata only", "Current credentials and effective settings choose the live runtime."],
  ["Saved active agent", "Metadata only", "Startup agent selection comes from CLI arguments or current settings."],
  ["Modified-file tracker", "No", "The saved list is not rehydrated into the live tracker."],
  ["Last retryable prompt", "No", "Use a new prompt after resume; /retry initially has no in-process last message."],
  ["Process counters", "No", "Duration, token, cost and tool-call counters begin with the reopened app."],
];

export default function SessionLifecycle() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Session lifecycle</span>
        </nav>

        <div className="hero">
          <h1>Session lifecycle</h1>
          <p className="tagline">Start, switch and resume conversations while keeping each saved session's identity and recovery boundary clear.</p>
        </div>

        <section id="definition">
          <h2><span className="anchor">#</span>What a session contains</h2>
          <p>
            An interactive DeepSeek Code process owns a session ID and periodically writes a JSON record.
            That record is the resume source for the conversation; it is distinct from input history,
            checkpoints, audit logs and task snapshots.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "25%" }}>Part</th><th>Persisted session data</th></tr></thead>
            <tbody>{SESSION_FIELDS.map(([part, data]) => (
              <tr key={part}><td><b>{part}</b></td><td>{data}</td></tr>
            ))}</tbody>
          </table></div>
          <Note>
            A session record is operational state, not a privacy-filtered transcript. Use the sanitized
            export command before sharing a conversation with someone else.
          </Note>
        </section>

        <section id="start">
          <h2><span className="anchor">#</span>Start a session</h2>
          <p>
            Launch with no positional message for an empty interactive conversation, or supply one initial
            prompt. A fresh 12-character ID is generated before the TUI mounts in either case.
          </p>
          <CodeBlock lang="bash">{"$ cd /home/you/projects/acme\n$ deepseek\n\n$ deepseek \"explain the failing test\""}</CodeBlock>
          <p>
            Plain <code className="inline">deepseek</code> starts fresh by default. It does <b>not</b> open
            the resume picker unless project settings enable automatic resume. To open the picker explicitly,
            pass <code className="inline">--resume</code> without an ID.
          </p>
        </section>

        <section id="save">
          <h2><span className="anchor">#</span>When sessions are saved</h2>
          <p>
            The TUI schedules a best-effort save shortly after a main-agent turn reaches its completion
            callback. The snapshot includes the current model-facing history, visible messages, workspace,
            model/provider metadata, modified-file tracker and goal state. The first eligible completed turn
            is what makes a fresh ID discoverable on disk.
          </p>
          <p>
            Saves are <b>not</b> a write-ahead log. Typing, streaming output, standalone slash commands,
            <code className="inline">!</code> shell lines and an agent request that exits through the outer
            error path do not each force a session-record write. A model switch or clear operation becomes
            reflected in the record only when a later eligible turn saves the session.
          </p>
          <p>
            Persistence errors are deliberately swallowed so a filesystem problem does not crash the coding
            session. The trade-off is that a successful-looking conversation is not proof that its latest
            state reached disk. If resume matters, finish a normal turn and verify that it appears in the
            project picker before closing the terminal abruptly.
          </p>
          <Note>
            Exiting during the short deferred-save window, killing the process, or losing access to
            <code className="inline">~/.deepseek</code> can leave the latest UI state unsaved.
          </Note>
        </section>

        <section id="ids">
          <h2><span className="anchor">#</span>Session IDs</h2>
          <p>
            Interactive IDs contain exactly twelve hexadecimal characters. Ctrl+C or another handled
            termination signal prints the current process&apos;s resume command:
          </p>
          <CodeBlock lang="text">{"Resume this session:\ndeepseek --resume a1b2c3d4e5f6"}</CodeBlock>
          <p>
            Resuming or reopening a saved record keeps <b>its original ID</b>. Later saves update that record,
            so it appears only once in the command center. Starting a fresh session creates a new ID;
            <code className="inline">/branch</code> creates an independent copy with its own ID.
          </p>
          <Note>
            <code className="inline">/quit</code> exits directly and does not print the resume hint. Copy the
            ID from the picker or use a signal-handled exit when you need the exact current ID.
          </Note>
        </section>

        <section id="list">
          <h2><span className="anchor">#</span>List saved sessions</h2>
          <p>
            Inside the TUI, <code className="inline">/sessions</code> shows at most ten of the most recently
            updated records across all known workspace buckets. Each row includes a title or first-user-line
            fallback, local update time, count of visible user messages and saved workspace.
          </p>
          <CodeBlock lang="text">{"> /sessions\nRecent sessions:\n  Fix OAuth callback  8/12/2026, 2:40:10 PM  4 messages  /home/you/acme\n  New conversation     8/11/2026, 9:15:04 AM  1 messages  /home/you/tools\n\nResume: deepseek --resume <id>\nExport: /sessions export <id> [json|md]"}</CodeBlock>
          <p>
            The list output currently does <b>not</b> print IDs. Use the project resume picker to see the exact
            ID attached to each card, or retain the command printed when the session exits.
          </p>
        </section>

        <section id="command-center">
          <h2><span className="anchor">#</span>Switch sessions in the command center</h2>
          <p>
            Press <code className="inline">Left</code> on an empty prompt to open the command center. It shows
            the current session and saved sessions across projects, with status tabs and a details pane on
            wide terminals. Press <code className="inline">Enter</code> or <code className="inline">Right</code>{" "}
            to open a selection, <code className="inline">n</code> for a fresh session, and
            <code className="inline">Esc</code> to return to the prompt. A running turn or one waiting for
            input must finish or be stopped before you switch or start a new session.
          </p>
          <p>
            Use <code className="inline">Tab</code>/<code className="inline">Shift+Tab</code> to filter by
            status, <code className="inline">g</code> to group by project, status or model, and
            <code className="inline">f</code> to search titles, prompts and paths. Press
            <code className="inline">r</code> to rename a selected session or
            <code className="inline">Backspace</code> to request deletion of a saved session;
            <code className="inline">y</code> confirms. The current session cannot be deleted.
          </p>
          <Note>
            The command center's Working, Needs input and Ready statuses describe only this process's
            current session. Other saved sessions are shown as Inactive; they do not continue running
            in the background. Reopening one whose project directory no longer exists gives it a fresh ID
            in the current workspace.
          </Note>
        </section>

        <section id="resume">
          <h2><span className="anchor">#</span>Resume by ID or picker</h2>
          <CodeBlock lang="bash">{"# Open the picker for sessions saved in this exact workspace\n$ cd /home/you/projects/acme\n$ deepseek --resume\n\n# Resume one exact record\n$ deepseek --resume a1b2c3d4e5f6"}</CodeBlock>
          <p>
            The picker is keyboard-driven: Up and Down select, Enter resumes, and Escape cancels into a fresh
            session. Cards show the title, update time, saved model, ID and a short assistant preview.
          </p>
          <p>
            Both picker and exact-ID startup are <b>project-scoped</b>. DeepSeek Code searches records whose
            saved absolute <code className="inline">cwd</code> equals the shell&apos;s current absolute directory.
            An ID that exists under another project is treated as not found until you launch from that project.
          </p>
          <CodeBlock lang="text">{"$ cd /home/you/projects/other\n$ deepseek --resume a1b2c3d4e5f6\n⚠ Session not found. Starting a new session."}</CodeBlock>
          <Note>
            The current not-found screen displays that warning but does not transition into the normal input
            view. Restart without the invalid ID to begin a usable fresh session.
          </Note>
        </section>

        <section id="restored">
          <h2><span className="anchor">#</span>What resume restores</h2>
          <p>
            Resume is conversation hydration, not a complete recreation of the previous process. Current
            provider credentials and current layered settings remain authoritative.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "25%" }}>State</th><th style={{ width: "16%" }}>Restored?</th><th>Behavior</th></tr></thead>
            <tbody>{RESUME_BEHAVIOR.map(([state, restored, behavior]) => (
              <tr key={state}><td><b>{state}</b></td><td>{restored}</td><td>{behavior}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            If the saved workspace still exists, it seeds the agent project root and therefore project
            settings, steering, memory and extensions. The live model can still differ from the model shown
            on the picker card because that card displays saved metadata while startup applies today&apos;s config.
          </p>
          <p>
            Task snapshots are keyed by session ID and project root. When a saved session is reopened with
            the same ID and workspace, the agent attempts to restore its snapshot; interrupted running tasks
            are marked failed, and queued tasks without a runner are blocked. The snapshot does not restart
            old worker processes.
          </p>
        </section>

        <section id="auto">
          <h2><span className="anchor">#</span>Automatic project resume</h2>
          <p>
            Set <code className="inline">sessions.autoResume</code> to
            <code className="inline">project-last</code> to load the newest saved record for the current
            workspace whenever you run plain <code className="inline">deepseek</code>. The default is
            <code className="inline">off</code>.
          </p>
          <CodeBlock lang="json">{'{\n  "sessions": {\n    "autoResume": "project-last",\n    "retention": 50\n  }\n}'}</CodeBlock>
          <p>
            Explicit <code className="inline">--resume</code> takes precedence over automatic resume. A CLI
            initial message and automatic resume can also coexist: the saved conversation loads first, then
            the initial message is submitted to the hydrated session.
          </p>
        </section>

        <section id="storage">
          <h2><span className="anchor">#</span>Storage and retention</h2>
          <p>
            Current records live below
            <code className="inline">~/.deepseek/sessions/&lt;project-name&gt;-&lt;path-hash&gt;/</code>. The readable
            name is derived from the workspace basename and the eight-character hash distinguishes different
            absolute paths with the same basename. The loader also recognizes older per-project and legacy
            flat layouts for compatibility.
          </p>
          <p>
            <code className="inline">sessions.retention</code> must be a positive integer and defaults to
            <code className="inline">50</code>. After each successful save, records are sorted globally by
            update time and older records beyond that cap are removed across workspace buckets. Retention is
            therefore a total saved-session ceiling, not fifty records per project.
          </p>
          <p>
            Session titles are generated asynchronously after the first user turn. Until a title is available,
            listings and the picker fall back to the first visible user message or “New conversation.”
          </p>
        </section>

        <section id="export">
          <h2><span className="anchor">#</span>Export vs resume</h2>
          <p>
            Resume loads a raw operational record into DeepSeek Code. Export creates a separate redacted copy
            for review or tooling and does not alter the source session.
          </p>
          <CodeBlock lang="text">{"> /sessions export a1b2c3d4e5f6 md\nSanitized session export written to /home/you/acme/.deepseek/session-a1b2c3d4e5f6.sanitized.md"}</CodeBlock>
          <p>
            Export lookup is project-scoped like startup resume. The requested ID must belong to the current workspace,
            and output is written into the currently active workspace. See <a href="/docs/session-export">Exporting sessions</a> for the
            Markdown/JSON formats and privacy boundary.
          </p>
        </section>

        <section id="unsupported">
          <h2><span className="anchor">#</span>Lifecycle boundaries</h2>
          <p>
            There is no <code className="inline">--continue</code> shortcut. The command center provides
            interactive switching, renaming and confirmed deletion; <code className="inline">/branch</code>{" "}
            forks a conversation under a new ID. <code className="inline">/clear</code> only clears live
            conversation state and may later overwrite the saved record after another completed turn.
          </p>
        </section>

        <section id="recovery">
          <h2><span className="anchor">#</span>Recovery and limitations</h2>
          <h3>The picker is empty</h3>
          <p>Confirm that you launched from the exact saved absolute workspace and that at least one normal main-agent turn completed there. The picker does not search other projects.</p>
          <h3>The model differs after resume</h3>
          <p>The saved model is descriptive metadata. Select the desired currently available model with <code className="inline">/model</code> or update the effective settings.</p>
          <h3>The latest output is missing</h3>
          <p>The session save may not have run after an error, shell-only action, abrupt exit or deferred-save interruption. The older completed-turn snapshot is the recovery boundary.</p>
          <h3>An old record vanished</h3>
          <p>Retention is global and pruning runs after saves. Increase <code className="inline">sessions.retention</code> before the total count reaches the current ceiling, or create a sanitized export for durable sharing.</p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
