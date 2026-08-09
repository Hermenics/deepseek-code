import { Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "input", label: "Input editor" },
  { id: "ghost", label: "Ghost text" },
  { id: "dropdowns", label: "Dropdowns" },
  { id: "paste", label: "Paste" },
  { id: "queue", label: "Message queue" },
  { id: "status-bar", label: "Status bar" },
  { id: "messages", label: "Message rendering" },
  { id: "dialogs", label: "Prompts & dialogs" },
  { id: "monitors", label: "Monitors" },
  { id: "safety", label: "Double-press safety" },
  { id: "loading", label: "LoadingSpinner" },
  { id: "setup", label: "Setup wizard" },
  { id: "renderer", label: "Renderer capabilities" },
];

const EMACS_KEYS = [
  ["Ctrl+A / Ctrl+E", "Move to start / end of line"],
  ["Ctrl+B / Ctrl+F", "Move one grapheme left / right"],
  ["Ctrl+K", "Kill to end of line (kill ring, append)"],
  ["Ctrl+U", "Kill to start of line (kill ring, prepend)"],
  ["Ctrl+W", "Delete word before cursor (kill ring)"],
  ["Ctrl+Y", "Yank last kill ring entry"],
  ["Meta+B / Meta+F", "Move one word back / forward"],
  ["Meta+D", "Delete word after cursor"],
  ["Ctrl+Z / Shift+Z", "Undo / redo (50-entry buffer)"],
  ["Shift+Enter", "Insert newline (multiline input)"],
  ["↑ / ↓", "History at first/last visual line, line navigation inside multiline"],
];

const STATUS_BAR_ITEMS = [
  ["mode", "Current interaction mode, colored per mode (Build green, Plan yellow, Review blue, Auto red)"],
  ["model", "Active model, prefixed with ◈"],
  ["tokens", "Token count for the current turn, prefixed with ℹ"],
  ["branch", "Git branch (⎇), re-polled every 30s"],
  ["context", "ctx N% plus an 8-step progress bar — yellow at ≥70%, red at ≥90%"],
];

const MESSAGE_ROLES = [
  ["user", "❯ prompt in the primary brand color"],
  ["assistant", "● markdown-rendered reply"],
  ["tool", "● tool line with a friendly name and per-tool icon; max 5 output lines, then “… N more lines”"],
  ["terminal", "$ shell output in magenta (bashBorder)"],
  ["thinking", "◌ Thinking panel with dimmed markdown on the thinking background"],
];

const DIALOGS = [
  ["ConfirmPrompt", "Yellow ⚠ box with the message; y confirms, n/Esc cancels"],
  ["ToolPermissionPrompt", "Cyan ◆ box with tool/action/reason; numbered options (see below)"],
  ["PlanApprovalPrompt", "Scrollable plan content with y/n; n opens a feedback phase; Esc aborts"],
  ["BtwSideQuestion", "⚠ /btw panel answering while the main agent works; Space/Enter/Esc dismisses"],
];

const MONITORS = [
  ["TodoPanel", "◆ TODO (N) box — ○ pending, ◉ in_progress, ● done"],
  ["SubagentList", "Tree of running subagents — color-coded roles, confidence %, tools, tokens, cost, ✓✓ verified"],
  ["ActivityFooter", "● main agent plus up to 5 activities; Enter/↓ opens the detail panel; x stops, p pauses a workflow, r resumes"],
  ["WorkflowMonitor", "Fullscreen run monitor — status icons, done/total agents, tokens, cost; x stop, p pause/resume, r restart, s save, Esc closes"],
];

const RENDERER_CAPS = [
  ["Alternate screen", "DEC 1049 (used when settings.interface.alternateScreen is on)"],
  ["Mouse tracking", "SGR 1000/1002/1003/1006 — click, drag, hover, wheel"],
  ["Focus events", "Tracks terminal focus to pause rendering while unfocused"],
  ["Bracketed paste", "Distinguishes pasted input from typed keys"],
  ["Synchronized updates", "DEC 2026 — tear-free repaints"],
  ["OSC hyperlinks", "OSC 8 links inside rendered output"],
  ["Text selection", "Copy-on-select via pbcopy/OSC 52 with tmux passthrough"],
  ["Search highlight", "Find matches highlighted in the rendered buffer"],
  ["Bidi reordering", "Bi-directional text laid out correctly (native in Terminal.app/iTerm2)"],
  ["Kitty keyboard protocol", "Extended key reporting (also via tmux csi-u)"],
  ["Terminal queries", "DA1/DA2 and DECRQM probing with a DA1 sentinel"],
  ["iTerm2 tab status", "OSC 9 tab/notification status and OSC 9;4 progress"],
];

