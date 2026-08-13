import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "pipe", label: "Pipe mode (--pipe)" },
  { id: "output", label: "Output & exit handling" },
  { id: "doctor", label: "Diagnostics (/doctor)" },
  { id: "verify", label: "Automated verification (/verify)" },
];

const OUTPUT_MODES = [
  ["plain", "streamed tokens", "[tool] <name> lines", "0 on success"],
  ["--json", '{"ok":true,"output":"…","tools":["…"]}', "[tool] <name> lines", "0 on success"],
  ["either", "error (JSON) / — (plain)", "error (plain)", "1 on setup failure"],
];

const DOCTOR_CHECKS = [
  ["Runtime", "Bun version"],
  ["Workspace", "current directory is accessible"],
  ["Git", "git is on PATH"],
  ["ripgrep", "rg is on PATH (missing only slows search)"],
  ["Credentials", "a saved provider config exists"],
  ["Settings", "merged settings resolve and the active provider"],
  ["MCP config", ".deepseek/mcp.json exists and is valid JSON"],
];

export default function Automation() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Automation</span>
        </nav>

        <div className="hero">
          <h1>Automation & scripting</h1>
          <p className="tagline">
            Drive the agent from scripts, CI jobs, and cron — no terminal UI needed.
          </p>
        </div>

        <section id="pipe">
          <h2><span className="anchor">#</span>Pipe mode (--pipe)</h2>
          <p>
            Passing <code className="inline">--pipe</code> runs exactly one headless turn: it reads a prompt from
            argv or stdin, runs the agent, and writes the result to stdout. No TUI renders, no
            alternate screen.
          </p>
          <CodeBlock lang="bash">{`echo "Summarize this commit" | deepseek --pipe
cat src/index.ts | deepseek --pipe "explain this file"
deepseek --pipe "add a --dry-run flag to build.ts"`}</CodeBlock>
          <ul className="capabilities">
            <li>A prompt can come from argv, stdin, or both — when both are present, stdin becomes context wrapped in a fenced code block.</li>
            <li>Provider config comes from your saved setup or <code className="inline">DEEPSEEK_API_KEY</code>.</li>
            <li>Because there is no one to approve commands interactively, pipe mode installs a shell-confirmation handler that always answers false — destructive shell operations that require confirmation are automatically denied.</li>
          </ul>
          <Note>
            Pipe mode awaits the agent's asynchronous initialization — MCP servers, steering rules,
            and AGENTS.md / DEEPSEEK.md loading — via <code className="inline">agent.readyPromise</code> before the
            first turn, and calls <code className="inline">agent.shutdown()</code> in a{" "}
            <code className="inline">finally</code> block so workers and streams are released even when the turn
            fails.
          </Note>
          <Note>
            Pipe mode only activates when <code className="inline">--pipe</code> is present. Without it,{" "}
            <code className="inline">deepseek "message"</code> starts a normal interactive session and ignores
            stdin.
          </Note>
        </section>

        <section id="output">
          <h2><span className="anchor">#</span>Output & exit handling</h2>
          <p>
            Plain mode streams tokens to stdout as they are generated and writes tool calls to stderr
            as <code className="inline">[tool] &lt;name&gt;</code>, so the result stays clean.{" "}
            <code className="inline">--json</code> keeps assistant text off stdout entirely and emits a single
            JSON object when the turn finishes:
          </p>
          <CodeBlock lang="bash">{`echo "explain argv parsing" | deepseek --pipe --json | jq -r .output
echo "find the bug" | deepseek --pipe --json | jq -r '.tools[]'`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Mode</th><th style={{ width: "40%" }}>stdout</th><th>stderr</th><th style={{ width: "24%" }}>Exit code</th></tr>
              </thead>
              <tbody>
                {OUTPUT_MODES.map(([m, out, err, code]) => (
                  <tr key={m}>
                    <td><code className="inline">{m}</code></td>
                    <td><code className="inline">{out}</code></td>
                    <td>{err}</td>
                    <td>{code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`// success — one object on stdout when the turn finishes
{"ok":true,"output":"…","tools":["shell","read_file"]}
// setup failure — no key, no saved config, or no prompt
{"ok":false,"error":"DEEPSEEK_API_KEY not set and no saved config found"}`}</CodeBlock>
          <p>
            On failure — no API key and no saved config, or no prompt supplied — JSON mode prints{" "}
            <code className="inline">{"{\"ok\":false,\"error\":\"…\"}"}</code> to stdout, plain mode prints to
            stderr, and both exit <code className="inline">1</code>, so <code className="inline">&&</code> chains in
            scripts fail fast. Success exits <code className="inline">0</code> in both modes.
          </p>
        </section>

        <section id="doctor">
          <h2><span className="anchor">#</span>Diagnostics (/doctor)</h2>
          <p>
            <code className="inline">/doctor</code> (also available as <code className="inline">deepseek doctor</code> from
            the shell) checks the whole local setup in one pass, prints a report, and exits{" "}
            <code className="inline">0</code> when everything is ready or <code className="inline">1</code> when anything
            needs attention.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Check</th><th>Verifies</th></tr>
              </thead>
              <tbody>
                {DOCTOR_CHECKS.map(([c, v]) => (
                  <tr key={c}>
                    <td><b style={{ color: "var(--text-strong)" }}>{c}</b></td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            The MCP check reports how many servers are configured and flags malformed JSON — handy
            right after hand-editing <code className="inline">.deepseek/mcp.json</code>.
          </Note>
        </section>

        <section id="verify">
          <h2><span className="anchor">#</span>Automated verification (/verify)</h2>
          <p>
            <code className="inline">/verify</code> (alias <code className="inline">/test</code>) detects the project's
            test command and runs it after a quick confirmation. Detection reads{" "}
            <code className="inline">scripts.test</code> from <code className="inline">package.json</code> — picking{" "}
            <code className="inline">bun test</code>, <code className="inline">pnpm test</code>,{" "}
            <code className="inline">yarn test</code>, or <code className="inline">npm test</code> from the lockfile — then
            falls back to <code className="inline">cargo test</code> for <code className="inline">Cargo.toml</code> and{" "}
            <code className="inline">go test ./...</code> for <code className="inline">go.mod</code>. Results are posted
            back into the conversation with a ✓/✗ and the full output.
          </p>
          <p>
            With <code className="inline">git.verifyAfterEdit</code> (default <code className="inline">true</code>), the agent
            offers to run that same command after any turn that modified files:
          </p>
          <CodeBlock lang="text">{`{ "git": { "verifyAfterEdit": false } }`}</CodeBlock>
          <p>
            Set it to <code className="inline">false</code> to skip the post-edit prompt, or leave the default and
            get a failing build surfaced right in context for the next step.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
