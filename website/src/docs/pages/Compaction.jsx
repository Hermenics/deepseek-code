import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "three", label: "Two active mechanisms" },
  { id: "full", label: "Full compaction (/compact)" },
  { id: "summary", label: "The nine-section summary" },
  { id: "boundary", label: "The compact boundary" },
  { id: "cleanup", label: "Post-compact cleanup" },
  { id: "auto", label: "Automatic compaction" },
  { id: "breaker", label: "The circuit breaker" },
  { id: "micro", label: "Micro-compaction" },
  { id: "enhanced", label: "Enhanced micro-compaction" },
  { id: "config", label: "Configuration" },
  { id: "choosing", label: "Choosing the right tool" },
];

const MECHANISMS = [
  ["Full compaction", "/compact, auto", "Yes", "Replaces the active conversation with a structured summary."],
  ["Selective micro-compaction", "Before each turn", "No", "Clears older, long results from an allowlist of read-only tools and keeps the latest 8 candidates."],
];

const SECTIONS = [
  ["1. Primary Task", "The original request and what the user is trying to accomplish."],
  ["2. Key Technical Decisions", "Architecture, library and approach choices — with the reasoning."],
  ["3. Current Implementation State", "What has been built or modified, and what is working."],
  ["4. Files Modified", "Every path read, created, or modified, each with a note."],
  ["5. Errors & Solutions", "What broke and how it was resolved."],
  ["6. Pending Tasks", "What is left and what the next step is."],
  ["7. Requirements & Constraints", "Rules and limits that must keep being respected."],
  ["8. Code Patterns & Architecture", "Naming conventions and structural decisions in force."],
  ["9. Open Questions", "Unresolved ambiguities and decisions awaiting the user."],
];

const CONFIG = [
  ["compaction.enabled", "true", "Controls the configurable pre-turn automatic check."],
  ["compaction.threshold", "0.90", "Pre-turn usage ratio; valid values are 0.70 through 0.95."],
  ["bufferTokens", "13000", "Runtime config field reserved for headroom; the current trigger does not consult it."],
  ["maxConsecutiveFailures", "3", "Failures after which auto-compaction disables itself for the session."],
  ["features.microCompact", "true", "Enables selective tool-result clearing before a turn."],
  ["Recent candidates kept", "8", "Number of recent eligible tool results left intact."],
];

const COMPACTABLE = [
  "read_file", "grep", "glob", "list_files", "web_search", "web_fetch", "file_search", "directory_tree",
];

const CHOOSING = [
  ["Tool Results dominate the breakdown", "Let micro-compaction work; it targets exactly this without a model call."],
  ["Messages dominate the breakdown", "/compact — only summarization compresses conversation."],
  ["Starting an unrelated task", "/clear — a summary of work you are abandoning is pure waste."],
  ["Approaching the limit mid-task", "Let automatic compaction run, or use /compact before an especially large next step."],
  ["Fixed floor is already large", "Neither. Trim steering, memory, and enabled tools instead."],
];

