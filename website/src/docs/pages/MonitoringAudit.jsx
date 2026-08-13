import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What is recorded" },
  { id: "location", label: "Location & naming" },
  { id: "events", label: "The event catalog" },
  { id: "format", label: "Line format" },
  { id: "redaction", label: "Secret redaction" },
  { id: "permissions", label: "File permissions" },
  { id: "neverfails", label: "Why logging never fails the agent" },
  { id: "querying", label: "Querying the log" },
  { id: "retention", label: "Retention" },
  { id: "layers", label: "The other observability layers" },
];

const EVENTS = [
  ["session_start", "model, provider, cwd", "Opens the file. Tells you what was running and where."],
  ["tool_call", "tool, args", "Every invocation, with arguments — redacted."],
  ["tool_result", "tool, result, durationMs", "The outcome and how long it took."],
  ["compact", "reason", "A compaction ran, and why it was triggered."],
  ["compact_error", "reason", "A compaction failed. Three of these arm the circuit breaker."],
  ["checkpoint", "id, label", "A conversation checkpoint was saved."],
  ["mcp_server_load", "serverName, transport", "An MCP server connected."],
  ["session_end", "totalTokens", "Clean shutdown, with the final token count."],
];

const QUERIES = [
  ["Which tools ran", "jq -r 'select(.type==\"tool_call\") | .tool' session.jsonl | sort | uniq -c"],
  ["Slowest calls", "jq -r 'select(.type==\"tool_result\") | [.durationMs, .tool] | @tsv' session.jsonl | sort -rn | head"],
  ["Every shell command", "jq -r 'select(.type==\"tool_call\" and .tool==\"shell\") | .args.command' session.jsonl"],
  ["Compaction history", "jq -r 'select(.type|startswith(\"compact\")) | [.ts,.type,.reason] | @tsv' session.jsonl"],
  ["Session summary", "jq -r 'select(.type==\"session_start\" or .type==\"session_end\")' session.jsonl"],
];

const LAYERS = [
  ["Audit log", "~/.deepseek/logs/*.jsonl", "Per session", "What the agent did, for review after the fact."],
  ["Orchestrator events", "In memory + optional JSONL", "Per orchestration session", "Task lifecycle, workspaces, authorization."],
  ["Kernel event bus", "kernel.db events table", "Durable, queryable", "Replayable history across sessions."],
  ["Cost tracking", "/cost, /stats", "Live", "Token and spend accounting."],
];

