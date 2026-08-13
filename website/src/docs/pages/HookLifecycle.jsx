import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "scope", label: "Scope and activation" },
  { id: "timeline", label: "Lifecycle timeline" },
  { id: "session-start", label: "SessionStart" },
  { id: "pre-tool", label: "PreToolUse" },
  { id: "authorization", label: "Authorization after hooks" },
  { id: "post-tool", label: "PostToolUse" },
  { id: "ordering", label: "Ordering and matching" },
  { id: "library", label: "Hook library" },
  { id: "boundaries", label: "Current boundaries" },
];

const EVENTS = [
  ["SessionStart", "During agent initialization", "Sequential and awaited", "No"],
  ["PreToolUse", "After the mode gate, before authorization", "Sequential and awaited", "Yes"],
  ["PostToolUse", "After a tool resolves successfully", "Started without waiting", "No"],
];

const LIBRARY_KEYS = [
  ["↑ / ↓ or j / k", "Move through hooks"],
  ["n", "Create a PreToolUse(*) hook with a 30-second timeout"],
  ["e / m / x", "Edit command, matcher, or timeout"],
  ["v", "Cycle PreToolUse → PostToolUse → SessionStart"],
  ["Space", "Enable or disable the selected command"],
  ["t", "Run the command against a simulated payload"],
  ["d", "Delete the selected command"],
];

