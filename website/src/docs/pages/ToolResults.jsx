import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "three", label: "Three different views" },
  { id: "lifecycle", label: "Result lifecycle" },
  { id: "display", label: "Interactive display" },
  { id: "full", label: "Full mode" },
  { id: "limits", label: "Tool-level limits" },
  { id: "diffs", label: "Writes and diffs" },
  { id: "errors", label: "Errors and denials" },
  { id: "context", label: "Context and compaction" },
  { id: "headless", label: "Headless behavior" },
  { id: "audit", label: "Audit visibility" },
  { id: "recovery", label: "Recover complete evidence" },
];

const VIEWS = [
  ["Model history", "The actual tool result paired to its tool-call ID. This is what the next model iteration receives."],
  ["Interactive transcript", "A deliberately compact rendering: label, argument preview, selected output, or a structured diff."],
  ["Audit and events", "A diagnostic preview capped independently from both history and the TUI."],
];

const DISPLAY = [
  ["shell", "Bash label plus command; up to five non-empty output lines in normal mode."],
  ["write_file / patch_file", "Structured diff card when the result is a valid diff payload."],
  ["read_file / read_folder", "Path only after completion; file contents stay out of the visible transcript."],
  ["glob / grep", "Pattern or path preview only; matches remain in model history."],
  ["subagent", "A compact working/done line rather than the worker's raw result."],
  ["other built-ins", "A persisted completion detail capped to the first 100 characters."],
  ["MCP tools", "Calls whose names contain a double underscore are not added to the normal transcript."],
];

const LIMITS = [
  ["read_file", "200 lines by default", "Header reports total, shown range, and the next start_line."],
  ["read_folder", "1,000 entries; five recursive levels", "Explicit truncation note asks for a narrower path."],
  ["grep", "200 matching lines", "Returns total matches and says the first 200 are shown."],
  ["glob", "500 files", "Returns total matches and says the first 500 are shown."],
  ["shell", "50,000 characters", "The returned string is sliced; no continuation cursor is available."],
  ["web_fetch", "20,000 characters", "Cleaned page text is sliced; no truncation marker is appended."],
  ["write_file / patch_file", "Detailed diff disabled above 5,000 old or new lines", "Returns a successful summary with old/new counts instead."],
];

