import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "transport", label: "Process contract" },
  { id: "identity", label: "Identity fields" },
  { id: "context", label: "Context fields" },
  { id: "events", label: "Event payloads" },
  { id: "legacy", label: "PreToolUse response" },
  { id: "lifecycle", label: "Lifecycle response" },
  { id: "failure", label: "Parsing and failure" },
  { id: "limits", label: "Limits and identifiers" },
];

const IDENTITY = [
  ["schema_version", "1", "Versioned payload format. The current CLI emits number 1."],
  ["event", "HookEvent", "Canonical event name."],
  ["hook_event_name", "HookEvent", "Duplicate event name retained for Claude-compatible consumers."],
  ["session_id", "string", "Hook session identity shared by the agent lifetime."],
  ["correlation_id", "string", "Shared by commands in one event phase."],
  ["run_id", "string", "Unique to one command execution."],
  ["cwd", "string", "Working directory used to build the event."],
];

const CONTEXT = [
  ["tool_name / tool_input", "Tool name and current complete arguments."],
  ["tool_result", "PostToolUse result, capped to the first 10,000 characters."],
  ["prompt", "Original user prompt for UserPromptSubmit."],
  ["model / permission_mode", "Active model and permission context when supplied."],
  ["trigger", "manual, auto, init or maintenance; compaction uses manual/auto."],
  ["last_assistant_message", "Last assistant text for Stop and SubagentStop."],
  ["stop_hook_active", "Whether a stop continuation is already active."],
  ["agent_id / agent_type", "Sub-agent identity and type."],
  ["task_id / task_subject / task_description", "Task metadata for task lifecycle events."],
  ["source / reason", "Session source or lifecycle reason."],
  ["file_path / file_change_type", "Changed file and change/add/unlink classification."],
  ["old_cwd / new_cwd", "Directory transition values for CwdChanged."],
  ["error / error_details", "Failure text and additional diagnostic detail."],
  ["file_path / memory_type / load_reason", "Instruction file metadata for InstructionsLoaded."],
];

