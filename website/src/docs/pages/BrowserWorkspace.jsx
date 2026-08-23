import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "What it is" },
  { id: "start", label: "Start the workspace" },
  { id: "conversation", label: "Conversation view" },
  { id: "commands", label: "Browser commands" },
  { id: "changes", label: "Changes & Git" },
  { id: "terminal", label: "Browser terminal" },
  { id: "live", label: "Live state" },
  { id: "security", label: "Local-only security" },
  { id: "lifecycle", label: "Process lifecycle" },
  { id: "limits", label: "Current limits" },
];

const VIEWS = [
  ["Chat", "Run prompts, watch streamed thinking, assistant text and workflow progress, inspect tool cards, and answer permission, plan, diff-review, verification, or user-question requests."],
  ["Changes", "Inspect the current Git branch, ahead/behind counts, staged and unstaged files, and a selected file's working-tree or staged diff."],
  ["Terminal", "Use an xterm-compatible terminal attached to the same workspace directory as the agent."],
];

const STATS = [
  ["Context", "Current context usage and configured context limit."],
  ["Tokens", "Prompt, completion, cached and total token counters."],
  ["Work", "Tool calls, modified-file count and estimated session cost."],
  ["Tasks", "The current todo list, live sub-agent activity and blocked-worker state."],
  ["Workflows", "Live phase, status, agent count, token usage and workflow log progress."],
];

