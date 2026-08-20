import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "safe-debug", label: "Safe debug sequence" },
  { id: "library-test", label: "Test from settings" },
  { id: "symptoms", label: "Symptom reference" },
  { id: "failures", label: "Failure semantics" },
  { id: "matcher", label: "Matcher problems" },
  { id: "rewrites", label: "Rewrite surprises" },
  { id: "timeouts", label: "Timeouts and output" },
  { id: "scope", label: "Scope and reload" },
  { id: "observability", label: "What you can inspect" },
  { id: "recovery", label: "Recovery checklist" },
];

const SYMPTOMS = [
  ["Tool is blocked with Hook timed out", "The matching PreToolUse command exceeded its timeout.", "Disable it, run it directly with a saved payload, then raise the timeout only if the work is expected."],
  ["Tool is blocked with Hook failed: …", "The command exited non-zero; stderr is used as the reason.", "Run the exact command from the same working directory and fix its dependency or exit path."],
  ["Hook prints JSON but nothing changes", "The event may be observational, the output field may not be consumed by that boundary, or the response may use the wrong contract.", "Confirm the event, use top-level PreToolUse fields for rewrites, and use hookSpecificOutput for lifecycle decisions."],
  ["Hook never runs", "Wrong scope, disabled matcher/command, unmatched tool name, or the mode gate rejected first.", "Verify User scope, toggle both levels on, use an exact /tools name, and switch to a mode that permits the tool."],
  ["Post hook is intermittent", "PostToolUse is launched without awaiting and commands may overlap.", "Make the side effect atomic/idempotent or serialize in the hook command."],
  ["Permission prompt changed after a hook", "modified_input is authorized after the hook chain.", "Inspect the complete replacement object; it may target a different path or command."],
  ["Project hook is listed but ignored", "Executable hooks are User-only.", "Review it, then recreate the approved command in User settings."],
  ["Settings test passes, real call does not", "The test uses a simulated read_file payload and does not exercise the real lifecycle producer.", "Replay the real event shape and confirm the matcher names the real tool, event value, agent type or compaction trigger."],
];

const DIAGNOSTICS = [
  ["Non-zero command", "[hooks] Hook \"<command>\" failed: <stderr or exit code>"],
  ["Non-JSON stdout", "[hooks] PreToolUse hook \"<command>\" returned non-JSON output (run <id>)"],
  ["Wrong decision type", "… returned non-string decision …"],
  ["Wrong reason type", "… returned non-string reason …"],
  ["Wrong replacement type", "… returned non-object modified_input …"],
];

