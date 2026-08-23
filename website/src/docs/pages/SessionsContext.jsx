import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "sessions", label: "Session lifecycle" },
  { id: "snapshots", label: "Task snapshots & resume" },
  { id: "export", label: "Exporting sessions" },
  { id: "context", label: "Understanding context usage" },
  { id: "compaction", label: "Compaction (manual & auto)" },
  { id: "microcompact", label: "Micro-compact (zero-LLM)" },
  { id: "checkpoints", label: "Checkpoints & undo" },
  { id: "audit", label: "Audit log" },
  { id: "history", label: "Input & conversation history" },
  { id: "clear", label: "Starting fresh (/clear)" },
];

const AUDIT_EVENTS = [
  ["session_start", "Model, provider, and working directory"],
  ["tool_call", "Tool name and (redacted) arguments"],
  ["tool_result", "Result truncated to 200 chars, plus duration"],
  ["compact / compact_error", "Compaction runs and their failures"],
  ["checkpoint", "Checkpoint id and optional label"],
  ["session_end", "Total tokens consumed"],
  ["mcp_server_load", "MCP server name and transport"],
];

const UNDO = [
  ["/undo", "Restore the last file write"],
  ["/undo all", "Roll back all durable file checkpoints in this process"],
  ["/undo list", "Show the durable file checkpoints available to undo"],
  ["/checkpoint save [label]", "Snapshot model messages plus modified-file metadata"],
  ["/checkpoint list", "List snapshots"],
  ["/checkpoint restore <id>", "Restore model-message history; it does not restore files"],
];