export default function ToolResults() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Tool results</span>
        </nav>

        <div className="hero">
          <h1>Tool results and truncation</h1>
          <p className="tagline">
            Understand what the model received, what the terminal chose to show, where output was permanently
            bounded, and how to recover evidence without mistaking a preview for the complete result.
          </p>
        </div>

        <section id="three">
          <h2><span className="anchor">#</span>Three different views</h2>
          <p>
            “The tool result” can mean three different representations. They intentionally have different sizes.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "24%" }}>Representation</th><th>Contents</th></tr></thead>
            <tbody>{VIEWS.map(([view, contents]) => <tr key={view}><td><b>{view}</b></td><td>{contents}</td></tr>)}</tbody>
          </table></div>
          <Note>
            A short or hidden terminal row does not mean the model received a short result. Conversely, expanding
            the terminal cannot recover characters that the tool itself never returned.
          </Note>
        </section>

        <section id="lifecycle">
          <h2><span className="anchor">#</span>Result lifecycle</h2>
          <CodeBlock lang="text">{`tool requested
  → arguments validated and authorized
  → running status appears
  → tool returns a string (or an execution error becomes one result)
  → callback updates the TUI
  → result is appended to model history with the original tool-call ID
  → the model continues with that evidence`}</CodeBlock>
          <p>
            Tool calls and results must remain paired. For sequential calls, each result is appended immediately.
            A batch composed entirely of parallel-safe tools executes concurrently and collects every outcome;
            rejected entries still receive a cancellation placeholder so provider history remains structurally
            valid.
          </p>
          <p>
            Unexpected execution exceptions are normalized to one <code className="inline">Error: …</code> result
            and surfaced once. A tool can also return an error-looking string as its normal result. In both cases,
            the model can inspect the failure and decide what evidence to gather next.
          </p>
        </section>

        <section id="display">
          <h2><span className="anchor">#</span>Interactive display</h2>
          <p>
            While a tool runs, the status row shows a spinner, human display name, a preview of its primary
            argument capped near 60 characters, and elapsed seconds. When it finishes, the callback retains the
            first 200 result characters in transient state, while the row renders roughly the first 60 with a
            success marker before clearing.
          </p>
          <p>The persisted transcript applies tool-specific rendering:</p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "28%" }}>Tool class</th><th>Visible completion record</th></tr></thead>
            <tbody>{DISPLAY.map(([tool, behavior]) => <tr key={tool}><td><code className="inline">{tool}</code></td><td>{behavior}</td></tr>)}</tbody>
          </table></div>
          <p>
            <code className="inline">interface.showToolCalls: false</code> hides persisted tool rows and the
            live status. It does not disable tools, remove their results from model context, reduce provider cost,
            or stop file changes.
          </p>
        </section>

        <section id="full">
          <h2><span className="anchor">#</span>Full mode</h2>
          <p>
            Press <code className="inline">Ctrl+O</code> to toggle Full mode. It expands saved thinking, stops
            truncating persisted argument previews at 60 characters, and shows all non-empty output lines present in a
            transcript tool record. Normal mode shows at most five non-empty output lines and reports how many
            remain.
          </p>
          <CodeBlock lang="text">{`Normal mode
✓ Bash  bun test
   pass 1
   pass 2
   pass 3
   pass 4
   pass 5
   … 23 more lines

Full mode · ctrl+o to toggle`}</CodeBlock>
          <p>
            Full mode is a display toggle only. It does not rerun a tool, modify model history, restore
            micro-compacted content, increase a tool's hard output ceiling, or reveal read/search contents that
            were stored in the interactive transcript only as a path or pattern.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Tool-level limits</h2>
          <p>
            These limits apply before display and therefore also bound what reaches model history:
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "24%" }}>Tool</th><th style={{ width: "25%" }}>Bound</th><th>Signal and continuation</th></tr></thead>
            <tbody>{LIMITS.map(([tool, bound, behavior]) => <tr key={tool}><td><code className="inline">{tool}</code></td><td>{bound}</td><td>{behavior}</td></tr>)}</tbody>
          </table></div>
          <p>
            A visible truncation marker is evidence that the result is incomplete, not a warning you may ignore.
            Shell and web fetch are more dangerous diagnostically because their hard character slices may end
            without a marker. Design commands to summarize, filter, or write a recoverable artifact rather than
            relying on the tail of enormous stdout.
          </p>
          <CodeBlock lang="text">{`The previous search was truncated. Restrict it to src/payments/**/*.ts,
then inspect only matches for settleInvoice. Do not treat the first page as exhaustive.`}</CodeBlock>
        </section>

        <section id="diffs">
          <h2><span className="anchor">#</span>Writes and diffs</h2>
          <p>
            Successful <code className="inline">write_file</code> and <code className="inline">patch_file</code>
            calls normally return structured diff data. The TUI validates that payload before rendering a diff
            card with the path, counts, changed lines, and optional word-level highlighting. Invalid or ordinary
            JSON is shown as a regular tool detail instead of trusted as a diff.
          </p>
          <p>
            Press <code className="inline">Ctrl+D</code> to open the latest valid diff. The conversation also
            aggregates changed-file counts. When diffs are hidden, a compact summary remains; when
            <code className="inline">showToolCalls</code> is off, even that transcript row is hidden.
          </p>
          <p>
            Files above the detailed-diff guard are still written successfully. Their result contains a summary,
            not line-level proof. Inspect them with Git or a bounded file read before claiming the change is safe.
          </p>
        </section>

        <section id="errors">
          <h2><span className="anchor">#</span>Errors and denials</h2>
          <p>
            Schema errors, missing files, command failures, timeouts, and safety rejections normally become tool
            results the model can read. The result text should describe the failed boundary and preserve enough
            detail to choose a narrower next step.
          </p>
          <p>
            An interactive user denial is different: it aborts the turn rather than feeding a permission-denied
            result back to the model. That prevents the model from treating the denial as a puzzle and attempting
            another route. In a parallel-safe batch, already-started calls finish and every provider tool call is
            paired, then the denial abort propagates.
          </p>
          <Note>
            A success icon means the tool returned through its normal callback. Some tools encode operational
            failure in their returned text. Read the content; do not infer success from the row color alone.
          </Note>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Context and compaction</h2>
          <p>
            Complete model-facing results accumulate in the context window and are paid again on later requests.
            Before each new turn, the enabled micro-compaction pass finds old results over 200 characters from
            selected reproducible read-only tools and replaces all but the latest eight candidates with a note
            naming the original tool and character count.
          </p>
          <CodeBlock lang="text">{`[content cleared by micro-compaction to reduce context usage]
[original tool: read_file, 18432 chars]`}</CodeBlock>
          <p>
            Current compactable names are <code className="inline">read_file</code>,
            <code className="inline">grep</code>, <code className="inline">glob</code>,
            <code className="inline">web_fetch</code>, and compatibility names for read-only search/tree tools.
            Shell, Git, writes, and task results are preserved because replay can have side effects or lose
            irreplaceable evidence.
          </p>
          <p>
            Micro-compaction does not call a model and does not alter the earlier TUI transcript. If the model
            needs cleared evidence again, it must rerun the safe read with a narrow query. Full compaction is
            separate: it summarizes the whole active conversation behind a boundary.
          </p>
        </section>

        <section id="headless">
          <h2><span className="anchor">#</span>Headless behavior</h2>
          <p>
            In pipe mode, assistant text goes to stdout and each tool start prints
            <code className="inline">[tool] name</code> to stderr. Tool result bodies are not written to stdout;
            they remain in agent context. JSON mode returns final assistant output and the ordered list of tool
            names, not every result.
          </p>
          <CodeBlock lang="bash">{`deepseek --pipe --json "run the focused tests"
# stdout: {"ok":true,"output":"...","tools":["shell"]}
# stderr: [tool] shell`}</CodeBlock>
          <p>
            Destructive shell confirmation is denied in unattended pipe mode. If automation requires machine-
            readable intermediate evidence, ask the agent to summarize it in the final answer or create an
            explicitly authorized artifact; do not scrape interactive terminal rows.
          </p>
        </section>

        <section id="audit">
          <h2><span className="anchor">#</span>Audit visibility</h2>
          <p>
            Tool lifecycle events record the tool, duration, and a result preview capped at 200 characters. The
            audit log uses the same preview and applies secret redaction. Hook audit entries separately report
            whether command output was truncated at the hook executor's byte limit.
          </p>
          <p>
            Audit previews establish that a call happened and how long it took; they are not a durable archive of
            full stdout. For high-stakes verification, retain the command's own report file or rerun the bounded
            check rather than reconstructing evidence from the audit trail.
          </p>
        </section>

        <section id="recovery">
          <h2><span className="anchor">#</span>Recover complete evidence</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "30%" }}>What you see</th><th>Next step</th></tr></thead>
            <tbody>
              <tr><td>Read range says more lines remain</td><td>Continue with the reported <code className="inline">start_line</code>, using a bounded end line.</td></tr>
              <tr><td>Grep or glob reports truncation</td><td>Narrow the directory, identifier, extension, or include pattern; do not page the same broad query blindly.</td></tr>
              <tr><td>Only five shell lines are visible</td><td>Try Full mode. If still missing, the persisted TUI record itself was bounded or the shell hit its 50k ceiling.</td></tr>
              <tr><td>Read/search row shows only a path</td><td>That is expected TUI behavior. Ask a focused question or rerun the read; Full mode cannot expand it.</td></tr>
              <tr><td>Micro-compaction note in model context</td><td>Rerun the safe read with a narrow scope. The original content is no longer in active model history.</td></tr>
              <tr><td>Large-file write summary</td><td>Use Git diff/stat and focused ranges to verify the resulting file.</td></tr>
              <tr><td>Web or shell ends abruptly</td><td>Assume the hard character cap may have fired. Filter upstream or save a report with explicit authorization.</td></tr>
            </tbody>
          </table></div>
          <p>
            See <a href="/docs/context-window">Context window</a>, <a href="/docs/compaction">Compaction</a>,
            and <a href="/docs/search">Search tools</a> for context-efficient investigation patterns.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
