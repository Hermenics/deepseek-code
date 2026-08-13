import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What hooks are" },
  { id: "events", label: "The three events" },
  { id: "config", label: "Configuration shape" },
  { id: "matching", label: "Matcher patterns" },
  { id: "input", label: "The JSON input" },
  { id: "output", label: "PreToolUse output" },
  { id: "failclosed", label: "Every failure is a block" },
  { id: "timeout", label: "Timeouts & output limits" },
  { id: "audit", label: "The hook audit log" },
  { id: "examples", label: "Examples" },
  { id: "practices", label: "Practices" },
];

const EVENTS = [
  ["PreToolUse", "Before a tool runs", "approve, block, or rewrite the input", "Matcher list"],
  ["PostToolUse", "After a tool produces a result", "observe — formatting, linting, notification", "Matcher list"],
  ["SessionStart", "Once, when a session begins", "observe — warm caches, print context", "Command list"],
];

const INPUT_FIELDS = [
  ["schema_version", "1", "Always 1. Lets a hook detect a future format change."],
  ["event", "HookEvent", "PreToolUse, PostToolUse or SessionStart."],
  ["session_id", "string", "The session this belongs to."],
  ["correlation_id", "string", "Shared by every hook run for one tool call."],
  ["run_id", "string", "Unique to this single hook execution."],
  ["cwd", "string", "The working directory at execution time."],
  ["tool_name", "string?", "The tool being called. Absent for SessionStart."],
  ["tool_input", "object?", "The tool's arguments. Absent for SessionStart."],
  ["tool_result", "string?", "The result. PostToolUse only."],
];

const OUTPUT_FIELDS = [
  ["decision", "'approve' | 'block'", "Omit to pass through without an opinion."],
  ["reason", "string", "Shown when blocking. Write it for whoever reads the refusal."],
  ["modified_input", "object", "Replaces the tool arguments for this call."],
];

const FAILURES = [
  ["Non-zero exit", "block", "stderr if present, otherwise \"exited with code N\"."],
  ["Timeout", "block", "\"Hook timed out\"."],
  ["Spawn error", "block", "The spawn error message."],
  ["stdin error", "block", "\"stdin error: …\"."],
  ["Exit 0, empty stdout", "pass", "No opinion. The call proceeds."],
  ["Exit 0, JSON stdout", "as stated", "approve or block per the payload."],
];

const LIMITS = [
  ["timeout", "30 seconds", "Per hook command. Configurable per hook."],
  ["MAX_OUTPUT_BYTES", "100,000", "Cap on captured stdout and stderr each."],
  ["MAX_HOOK_AUDIT_ENTRIES", "500", "In-memory audit entries retained per session."],
];

const PRACTICES = [
  ["Make hooks fast", "A 30-second cap is a ceiling, not a budget. Every hook runs on every matching call."],
  ["Match narrowly", "\"*\" runs your hook on reads and searches too. Name the tools you mean."],
  ["Exit 0 unless you mean to block", "A crashing hook does not fail open — it blocks the tool."],
  ["Give a reason when blocking", "The reason is the only explanation anyone gets."],
  ["Prefer PostToolUse for side effects", "Formatting and linting belong after the edit, not before it."],
];

