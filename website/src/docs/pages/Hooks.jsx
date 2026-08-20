import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What hooks are" },
  { id: "events", label: "Supported event families" },
  { id: "config", label: "Configuration shape" },
  { id: "matching", label: "Matchers and scopes" },
  { id: "decisions", label: "Decisions and effects" },
  { id: "input", label: "Input and output" },
  { id: "runtime", label: "Runtime behavior" },
  { id: "security", label: "Security boundaries" },
  { id: "examples", label: "Examples" },
];

const EVENTS = [
  ["Tool gate", "PreToolUse", "Matcher", "Can block or replace the complete tool input before authorization."],
  ["Permission gate", "PermissionRequest", "Matcher", "Can allow or deny a pending permission decision."],
  ["Prompt gate", "UserPromptSubmit", "Command list", "Can block a prompt or add context before the model sees it."],
  ["Stop gate", "Stop", "Command list", "Can return feedback that makes the agent continue instead of completing."],
  ["Compaction", "PreCompact / PostCompact", "Matcher", "Pre can block manual or automatic compaction; Post observes a completed compaction."],
  ["Sub-agents", "TaskCreated / SubagentStart / TaskCompleted / SubagentStop", "Mixed", "Can block task creation or sub-agent start; completion events are observational."],
  ["Session", "Setup / InstructionsLoaded / SessionStart / SessionEnd", "Matcher", "Observe initialization, loaded project instructions and shutdown."],
  ["Tools", "PostToolUse / PostToolUseFailure / PostToolBatch / FileChanged", "Mixed", "Observe successful tools, failures, batches and changed paths."],
  ["Other lifecycle", "PermissionDenied / StopFailure / MessageDisplay / CwdChanged / WorktreeCreate / WorktreeRemove", "Mixed", "Observe or guard the corresponding runtime boundary."],
];

const DECLARED_NOT_WIRED = [
  "UserPromptExpansion",
  "Notification",
  "ConfigChange",
  "DirectoryAdded",
  "Elicitation",
  "ElicitationResult",
  "TeammateIdle",
];