export default function Compaction() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Compaction</span>
        </nav>

        <div className="hero">
          <h1>Compaction</h1>
          <p className="tagline">
            How long sessions shed old tool output or replace active history with a continuation summary.
          </p>
        </div>

        <section id="three">
          <h2><span className="anchor">#</span>Two active mechanisms</h2>
          <p>
            "Compaction" covers two operations in the live agent path. They solve different problems and
            have very different costs:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "24%" }}>Mechanism</th>
                  <th style={{ width: "22%" }}>Triggered by</th>
                  <th style={{ width: "12%" }}>Model call?</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {MECHANISMS.map(([m, t, c, w]) => (
                  <tr key={m}>
                    <td><b style={{ color: "var(--text-strong)" }}>{m}</b></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{c}</td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Full compaction makes a provider request and consumes model tokens; it can also incur API cost.
            Selective micro-compaction is a local message transformation with no network request. A simpler
            five-result helper also exists in the compaction service, but the live agent does not call it.
          </p>
        </section>

        <section id="full">
          <h2><span className="anchor">#</span>Full compaction (/compact)</h2>
          <p>
            Full compaction takes everything after the last boundary, sends it to the model with a
            structured summarization prompt, and rebuilds the message array around the result.
          </p>
          <CodeBlock lang="text">{`before                          after
─────────────────────────       ─────────────────────────
system                          system
user      "add auth"            <boundary>
assistant tool_calls            assistant "[Compacted context]
tool      file contents                    ## 1. Primary Task …"
assistant tool_calls            user      "[System: Project
tool      grep output                      instructions refreshed
… 40 more messages                         after compact] …"
assistant "done"`}</CodeBlock>
          <p>
            The mechanics, in order:
          </p>
          <p>
            <b>1.</b> Collect every message after the last boundary and drop system messages.
            If nothing remains, the command returns <code className="inline">Nothing to compact.</code>{" "}
            and stops — compacting an empty conversation would spend a model call to produce nothing.
          </p>
          <p>
            <b>2.</b> Send them to the model with a fixed budget of{" "}
            <code className="inline">max_tokens: 4000</code> under a 60-second timeout, wrapped in the
            standard retry path.
          </p>
          <p>
            <b>3.</b> Initially rebuild <code className="inline">messages</code> as exactly three entries: the system
            prompt, a boundary marker, and one assistant message prefixed{" "}
            <code className="inline">[Compacted context]</code>.
          </p>
          <p>
            <b>4.</b> Run <a href="#cleanup">post-compact cleanup</a>, re-inject{" "}
            <code className="inline">DEEPSEEK.md</code>, persist history, and mark the context breakdown stale.
          </p>
          <Note>
            The summary is stored as an <b>assistant</b> message, not a system message. It is a report of
            what happened, not an instruction — and keeping it in the assistant role preserves the
            conversational alternation providers expect.
          </Note>
        </section>

        <section id="summary">
          <h2><span className="anchor">#</span>The nine-section summary</h2>
          <p>
            The summarization prompt is not "summarize this conversation". It demands nine specific
            sections, because a free-form summary reliably discards the things an agent needs most: exact
            file paths, decisions already made, and what was about to happen next.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Section</th><th>Must preserve</th></tr>
              </thead>
              <tbody>
                {SECTIONS.map(([s, m]) => (
                  <tr key={s}>
                    <td><b style={{ color: "var(--text-strong)" }}>{s}</b></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The prompt explicitly instructs the model to preserve exact file paths, function names, and code
            snippets needed to continue, and to prioritize actionable context over description. Sections 4, 6
            and 9 are the ones that let work resume rather than restart.
          </p>
          <p>
            The format is an instruction to the summarizing model, not a completeness guarantee. Review a
            thin or missing section before relying on it: compaction is deliberately lossy, and a model can
            omit a detail that was present in the original history.
          </p>
        </section>

        <section id="boundary">
          <h2><span className="anchor">#</span>The compact boundary</h2>
          <p>
            A boundary is a synthetic marker with the role{" "}
            <code className="inline">__compact_boundary__</code>. It is not a message — it is never sent to a
            provider — it is a bookmark inside the local array.
          </p>
          <p>
            The successful operation replaces the old in-memory array; it does not retain the pre-compaction
            transcript above the marker. A later compaction summarizes the current compacted-summary message,
            refreshed project instructions, and everything added since them.
          </p>
          <p>
            Micro-compaction walks the current array and preserves any boundary in place. It replaces only
            eligible tool-result content, retaining message roles and tool-call identifiers.
          </p>
          <Note>
            Session files carry the boundary too. Resuming restores the already-compacted array, including
            its summary and marker; the original transcript was replaced when compaction succeeded.
          </Note>
        </section>

        <section id="cleanup">
          <h2><span className="anchor">#</span>Post-compact cleanup</h2>
          <p>
            A cleanup pass runs immediately after a successful compaction. Its current call site performs one
            registered action and then refreshes project instructions:
          </p>
          <p>
            <b>System prompt re-installed.</b> The current in-memory system prompt is returned by the cleanup
            callback and assigned to <code className="inline">messages[0]</code>. This does not rebuild memory,
            settings, or effort state, and the agent does not register a file-cache clearing callback here.
          </p>
          <p>
            <b>Project instructions re-injected.</b> <code className="inline">DEEPSEEK.md</code> is reloaded and
            appended as a user message tagged{" "}
            <code className="inline">[System: Project instructions refreshed after compact]</code>. This is
            defensive: project rules are the single most damaging thing to lose to a lossy summary, so they
            are restored verbatim rather than trusted to the summarizer.
          </p>
          <p>
            The reload is wrapped in a <code className="inline">try/catch</code> and treated as non-critical. A
            missing <code className="inline">DEEPSEEK.md</code> does not fail the compaction.
          </p>
        </section>

        <section id="auto">
          <h2><span className="anchor">#</span>Automatic compaction</h2>
          <p>
            You rarely need to type <code className="inline">/compact</code>. The agent currently checks for
            automatic compaction at two different points:
          </p>
          <p>
            <b>Before a turn,</b> it uses <code className="inline">compaction.enabled</code>, the configured
            threshold (default <code className="inline">0.90</code>), valid non-zero usage and limit values,
            and the three-failure circuit breaker. The comparison is strictly greater than the threshold.
          </p>
          <p>
            <b>After a streaming response,</b> a second check currently uses a fixed 85% threshold and the
            circuit breaker. It does not consult <code className="inline">compaction.enabled</code> or the
            configured threshold. Bedrock models on the non-streaming path and Vertex do not take this
            post-stream branch.
          </p>
          <p>
            This mismatch is a current runtime limitation worth knowing when tuning or disabling automatic
            compaction. The 13,000-token buffer is present in the resolved configuration, but no trigger
            calculation currently subtracts or checks it.
          </p>
        </section>

        <section id="breaker">
          <h2><span className="anchor">#</span>The circuit breaker</h2>
          <p>
            <code className="inline">consecutiveFailures</code> counts failed compaction attempts. At{" "}
            <code className="inline">maxConsecutiveFailures</code> (default 3), auto-compaction switches itself
            off for the rest of the session.
          </p>
          <p>
            The reasoning is worth stating plainly. A compaction failing three times in a row almost never
            means bad luck — it means the provider is rejecting the request, the model is unavailable, or the
            conversation cannot be serialized. Retrying forever converts one degraded feature into a session
            that cannot move at all, because every turn would stall on a failing compaction before doing your
            actual work.
          </p>
          <p>
            When the breaker is open you keep full manual control: <code className="inline">/compact</code>{" "}
            still works, and so does <code className="inline">/clear</code>. Starting a fresh session resets the
            counter.
          </p>
        </section>

        <section id="micro">
          <h2><span className="anchor">#</span>Micro-compaction</h2>
          <p>
            The compaction service includes a basic helper that scans messages with{" "}
            <code className="inline">role: "tool"</code>, keeps the most recent five, and replaces long older
            contents with a short marker:
          </p>
          <CodeBlock lang="text">{`[tool result cleared to save context]`}</CodeBlock>
          <p>
            It <b>never deletes messages</b> — only rewrites content — so every{" "}
            <code className="inline">tool_call_id</code> still has its matching result and the provider does not
            reject the request. It skips anything under 200 characters, since clearing a short result would
            cost more in explanation than it saves. And it returns a new array rather than mutating the
            input, so a failure part-way through cannot leave the history corrupt.
          </p>
          <p>
            This helper is exported and tested but is not wired into the live agent path. The feature flag
            named <code className="inline">microCompact</code> controls the selective implementation below.
          </p>
        </section>

        <section id="enhanced">
          <h2><span className="anchor">#</span>Enhanced micro-compaction</h2>
          <p>
            The live selective variant only clears long results from an explicit read-only-tool allowlist.
            It runs before each user turn when the <code className="inline">microCompact</code>{" "}
            <a href="/docs/features">feature flag</a> is enabled; that flag is on by default.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Compactable tools</th><th>Why safe</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{COMPACTABLE.map((t) => <code className="inline" key={t} style={{ marginRight: 6 }}>{t}</code>)}</td>
                  <td>All names are treated as read-only by this pass; some are compatibility names not registered by the current CLI.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            The result of an edit or a shell command is <b>not</b> on that list, and deliberately so. Clearing
            "created 3 files" or the output of a test run destroys evidence the model cannot recover without
            side effects.
          </p>
          <p>
            Finding the tool name requires a small trick. The provider format attaches the tool name to the{" "}
            <em>assistant</em> message that requested the call, not to the result. So the pass first builds a{" "}
            <code className="inline">tool_call_id → toolName</code> map by walking assistant messages, then uses
            it to classify each result.
          </p>
          <p>
            Cleared entries keep a breadcrumb rather than a bare note:
          </p>
          <CodeBlock lang="text">{`[content cleared by micro-compaction to reduce context usage]
[original tool: read_file, 18432 chars]`}</CodeBlock>
          <p>
            The model can therefore tell that something was there, which tool produced it, and roughly how
            large it was — enough to decide whether re-reading is worthwhile. The pass also returns{" "}
            <code className="inline">freedTokensEstimate</code> so the saving can be reported.
          </p>
          <Note>
            In the current built-in tool set, <code className="inline">read_file</code>,{" "}
            <code className="inline">grep</code>, <code className="inline">glob</code>, and{" "}
            <code className="inline">web_fetch</code> match this allowlist. <code className="inline">read_folder</code>{" "}
            is read-only but is not presently included, so its results are left intact.
          </Note>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Configuration</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Key</th><th style={{ width: "16%" }}>Default</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {CONFIG.map(([k, d, m]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td><code className="inline">{d}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`// .deepseek/settings.json
{
  "compaction": {
    "enabled": true,
    "threshold": 0.75
  }
}`}</CodeBlock>
          <p>
            Legacy flat keys <code className="inline">autoCompact</code> and{" "}
            <code className="inline">autoCompactThreshold</code> are still honored, with the nested{" "}
            <code className="inline">compaction</code> object taking priority when both are present.
          </p>
          <p>
            Lowering or raising the threshold affects the pre-turn check. Because the streaming post-response
            check is currently fixed at 85%, setting <code className="inline">enabled: false</code> does not
            make streaming sessions entirely manual. Use <code className="inline">/compact</code> whenever you
            want an explicit boundary rather than waiting for either automatic path.
          </p>
        </section>

        <section id="choosing">
          <h2><span className="anchor">#</span>Choosing the right tool</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "38%" }}>Situation</th><th>Do this</th></tr>
              </thead>
              <tbody>
                {CHOOSING.map(([s, d]) => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            One rule helps with all of these: <b>delegate bounded research before it floods the parent</b>. If a job will clearly
            generate a lot of context — auditing a directory, reading a large module — hand it to a{" "}
            <a href="/docs/subagents">sub-agent</a>. The sub-agent burns its own window and returns a typed
            summary. That handoff is also a summary and can omit detail, but it keeps the full child transcript
            out of the parent context window.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