export default function MonitoringAudit() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Monitoring & audit</span>
        </nav>

        <div className="hero">
          <h1>Monitoring & audit</h1>
          <p className="tagline">
            An append-only JSONL trail of every tool call, result and lifecycle event — redacted, restricted,
            and written in a way that can never take the session down with it.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What is recorded</h2>
          <p>
            Every session writes an audit log: one JSON object per line, appended as things happen. It
            answers the questions you have after the fact — what did it run, with what arguments, how long
            did it take, and did anything fail.
          </p>
          <p>
            This is not telemetry. Nothing leaves your machine. The log exists so <em>you</em> can review an
            unattended run, debug a session that went sideways, or satisfy a policy that says agent actions
            must be auditable.
          </p>
          <p>
            The design has four properties worth knowing about, each of which is a deliberate choice:
            append-only, redacted, mode <code className="inline">0600</code>, and failure-silent.
          </p>
        </section>

        <section id="location">
          <h2><span className="anchor">#</span>Location & naming</h2>
          <CodeBlock lang="text">{`~/.deepseek/logs/session-<timestamp>-<random>.jsonl

  session-1754923000000-9f2a1c.jsonl
           └─ Date.now() ─┘ └ 3 random bytes`}</CodeBlock>
          <p>
            The id is computed <b>once at module load</b> and reused for the whole process. Every line from a
            single run lands in a single file, and the file name identifies the run.
          </p>
          <p>
            Timestamp-prefixed names sort chronologically as strings, so{" "}
            <code className="inline">ls</code> gives you sessions in order without parsing anything. The random
            suffix prevents collisions between two sessions started in the same millisecond — which happens
            more often than you would expect when a script launches several at once.
          </p>
          <p>
            The directory is created lazily on first write, guarded by an{" "}
            <code className="inline">initialized</code> flag so the check costs nothing on subsequent lines.
          </p>
        </section>

        <section id="events">
          <h2><span className="anchor">#</span>The event catalog</h2>
          <p>
            <code className="inline">AuditEvent</code> is a discriminated union — eight event types, each with
            its own fields:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Type</th><th style={{ width: "26%" }}>Fields</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {EVENTS.map(([t, f, m]) => (
                  <tr key={t}>
                    <td><code className="inline">{t}</code></td>
                    <td><code className="inline">{f}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The union is closed, which means adding an event type is a type-level change rather than a new
            string someone might typo. Consumers can exhaustively handle every case and be told by the
            compiler when a new one appears.
          </p>
          <p>
            The pairing of <code className="inline">tool_call</code> and{" "}
            <code className="inline">tool_result</code> is what makes the log useful for performance work: two
            lines per tool, with the duration on the second. A missing result line for a call is itself a
            finding — it means the session ended mid-tool.
          </p>
          <Note>
            An absent <code className="inline">session_end</code> line means the process did not shut down
            cleanly. That is often the fastest way to spot a crash after the fact.
          </Note>
        </section>

        <section id="format">
          <h2><span className="anchor">#</span>Line format</h2>
          <CodeBlock lang="json">{`{"ts":"2026-08-11T14:02:11.000Z","type":"session_start","model":"deepseek-v4-pro","provider":"deepseek","cwd":"/home/you/proj"}
{"ts":"2026-08-11T14:02:19.412Z","type":"tool_call","tool":"grep","args":{"pattern":"refreshToken","path":"src"}}
{"ts":"2026-08-11T14:02:19.688Z","type":"tool_result","tool":"grep","result":"4 matches","durationMs":276}
{"ts":"2026-08-11T14:31:02.900Z","type":"compact","reason":"auto: usage 0.87 > threshold 0.85"}
{"ts":"2026-08-11T14:58:44.010Z","type":"session_end","totalTokens":184233}`}</CodeBlock>
          <p>
            Every line gets an ISO 8601 <code className="inline">ts</code> prepended before the event's own
            fields are spread in. Timestamp first means a line remains sortable and greppable by time even
            when you are looking at raw text rather than parsed JSON.
          </p>
          <p>
            JSONL rather than a JSON array is what makes the file safe to append to. There is no closing
            bracket to maintain, a crashed process leaves a valid file minus its last line, and standard
            line-oriented tools work directly.
          </p>
        </section>

        <section id="redaction">
          <h2><span className="anchor">#</span>Secret redaction</h2>
          <p>
            Every event passes through <code className="inline">redactSecrets()</code> <b>before</b>{" "}
            serialization — the same function the orchestrator uses for its events and snapshots.
          </p>
          <p>
            This matters because <code className="inline">tool_call</code> records arguments. A shell command
            can legitimately contain a token; an MCP server load can carry a connection string. Without
            redaction, the audit log would be the highest-value secret store on the machine — a plain-text
            file accumulating every credential the agent ever touched.
          </p>
          <p>
            Redaction happens at the write boundary rather than at each call site. One place to get right,
            and no way for a new event type to be added that forgets to redact.
          </p>
          <Note>
            Redaction is pattern-based on credential-shaped values. It is a strong default, not a proof —
            treat the log as sensitive regardless, which is what the file mode assumes.
          </Note>
        </section>

        <section id="permissions">
          <h2><span className="anchor">#</span>File permissions</h2>
          <p>
            Mode <code className="inline">0600</code> is owner read/write only. It is applied twice, and the
            duplication is intentional: the <code className="inline">mode</code> option only takes effect when{" "}
            <code className="inline">appendFile</code> <em>creates</em> the file, so an existing file created
            under a permissive umask would keep its old mode. The explicit{" "}
            <code className="inline">chmod</code> re-asserts the restriction on every write.
          </p>
          <p>
            Belt and braces on a file that records everything the agent did is a reasonable trade for one
            extra syscall per line.
          </p>
        </section>

        <section id="neverfails">
          <h2><span className="anchor">#</span>Why logging never fails the agent</h2>
          <p>
            The entire function is wrapped in a swallowing catch. A full disk, a read-only home directory, a
            permissions problem — none of it interrupts your work.
          </p>
          <p>
            This is a genuine trade-off and worth being explicit about. In a compliance setting you might
            want the opposite: no audit, no execution. Here the priority is the other way round, on the
            reasoning that a local developer tool refusing to run because it could not write a log file is a
            worse outcome than a gap in the log.
          </p>
          <p>
            The practical consequence: <b>do not assume completeness</b>. If the log is load-bearing for you,
            verify the file exists and is growing rather than trusting silence.
          </p>
        </section>

        <section id="querying">
          <h2><span className="anchor">#</span>Querying the log</h2>
          <p>
            JSONL plus <code className="inline">jq</code> covers most questions:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Question</th><th>Command</th></tr>
              </thead>
              <tbody>
                {QUERIES.map(([q, c]) => (
                  <tr key={q}>
                    <td><b style={{ color: "var(--text-strong)" }}>{q}</b></td>
                    <td><code className="inline">{c}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`cd ~/.deepseek/logs

# the most recent session
ls -t session-*.jsonl | head -1

# time spent per tool, worst first
jq -r 'select(.type=="tool_result") | [.tool, .durationMs] | @tsv' "$(ls -t session-*.jsonl | head -1)" \\
  | awk '{t[$1]+=$2} END {for (k in t) printf "%8d ms  %s\\n", t[k], k}' \\
  | sort -rn`}</CodeBlock>
          <p>
            The last one is the highest-value query when a session felt slow. It usually shows one tool
            dominating, and that tool is usually a search that should have been narrower.
          </p>
        </section>

        <section id="retention">
          <h2><span className="anchor">#</span>Retention</h2>
          <p>
            There is <b>no automatic rotation</b>. Logs accumulate one file per session forever. Unlike{" "}
            <a href="/docs/checkpointing#pruning">checkpoints</a>, which are capped at 20, nothing prunes
            this directory — deleting an audit trail on the tool's own initiative would defeat its purpose.
          </p>
          <p>
            Pruning is therefore your decision:
          </p>
          <CodeBlock lang="bash">{`# how much space
du -sh ~/.deepseek/logs

# drop anything older than 30 days
find ~/.deepseek/logs -name 'session-*.jsonl' -mtime +30 -delete

# archive instead of deleting
tar czf ~/audit-$(date +%Y%m).tar.gz ~/.deepseek/logs && rm ~/.deepseek/logs/*.jsonl`}</CodeBlock>
          <p>
            Volume scales with tool calls, not with wall-clock time. A long thinking session is small; a
            short session that grepped a large repository can be large.
          </p>
        </section>

        <section id="layers">
          <h2><span className="anchor">#</span>The other observability layers</h2>
          <p>
            The audit log is one of four, and they answer different questions:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>Layer</th>
                  <th style={{ width: "26%" }}>Where</th>
                  <th style={{ width: "18%" }}>Scope</th>
                  <th>Answers</th>
                </tr>
              </thead>
              <tbody>
                {LAYERS.map(([l, w, s, a]) => (
                  <tr key={l}>
                    <td><b style={{ color: "var(--text-strong)" }}>{l}</b></td>
                    <td><code className="inline">{w}</code></td>
                    <td>{s}</td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Rule of thumb: use the <b>audit log</b> for "what did this session do", the{" "}
            <a href="/docs/agent-teams#events">orchestrator events</a> for "what happened to this task", the{" "}
            <a href="/docs/kernel-persistence#events">kernel event bus</a> for anything spanning sessions,
            and <a href="/docs/costs">/cost</a> for spend.
          </p>
          <p>
            All four share the same redaction guarantee, so none of them is the weak link that leaks what
            the others protect.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