export default function HookTroubleshooting() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Extending</span><span className="sep">/</span><span className="current">Hook troubleshooting</span>
        </nav>

        <div className="hero">
          <h1>Hook troubleshooting</h1>
          <p className="tagline">
            Isolate a broken executable hook without bypassing the policy it was meant to enforce.
          </p>
        </div>

        <section id="safe-debug">
          <h2><span className="anchor">#</span>Safe debug sequence</h2>
          <ol style={{ margin: "0 0 14px 20px" }}>
            <li>Copy the exact refusal or <code className="inline">[hooks]</code> diagnostic before changing anything.</li>
            <li>Open <code className="inline">/settings</code> → <b>Hooks</b> → <b>Hook library</b> at User scope.</li>
            <li>Disable only the selected command with <code className="inline">Space</code> if it blocks all work.</li>
            <li>Run its exact command directly from the CLI working directory with a representative stdin payload.</li>
            <li>Validate that stdout is empty or exactly one response object and that the process exits zero.</li>
            <li>Re-enable it, leave the Hook library so effective settings reload, then retry one matching tool.</li>
          </ol>
          <Note>
            Disabling is safer than deleting: it preserves the command, matcher, timeout and stable id while you
            diagnose it. Do not route the same action through a different tool merely to evade a hook block.
          </Note>
        </section>

        <section id="library-test">
          <h2><span className="anchor">#</span>Test from settings</h2>
          <p>
            Select a hook and press <code className="inline">t</code>. The first test requires confirmation:
          </p>
          <CodeBlock lang="text">{`Run executable hook with a simulated payload?
1 Confirm once · 2 Confirm for session · c Cancel

Test completed · 18ms
Test output: {"decision":"approve"} · 21ms`}</CodeBlock>
          <p>
            Option 2 suppresses further test confirmations only for the current CLI process. The command is
            real, but the payload is synthetic: session id <code className="inline">settings-preview</code>,
            tool <code className="inline">read_file</code>, path <code className="inline">README.md</code>, and
            a simulated flag. PostToolUse receives the literal result <code className="inline">simulated result</code>.
          </p>
          <p>
            This test proves that the process starts and shows its trimmed stdout. It does not prove that a
            matcher selects the intended production tool, that a path policy sees a realistic path, or that a
            post-hook finishes before the session exits.
          </p>
        </section>

        <section id="symptoms">
          <h2><span className="anchor">#</span>Symptom reference</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "25%" }}>Symptom</th><th style={{ width: "31%" }}>Likely cause</th><th>Next check</th></tr></thead>
              <tbody>{SYMPTOMS.map(([symptom, cause, check]) => <tr key={symptom}><td><b>{symptom}</b></td><td>{cause}</td><td>{check}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section id="failures">
          <h2><span className="anchor">#</span>Failure semantics differ by event</h2>
          <p>
            The command runner converts a timeout, spawn/stdin error, or non-zero exit into a block-shaped JSON
            response. What that means depends on who called it:
          </p>
          <CodeBlock lang="text">{`Gate event       → parses the response and can block the pending operation
Observation event → records the run; completed work is not undone
PostToolUse      → fire-and-forget after success; failures cannot delay delivery`}</CodeBlock>
          <p>
            Exit-zero malformed stdout is different from a process failure. The legacy PreToolUse parser logs a
            parsing/type diagnostic and continues; the expanded lifecycle parser treats an unrecognized object as no
            opinion. A command that intends to enforce policy should therefore exit non-zero when it cannot evaluate
            the input; printing an error sentence to stdout while exiting zero fails open.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Condition</th><th>Terminal diagnostic</th></tr></thead>
              <tbody>{DIAGNOSTICS.map(([condition, message]) => <tr key={condition}><td>{condition}</td><td><code className="inline">{message}</code></td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Timeout, spawn and stdin errors return a reason but do not have the same explicit
            <code className="inline"> [hooks] Hook … failed</code> line as a normal non-zero close. The tool
            refusal itself is the primary clue in those cases.
          </p>
        </section>

        <section id="matcher">
          <h2><span className="anchor">#</span>Matcher problems</h2>
          <p>
            Matchers compare the actual tool name case-insensitively. A bare asterisk or an empty string matches
            all tools; otherwise the string is split on pipes, trimmed and compared exactly. There are no globs,
            regular expressions or aliases.
          </p>
          <CodeBlock lang="text">{`works:      "shell"
works:      "write_file | edit_file | patch_file"
works:      "*"
does not:   "write_*"
does not:   "WriteFile" when /tools reports "write_file"`}</CodeBlock>
          <p>
            Run <code className="inline">/tools</code> and copy the name from the Built-in or MCP section. MCP
            names include the server prefix and double underscore. Also remember that Plan and Review reject
            MCP tools at the mode gate, before matching any hook.
          </p>
        </section>

        <section id="rewrites">
          <h2><span className="anchor">#</span>Rewrite surprises</h2>
          <p>
            A replacement must be a JSON object and replaces all arguments. Accidentally returning only the
            changed key can remove required fields, producing a later validation or execution error. Capture a
            representative payload and compare the full object before and after:
          </p>
          <CodeBlock lang="text">{`before: {"path":"src/a.ts","content":"hello"}
bad:    {"modified_input":{"path":"src/b.ts"}}
good:   {"modified_input":{"path":"src/b.ts","content":"hello"}}`}</CodeBlock>
          <p>
            Multiple hooks chain replacements. If the final action is unexpectedly denied, inspect every
            matching command in configuration order; authorization sees the final result, not the original
            request. Details are in <a href="/docs/hook-input-output#rewrite">Replacement and chaining</a>.
          </p>
        </section>

        <section id="timeouts">
          <h2><span className="anchor">#</span>Timeouts and output</h2>
          <p>
            The default is 30 seconds per command. The settings validator accepts only positive finite values,
            expressed in seconds. Each PreToolUse and SessionStart command is awaited, so their latencies add.
            PostToolUse commands can overlap and are not awaited by the agent loop.
          </p>
          <CodeBlock lang="json">{`{
  "id": "fast-policy",
  "type": "command",
  "command": "./scripts/check-policy",
  "timeout": 3,
  "enabled": true
}`}</CodeBlock>
          <p>
            Stdout and stderr capture stop at 100,000 bytes each. PostToolUse receives only the first 10,000
            result characters. If a policy needs information beyond that boundary, move the check earlier or
            inspect a stable artifact directly instead of expecting the complete result payload.
          </p>
        </section>

        <section id="scope">
          <h2><span className="anchor">#</span>Scope and reload</h2>
          <p>
            If the Hook library says <code className="inline">Project and Local hooks are ignored for security</code>,
            switch the settings scope to User. The executable configuration must live in
            <code className="inline">~/.deepseek/settings.json</code>. Malformed containers and non-positive
            timeouts appear under Settings → Advanced → Diagnostics.
          </p>
          <CodeBlock lang="text">{`user: /home/you/.deepseek/settings.json
project: /home/you/project/.deepseek/settings.json
local: /home/you/project/.deepseek/settings.local.json
Unknown keys: none · project:hooks Executable hooks are ignored outside User scope`}</CodeBlock>
          <p>
            Edits made in the Hook library are persisted immediately. Leave the library to trigger the settings
            reload into the active agent. Hand-edited files require Settings → Advanced → <b>Reload settings</b>
            or a new session.
          </p>
        </section>

        <section id="observability">
          <h2><span className="anchor">#</span>What you can inspect</h2>
          <ul className="capabilities">
            <li>The Hook library displays event, matcher, command, id, timeout and enabled state.</li>
            <li>The test action displays trimmed stdout and elapsed milliseconds.</li>
            <li>Terminal diagnostics expose non-zero exits and invalid PreToolUse response shapes.</li>
            <li>The hook executor keeps the newest 500 runs in memory, including truncation state.</li>
          </ul>
          <Note>
            The in-memory hook audit has no current viewer, slash command, persistence file or export. The
            regular <a href="/docs/monitoring-audit">session audit log</a> records tool calls and results, but
            it does not serialize these hook-run records.
          </Note>
        </section>

        <section id="recovery">
          <h2><span className="anchor">#</span>Recovery checklist</h2>
          <CodeBlock lang="text">{`1. Preserve the exact error and command id.
2. Disable one command, not the whole hook configuration.
3. Reproduce with representative JSON on stdin.
4. Require exit 0 and either empty stdout or one valid JSON object.
5. Keep diagnostic prose on stderr.
6. Verify the exact matcher with /tools.
7. Re-enable, leave the library, and retry one operation.
8. If the tool is still denied, inspect mode and permissions after the hook.`}</CodeBlock>
          <p>
            For event ordering, see <a href="/docs/hook-lifecycle">Hook lifecycle</a>. For the wire contract,
            see <a href="/docs/hook-input-output">Hook input & output</a>.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