export default function HookLifecycle() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Extending</span><span className="sep">/</span><span className="current">Hook lifecycle</span>
        </nav>

        <div className="hero">
          <h1>Hook lifecycle</h1>
          <p className="tagline">
            When each executable hook runs, what it can stop, and which paths never reach it.
          </p>
        </div>

        <section id="scope">
          <h2><span className="anchor">#</span>Scope and activation</h2>
          <p>
            The active CLI hook system reads <code className="inline">hooks</code> from the effective User
            settings. Its file is <code className="inline">~/.deepseek/settings.json</code>. Hook blocks placed
            in project <code className="inline">.deepseek/settings.json</code> or local
            <code className="inline">.deepseek/settings.local.json</code> are reported as ignored and removed
            before effective settings are built.
          </p>
          <Note>
            A repository cannot activate executable hooks by itself. Review a command before copying it into
            User settings: every active hook runs through <code className="inline">sh -c</code> with your OS
            account and the CLI process environment.
          </Note>
          <p>
            The settings center applies compatible hook changes to the running agent when you leave the Hook
            library. A fresh <code className="inline">SessionStart</code> event is not synthesized by that
            reload; it runs on initialization only.
          </p>
        </section>

        <section id="timeline">
          <h2><span className="anchor">#</span>Lifecycle timeline</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th>Event</th><th>Position</th><th>Scheduling</th><th>Can stop the tool?</th></tr></thead>
              <tbody>
                {EVENTS.map(([event, position, scheduling, stops]) => (
                  <tr key={event}><td><code className="inline">{event}</code></td><td>{position}</td><td>{scheduling}</td><td>{stops}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="text">{`agent initialization
  → load settings, project instructions, memory and enabled MCP servers
  → SessionStart hooks, one command at a time

tool request
  → interaction-mode gate
  → matching PreToolUse hooks, one command at a time
  → authorization evaluates the final, possibly rewritten input
  → tool execution
  → tool audit/event completion
  → matching PostToolUse hooks are launched
  → result is delivered to the conversation`}</CodeBlock>
        </section>

        <section id="session-start">
          <h2><span className="anchor">#</span>SessionStart</h2>
          <p>
            <code className="inline">SessionStart</code> is a flat command list because there is no tool name
            to match. Enabled commands run in configuration order and each is awaited before the next begins.
            Their stdin payload contains the event, session identifiers and working directory, but no tool
            fields.
          </p>
          <p>
            Output and failure decisions are ignored by lifecycle control. A non-zero exit or timeout is still
            recorded as a blocked hook run, but initialization continues to the next command. Because execution
            is awaited, a slow command still delays startup by up to its configured timeout.
          </p>
          <CodeBlock lang="json">{`{
  "hooks": {
    "SessionStart": [
      { "id": "check-worktree", "type": "command", "command": "git status --short", "timeout": 5 }
    ]
  }
}`}</CodeBlock>
        </section>

        <section id="pre-tool">
          <h2><span className="anchor">#</span>PreToolUse</h2>
          <p>
            The interaction-mode gate comes first. If a tool is unavailable in the current mode, the request is
            rejected without executing any hook. An allowed tool then enters <code className="inline">PreToolUse</code>.
            Every enabled matching command runs serially and receives the current arguments.
          </p>
          <p>
            A hook may block immediately or replace the complete input object. A replacement becomes the input
            seen by the next hook. The first block stops the remaining hook chain and the tool never runs. If at
            least one matcher applies and none blocks, the aggregate result approves the call; if no matcher
            applies, hooks pass without an opinion.
          </p>
          <CodeBlock lang="text">{`PreToolUse outcomes
no matching matcher                     → pass
matching hooks exit 0 without a block   → approve
one hook returns decision: block        → stop chain and return its reason
one hook returns modified_input         → replace arguments, continue chain`}</CodeBlock>
          <p>
            See <a href="/docs/hook-input-output">Hook input & output</a> for the exact payload and response
            contract.
          </p>
        </section>

        <section id="authorization">
          <h2><span className="anchor">#</span>Authorization after hooks</h2>
          <p>
            A rewrite is not an authorization bypass. After <code className="inline">PreToolUse</code>, the CLI
            evaluates workflow consent, external paths, risk rules, permission allow/deny rules, agent
            allowlists and session confirmations against the <b>effective rewritten arguments</b>. A hook can
            turn an initially safe command into one that is denied or requires confirmation.
          </p>
          <Note>
            A PreToolUse approval means only “the hook chain did not block.” It does not pre-approve the later
            gates. See <a href="/docs/permissions">Permissions</a> for those decisions.
          </Note>
        </section>

        <section id="post-tool">
          <h2><span className="anchor">#</span>PostToolUse</h2>
          <p>
            <code className="inline">PostToolUse</code> is reached only after the tool executor resolves and the
            CLI records its normal audit and lifecycle events. It receives the effective input and at most the
            first 10,000 characters of the tool result.
          </p>
          <p>
            Matching commands are launched without awaiting their completion. Their failures are audited by
            the hook executor but cannot replace, block or delay delivery of the tool result. Concurrent post
            hooks may overlap, so commands that mutate the same file need their own coordination.
          </p>
          <p>
            There is no PostToolUse run when the mode gate, a PreToolUse hook, authorization, or permission
            blocks the request. It is also skipped when the executor throws before producing a normal result.
          </p>
        </section>

        <section id="ordering">
          <h2><span className="anchor">#</span>Ordering and matching</h2>
          <p>
            Pre- and post-tool configuration has two ordered layers: matcher groups, then commands inside each
            group. Both support <code className="inline">enabled: false</code>. Matching is case-insensitive and
            accepts an exact tool name, a pipe-separated list, or the bare <code className="inline">*</code>.
            An empty matcher also matches every tool; partial globs such as
            <code className="inline"> write_*</code> are not supported.
          </p>
          <CodeBlock lang="json">{`{
  "hooks": {
    "PreToolUse": [
      {
        "id": "write-guards",
        "matcher": "write_file | edit_file | patch_file",
        "enabled": true,
        "hooks": [
          { "id": "policy-a", "type": "command", "command": "./scripts/policy-a", "timeout": 5 },
          { "id": "policy-b", "type": "command", "command": "./scripts/policy-b", "timeout": 5 }
        ]
      }
    ]
  }
}`}</CodeBlock>
          <p>
            Missing ids are normalized into stable ids when settings load, and omitted enabled flags become
            <code className="inline">true</code>. Explicit ids are easier to recognize in the Hook library and
            diagnostics.
          </p>
        </section>

        <section id="library">
          <h2><span className="anchor">#</span>Hook library</h2>
          <p>
            Open <code className="inline">/settings</code> or <code className="inline">/config</code>, choose
            <b> Hooks</b>, then <b>Hook library</b>. The editor always persists executable hooks to User scope.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Key</th><th>Action</th></tr></thead>
              <tbody>{LIBRARY_KEYS.map(([key, action]) => <tr key={key}><td><code className="inline">{key}</code></td><td>{action}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            The first test asks for one-time or session-wide confirmation because it executes the real command.
            Its simulated tool is <code className="inline">read_file</code> with a README path; a PostToolUse
            preview also includes a simulated result. Testing here verifies process execution, not whether your
            matcher would select a real tool call.
          </p>
        </section>

        <section id="boundaries">
          <h2><span className="anchor">#</span>Current boundaries</h2>
          <ul className="capabilities">
            <li>The public lifecycle has exactly SessionStart, PreToolUse and PostToolUse.</li>
            <li>Only command handlers executed through the shell are configurable in User settings.</li>
            <li>There is no SessionEnd, failure-only, compaction, prompt, HTTP or agent hook in the active CLI path.</li>
            <li>Plugin manifests can advertise a hooks file, but the current loader only reports its presence; it does not merge that file into active hooks.</li>
            <li>The separate kernel hook runtime is not wired into the current agent loop or settings UI.</li>
          </ul>
          <p>
            For failure behavior and recovery, continue to <a href="/docs/hook-troubleshooting">Hook
            troubleshooting</a>. For the high-level entry point, return to <a href="/docs/hooks">Hooks</a>.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
