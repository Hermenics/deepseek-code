import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "sources", label: "What becomes reasoning" },
  { id: "collapsed", label: "Collapsed display" },
  { id: "full", label: "Full mode" },
  { id: "visibility", label: "Show or hide thoughts" },
  { id: "effort", label: "Reasoning effort" },
  { id: "providers", label: "Provider differences" },
  { id: "persistence", label: "Context & persistence" },
  { id: "limits", label: "Limits & accessibility" },
];

const EFFORTS = [
  ["low", "Request a quick, concise response. For direct DeepSeek and Bedrock calls, thinking is sent as disabled."],
  ["high", "Default. Request comprehensive reasoning; direct DeepSeek and Bedrock calls enable thinking with high effort."],
  ["max", "Request the deepest available reasoning; direct DeepSeek and Bedrock calls enable thinking with max effort."],
  ["auto / unset", "Accepted aliases that currently reset the level to high; they are not an adaptive fourth mode."],
];

export default function ReasoningDisplay() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Reasoning display</span>
        </nav>

        <div className="hero">
          <h1>Reasoning display</h1>
          <p className="tagline">
            Control collapsed thinking summaries, expanded reasoning panels and provider effort without confusing visibility with deletion.
          </p>
        </div>

        <section id="sources">
          <h2><span className="anchor">#</span>What becomes a reasoning panel</h2>
          <p>
            A reasoning-capable provider can stream a dedicated reasoning channel separately from visible assistant text.
            DeepSeek Code accumulates that channel, displays a live thinking state and preserves the provider field in agent
            history when it is supplied. The UI can also separate legacy content wrapped in a complete
            <code className="inline">&lt;thinking&gt;...&lt;/thinking&gt;</code> block.
          </p>
          <p>
            Internal <code className="inline">&lt;think&gt;</code>, <code className="inline">&lt;step&gt;</code> and
            <code className="inline">&lt;tool_call&gt;</code> blocks embedded in visible output are suppressed rather than
            presented as ordinary answer text. A response wrapper is removed while its visible content is retained.
          </p>
          <Note>
            A reasoning panel appears only when the provider or compatibility format supplies usable content. Selecting a
            high effort level cannot make every model expose reasoning, and the absence of a panel is not proof that the
            model performed no internal computation.
          </Note>
        </section>

        <section id="collapsed">
          <h2><span className="anchor">#</span>Collapsed display by default</h2>
          <p>
            While reasoning is live, the compact row shows a textual timer such as
            <code className="inline">◌ Thinking for 4 seconds...</code>. If no start timestamp is available, it shows
            <code className="inline">◌ Thinking...</code>. Finished reasoning collapses to a summary row with a rounded duration.
          </p>
          <CodeBlock lang="text">{"◌ Thinking for 4 seconds...\n\n◌ Thought for 7 seconds (ctrl+o to expand)"}</CodeBlock>
          <p>
            A turn can produce multiple thought rows. Reasoning accumulated before a tool call is finalized before the tool
            row; reasoning after that tool belongs to a later phase. Aborting a streaming turn can preserve partial reasoning
            in agent history, and any buffered UI reasoning is finalized when the turn completes its callback path.
          </p>
          <p>
            The timer measures the UI reasoning phase, not provider billing, network latency or total turn duration. Live
            seconds are floored; completed seconds are rounded from the recorded millisecond duration.
          </p>
        </section>

        <section id="full">
          <h2><span className="anchor">#</span>Expand with full mode</h2>
          <p>
            Press <code className="inline">Ctrl+O</code> to toggle full mode. Completed and live reasoning then render in a
            dimmed Markdown panel labelled Thinking. Press Ctrl+O again to return to compact rows. The toggle is immediate,
            process-local and display-only: it does not abort the agent, request another response or change stored messages.
          </p>
          <CodeBlock lang="text">{"Ctrl+O\n◌ Thinking\n  Compare the current behavior with the requested contract...\n\nFull mode · ctrl+o to toggle                         verbose"}</CodeBlock>
          <p>
            Full mode is broader than reasoning. It also removes the normal 60-character truncation from tool arguments and
            expands tool output beyond its first five non-empty lines. Its footer therefore says
            <code className="inline">verbose</code> even when the current model emits no reasoning.
          </p>
          <p>
            Reasoning uses the terminal&apos;s limited Markdown renderer: headings, lists, quotes, fenced code and a small inline
            formatting subset. Browser tables, images, HTML and a semantic document tree are not available.
          </p>
        </section>

        <section id="visibility">
          <h2><span className="anchor">#</span>Show or hide thoughts</h2>
          <p>
            <code className="inline">interface.showThoughts</code> defaults to true. Toggle Show thoughts in
            <code className="inline">/config</code>, or persist the setting directly. Setting it to false removes completed
            thought rows and live thinking text from the main transcript without deleting the underlying agent history.
          </p>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "showThoughts": false\n  }\n}'}</CodeBlock>
          <p>
            Ctrl+O does not override this setting: full mode can still expand tool detail, but hidden main-transcript thoughts
            remain hidden. Turning Show thoughts back on makes retained UI thought messages visible again.
          </p>
          <Note>
            Current limitation: a focused subagent transcript is selected through a separate message path and is not filtered
            by Show thoughts in exactly the same way as the main transcript. Leave the subagent focus view if you need the
            setting&apos;s predictable main-conversation behavior.
          </Note>
        </section>

        <section id="effort">
          <h2><span className="anchor">#</span>Choose reasoning effort</h2>
          <p>
            Use <code className="inline">/effort</code> with no argument to open the selector, or set a level directly. The
            default is high. Effort changes the active agent&apos;s instruction and, for supported direct providers, its thinking
            request parameters. It is not the same setting as whether panels are visible.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "26%" }}>Level</th><th>Current behavior</th></tr></thead>
              <tbody>
                {EFFORTS.map(([level, behavior]) => <tr key={level}><td><code className="inline">{level}</code></td><td>{behavior}</td></tr>)}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="text">{"/effort low\nEffort: low — Quick, straightforward responses\n\n/effort max\nEffort: max — Maximum reasoning depth (best with deepseek-v4-pro)"}</CodeBlock>
          <p>
            <code className="inline">/effort status</code> and <code className="inline">/effort current</code> open the same
            selector as a command with no argument. The effort level is runtime agent state rather than an
            <code className="inline">interface</code> setting, so start a new process expecting the high default.
          </p>
        </section>

        <section id="providers">
          <h2><span className="anchor">#</span>Provider and transport differences</h2>
          <ul className="capabilities">
            <li><b>Streaming reasoning:</b> dedicated reasoning deltas update the live panel and are saved alongside the assistant message.</li>
            <li><b>Direct DeepSeek / Bedrock effort:</b> low disables thinking; high and max enable it and send the corresponding effort request.</li>
            <li><b>Other providers:</b> still receive the effort instruction, but no provider-specific thinking parameters are added.</li>
            <li><b>Legacy Bedrock reasoning:</b> dedicated reasoning or compatible tagged output can be emitted to the panel in its non-streaming path.</li>
            <li><b>Native non-streaming responses:</b> a reasoning field can be preserved in history without producing the same live panel callback.</li>
            <li><b>Unsupported models:</b> can ignore effort controls or return only visible answer content.</li>
          </ul>
          <p>
            Pipe mode registers only visible answer tokens and tool names in its output callbacks. Plain pipe output does not
            print reasoning panels, and <code className="inline">--json</code> returns
            <code className="inline">ok</code>, <code className="inline">output</code> and
            <code className="inline">tools</code>, not a reasoning field.
          </p>
        </section>

        <section id="persistence">
          <h2><span className="anchor">#</span>Context, sessions and exports</h2>
          <p>
            Provider reasoning fields are preserved in raw agent history for every model that returns them, including
            messages paired with tool calls and partial messages on the abort path. This is required by providers that expect
            the original reasoning field to be sent back with later tool results. Reasoning therefore contributes to context
            size and completion-token accounting.
          </p>
          <p>
            UI thought rows are saved with session UI messages and can return on resume. Session export redacts recognized
            secrets but otherwise includes UI messages; Markdown exports label reasoning rows as Thinking, and JSON can retain
            structured reasoning/history fields. Hiding thoughts is a presentation preference, not redaction or deletion.
          </p>
          <Note>
            Do not use Show thoughts as a confidentiality control. If reasoning or prompt content must not persist, manage the
            session/export lifecycle and provider retention policy explicitly rather than relying on collapsed or hidden UI.
          </Note>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits, interpretation and accessibility</h2>
          <ul className="capabilities">
            <li><b>Model-generated trace:</b> displayed reasoning can be incomplete, simplified or wrong; it is not an audit proof of how an answer was produced.</li>
            <li><b>Availability:</b> provider, model and transport determine whether reasoning reaches the panel.</li>
            <li><b>Display timing:</b> output is buffered into UI frames, so the timer and text cadence are approximate.</li>
            <li><b>Visibility scope:</b> Show thoughts filters the main transcript; focused subagent messages currently differ.</li>
            <li><b>Full mode scope:</b> Ctrl+O expands reasoning and tool detail together and is not persisted.</li>
            <li><b>Reduced motion:</b> replaces the working spinner but does not stop reasoning timers or streamed updates.</li>
          </ul>
          <p>
            Collapsed states include words and elapsed time rather than relying only on dim color. Expanded panels remain
            terminal cells with no semantic disclosure-widget role, so screen readers may announce redraw fragments. For a
            quieter main transcript, hide thoughts; for linear automation output, use
            <code className="inline">deepseek --pipe</code>.
          </p>
          <p>
            See <a href="/docs/model-config">Model configuration</a>,
            <a href="/docs/context-window"> Context window</a> and
            <a href="/docs/terminal-rendering"> Terminal rendering</a> for the surrounding provider and display behavior.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