const FAILURE_ROWS = [
  ["Exit 0 + empty stdout", "No opinion; continue."],
  ["Exit 0 + valid JSON", "Parse the recognized control fields."],
  ["Exit 0 + non-JSON", "Log a diagnostic and treat it as no opinion."],
  ["Non-zero exit", "Synthesize a block result using stderr or the exit code."],
  ["Timeout", "Synthesize a block result with Hook timed out."],
  ["Spawn/stdin error", "Synthesize a block result with the process error."],
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
            The versioned stdin payload, the two response contracts, and the exact difference between a hook failure and a malformed successful response.
          </p>
        </div>

        <section id="transport">
          <h2><span className="anchor">#</span>Process contract</h2>
          <p>
            DeepSeek Code launches each enabled command through the platform shell, writes one compact JSON object
            to stdin, closes stdin, captures stdout and stderr, and waits up to the command timeout. On POSIX the
            shell is <code className="inline">$SHELL</code> or <code className="inline">/bin/sh</code>; on Windows it
            is <code className="inline">COMSPEC</code> or <code className="inline">cmd.exe</code>.
          </p>
          <p>
            Stdout is a control channel. Emit either nothing or one JSON value. Human diagnostics belong on stderr,
            especially because non-zero stderr becomes the failure reason for a blocking hook.
          </p>
          <CodeBlock lang="bash">{"printf '%s' '{\"schema_version\":1,\"event\":\"PreToolUse\",\"session_id\":\"demo\",\"correlation_id\":\"group-1\",\"run_id\":\"run-1\",\"cwd\":\"/workspace\",\"tool_name\":\"write_file\",\"tool_input\":{\"path\":\"README.md\"}}' | ./scripts/check-write"}</CodeBlock>
        </section>

        <section id="identity">
          <h2><span className="anchor">#</span>Identity fields</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "25%" }}>Field</th><th style={{ width: "22%" }}>Value</th><th>Meaning</th></tr></thead>
              <tbody>{IDENTITY.map(([field, value, meaning]) => <tr key={field}><td><code className="inline">{field}</code></td><td>{value}</td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
          <Note>
            Use <code className="inline">schema_version</code> and <code className="inline">hook_event_name</code>
            instead of inferring a version from optional fields. Correlation ids are not durable across phases.
          </Note>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Context fields</h2>
          <p>
            The payload is sparse. Only fields relevant to the current boundary are added; a missing optional field
            means “not supplied for this event”, not an empty string.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "37%" }}>Fields</th><th>Used for</th></tr></thead>
              <tbody>{CONTEXT.map(([fields, meaning]) => <tr key={fields}><td><code className="inline">{fields}</code></td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section id="events">
          <h2><span className="anchor">#</span>Event payloads</h2>
          <p>A permission request includes the tool and the complete arguments about to be authorized:</p>
          <CodeBlock lang="json">{'{\n  "schema_version": 1,\n  "event": "PermissionRequest",\n  "hook_event_name": "PermissionRequest",\n  "session_id": "…",\n  "correlation_id": "…",\n  "run_id": "…",\n  "cwd": "/workspace",\n  "tool_name": "shell",\n  "tool_input": { "command": "bun test" }\n}'}</CodeBlock>
          <p>A compaction event carries its trigger and active model:</p>
          <CodeBlock lang="json">{'{\n  "schema_version": 1,\n  "event": "PreCompact",\n  "hook_event_name": "PreCompact",\n  "session_id": "…",\n  "correlation_id": "…",\n  "run_id": "…",\n  "cwd": "/workspace",\n  "model": "deepseek-chat",\n  "trigger": "auto"\n}'}</CodeBlock>
          <p>Instruction loading identifies the file and why it was loaded:</p>
          <CodeBlock lang="json">{'{\n  "event": "InstructionsLoaded",\n  "hook_event_name": "InstructionsLoaded",\n  "cwd": "/workspace",\n  "file_path": "/workspace/AGENTS.md",\n  "memory_type": "Project",\n  "load_reason": "session_start"\n}'}</CodeBlock>
          <p>
            <code className="inline">PostToolUse</code> uses the effective arguments that executed and includes a
            bounded result. <code className="inline">Stop</code> and <code className="inline">SubagentStop</code>
            include the latest assistant text when one exists.
          </p>
        </section>

        <section id="legacy">
          <h2><span className="anchor">#</span>PreToolUse response</h2>
          <p>
            PreToolUse retains its sequential, rewrite-aware compatibility runner. Its exit-zero stdout recognizes
            these top-level fields:
          </p>
          <h3 id="rewrite">Replacement and chaining</h3>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "30%" }}>Field</th><th>Effect</th></tr></thead>
              <tbody>
                <tr><td><code className="inline">decision: "block"</code></td><td>Stops the chain and prevents the tool from running.</td></tr>
                <tr><td><code className="inline">decision: "approve"</code></td><td>Records an approval opinion; later authorization still runs.</td></tr>
                <tr><td><code className="inline">reason</code></td><td>Explanation returned with a block.</td></tr>
                <tr><td><code className="inline">modified_input</code></td><td>Replaces the complete argument object for the next hook and final tool authorization.</td></tr>
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{'{ "decision": "block", "reason": "Writes must stay under src/." }'}</CodeBlock>
          <CodeBlock lang="json">{'{ "modified_input": { "path": "src/generated.ts", "content": "..." } }'}</CodeBlock>
          <Note>
            <code className="inline">modified_input</code> is a replacement, not a patch. Include every required
            field. A rewritten path is rechecked by normal authorization.
          </Note>
        </section>

        <section id="lifecycle">
          <h2><span className="anchor">#</span>Lifecycle response</h2>
          <p>
            The expanded lifecycle runner accepts top-level and nested control fields. The integration consuming the
            event decides which fields have an effect; observation hooks cannot retroactively undo completed work.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "40%" }}>Field</th><th>Effect</th></tr></thead>
              <tbody>
                <tr><td><code className="inline">decision: "approve" | "block"</code></td><td>Pass or block a gate-capable lifecycle event.</td></tr>
                <tr><td><code className="inline">continue: false</code></td><td>Blocks the current lifecycle operation.</td></tr>
                <tr><td><code className="inline">reason / stopReason</code></td><td>Human-readable block or continuation reason.</td></tr>
                <tr><td><code className="inline">additionalContext</code></td><td>Context returned to prompt and sub-agent integrations.</td></tr>
                <tr><td><code className="inline">systemMessage</code></td><td>System-facing message retained by the lifecycle result.</td></tr>
                <tr><td><code className="inline">hookSpecificOutput.retry</code></td><td>Requests a retry where the consuming integration honors it.</td></tr>
                <tr><td><code className="inline">hookSpecificOutput.suppressOutput</code></td><td>Requests output suppression where the consuming integration honors it.</td></tr>
                <tr><td><code className="inline">hookSpecificOutput.updatedInput</code></td><td>Updated input metadata for integrations that support it.</td></tr>
                <tr><td><code className="inline">hookSpecificOutput.decision</code></td><td><code className="inline">behavior: allow|deny</code> for permission-style decisions.</td></tr>
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{'{ "hookSpecificOutput": { "decision": { "behavior": "deny", "message": "Policy refused this command." } } }'}</CodeBlock>
        </section>

        <section id="failure">
          <h2><span className="anchor">#</span>Parsing and failure semantics</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "29%" }}>Process outcome</th><th>Hook executor result</th></tr></thead>
              <tbody>{FAILURE_ROWS.map(([outcome, result]) => <tr key={outcome}><td>{outcome}</td><td>{result}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Exit-zero JSON is parsed as an object. Invalid field types are ignored for that response and logged as a
            diagnostic. A non-zero command is different: it is a process failure and becomes a block-shaped result.
            For PreToolUse, malformed JSON therefore fails open while a non-zero exit fails closed.
          </p>
          <p>
            PostToolUse and other observational events may execute after the work they describe. Their block-shaped
            failure is audited, but it cannot un-write a file or withdraw a result already sent to the model.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and identifiers</h2>
          <ul className="capabilities">
            <li>Default timeout: 30 seconds per command; configured values must be positive and finite.</li>
            <li>Captured stdout and stderr: 100,000 bytes each.</li>
            <li>PostToolUse result in stdin: first 10,000 characters.</li>
            <li>In-memory hook audit: newest 500 command runs per process.</li>
            <li>One run id per command; one correlation id per event phase.</li>
          </ul>
          <p>
            Hook output is not a durable archive. If a policy needs complete evidence, write an explicitly authorized
            report from the hook and keep that artifact under the normal project and secret-handling rules.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
