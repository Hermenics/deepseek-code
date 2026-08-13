import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "items", label: "Status items" },
  { id: "responsive", label: "Responsive layout" },
  { id: "configure", label: "Configure the bar" },
  { id: "updates", label: "When values update" },
  { id: "compaction", label: "Compaction badge" },
  { id: "activity", label: "Activity indicator" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const ITEMS = [
  ["mode", "Build, Plan, Review or Auto", "Always available. The label and color change as you cycle interaction modes."],
  ["model", "◈ model-name", "Always available. Below 60 columns, the model identifier is shortened to 15 characters."],
  ["tokens", "ℹ 12,345 tokens", "Appears after the reported cumulative token count becomes greater than zero."],
  ["branch", "⎇ branch-name", "Appears when the current directory is inside a Git worktree and the branch lookup succeeds."],
  ["context", "ctx 42%", "Appears after context usage becomes greater than zero. Wide terminals also show a ten-cell progress bar."],
];

const WIDTHS = [
  ["80 columns or wider", "Every configured statusBar item, in configuration order", "Yes"],
  ["60–79 columns", "First three eligible narrowPriority items", "No"],
  ["Below 60 columns", "First two eligible narrowPriority items; model shortened to 15 characters", "No"],
];

export default function StatusBar() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Status bar</span>
        </nav>

        <div className="hero">
          <h1>Status bar</h1>
          <p className="tagline">
            Read model, mode, token, context and repository state without leaving the conversation—and choose what survives in a narrow terminal.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Overview</h2>
          <p>
            The status bar is the compact row below the transcript and activity area. A horizontal divider separates
            it from the conversation. Its content is deliberately conditional: configuring an item makes it eligible,
            but values such as tokens, context usage and Git branch stay hidden until there is something meaningful to show.
          </p>
          <p>
            The default order is <code className="inline">mode</code>, <code className="inline">model</code>,{" "}
            <code className="inline">tokens</code>, <code className="inline">branch</code>, then{" "}
            <code className="inline">context</code>. The terminal width determines how many of those items remain visible.
          </p>
          <Note>
            The status bar summarizes the main agent session. It does not currently expose a configurable provider or
            active-agent item; those identities are shown elsewhere in the interface.
          </Note>
        </section>

        <section id="items">
          <h2><span className="anchor">#</span>Status items</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "17%" }}>Item</th><th style={{ width: "25%" }}>Display</th><th>Visibility and meaning</th></tr></thead>
              <tbody>
                {ITEMS.map(([item, display, behavior]) => (
                  <tr key={item}>
                    <td><code className="inline">{item}</code></td>
                    <td>{display}</td>
                    <td>{behavior}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Mode colors follow the active interaction mode: Build is green, Plan is yellow, Review is blue and Auto is
            red. Context uses the theme&apos;s primary color below 70%, warning color from 70% through 89%, and error color
            at 90% or above. The same thresholds color both the percentage and the wide-terminal progress bar.
          </p>
          <p>
            The token number is the cumulative count supplied by the running agent, formatted for the current locale.
            It is not a per-message estimate. Context is a rounded percentage of the active context window, so the two
            values measure related but different things.
          </p>
        </section>

        <section id="responsive">
          <h2><span className="anchor">#</span>Responsive layout</h2>
          <p>
            DeepSeek Code reads the current terminal width on every render. At narrow widths it stops following the
            normal status-bar order and instead uses <code className="inline">narrowPriority</code> to preserve the most useful signals.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "24%" }}>Terminal width</th><th>Eligible items</th><th style={{ width: "18%" }}>Context bar</th></tr></thead>
              <tbody>
                {WIDTHS.map(([width, visible, progress]) => (
                  <tr key={width}><td><b>{width}</b></td><td>{visible}</td><td>{progress}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The default narrow priority is <code className="inline">mode</code>, <code className="inline">context</code>,{" "}
            <code className="inline">model</code>, <code className="inline">branch</code>, then{" "}
            <code className="inline">tokens</code>. An item must be present in both the normal configuration and the
            narrow-priority list to occupy a narrow slot. A slot can still render no text when its value is unavailable;
            ordering high-value, always-present items first avoids an unexpectedly sparse footer.
          </p>
        </section>

        <section id="configure">
          <h2><span className="anchor">#</span>Configure the bar</h2>
          <p>
            Use <code className="inline">/config</code> for interactive settings, or edit an effective settings file.
            Both arrays accept only <code className="inline">mode</code>, <code className="inline">model</code>,{" "}
            <code className="inline">tokens</code>, <code className="inline">branch</code> and{" "}
            <code className="inline">context</code>.
          </p>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "statusBar": ["mode", "model", "context", "tokens", "branch"],\n    "narrowPriority": ["context", "mode", "model", "branch", "tokens"]\n  }\n}'}</CodeBlock>
          <p>
            In that example, wide terminals use the <code className="inline">statusBar</code> order. A medium-width
            terminal instead shows context, mode and model; a very narrow terminal shows context and mode. Moving an
            item in <code className="inline">narrowPriority</code> does not affect wide terminals.
          </p>
          <Note>
            <code className="inline">narrowPriority</code> cannot re-enable an item omitted from{" "}
            <code className="inline">statusBar</code>. To hide the normal status row entirely, use an empty{" "}
            <code className="inline">statusBar</code> array—but live activity can still add its own indicator.
          </Note>
        </section>

        <section id="updates">
          <h2><span className="anchor">#</span>When values update</h2>
          <p>
            Mode and model changes appear as soon as the corresponding session state changes. Token and context values
            are committed when a main-agent turn finishes successfully, so they can lag behind a streaming response and
            then jump once the turn closes. Context compaction can lower the next reported percentage even while the
            cumulative token count continues to rise.
          </p>
          <p>
            Git branch detection runs once when the status bar mounts, then every 30 seconds. It asks Git for the current
            branch in the process working directory. Changing branches therefore is not necessarily visible immediately;
            leaving a worktree or a failed Git lookup removes the branch value on the next poll.
          </p>
        </section>

        <section id="compaction">
          <h2><span className="anchor">#</span>Compaction badge</h2>
          <p>
            After DeepSeek Code compacts context, the status bar briefly appends a warning-colored badge. Micro
            compaction displays <code className="inline">⚡ micro</code>; full compaction displays{" "}
            <code className="inline">⚡ compact</code>. The badge is transient and is eligible for four seconds from the
            recorded compaction event—it is not a persistent status item and cannot be reordered with the arrays above.
          </p>
        </section>

        <section id="activity">
          <h2><span className="anchor">#</span>Activity indicator</h2>
          <p>
            When subagents or workflows have entries in the Activity panel, the bar appends a downward-arrow counter.
            Normal and medium-width terminals show text such as <code className="inline">↓ 1 activity</code> or{" "}
            <code className="inline">↓ 3 activities</code>. Below 60 columns it collapses to{" "}
            <code className="inline">↓3</code>.
          </p>
          <p>
            This counter is independent of <code className="inline">statusBar</code> and{" "}
            <code className="inline">narrowPriority</code>. If every configured status item is absent but activity exists,
            the divider and activity counter still render. Open the panel from an empty input with the Down arrow; see{" "}
            <a href="/docs/activity-panel">Activity panel</a> for navigation and controls.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <h3>The branch is missing or stale</h3>
          <p>
            Confirm that DeepSeek Code was launched inside the intended Git worktree, that Git is available, and wait for
            the next 30-second refresh after switching branches. Git errors are intentionally hidden rather than printed
            into the conversation.
          </p>
          <h3>An item disappears after resizing</h3>
          <p>
            Check the two width boundaries and the item&apos;s position in <code className="inline">narrowPriority</code>.
            Below 80 columns only three priority entries are considered; below 60 only two are considered. Make sure the
            item also remains in <code className="inline">statusBar</code>.
          </p>
          <h3>Tokens or context still show zero</h3>
          <p>
            These fields remain hidden until the agent reports a positive value at turn completion. Finish a regular
            main-agent turn before diagnosing the configuration, and remember that cancellation during streaming may
            leave the previous completed-turn metrics in place.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