export default function SessionsContext() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Sessions & context</span>
        </nav>

        <div className="hero">
          <h1>Sessions, context & checkpoints</h1>
          <p className="tagline">
            Completed turns are saved best-effort, the context window is finite — know the exact recovery boundary.
          </p>
        </div>

        <section id="sessions">
          <h2><span className="anchor">#</span>Session lifecycle</h2>
          <p>
            After a main-agent turn reaches its completion callback, DeepSeek Code schedules a short,
            best-effort save to{" "}
            <code className="inline">~/.deepseek/sessions/&lt;project&gt;-&lt;sha8&gt;/&lt;id&gt;.json</code>{" "}
            (the <code className="inline">&lt;sha8&gt;</code> is a short hash of the workspace path). Each
            session file records the agent messages, UI messages, files modified, model, provider,
            active agent, and goal.
          </p>
          <p>
            A slash command, a <code className="inline">!</code> shell line, streaming output or an outer
            request error does not independently force that session-record save. Persistence failures are
            swallowed so they cannot crash the TUI, and an abrupt exit can therefore leave the newest state
            absent. The first eligible completed turn is what makes a fresh session discoverable.
          </p>
          <p>
            Sessions are pruned by update time, keeping the newest{" "}
            <code className="inline">sessions.retention</code> records globally (default <b>50</b>). Plain
            <code className="inline">deepseek</code> starts fresh by default. Use
            <code className="inline">deepseek --resume</code> with no ID for the project picker, or pass a
            current 12-character hexadecimal ID directly:
          </p>
          <CodeBlock lang="bash">{`$ deepseek --resume
$ deepseek --resume a1b2c3d4e5f6`}</CodeBlock>
          <p>
            Resume lookup is scoped to the exact absolute current project path. Set
            <code className="inline">sessions.autoResume</code> to{" "}
            <code className="inline">'project-last'</code> to auto-resume the most recent session for the
            current project.
          </p>
          <Note>
            Resume hydrates old messages into a new process with a new session ID. Saved model, provider and
            active-agent values are metadata: current credentials, CLI agent selection and effective settings
            choose the live runtime. The modified-file tracker, process counters and the raw prompt used by
            <code className="inline">/retry</code> are not restored.
          </Note>
        </section>

        <section id="snapshots">
          <h2><span className="anchor">#</span>Task snapshots & resume</h2>
          <p>
            Beyond the transcript, the session's <b>task graph</b> (delegated sub-agent tasks and
            their orchestration state) is snapshotted to{" "}
            <code className="inline">~/.deepseek/task-snapshots/&lt;sha256&gt;.json</code> — a sha256 of
            the session id. Writes are <b>atomic</b> (temp file + rename), use{" "}
            <code className="inline">0600</code> permissions, and pass through{" "}
            <code className="inline">redactSecrets</code> so credentials are stored as{" "}
            <code className="inline">[REDACTED]</code>. On load, a snapshot is <b>tamper-rejected</b>:
            the identity, graph (states, dependencies, cycles), and workspace envelope are validated
            before anything is restored.
          </p>
          <p>
            Task snapshots are keyed by the orchestration session ID and can restore a runtime only when it
            starts with that same identity and project root. During that same-ID restoration, interrupted
            running work is reconciled, unavailable queued runners are blocked, workspace ownership is
            validated and the generic <code className="inline">AgentN</code> counter continues safely.
          </p>
          <Note>
            Ordinary <code className="inline">deepseek --resume</code> is conversation continuation, not
            same-ID orchestration recovery: the CLI creates a new ID before loading saved messages. It does
            not automatically attach or reconcile the old task snapshot. Inspect old task artifacts separately
            rather than assuming workers resumed.
          </Note>
        </section>

        <section id="export">
          <h2><span className="anchor">#</span>Exporting sessions</h2>
          <p>
            Export a sanitized transcript with{" "}
            <code className="inline">/sessions export &lt;12-char-id&gt; [json|md]</code>:
          </p>
          <CodeBlock lang="bash">/sessions <span className="k">export</span> <span className="s">a1b2c3d4e5f6</span> <span className="m">md</span></CodeBlock>
          <p>
            This writes <code className="inline">.deepseek/session-&lt;id&gt;.sanitized.json|md</code> in the
            current workspace. The content is passed through <code className="inline">redactSecrets</code>{" "}
            before writing, so credentials and API keys are scrubbed from the export. The Markdown
            format renders each message as a <code className="inline">## Role</code> section.
          </p>
          <Note>
            Exported files are written with <code className="inline">0600</code> permissions — the
            transcript stays private to you.
          </Note>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Understanding context usage</h2>
          <p>
            The direct DeepSeek API models get a <b>1,000,000-token</b> context window
            (<code className="inline">deepseek-v4-flash</code>, <code className="inline">deepseek-v4-pro</code> and{" "}
            <code className="inline">deepseek-v4-flash-vision-exp</code>).
            Other providers/models are limited by their
            window (for example 128K on Bedrock and Vertex).
          </p>
          <p>
            Run <code className="inline">/context</code> (or <code className="inline">/ctx</code>) to see an
            estimated live-window breakdown across system prompt, tool definitions, memory, and
            conversation (messages plus tool results). Category sizes are proportional estimates —
            only the total is exact, straight from the provider.
          </p>
          <p>
            DeepSeek V4 models have built-in thinking mode and may return{" "}
            <code className="inline">reasoning_content</code> on any message. This field is{" "}
            <b>always preserved</b> in the saved history and re-sent to the API — the API requires it
            to be passed back, and the request fails otherwise. Preservation holds across compaction
            boundaries and aborts.
          </p>
        </section>

        <section id="compaction">
          <h2><span className="anchor">#</span>Compaction (manual & auto)</h2>
          <p>
            <code className="inline">/compact</code> asks the LLM to summarize everything after the last
            compact boundary into a 9-section structured summary — Primary Task, Key Technical
            Decisions, Current State, Files Modified, Errors & Solutions, Pending Tasks,
            Requirements, Code Patterns, and Open Questions. It then resets to system + boundary +
            summary and re-injects <code className="inline">DEEPSEEK.md</code> so project instructions are
            fresh.
          </p>
          <p>
            Auto-compact fires before a turn (and mid-turn past the threshold) when usage exceeds{" "}
            <code className="inline">compaction.threshold</code> (configurable from{" "}
            <code className="inline">0.70</code> to <code className="inline">0.95</code>), and is controlled by{" "}
            <code className="inline">compaction.enabled</code>. A circuit breaker disables auto-compact
            after 3 consecutive failures (manual <code className="inline">/compact</code> still works), and a
            13k-token buffer keeps headroom so the compaction prompt itself fits.
          </p>
        </section>

        <section id="microcompact">
          <h2><span className="anchor">#</span>Micro-compact (zero-LLM)</h2>
          <p>
            Before each turn, old tool-result contents from read-only tools (<code className="inline">read_file</code>,{" "}
            <code className="inline">grep</code>, <code className="inline">glob</code>,{" "}
            <code className="inline">list_files</code>, <code className="inline">web_search</code>,{" "}
            <code className="inline">web_fetch</code>, and friends) are replaced with a truncation note —
            keeping the last 8 results, and only touching results longer than 200 characters. This is
            pure context reduction: no LLM call, no summary, just reclaimed tokens.
          </p>
        </section>

        <section id="checkpoints">
          <h2><span className="anchor">#</span>Checkpoints & undo</h2>
          <p>
            <code className="inline">/checkpoint</code> snapshots the full model-message array plus the paths
            currently tracked as modified. Restoring a checkpoint replaces message history; it does not roll
            workspace files back:
          </p>
          <CodeBlock lang="bash">{`/checkpoint save before refactor     # snapshot with an optional label
/checkpoint list                      # list snapshots
/checkpoint restore <id>              # restore one`}</CodeBlock>
          <p>
            Every <code className="inline">write_file</code>/<code className="inline">patch_file</code> also records
            a per-file checkpoint. <code className="inline">/undo</code> restores the latest in-memory write;
            <code className="inline">/undo all</code> restores every durable file checkpoint in reverse order;
            and <code className="inline">/undo list</code> lists those durable entries. The in-memory undo stack
            covers the last 10 writes in the process.
          </p>
          <p>
            Under the hood: the in-memory stack is capped at <code className="inline">UNDO_STACK_MAX</code>{" "}
            (10), while durable per-file backups are written <b>before</b> each write/patch to{" "}
            <code className="inline">~/.deepseek-code/checkpoints/&lt;sessionId&gt;/files/</code>. Files
            matching <code className="inline">settings.git.generatedPatterns</code> are excluded from
            both, and undo paths are re-validated against the workspace on restore — a path that no
            longer resolves inside the project is refused.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "38%" }}>Command</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {UNDO.map(([c, d]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="audit">
          <h2><span className="anchor">#</span>Audit log</h2>
          <p>
            Every session writes a JSONL audit trail to{" "}
            <code className="inline">~/.deepseek/logs/session-&lt;ts&gt;-&lt;hex&gt;.jsonl</code>:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Event</th><th>Records</th></tr>
              </thead>
              <tbody>
                {AUDIT_EVENTS.map(([e, d]) => (
                  <tr key={e}>
                    <td><code className="inline">{e}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Secrets are redacted before writing, the file is kept at{" "}
            <code className="inline">0600</code>, and logging <b>never throws</b> — a failed append is
            silently skipped so the agent keeps running.
          </p>
        </section>

        <section id="history">
          <h2><span className="anchor">#</span>Input & conversation history</h2>
          <p>
            Your typed input is recorded in{" "}
            <code className="inline">~/.deepseek/input_history.json</code> — capped at{" "}
            <b>200 entries</b>, with consecutive duplicates dropped, and{" "}
            <code className="inline">/commands</code> and <code className="inline">!shell</code> lines ignored.
          </p>
          <p>
            A separate <code className="inline">~/.deepseek/history.json</code> keeps the{" "}
            <b>last 500 model-facing messages</b> from the most recently written live history. It is a
            bounded compatibility/history artifact, not a per-session store and not the source of the picker.
            The project picker reads the structured records below
            <code className="inline">~/.deepseek/sessions/</code> when you launch
            <code className="inline">deepseek --resume</code> without an ID.
          </p>
        </section>

        <section id="clear">
          <h2><span className="anchor">#</span>Starting fresh (/clear)</h2>
          <p>
            <code className="inline">/clear</code> immediately resets model-facing history to the current
            system/project prompt, clears the visible transcript, the in-memory undo stack and the tracked
            modified-file set. It does not delete or restore workspace files, create a new session ID, revoke
            approvals, stop goals/tasks/workflows, or reset model, effort and usage counters.
          </p>
          <p>
            The command does not immediately rewrite or delete the saved record, so the older disk snapshot
            may remain briefly. Once a later main-agent turn completes, the same session ID is saved with the
            cleared history plus new messages, replacing that record&apos;s resumable conversation. Export anything
            you need before clearing; use a new process when you need an independent session ID.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