export default function BrowserWorkspace() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Browser workspace</span>
        </nav>

        <div className="hero">
          <h1>Browser workspace</h1>
          <p className="tagline">
            A local browser UI for the same DeepSeek Code agent, workspace and permissions that power the terminal session.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>What it is</h2>
          <p>
            The Browser Workspace is an optional localhost interface. DeepSeek Code starts a local HTTP server,
            serves its bundled client and connects the page to the agent through a WebSocket bridge. It is not a
            hosted dashboard and it does not send your workspace to a DeepSeek Code server.
          </p>
          <p>
            The browser and TUI are separate agent sessions. The browser session starts in the current directory and
            uses the provider, model, language and prompt-refiner settings already saved for the CLI. Files changed in
            one session are visible to the other on disk, but their conversation histories are not merged.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "24%" }}>View</th><th>What it provides</th></tr></thead>
              <tbody>{VIEWS.map(([view, description]) => <tr key={view}><td><b>{view}</b></td><td>{description}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section id="start">
          <h2><span className="anchor">#</span>Start the workspace</h2>
          <p>Use the in-session command when the TUI is already open:</p>
          <CodeBlock lang="text">{"/gui\n\n# Direct equivalent, from a shell:\ndeepseek --web\n\n# Choose a port (0 asks the OS for an available port):\ndeepseek --web --port 4322"}</CodeBlock>
          <p>
            <code className="inline">/gui</code> launches a separate web process, opens the system browser and keeps
            the TUI available. Running <code className="inline">/gui</code> again during the same TUI session reports
            that the GUI is already running. The direct <code className="inline">--web</code> mode owns the foreground
            process instead and prints the complete URL before waiting for Ctrl+C.
          </p>
          <p>
            The default port is <code className="inline">4321</code>. Set{" "}
            <code className="inline">DEEPSEEK_WEB_PORT</code> or pass <code className="inline">--port</code> to choose
            another valid port. If no provider has been configured, web mode exits with a setup message; run{" "}
            <code className="inline">deepseek</code> once to configure one.
          </p>
        </section>

        <section id="conversation">
          <h2><span className="anchor">#</span>Conversation view</h2>
          <p>
            The main view streams assistant text and reasoning separately. Tool calls appear as expandable cards with
            human-readable argument previews, running state and result summaries. Long tool output can be expanded in
            the card when it is still available to the browser view; this does not change the result sent to model
            context or remove tool-level output limits.
          </p>
          <p>
            The composer supports slash-command suggestions and the same interaction modes exposed by the TUI:
            <code className="inline">plan</code>, <code className="inline">review</code>,{" "}
            <code className="inline">build</code> and <code className="inline">auto</code>. Permission prompts,
            confirmations, AskUser questions, plan review, diff review and verification are delivered as explicit
            browser dialogs or panels and their responses are sent back over the bridge.
          </p>
          <Note>
            Browser commands are not a second permission system. The agent still performs workspace containment,
            risk assessment, permission rules and hook checks before a tool executes.
          </Note>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>Browser command surface</h2>
          <p>
            The browser composer uses the same command resolver as the TUI. Saved workflows and project or user custom
            commands therefore appear as slash-command suggestions alongside built-ins; changing the working directory
            refreshes the discovered command set. See <a href="/docs/slash-commands">Slash commands</a> for the full
            syntax and <a href="/docs/slash-commands#custom">Custom commands</a> for the file format.
          </p>
          <p>
            Browser-local controls include <code className="inline">/clear</code>,{" "}
            <code className="inline">/help</code>, <code className="inline">/compact</code>,{" "}
            <code className="inline">/model</code>, <code className="inline">/cost</code>,{" "}
            <code className="inline">/stats</code>, <code className="inline">/system</code>,{" "}
            <code className="inline">/files</code>, <code className="inline">/tools</code>,{" "}
            <code className="inline">/undo</code>, <code className="inline">/checkpoint</code>,{" "}
            <code className="inline">/review</code>, <code className="inline">/plan</code>,{" "}
            <code className="inline">/btw</code> and <code className="inline">/effort</code>.
          </p>
          <p>
            Shared session and task commands include <code className="inline">/sessions</code>,{" "}
            <code className="inline">/memory</code>, <code className="inline">/goal</code>,{" "}
            <code className="inline">/tasks</code>, <code className="inline">/task</code>,{" "}
            <code className="inline">/cwd</code>, <code className="inline">/worktree</code>,{" "}
            <code className="inline">/doctor</code>, <code className="inline">/verify</code>,{" "}
            <code className="inline">/catalog</code>, <code className="inline">/permissions</code>,{" "}
            <code className="inline">/context</code>, <code className="inline">/features</code>,{" "}
            <code className="inline">/agents</code>, <code className="inline">/agent</code>,{" "}
            <code className="inline">/skill</code>, <code className="inline">/plugin</code>,{" "}
            <code className="inline">/retry</code>, <code className="inline">/logout</code>,{" "}
            <code className="inline">/workflow</code> and <code className="inline">/workflows</code>.
          </p>
          <p>
            Terminal-only commands such as <code className="inline">/vim</code>,{" "}
            <code className="inline">/quit</code>, <code className="inline">/config</code>,{" "}
            <code className="inline">/gui</code> and <code className="inline">/mobile</code> do not pretend to run in
            the browser: the bridge explains that their terminal surface is unavailable.
          </p>
        </section>

        <section id="changes">
          <h2><span className="anchor">#</span>Changes and Git</h2>
          <p>
            The Changes view reads the current workspace with Git and groups files into staged and unstaged changes.
            Select a file to inspect its working-tree diff or staged diff, then use the stage and unstage controls as
            needed. A commit action is available only when there are staged files and sends the commit message to the
            local Git process.
          </p>
          <CodeBlock lang="text">{"Changes\n  ├── select a file        → inspect its diff\n  ├── Stage / Unstage      → update the index\n  └── Commit staged files  → create a local commit"}</CodeBlock>
          <p>
            A non-Git directory remains usable for chat and terminal work; the Changes view simply reports that the
            workspace is not a repository. Source-control failures are returned to the browser as an error event and
            do not silently commit or discard files.
          </p>
        </section>

        <section id="terminal">
          <h2><span className="anchor">#</span>Browser terminal</h2>
          <p>
            The Terminal view uses the bundled xterm client and a pseudo-terminal rooted at the same working directory
            passed to the web server. Resize, input, reset and replay commands are carried over the WebSocket; the
            server keeps a terminal snapshot so a reconnecting page can restore the visible terminal buffer.
          </p>
          <p>
            The terminal is not a restricted browser sandbox. It has the operating-system permissions of the process
            that launched DeepSeek Code. Treat the URL as a control surface for the local machine, not as a safe way to
            expose a shell to another person.
          </p>
        </section>

        <section id="live">
          <h2><span className="anchor">#</span>Live state and reconnects</h2>
          <p>
            The initial handshake sends the session id, model, working directory, active mode, tool inventory, Git
            snapshot, todos and session statistics. During work, the bridge streams tokens, thinking, tool activity,
            sub-agent events, permission requests, source-control refreshes, terminal data and completion state. Workflow
            runs additionally stream phase and status updates, usage counters and <code className="inline">log()</code>
            output; blocked sub-agents expose their block reason in the activity row.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "26%" }}>Telemetry</th><th>Displayed meaning</th></tr></thead>
              <tbody>{STATS.map(([name, description]) => <tr key={name}><td><code className="inline">{name}</code></td><td>{description}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            The server keeps the newest 300 replayable events. A reconnecting client asks for events after its last
            sequence number. If that sequence has fallen outside the journal, the server sends a session-gap event so
            the client can stop pretending that its transcript is complete. Terminal bytes, heartbeats and terminal
            exit events are not replayed through that journal.
          </p>
          <p>
            The browser also keeps a bounded snapshot in <code className="inline">sessionStorage</code> for the current
            token, including recent messages, tool cards and activity. It is a convenience for a page refresh, not a
            durable session export or a replacement for <a href="/docs/session-export">session export</a>.
          </p>
        </section>

        <section id="security">
          <h2><span className="anchor">#</span>Local-only security</h2>
          <p>
            Each server instance creates a fresh random access token and includes it in the printed URL. Requests are
            rejected unless both the token and the loopback <code className="inline">Host</code> header match. The
            default bind address is <code className="inline">127.0.0.1</code>; the implementation does not provide a
            remote-login or multi-user mode.
          </p>
          <ul className="capabilities">
            <li><b>Same-origin assets:</b> the page, bundled JavaScript, CSS, logo and WebSocket are served by the local process.</li>
            <li><b>Content Security Policy:</b> scripts and connections are restricted to the local origin, with no remote form action.</li>
            <li><b>Input cap:</b> WebSocket frames over one million characters are rejected before JSON parsing.</li>
            <li><b>No-store responses:</b> the server asks the browser and intermediaries not to cache control responses.</li>
          </ul>
          <Note>
            Anyone who can control the local browser profile or obtain the printed token can operate this local agent.
            Do not paste the URL into chat, expose the port through a tunnel, or treat browser history as harmless.
          </Note>
        </section>

        <section id="lifecycle">
          <h2><span className="anchor">#</span>Process lifecycle</h2>
          <p>
            In <code className="inline">--web</code> mode, Ctrl+C or SIGTERM stops the HTTP/WebSocket server, aborts
            the agent and performs a bounded graceful shutdown. A stuck worker or shutdown hook cannot hold the
            process indefinitely; the shutdown race is capped at roughly 1.5 seconds after the server closes.
          </p>
          <p>
            When launched by <code className="inline">/gui</code>, the TUI owns the child process and cleans it up when
            the TUI exits. Closing the browser tab alone does not stop the web process; close the TUI or terminate the
            direct web process when you are finished.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Current limits</h2>
          <ul className="capabilities">
            <li>The workspace is localhost-only and has no remote authentication, user accounts or TLS setup.</li>
            <li>The browser session is separate from the TUI session; live conversation state is not synchronized between them.</li>
            <li>Most shared slash commands, saved workflows and custom commands are available through the bridge; terminal-only commands explain why they cannot run in the browser.</li>
            <li>Web UI persistence is bounded page-session state, not a durable transcript. Use <code className="inline">/sessions export</code> for a sanitized artifact.</li>
          </ul>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