const HOOK_CONFIG = '{\n  "hooks": {\n    "PreToolUse": [\n      {\n        "matcher": "write_file|edit_file|patch_file",\n        "hooks": [\n          {\n            "id": "protect-generated",\n            "type": "command",\n            "command": "node scripts/check-write.js",\n            "timeout": 5\n          }\n        ]\n      }\n    ],\n    "UserPromptSubmit": [\n      { "type": "command", "command": "bun scripts/add-context.ts" }\n    ],\n    "PreCompact": [\n      {\n        "matcher": "manual|auto",\n        "hooks": [{ "type": "command", "command": "bun scripts/compact-policy.ts" }]\n      }\n    ]\n  }\n}';

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
            Executable shell commands that observe or control the agent lifecycle, from prompt submission to
            tool authorization, compaction, sub-agents and shutdown.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What hooks are</h2>
          <p>
            A hook is a command that receives one JSON object on <b>stdin</b>. Its exit status and optional JSON
            written to <b>stdout</b> become a lifecycle result. There is no language-specific SDK: a shell script,
            Bun program, Node program or compiled executable can participate as long as it follows the process
            contract described in <a href="/docs/hook-input-output">Hook input & output</a>.
          </p>
          <p>
            Hooks run as the operating-system user that launched DeepSeek Code. On POSIX systems the configured
            command runs through the default shell; on Windows it runs through <code className="inline">COMSPEC</code>
            (normally <code className="inline">cmd.exe</code>). A hook is therefore executable policy, not harmless
            metadata.
          </p>
          <Note>
            Active executable hooks are loaded from User settings only:
            <code className="inline">~/.deepseek/settings.json</code>. Project and local hook blocks are ignored
            before effective settings are built so a repository cannot silently execute a command on a new machine.
          </Note>
        </section>

        <section id="events">
          <h2><span className="anchor">#</span>Supported event families</h2>
          <p>
            The hook configuration now accepts the expanded lifecycle vocabulary below. “Matcher” events use an
            array of matcher groups; “command list” events use a flat array. The event name is included in every
            stdin payload as both <code className="inline">event</code> and{" "}
            <code className="inline">hook_event_name</code>.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "18%" }}>Family</th><th style={{ width: "31%" }}>Events</th><th style={{ width: "15%" }}>Shape</th><th>Effect</th></tr></thead>
              <tbody>{EVENTS.map(([family, events, shape, effect]) => <tr key={family}><td><b>{family}</b></td><td><code className="inline">{events}</code></td><td>{shape}</td><td>{effect}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            The type contract also reserves several event names for future integrations:
            {DECLARED_NOT_WIRED.map((event) => <span key={event}> <code className="inline">{event}</code></span>)}.
            They are normalized as valid settings keys, but the current agent has no call site that emits them.
            Configuring a reserved event is consequently a no-op until a producer is wired.
          </p>
          <Note>
            A valid key in <code className="inline">settings.json</code> means the schema accepts it; it does not
            promise that every runtime subsystem already emits that event.
          </Note>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Configuration shape</h2>
          <p>
            Matcher events group one or more commands behind a value. Direct command events have no matcher because
            there is no value to select. Both a matcher and an individual command can be disabled without deleting
            the configuration.
          </p>
          <CodeBlock lang="json">{HOOK_CONFIG}</CodeBlock>
          <p>
            Each command supports <code className="inline">type: "command"</code>, a required{" "}
            <code className="inline">command</code>, an optional positive finite <code className="inline">timeout</code>
            in seconds (30 by default), an optional stable <code className="inline">id</code> and{" "}
            <code className="inline">enabled</code>. Missing ids are normalized when settings load.
          </p>
          <p>
            The settings center's Hook library writes compatible entries to User scope, lets you edit event, matcher,
            command and timeout, runs a confirmed simulated test, and toggles enabled state. Leaving the library
            reloads the active settings; it does not replay a fresh SessionStart event.
          </p>
        </section>

        <section id="matching">
          <h2><span className="anchor">#</span>Matchers and scopes</h2>
          <p>
            Tool matchers compare case-insensitively against the actual tool name. Use one exact name, a pipe-separated
            list, an empty matcher or <code className="inline">*</code>. Partial globs and regular expressions are not
            supported.
          </p>
          <CodeBlock lang="text">{'matches:     shell\nmatches:     write_file | edit_file | patch_file\nmatches:     *\nnot a glob:  write_*\nnot an alias: WriteFile when the tool is write_file'}</CodeBlock>
          <p>
            Other matcher events use their event-specific value: <code className="inline">PreCompact</code> and{" "}
            <code className="inline">PostCompact</code> use <code className="inline">manual</code> or{" "}
            <code className="inline">auto</code>; <code className="inline">SessionStart</code> uses its source;
            <code className="inline">SubagentStart</code> and <code className="inline">SubagentStop</code> use the
            agent type; permission and tool events use the tool name; worktree and file events use the relevant path
            or name when the integration supplies one.
          </p>
          <p>
            A project can contain hook-looking settings for documentation or portability, but the executable hook
            loader removes them from the active User resolution. Keep commands reviewed and explicit in the owner
            settings file.
          </p>
        </section>

        <section id="decisions">
          <h2><span className="anchor">#</span>Decisions and effects</h2>
          <p>
            A hook result is folded across all matching commands. The first blocking decision wins; additional
            context is joined; system messages, retries, output suppression and updated input are retained according
            to the lifecycle integration. A hook approval is never a blanket bypass of later authorization.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Output</th><th>Current effect</th></tr></thead>
              <tbody>
                <tr><td><code className="inline">decision: "block"</code></td><td>Blocks a control-capable event; the returned reason is shown at the boundary.</td></tr>
                <tr><td><code className="inline">continue: false</code></td><td>Equivalent blocking signal for lifecycle events.</td></tr>
                <tr><td><code className="inline">hookSpecificOutput.additionalContext</code></td><td>Appends context for prompt submission and sub-agent start integrations.</td></tr>
                <tr><td><code className="inline">decision.behavior: "allow" | "deny"</code></td><td>Allows or denies a permission request; deny blocks the pending request.</td></tr>
                <tr><td><code className="inline">modified_input</code></td><td>PreToolUse replaces the complete argument object before authorization.</td></tr>
                <tr><td>Empty or unrecognized JSON</td><td>No opinion; the event continues unless the process itself failed.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            A failed command, timeout, spawn failure or stdin failure is converted into a block-shaped result. That
            result blocks a gate such as PreToolUse, PermissionRequest, UserPromptSubmit, Stop, PreCompact or
            SubagentStart; observational events record the failure without undoing work that already completed.
          </p>
        </section>

        <section id="input">
          <h2><span className="anchor">#</span>Input and output</h2>
          <p>
            Every payload includes <code className="inline">schema_version: 1</code>, session, correlation and run
            identifiers, the event name and the current working directory. Optional fields describe the boundary:
            prompt text, tool input/result, model, compaction trigger, permission mode, task identity, changed path,
            error details, loaded instruction file or shutdown reason.
          </p>
          <CodeBlock lang="json">{'{\n  "schema_version": 1,\n  "event": "PermissionRequest",\n  "hook_event_name": "PermissionRequest",\n  "session_id": "…",\n  "correlation_id": "…",\n  "run_id": "…",\n  "cwd": "/workspace",\n  "tool_name": "shell",\n  "tool_input": { "command": "bun test" }\n}'}</CodeBlock>
          <p>
            Use stdout for one JSON response only. Send diagnostics to stderr. The full field table, event-specific
            payload examples and parser rules live on <a href="/docs/hook-input-output">Hook input & output</a>.
          </p>
        </section>

        <section id="runtime">
          <h2><span className="anchor">#</span>Runtime behavior</h2>
          <ul className="capabilities">
            <li><b>PreToolUse:</b> matching commands run in configuration order and can chain complete input replacements; authorization sees the final object.</li>
            <li><b>PostToolUse:</b> matching commands are fire-and-forget after a successful tool, with up to 10,000 result characters.</li>
            <li><b>Lifecycle matcher events:</b> matching commands are dispatched as one event group; duplicate command/timeout pairs are de-duplicated.</li>
            <li><b>Timeout:</b> each command has its own 30-second default and captured stdout/stderr are capped at 100,000 bytes each.</li>
            <li><b>Audit:</b> the process retains the newest 500 hook runs in memory, including ids, decisions and truncation state.</li>
          </ul>
          <p>
            For exact ordering around startup, tools, compaction, tasks and shutdown, use{" "}
            <a href="/docs/hook-lifecycle">Hook lifecycle</a>. For failure diagnosis, use{" "}
            <a href="/docs/hook-troubleshooting">Hook troubleshooting</a>.
          </p>
        </section>

        <section id="security">
          <h2><span className="anchor">#</span>Security boundaries</h2>
          <p>
            Hooks are deliberately User-only because a checked-out repository must not gain automatic command
            execution merely by adding a settings file. This protects activation, not execution: once you enable a
            command, it runs with your account and can read environment variables, modify files or start processes.
          </p>
          <p>
            Hooks also do not replace the normal permission pipeline. A rewritten tool input is rechecked for workspace
            containment, risk, external paths, permissions and interaction mode. A hook that allows a permission
            request grants only that pending decision, not every future call.
          </p>
        </section>

        <section id="examples">
          <h2><span className="anchor">#</span>Examples</h2>
          <p>Block writes outside a generated directory:</p>
          <CodeBlock lang="javascript">{'const input = JSON.parse(await Bun.stdin.text());\nconst path = String(input.tool_input?.path ?? "");\nif (!path.startsWith("generated/")) {\n  console.log(JSON.stringify({\n    decision: "block",\n    reason: "Generated files must stay under generated/."\n  }));\n}'}</CodeBlock>
          <p>Add project context before a prompt reaches the model:</p>
          <CodeBlock lang="javascript">{'const branch = Bun.spawnSync(["git", "branch", "--show-current"]).stdout.toString().trim();\nconsole.log(JSON.stringify({\n  hookSpecificOutput: {\n    additionalContext: "Current branch: " + branch\n  }\n}));'}</CodeBlock>
          <Note>
            Keep examples small and fail closed when the policy cannot be evaluated. Test commands from the Hook
            library with a simulated payload before enabling them for every real tool call.
          </Note>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
