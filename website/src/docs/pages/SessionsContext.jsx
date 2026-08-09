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
  ["/undo-all", "Roll back all writes in this session"],
  ["/undo-list", "Show what can be undone"],
  ["/checkpoint save [label]", "Snapshot messages + files"],
  ["/checkpoint list", "List snapshots"],
  ["/checkpoint restore <id>", "Restore a snapshot"],
];

export default function SessionsContext() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Sessions &amp; context</span>
        </nav>

        <div className="hero">
          <h1>Sessions, context &amp; checkpoints</h1>
          <p className="tagline">
            Everything is persisted, the context window is finite — here's the safety net.
          </p>
        </div>

        <section id="sessions">
          <h2><span className="anchor">#</span>Session lifecycle</h2>
          <p>
            Every turn is saved to disk at{" "}
            <code className="inline">~/.deepseek/sessions/&lt;project&gt;-&lt;sha8&gt;/&lt;id&gt;.json</code>{" "}
            (the <code className="inline">&lt;sha8&gt;</code> is a short hash of the workspace path). Each
            session file records the agent messages, UI messages, files modified, model, provider,
            active agent, and goal.
          </p>
          <p>
            Sessions are pruned by age, keeping the newest{" "}
            <code className="inline">settings.sessions.retention</code> (default <b>50</b>).{" "}
            <code className="inline">deepseek</code> with no arguments shows a resume picker, or you can
            resume directly:
          </p>
          <CodeBlock lang="bash">$ <span className="k">deepseek</span> <span className="m">--resume</span> <span className="s">&lt;session-id&gt;</span></CodeBlock>
          <p>
            Set <code className="inline">settings.sessions.autoResume</code> to{" "}
            <code className="inline">'project-last'</code> to auto-resume the most recent session for the
            current project.
          </p>
        </section>

        <section id="snapshots">
          <h2><span className="anchor">#</span>Task snapshots &amp; resume</h2>
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
            Resuming a session reconciles the graph: tasks that were <b>running</b> when the process
            died become <code className="inline">failed</code> with the{" "}
            <code className="inline">INTERRUPTED</code> error (retryable), and <b>queued</b> tasks with
            no reattached runner become <code className="inline">blocked</code> with{" "}
            <i>"Runner unavailable after restart"</i> until a runner is attached. The{" "}
            <code className="inline">AgentN</code> naming counter is re-derived from the restored
            tasks, so new spawns continue the sequence.
          </p>
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
            DeepSeek models get a <b>1,000,000-token</b> context window (<code className="inline">deepseek-v4-flash</code>,{" "}
            <code className="inline">deepseek-v4-pro</code>, <code className="inline">deepseek-chat</code>,{" "}
            <code className="inline">deepseek-reasoner</code>). Other providers/models are limited by their
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
          <h2><span className="anchor">#</span>Compaction (manual &amp; auto)</h2>
          <p>
            <code className="inline">/compact</code> asks the LLM to summarize everything after the last
            compact boundary into a 9-section structured summary — Primary Task, Key Technical
            Decisions, Current State, Files Modified, Errors &amp; Solutions, Pending Tasks,
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
          <h2><span className="anchor">#</span>Checkpoints &amp; undo</h2>
          <p>
            <code className="inline">/checkpoint</code> snapshots the full message array plus modified files:
          </p>
          <CodeBlock lang="bash">{`/checkpoint save "before refactor"   # snapshot with an optional label
/checkpoint list                      # list snapshots
/checkpoint restore <id>              # restore one`}</CodeBlock>
          <p>
            Every <code className="inline">write_file</code>/<code className="inline">patch_file</code> also records
            a per-file checkpoint. <code className="inline">/undo</code>, <code className="inline">/undo-all</code>, and{" "}
            <code className="inline">/undo-list</code> roll back individual writes, and an in-memory undo
            stack covers the last 10 writes in the session.
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
          <h2><span className="anchor">#</span>Input &amp; conversation history</h2>
          <p>
            Your typed input is recorded in{" "}
            <code className="inline">~/.deepseek/input_history.json</code> — capped at{" "}
            <b>200 entries</b>, with consecutive duplicates dropped, and{" "}
            <code className="inline">/commands</code> and <code className="inline">!shell</code> lines ignored.
          </p>
          <p>
            A separate <code className="inline">~/.deepseek/history.json</code> keeps the{" "}
            <b>last 500 messages</b> (system prompt plus the most recent messages) per session, which
            is what powers the resume picker when you launch{" "}
            <code className="inline">deepseek</code> with no arguments.
          </p>
        </section>

        <section id="clear">
          <h2><span className="anchor">#</span>Starting fresh (/clear)</h2>
          <p>
            <code className="inline">/clear</code> empties the live context. Because every turn is already
            saved to disk, the previous conversation survives and can be resumed later with{" "}
            <code className="inline">deepseek --resume &lt;session-id&gt;</code> — clearing is a fresh start,
            not a loss.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
