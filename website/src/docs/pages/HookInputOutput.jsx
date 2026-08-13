import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "transport", label: "Process contract" },
  { id: "fields", label: "Input fields" },
  { id: "event-shapes", label: "Payload by event" },
  { id: "pre-output", label: "PreToolUse stdout" },
  { id: "parsing", label: "Parsing and validation" },
  { id: "rewrite", label: "Replacement and chaining" },
  { id: "exit", label: "Exit and stderr behavior" },
  { id: "limits", label: "Limits and identifiers" },
];

const FIELDS = [
  ["schema_version", "number", "Always 1."],
  ["event", "string", "SessionStart, PreToolUse or PostToolUse."],
  ["session_id", "string", "Agent hook-session identifier."],
  ["correlation_id", "string", "Shared by all commands in one event group."],
  ["run_id", "string", "Unique to one command execution."],
  ["cwd", "string", "CLI process working directory when the payload is built."],
  ["tool_name", "string, optional", "Present for pre- and post-tool events."],
  ["tool_input", "object, optional", "Current effective arguments; absent on SessionStart."],
  ["tool_result", "string, optional", "PostToolUse only, truncated to 10,000 characters."],
];

const OUTPUTS = [
  ["Empty stdout", "No opinion; continue."],
  ["{}", "Valid JSON with no recognized action; continue."],
  ["decision: approve", "Continue. It does not bypass later authorization."],
  ["decision: block", "Stop PreToolUse and return reason, or the default block reason."],
  ["modified_input", "Replace the entire tool argument object and continue."],
];

