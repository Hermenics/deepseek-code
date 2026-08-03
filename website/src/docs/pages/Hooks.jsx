import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "What hooks do" },
  { id: "configuration", label: "Configuration" },
  { id: "matchers", label: "Matcher patterns" },
  { id: "protocol", label: "Input & output protocol" },
  { id: "pretooluse", label: "PreToolUse decisions" },
  { id: "hooklibrary", label: "HookLibrary editor" },
  { id: "debugging", label: "Debugging & audit" },
  { id: "kernel-runtime", label: "Kernel HookRuntime" },
];

const EVENTS = [
  ["PreToolUse", "before a tool call", "tool_name, tool_input", "Yes — approve, block, or rewrite"],
  ["PostToolUse", "after a tool call", "tool_name, tool_input, tool_result", "No (fire-and-forget)"],
  ["SessionStart", "session start", "session_id", "No"],
];

const FIELDS = [
  ["type", "string", "Always command"],
  ["command", "string", "Run via sh -c"],
  ["timeout", "number", "Seconds; default 30"],
  ["enabled", "boolean", "Defaults to true"],
];

export default function Hooks() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Hooks</span>
        </nav>

        <div className="hero">
          <h1>Hooks</h1>
          <p className="tagline">
            Scriptable checkpoints in the agent loop — before a tool runs, after it finishes, and at session start.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>What hooks do</h2>
          <p>
            Hooks run external commands at key points in the agent loop — before a tool runs,
            after it finishes, and when a session starts. They're a small, scriptable way to
            guard, reshape, or observe tool calls without touching the agent's code.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Event</th><th>When</th><th>Payload</th><th>Can block?</th></tr>
              </thead>
              <tbody>
                {EVENTS.map(([ev, when, payload, canBlock]) => (
                  <tr key={ev}>
                    <td><code className="inline">{ev}</code></td>
                    <td>{when}</td>
                    <td><code className="inline">{payload}</code></td>
                    <td>{canBlock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">PostToolUse</code> hooks receive <code className="inline">tool_result</code> truncated
            to 10,000 bytes. Every run — all three events — is recorded in an in-memory{" "}
            <code className="inline">hookAuditLog</code> capped at 500 entries.
          </p>
        </section>

        <section id="configuration">
          <h2><span className="anchor">#</span>Configuration</h2>
          <p>
            Hooks live under <code className="inline">settings.hooks</code> in{" "}
            <code className="inline">settings.json</code>, <b>User scope only</b>:
          </p>
          <CodeBlock lang="text">{`{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Shell",
        "hooks": [
          { "type": "command", "command": "cat", "timeout": 30, "enabled": true }
        ]
      }
    ]
  }
}`}</CodeBlock>
          <p>Each event is an array of matchers, and each matcher holds a list of hook commands:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Field</th><th style={{ width: "22%" }}>Type</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {FIELDS.map(([f, t, n]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{t}</td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            Project and Local hooks are ignored for security. Only User-scope hooks execute — the
            settings loader warns when it finds executable hooks outside User scope.
          </Note>
        </section>

        <section id="matchers">
          <h2><span className="anchor">#</span>Matcher patterns</h2>
          <p>
            Matchers decide which tool a hook applies to. They support <code className="inline">*</code>{" "}
            (every tool), an exact tool name like <code className="inline">Shell</code>, or a
            pipe-separated list like <code className="inline">Shell|WriteFile</code>. Patterns are
            resolved by <code className="inline">src/hooks/matcher.ts</code> against the tool
            about to run, and matching is case-insensitive.
          </p>
        </section>

        <section id="protocol">
          <h2><span className="anchor">#</span>Input &amp; output protocol</h2>
          <p>
            A hook command is spawned with <code className="inline">sh -c</code> and receives a
            JSON object on stdin:
          </p>
          <CodeBlock lang="json">{`{
  "schema_version": 1,
  "event": "PreToolUse",
  "session_id": "abc123",
  "correlation_id": "…",
  "run_id": "…",
  "cwd": "/path/to/workspace",
  "tool_name": "Shell",
  "tool_input": { "command": "ls" }
}`}</CodeBlock>
          <p>
            A hook returns either plain stdout text or a JSON decision —{" "}
            <code className="inline">{"{ \"decision\": \"approve\" | \"block\", \"reason\": \"…\", \"modified_input\": { } }"}</code>.
            A non-zero exit code or a timeout is treated as a block with the reason surfaced to
            the agent.
          </p>
        </section>

        <section id="pretooluse">
          <h2><span className="anchor">#</span>PreToolUse decisions</h2>
          <p>
            <code className="inline">PreToolUse</code> hooks return <code className="inline">approve</code> or{" "}
            <code className="inline">block</code>, plus an optional <code className="inline">reason</code> and{" "}
            <code className="inline">modified_input</code>. Blocked tools report the reason back to
            the agent. Because a hook can rewrite arguments, the rewritten{" "}
            <code className="inline">modified_input</code> is <b>re-authorized through the permission
            pipeline</b> — risk assessment and path checks inspect the modified arguments, not the
            originals.
          </p>
        </section>

        <section id="hooklibrary">
          <h2><span className="anchor">#</span>HookLibrary editor</h2>
          <p>
            A fullscreen editor inside <code className="inline">/settings</code> (
            <code className="inline">src/ui/setup/HookLibrary.tsx</code>) lets you add, edit, delete,
            and test hooks interactively. It lists hooks as <code className="inline">Event(Matcher)</code>{" "}
            rows, shows the ignored project/local count, and includes a test runner that sends a
            simulated payload (<code className="inline">tool_name: read_file</code>,{" "}
            <code className="inline">tool_input: {"{ path: \"README.md\", simulated: true }"}</code>) before
            executing a real hook.
          </p>
          <p>
            Keys: <code className="inline">n</code> new hook, <code className="inline">e</code> edit command,{" "}
            <code className="inline">m</code> edit matcher, <code className="inline">x</code> timeout,{" "}
            <code className="inline">v</code> cycle event, <code className="inline">Space</code> toggle enabled,{" "}
            <code className="inline">t</code> test, <code className="inline">d</code> delete,{" "}
            <code className="inline">Esc</code> back.
          </p>
        </section>

        <section id="debugging">
          <h2><span className="anchor">#</span>Debugging &amp; audit</h2>
          <p>
            Inspect the in-memory <code className="inline">hookAuditLog</code> to review runs — event,
            command, exit code, decision, and whether output was truncated. Test hooks with
            simulated payloads from the editor before trusting them. Watch the limits:{" "}
            <code className="inline">tool_result</code> is truncated to 10k bytes for{" "}
            <code className="inline">PostToolUse</code>, stdout capture is capped at 100k bytes, and
            the audit log keeps the latest 500 entries.
          </p>
        </section>

        <section id="kernel-runtime">
          <h2><span className="anchor">#</span>Reference: kernel HookRuntime</h2>
          <p>
            A second, more advanced hook engine exists at{" "}
            <code className="inline">src/kernel/hooks/hookRuntime.ts</code>. It supports handler
            types <code className="inline">command</code>, <code className="inline">shell</code>,{" "}
            <code className="inline">http</code>, <code className="inline">prompt</code>, and{" "}
            <code className="inline">agent</code>; seven decisions (<code className="inline">observe</code>,{" "}
            <code className="inline">allow</code>, <code className="inline">block</code>,{" "}
            <code className="inline">ask</code>, <code className="inline">modify</code>,{" "}
            <code className="inline">continue</code>, <code className="inline">stop</code>);{" "}
            <code className="inline">system</code>/<code className="inline">user</code>/<code className="inline">project</code>/
            <code className="inline">local</code>/<code className="inline">plugin</code> scopes; per-hook
            content-hash trust (a hook's SHA-256 hash must match what you trusted, or it's skipped);
            and persistence of every run to a SQLite <code className="inline">hook_runs</code> table.
          </p>
          <Note>
            <code className="inline">HookRuntime</code> is <b>reference-only</b> — it is not
            instantiated anywhere and is not yet wired to the agent loop. The production path is
            the <code className="inline">settings.hooks</code> engine described above.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