export default function Interface() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Interface (TUI)</span>
        </nav>

        <div className="hero">
          <h1>Interface (TUI)</h1>
          <p className="tagline">
            Everything DeepSeek Code renders on your terminal — the input editor, status bar,
            message transcript, dialogs, and the vendored Ink renderer underneath.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Overview</h2>
          <p>
            The TUI is a single React tree rooted at <code className="inline">App.tsx</code>, rendered by a
            vendored Ink reimplementation in <code className="inline">src/ink/</code>. The root component
            owns session state: the message transcript, the 50ms streaming flush that turns
            token buffers into visible text, live tool status (a ✓ checkmark for ~800ms after a
            tool finishes), interaction mode, the message queue, and the confirm / tool-permission /
            plan-approval dialogs.
          </p>
          <p>
            The header shows an ASCII mascot next to <b>◆ DeepSeek Code vX</b>, followed by the
            provider, the active agent in brackets, and the current working directory. Under 60
            terminal columns it collapses to a single compact line — mascot, name, and agent only.
          </p>
          <p>
            By default the app draws into the main screen buffer; set{" "}
            <code className="inline">settings.interface.alternateScreen</code> to{" "}
            <code className="inline">true</code> to render on the alternate buffer (takes effect
            next session).
          </p>
        </section>

        <section id="input">
          <h2><span className="anchor">#</span>Input editor</h2>
          <p>
            The input is a multiline editor with a grapheme-aware cursor built on{" "}
            <code className="inline">Intl.Segmenter</code> — emoji and composed characters move as
            one unit. Word motion uses the same segmenter at word granularity, vertical motion
            walks visual lines (not logical lines), and kills accumulate in a 10-entry kill ring.
            The editing keys are Emacs-style:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Keys</th><th>Action</th></tr>
              </thead>
              <tbody>
                {EMACS_KEYS.map(([k, a]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The placeholder adapts to state: <code className="inline">What do you want me to do? ↵</code>{" "}
            normally, <code className="inline">Queue a message...</code> while loading, and{" "}
            <code className="inline">Context almost full. Try /compact</code> at ≥90% context.
          </p>
        </section>

        <section id="ghost">
          <h2><span className="anchor">#</span>Ghost text</h2>
          <p>
            Gray inline suggestions (<code className="inline">#555555</code>) appear at the cursor
            while typing, in priority order:
          </p>
          <ul className="capabilities">
            <li><b>Command continuation</b> — completing a partial <code className="inline">/</code> command.</li>
            <li><b>Argument hints</b> — e.g. <code className="inline">/agent &lt;name&gt;</code> once the command is recognized.</li>
            <li><b>History entries</b> — the closest previous input when nothing else matches.</li>
          </ul>
          <p>
            <code className="inline">Tab</code> or <code className="inline">→</code> at end of line
            accepts the suggestion, replacing the buffer with the full command.
          </p>
        </section>

        <section id="dropdowns">
          <h2><span className="anchor">#</span>Dropdowns</h2>
          <p>Two completion dropdowns live in the input layer:</p>
          <ul className="capabilities">
            <li>
              <b><code className="inline">/</code> command dropdown</b> — fuzzy search over built-in,
              workflow, and slash commands via <b>Fuse.js</b>, capped at 8 results, each with its
              description. <code className="inline">↑/↓</code> moves, <code className="inline">Tab</code> or{" "}
              <code className="inline">Enter</code> submits the selection.
            </li>
            <li>
              <b><code className="inline">@</code> file dropdown</b> — searches relative paths with{" "}
              <code className="inline">fast-glob</code> (input is never interpolated into a shell
              command), excluding <code className="inline">node_modules</code>, <code className="inline">.git</code>,{" "}
              <code className="inline">dist</code>, <code className="inline">.deepseek</code>,{" "}
              <code className="inline">build</code>, <code className="inline">coverage</code>, and{" "}
              <code className="inline">.next</code>. Max 8 results after a 100ms debounce; matching
              falls back to fuzzy subsequence when the <code className="inline">fuzzyFileSearch</code>{" "}
              feature flag is on.
            </li>
          </ul>
        </section>

        <section id="paste">
          <h2><span className="anchor">#</span>Paste</h2>
          <p>
            Pastes arrive through bracketed-paste events or <code className="inline">Ctrl+Shift+V</code>{" "}
            (reading <code className="inline">xclip</code>/<code className="inline">xsel</code>/
            <code className="inline">wl-paste</code>), with CRLF normalized to <code className="inline">\n</code>.
            Short pastes (≤60 chars) insert inline — multiline pastes collapse to a single line.
            Longer pastes become a <code className="inline">[Text #n]</code> placeholder, and an{" "}
            <code className="inline">[n pasted]</code> badge appears in the input chrome; the real
            content is re-expanded when you submit. The clipboard shortcut also works in the setup
            wizard's credential fields.
          </p>
        </section>

        <section id="queue">
          <h2><span className="anchor">#</span>Message queue</h2>
          <p>
            Pressing <code className="inline">Enter</code> while the agent is loading queues your
            message instead of dropping it — up to <b>10</b> messages, listed under the input with a{" "}
            <code className="inline">⏎</code> prefix and truncated to 60 characters. Queued messages
            drain automatically at the end of each turn. Two kinds of input bypass the queue:{" "}
            <code className="inline">/btw</code> questions run immediately as a side question, and{" "}
            <code className="inline">/workflows</code> / <code className="inline">/workflow pause|resume|stop</code>{" "}
            controls pass straight through.
          </p>
        </section>

        <section id="status-bar">
          <h2><span className="anchor">#</span>Status bar</h2>
          <p>
            The footer bar shows a <code className="inline">─</code> divider and a row of items,
            each configurable through <code className="inline">settings.interface.statusBar</code>{" "}
            (order) and <code className="inline">narrowPriority</code> (which items survive narrow
            widths). Under 60 columns only 2 items fit; under 80, 3. The bar hides entirely when
            every item is empty:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Item</th><th>Shows</th></tr>
              </thead>
              <tbody>
                {STATUS_BAR_ITEMS.map(([i, d]) => (
                  <tr key={i}>
                    <td><code className="inline">{i}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            A <code className="inline">⚡ micro|compact</code> badge flashes for 4 seconds after a
            context compaction, and <code className="inline">↓ N activities</code> (or{" "}
            <code className="inline">↓N</code> when very narrow) counts running subagents and
            workflows.
          </p>
        </section>

        <section id="messages">
          <h2><span className="anchor">#</span>Message rendering</h2>
          <p>Each message role renders with its own prefix and style:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Role</th><th>Rendering</th></tr>
              </thead>
              <tbody>
                {MESSAGE_ROLES.map(([r, d]) => (
                  <tr key={r}>
                    <td><code className="inline">{r}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="capabilities">
            <li>
              <b>Work divider</b> — a full-width <code className="inline">─</code> line is drawn before a
              final assistant reply that follows concrete tool work.
            </li>
            <li>
              <b>Diffs</b> — <code className="inline">write_file</code>/<code className="inline">patch_file</code>{" "}
              results render as colored inline diffs (DiffView) with word-level highlighting via
              LCS and <code className="inline">+N −N</code> stats. <code className="inline">Ctrl+D</code>{" "}
              opens the latest diff fullscreen (DiffDialog); a "Changed files" summary also lists
              per-file totals.
            </li>
            <li>
              <b>Thoughts</b> — the ◌ thinking panel can be hidden with{" "}
              <code className="inline">settings.interface.showThoughts</code> without deleting history.
            </li>
          </ul>
        </section>

        <section id="dialogs">
          <h2><span className="anchor">#</span>Prompts & dialogs</h2>
          <p>Four interactive surfaces replace the input while active:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Dialog</th><th>Behavior</th></tr>
              </thead>
              <tbody>
                {DIALOGS.map(([d, b]) => (
                  <tr key={d}>
                    <td><b style={{ color: "var(--text-strong)" }}>{d}</b></td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            ToolPermissionPrompt options are numbered: <b>1</b> Allow this action, <b>2</b> allow for
            this session (or in the external directory), <b>3</b> deny, and — for permission-gated
            tools — <b>4</b> always allow. Workflow requests get their own set: execute once, view
            the workflow code, always allow this exact script, or deny.
          </p>
        </section>

        <section id="monitors">
          <h2><span className="anchor">#</span>Monitors</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Monitor</th><th>Shows & controls</th></tr>
              </thead>
              <tbody>
                {MONITORS.map(([m, d]) => (
                  <tr key={m}>
                    <td><b style={{ color: "var(--text-strong)" }}>{m}</b></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The ActivityFooter detail panel lists task, role, tools, tokens, and workspace per
            activity. Its collapsed footer also acts as a launcher: with an empty input,{" "}
            <code className="inline">↓</code> opens it.
          </p>
        </section>

        <section id="safety">
          <h2><span className="anchor">#</span>Double-press safety</h2>
          <ul className="capabilities">
            <li><b>Ctrl+C twice</b> exits the app (first press shows "Press Ctrl+C again to exit").</li>
            <li><b>Esc twice</b> clears the input buffer (shows "Press Esc again to clear input").</li>
            <li>
              <b>While loading</b>, a single <code className="inline">Ctrl+C</code> or{" "}
              <code className="inline">Esc</code> aborts the run — the transcript records{" "}
              <code className="inline">⛔ Execution aborted by user.</code>
            </li>
          </ul>
        </section>

        <section id="loading">
          <h2><span className="anchor">#</span>LoadingSpinner</h2>
          <p>
            While the agent works, an animated glyph (<code className="inline">✻ ✼ ✽ ✾ ✿ ❀</code>)
            cycles next to a rotating funny message — "Consulting the code gods...", "Centering the
            div...", "Asking the rubber duck..." — with a "Ctrl+C to cancel" hint. The message
            pool switches to prompt-refining quips during the refining phase. With{" "}
            <code className="inline">settings.interface.reducedMotion</code> the spinner is replaced
            by a static <code className="inline">Refining… / Working…</code> label.
          </p>
        </section>

        <section id="setup">
          <h2><span className="anchor">#</span>Setup wizard</h2>
          <p>First run walks through four steps:</p>
          <ol>
            <li><b>Theme</b> — the six themes listed side by side with a live diff preview.</li>
            <li><b>Provider</b> — DeepSeek API, Amazon Bedrock, Google Vertex AI, or Local (Ollama/LM Studio), each with a hint (e.g. <code className="inline">platform.deepseek.com/api_keys</code>).</li>
            <li><b>Credentials</b> — per-provider fields, masked for secrets, with <code className="inline">Ctrl+Shift+V</code> paste and Esc to go back.</li>
            <li><b>Done</b> — <code className="inline">✓ Saved!</code> and the session starts.</li>
          </ol>
          <p>
            A separate <b>LanguageSetup</b> prompt asks for your preferred response language as
            free text ("write your main language"), and the <b>UpdatePrompt</b> shows{" "}
            <code className="inline">✨ Update available!</code> with three choices: Update now
            (runs <code className="inline">npm install -g @hermenics/deepseek-code@latest</code>),
            Skip, or Don't ask again for this version.
          </p>
        </section>

        <section id="renderer">
          <h2><span className="anchor">#</span>Renderer capabilities</h2>
          <p>
            The vendored Ink renderer in <code className="inline">src/ink/</code> negotiates
            advanced terminal features and degrades gracefully:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Feature</th><th>Implementation</th></tr>
              </thead>
              <tbody>
                {RENDERER_CAPS.map(([f, i]) => (
                  <tr key={f}>
                    <td><b style={{ color: "var(--text-strong)" }}>{f}</b></td>
                    <td>{i}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            No doc page covered the TUI before this one — everything above is user-visible behavior.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