export default function Hooks() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Extending</span><span className="sep">/</span><span className="current">Hooks</span>
        </nav>

        <div className="hero">
          <h1>Hooks</h1>
          <p className="tagline">
            Shell commands that run around tool calls — able to approve, block, or rewrite what the agent
            was about to do. Every failure path fails closed.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What hooks are</h2>
          <p>
            A hook is a shell command. It receives a JSON payload on <b>stdin</b>, and what it writes to{" "}
            <b>stdout</b> can change what happens next. There is no plugin API, no SDK, and no language
            requirement — anything that reads stdin and writes stdout works.
          </p>
          <p>
            That choice has a consequence worth stating plainly: hooks run{" "}
            <code className="inline">sh -c &lt;your command&gt;</code> with your permissions. They are the most
            powerful extension point in the product and the one to be most careful installing from someone
            else.
          </p>
          <p>
            Hooks sit alongside the <a href="/docs/how-it-works#gates">three permission gates</a> rather than
            inside them. A <code className="inline">PreToolUse</code> hook can veto a call that workspace
            containment, risk assessment and permission resolution all approved.
          </p>
        </section>

        <section id="events">
          <h2><span className="anchor">#</span>The three events</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "18%" }}>Event</th>
                  <th style={{ width: "24%" }}>Fires</th>
                  <th style={{ width: "32%" }}>Can</th>
                  <th>Config shape</th>
                </tr>
              </thead>
              <tbody>
                {EVENTS.map(([e, f, c, s]) => (
                  <tr key={e}>
                    <td><code className="inline">{e}</code></td>
                    <td>{f}</td>
                    <td>{c}</td>
                    <td>{s}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Only <code className="inline">PreToolUse</code> can influence the outcome. The other two observe —
            which is why they take a flat command list rather than matchers with decisions.
          </p>
          <p>
            <code className="inline">SessionStart</code> is the odd one structurally: it is a bare{" "}
            <code className="inline">HookCommand[]</code> with no matcher, because there is no tool to match
            against.
          </p>
          <Note>
            Three events is the complete set. There is no PreCompact, no PreSubmit, no PostSession.
          </Note>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Configuration shape</h2>
          <CodeBlock lang="json">{`// .deepseek/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "id": "guard-generated",
        "matcher": "write_file|edit_file|patch_file",
        "enabled": true,
        "hooks": [
          { "id": "check-generated", "type": "command",
            "command": "node scripts/refuse-generated.js", "timeout": 5 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "edit_file|write_file",
        "hooks": [{ "type": "command", "command": "bunx tsc --noEmit" }]
      }
    ],
    "SessionStart": [
      { "type": "command", "command": "git fetch --quiet || true" }
    ]
  }
}`}</CodeBlock>
          <p>
            Two levels of grouping, and both matter. A <b>matcher</b> pairs a tool pattern with a list of
            commands; a <b>command</b> carries the shell string, an optional timeout, an optional id and an
            optional <code className="inline">enabled</code> flag.
          </p>
          <p>
            <code className="inline">enabled: false</code> exists at both levels because disabling is the common
            debugging move. Commenting out JSON is not possible, and deleting a block you want back is worse
            than a flag.
          </p>
          <p>
            The <code className="inline">id</code> fields are optional and worth setting — they appear in the{" "}
            <a href="#audit">audit log</a>, which is how you tell two hooks apart when one is misbehaving.
          </p>
        </section>

        <section id="matching">
          <h2><span className="anchor">#</span>Matcher patterns</h2>
          <p>
            A matcher is a tool-name pattern with exactly three forms:
          </p>
          <CodeBlock lang="text">{`"*"                             every tool
"shell"                         exactly shell
"write_file|edit_file"          any of the listed tools`}</CodeBlock>
          <p>
            Matching is case-insensitive and, notably, <b>not glob</b>. The pattern is split on{" "}
            <code className="inline">|</code>, each part is trimmed and lowercased, and membership is tested.
            There is no wildcard beyond the bare <code className="inline">*</code> — you cannot write{" "}
            <code className="inline">write_*</code>.
          </p>
          <p>
            That is a deliberate simplification. A hook matcher answers "which tools", a small closed set you
            can enumerate, and enumerating three names is clearer than a pattern that might quietly start
            matching a tool added later.
          </p>
          <p>
            An empty pattern is treated as <code className="inline">*</code>, so a misconfigured matcher runs on
            everything rather than silently on nothing — visible over-application instead of invisible
            absence.
          </p>
          <p>
            Multiple matchers can match one call. All of them run, in configuration order.
          </p>
        </section>

        <section id="input">
          <h2><span className="anchor">#</span>The JSON input</h2>
          <p>
            Every hook receives one JSON object on stdin:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Field</th><th style={{ width: "22%" }}>Type</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {INPUT_FIELDS.map(([f, t, m]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`{
  "schema_version": 1,
  "event": "PreToolUse",
  "session_id": "9f2a1c4b",
  "correlation_id": "7c31a9de-…",
  "run_id": "b2f04e11-…",
  "cwd": "/home/you/proj",
  "tool_name": "write_file",
  "tool_input": { "path": "src/generated/api.ts", "content": "…" }
}`}</CodeBlock>
          <p>
            The <code className="inline">correlation_id</code> / <code className="inline">run_id</code> pair is the
            part people miss. One tool call may trigger several hooks; they all share a{" "}
            <code className="inline">correlation_id</code> and each gets its own{" "}
            <code className="inline">run_id</code>. That is what makes "these four hook runs were about the same
            call" recoverable from the audit log.
          </p>
          <p>
            <code className="inline">schema_version</code> is present from the first version rather than added
            when it first changes — which is the only time adding it is free.
          </p>
        </section>

        <section id="output">
          <h2><span className="anchor">#</span>PreToolUse output</h2>
          <p>
            A <code className="inline">PreToolUse</code> hook may print JSON to stdout:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Field</th><th style={{ width: "26%" }}>Type</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {OUTPUT_FIELDS.map(([f, t, e]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`#!/usr/bin/env bash
input=$(cat)
path=$(echo "$input" | jq -r '.tool_input.path // ""')

case "$path" in
  */generated/*|*.gen.ts)
    echo '{"decision":"block","reason":"generated file — edit the template instead"}'
    ;;
  *)
    ;;   # no output = no opinion
esac`}</CodeBlock>
          <p>
            <b>Printing nothing is the common case.</b> A hook with no opinion exits 0 silently and the call
            proceeds — which means a hook that only cares about one path does not need an "approve" branch.
          </p>
          <p>
            <code className="inline">modified_input</code> is the powerful one: it <b>replaces</b> the tool's
            arguments. Values are validated before use — strings must be strings, the replacement input must
            be a non-array object — so a malformed rewrite is rejected rather than passed to the tool.
          </p>
          <p>
            When several hooks match, the modified input <b>chains</b>: each hook receives what the previous
            one produced, so two hooks can each adjust one field.
          </p>
        </section>

        <section id="failclosed">
          <h2><span className="anchor">#</span>Every failure is a block</h2>
          <p>
            This is the single most important thing to understand about hooks. Every abnormal exit path
            resolves to <code className="inline">block</code>:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Situation</th><th style={{ width: "16%" }}>Decision</th><th>Reason given</th></tr>
              </thead>
              <tbody>
                {FAILURES.map(([s, d, r]) => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td><code className="inline">{d}</code></td>
                    <td>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            A hook that crashes, times out, cannot be spawned, or exits non-zero <b>stops the tool call</b>.
            It does not fail open.
          </p>
          <p>
            The reasoning is that hooks exist to enforce policy. A security hook that silently stops working
            when a dependency is missing provides <em>negative</em> value: the policy is gone and nothing
            says so. Failing closed makes a broken hook immediately visible — the agent stops being able to
            work, and you fix it.
          </p>
          <p>
            The practical consequence: <b>a hook that is not carefully written will block your session</b>.
            Test it standalone before enabling it:
          </p>
          <CodeBlock lang="bash">{`echo '{"schema_version":1,"event":"PreToolUse","tool_name":"write_file",
"tool_input":{"path":"src/a.ts"}}' | ./my-hook.sh; echo "exit=$?"`}</CodeBlock>
          <p>
            Blocking failures are also logged to the terminal as{" "}
            <code className="inline">[hooks] Hook "&lt;command&gt;" failed: &lt;reason&gt;</code>, so a
            mysteriously refused tool call names its cause.
          </p>
        </section>

        <section id="timeout">
          <h2><span className="anchor">#</span>Timeouts & output limits</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Limit</th><th style={{ width: "18%" }}>Default</th><th>Applies to</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([l, d, a]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{d}</code></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The timeout is enforced twice — once through the spawn option and once by an explicit timer that{" "}
            <code className="inline">SIGKILL</code>s the process. The belt-and-braces matters because a hook
            that ignores the first mechanism would otherwise hang the loop indefinitely.
          </p>
          <p>
            Output is capped at 100,000 bytes for stdout and stderr each, and truncation is recorded as{" "}
            <code className="inline">output_truncated</code> in the audit entry rather than silently discarded.
            A hook that dumps a large file cannot exhaust memory.
          </p>
          <p>
            Cap your own timeout tightly. A validation hook should take milliseconds; if it takes seconds,
            every matching tool call pays that cost.
          </p>
        </section>

        <section id="audit">
          <h2><span className="anchor">#</span>The hook audit log</h2>
          <p>
            Every execution produces a <code className="inline">HookRun</code> record: run and hook ids, event,
            command, correlation and session ids, start and finish timestamps, exit code, decision, error
            and whether output was truncated.
          </p>
          <p>
            The log is in memory, bounded at 500 entries, and trimmed from the front when it overflows —
            recent history is what diagnoses a live problem, and an unbounded array in a long session is a
            leak.
          </p>
          <p>
            One implementation detail is visible in behavior: a{" "}
            <code className="inline">finalized</code> guard ensures the error and close handlers cannot both
            write an entry for the same run. Without it, a hook that errors and then closes would appear
            twice, and the duplicate would be the one with the misleading exit code.
          </p>
        </section>

        <section id="examples">
          <h2><span className="anchor">#</span>Examples</h2>
          <p><b>Typecheck after every edit.</b> The most useful hook there is:</p>
          <CodeBlock lang="json">{`{ "matcher": "edit_file|write_file|patch_file",
  "hooks": [{ "type": "command", "command": "bunx tsc --noEmit" }] }`}</CodeBlock>
          <p><b>Format after writes.</b> Post-hoc, so the agent's content is not rewritten mid-flight:</p>
          <CodeBlock lang="json">{`{ "matcher": "write_file|edit_file",
  "hooks": [{ "type": "command", "command": "bunx prettier --write .", "timeout": 20 }] }`}</CodeBlock>
          <p><b>Refuse edits to vendored code.</b> A block with a reason:</p>
          <CodeBlock lang="bash">{`#!/usr/bin/env bash
path=$(jq -r '.tool_input.path // ""')
case "$path" in
  vendor/*|node_modules/*)
    echo '{"decision":"block","reason":"vendored — change the upstream dependency"}' ;;
esac`}</CodeBlock>
          <p><b>Normalize a path.</b> Rewriting input rather than refusing it:</p>
          <CodeBlock lang="bash">{`#!/usr/bin/env bash
input=$(cat)
echo "$input" | jq -c '{modified_input: (.tool_input | .path |= sub("^\\\\./"; ""))}'`}</CodeBlock>
        </section>

        <section id="practices">
          <h2><span className="anchor">#</span>Practices</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Practice</th><th>Why</th></tr>
              </thead>
              <tbody>
                {PRACTICES.map(([p, w]) => (
                  <tr key={p}>
                    <td><b style={{ color: "var(--text-strong)" }}>{p}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The third is the one that bites. In most systems a broken extension is ignored; here it blocks.
            If you are writing a hook in a language with an unhandled-exception exit code, make sure the
            happy path exits 0 explicitly.
          </p>
          <p>
            Hooks can also ship inside a plugin, which is the clean way to distribute one to a team — see{" "}
            <a href="/docs/plugin-authoring">Plugin authoring</a>. For whole-suite checks rather than
            per-edit ones, see <a href="/docs/verification">Verification</a>.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