export default function HookInputOutput() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Extending</span><span className="sep">/</span><span className="current">Hook input & output</span>
        </nav>

        <div className="hero">
          <h1>Hook input & output</h1>
          <p className="tagline">
            The versioned stdin payload, the PreToolUse stdout contract, and exact failure semantics.
          </p>
        </div>

        <section id="transport">
          <h2><span className="anchor">#</span>Process contract</h2>
          <p>
            Every configured hook command is launched as <code className="inline">sh -c "&lt;command&gt;"</code>.
            The CLI writes one compact JSON object to standard input, closes stdin, captures stdout and stderr,
            and waits according to the command timeout. No newline is appended to stdin.
          </p>
          <p>
            The command inherits the CLI process environment. Treat command text as executable shell, quote it
            accordingly, and never put an unreviewed repository value into User hook settings.
          </p>
          <CodeBlock lang="bash">{`# Inspect the exact payload shape your command receives
printf '%s' '{"schema_version":1,"event":"PreToolUse","session_id":"demo","correlation_id":"group-1","run_id":"run-1","cwd":"/workspace","tool_name":"write_file","tool_input":{"path":"README.md","content":"hello"}}' \
  | ./scripts/check-write`}</CodeBlock>
        </section>

        <section id="fields">
          <h2><span className="anchor">#</span>Input fields</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "22%" }}>Field</th><th style={{ width: "20%" }}>Type</th><th>Meaning</th></tr></thead>
              <tbody>{FIELDS.map(([field, type, meaning]) => <tr key={field}><td><code className="inline">{field}</code></td><td>{type}</td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
          <Note>
            Consumers should check <code className="inline">schema_version</code> before relying on fields.
            Version 1 is the only format the current CLI emits.
          </Note>
        </section>

        <section id="event-shapes">
          <h2><span className="anchor">#</span>Payload by event</h2>
          <p><b>SessionStart</b> has lifecycle and identity fields only:</p>
          <CodeBlock lang="json">{`{
  "schema_version": 1,
  "event": "SessionStart",
  "session_id": "4dc7067e-…",
  "correlation_id": "e1b745fb-…",
  "run_id": "60ec66fa-…",
  "cwd": "/home/you/project"
}`}</CodeBlock>
          <p><b>PreToolUse</b> adds the tool name and current input:</p>
          <CodeBlock lang="json">{`{
  "schema_version": 1,
  "event": "PreToolUse",
  "session_id": "4dc7067e-…",
  "correlation_id": "a5d4abcc-…",
  "run_id": "c101ce47-…",
  "cwd": "/home/you/project",
  "tool_name": "shell",
  "tool_input": { "command": "bun test" }
}`}</CodeBlock>
          <p><b>PostToolUse</b> adds the result and uses the arguments that actually executed:</p>
          <CodeBlock lang="json">{`{
  "schema_version": 1,
  "event": "PostToolUse",
  "session_id": "4dc7067e-…",
  "correlation_id": "1599bb89-…",
  "run_id": "483a1603-…",
  "cwd": "/home/you/project",
  "tool_name": "shell",
  "tool_input": { "command": "bun test" },
  "tool_result": "12 pass\n0 fail"
}`}</CodeBlock>
          <p>
            Pre and post phases generate different correlation ids. Correlation groups commands within one
            phase; it is not a durable identifier joining both sides of a tool call.
          </p>
        </section>

        <section id="pre-output">
          <h2><span className="anchor">#</span>PreToolUse stdout</h2>
          <p>
            Only PreToolUse interprets successful stdout as a control response. Whitespace is trimmed before
            parsing. Supported fields are <code className="inline">decision</code>,
            <code className="inline"> reason</code> and <code className="inline">modified_input</code>.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "30%" }}>Stdout</th><th>Effect</th></tr></thead>
              <tbody>{OUTPUTS.map(([value, effect]) => <tr key={value}><td><code className="inline">{value}</code></td><td>{effect}</td></tr>)}</tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`{ "decision": "block", "reason": "Generated files must be changed through their template." }`}</CodeBlock>
          <CodeBlock lang="json">{`{ "modified_input": { "command": "bun test tests/auth.test.ts" } }`}</CodeBlock>
          <Note>
            PostToolUse and SessionStart discard stdout for lifecycle purposes. Printing a block response from
            either event does not undo a completed tool or stop initialization.
          </Note>
        </section>

        <section id="parsing">
          <h2><span className="anchor">#</span>Parsing and validation</h2>
          <p>
            Exit-zero, non-empty PreToolUse stdout is parsed as one JSON value. A non-JSON value logs a
            diagnostic and is otherwise ignored. The response fields are validated before use:
            <code className="inline"> decision</code> and <code className="inline">reason</code> must be strings,
            and <code className="inline">modified_input</code> must be a non-null, non-array object.
          </p>
          <p>
            If any present field has the wrong type, that response is ignored as a whole and the chain
            continues. The current parser acts only on the exact decision string
            <code className="inline"> block</code>; an unknown string is not treated as a block.
          </p>
          <CodeBlock lang="text">{`[hooks] PreToolUse hook "./scripts/check-write" returned non-JSON output (run <id>)
[hooks] PreToolUse hook "./scripts/check-write" returned non-object modified_input (run <id>)`}</CodeBlock>
        </section>

        <section id="rewrite">
          <h2><span className="anchor">#</span>Replacement and chaining</h2>
          <p>
            <code className="inline">modified_input</code> replaces the complete arguments object; it is not a
            patch or shallow merge. Include every field the target tool still needs. The next matching hook
            receives the replacement, and another replacement supersedes it.
          </p>
          <CodeBlock lang="text">{`original input:   { "path": "a.ts", "content": "old" }
hook A output:    { "modified_input": { "path": "b.ts", "content": "old" } }
hook B receives:  { "path": "b.ts", "content": "old" }
hook B output:    { "modified_input": { "path": "b.ts", "content": "new" } }
tool receives:    { "path": "b.ts", "content": "new" }`}</CodeBlock>
          <p>
            After the chain, normal authorization inspects the final object. This is why a rewrite can cause an
            external-path prompt, a risk confirmation or a permission denial. See
            <a href="/docs/hook-lifecycle#authorization"> lifecycle ordering</a>.
          </p>
        </section>

        <section id="exit">
          <h2><span className="anchor">#</span>Exit and stderr behavior</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th>Process outcome</th><th>Executor response</th><th>PreToolUse effect</th></tr></thead>
              <tbody>
                <tr><td>Exit 0</td><td>Trimmed stdout</td><td>Parse it if non-empty</td></tr>
                <tr><td>Non-zero exit</td><td>Block JSON using stderr or “exited with code N”</td><td>Blocks</td></tr>
                <tr><td>Timeout / SIGKILL</td><td>Block JSON with “Hook timed out”</td><td>Blocks</td></tr>
                <tr><td>Spawn or stdin error</td><td>Block JSON with the error message</td><td>Blocks</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            On an exit-zero command, stderr does not become the response and is not printed by the executor.
            On a non-zero command, trimmed stderr becomes the failure reason and a terminal diagnostic names
            the failed command. SessionStart ignores the returned block response; PostToolUse has already
            completed the original tool path.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and identifiers</h2>
          <ul className="capabilities">
            <li>Default timeout: 30 seconds per command; any positive finite number of seconds can be configured.</li>
            <li>Captured stdout and stderr: capped independently at 100,000 bytes.</li>
            <li>PostToolUse result in stdin: first 10,000 characters.</li>
            <li>In-memory hook audit retention: newest 500 command runs.</li>
            <li>Each command gets a unique run id; commands in one event phase share a correlation id.</li>
          </ul>
          <p>
            Output truncation is recorded on the in-memory audit entry, but there is currently no slash command
            that displays or exports that hook-specific buffer. Continue with
            <a href="/docs/hook-troubleshooting"> Hook troubleshooting</a> for observable diagnostics and test
            steps.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
