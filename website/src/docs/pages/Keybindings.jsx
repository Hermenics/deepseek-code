import { Note, Toc } from "../Layout";

const TOC = [
  { id: "session", label: "Session control" },
  { id: "emacs", label: "Emacs editing" },
  { id: "vim", label: "Vim mode" },
  { id: "autocomplete", label: "Autocomplete" },
  { id: "prompts", label: "Prompts" },
  { id: "workflow", label: "Workflow monitor" },
  { id: "config", label: "Config menu" },
  { id: "hooks", label: "Hook library" },
  { id: "agents", label: "Agent library" },
  { id: "mobile", label: "Mobile QR" },
  { id: "status-icons", label: "Status icons" },
];

const SESSION_KEYS = [
  ["Ctrl+C", "Abort the running turn; pressed twice, exits the app"],
  ["Esc", "Abort the running turn; pressed twice with text, clears the input"],
  ["Ctrl+D", "Open the latest diff fullscreen (DiffDialog)"],
  ["Shift+Tab", "Cycle interaction mode: plan → review → build → auto"],
  ["Ctrl+Z / Shift+Z", "Undo / redo the last input edit"],
];

const EMACS_KEYS = [
  ["Ctrl+A / Ctrl+E", "Move cursor to start / end of line"],
  ["Ctrl+B / Ctrl+F", "Move one grapheme left / right"],
  ["Ctrl+K / Ctrl+U / Ctrl+W", "Kill to end of line / to start of line / word before (kill ring)"],
  ["Ctrl+Y", "Yank the last kill"],
  ["Meta/Alt+B / Meta/Alt+F", "Move one word back / forward"],
  ["Meta/Alt+D", "Delete the word after the cursor"],
  ["Shift+Enter", "Insert a newline in the multiline input"],
  ["↑ / ↓", "Walk input history when on the first/last visual line; move by visual line inside multiline text"],
];

const VIM_KEYS = [
  ["Esc", "Insert → normal mode (Esc also cancels a pending operator)"],
  ["i / a / I / A", "Enter insert: at cursor / after cursor / at line start / at line end"],
  ["o", "Open a new line below and insert"],
  ["h l j k", "Move left / right / down / up (k and j also walk history in normal mode)"],
  ["w b e", "Word forward / backward / to word end"],
  ["0 $", "Line start / line end"],
  ["G / gg", "End of text / start of text"],
  ["f&lt;c&gt; / t&lt;c&gt;", "Jump to / until character c; add a count for repetition"],
  ["d / c / y + motion", "Delete / change / yank with counts, e.g. d3w"],
  ["dd / cc / yy", "Line delete / change / yank"],
  ["x / D", "Delete character / delete to end of line"],
  ["iw / aw", "Inner / around text objects — word, quotes (“ ” ' `), brackets, and parens"],
  ["p / P", "Paste register after / before cursor"],
  ["Enter", "Submit the input (normal mode)"],
];

const PROMPT_KEYS = [
  ["y / n", "Confirm / cancel in ConfirmPrompt and destructive confirmations"],
  ["1 – 4", "Tool permission decisions (4 only when the tool is permission-gated; workflows get their own numbered set)"],
  ["↑ / ↓ + Enter", "Navigate and select in plan approval, model, effort, and update prompts"],
  ["Space", "Dismiss the /btw side question; toggle a hook enabled/disabled in HookLibrary"],
  ["Esc", "Cancel or go back (also Ctrl+C in confirm dialogs)"],
];

const WORKFLOW_KEYS = [
  ["↑ / ↓", "Select a run"],
  ["Enter", "Toggle run detail"],
  ["x", "Stop the selected run"],
  ["p", "Pause (running) / resume (paused)"],
  ["r", "Restart a finished run"],
  ["s", "Save the workflow (type a name, Enter confirms, Esc cancels)"],
  ["Esc", "Close the monitor (back out of detail first)"],
];

const CONFIG_KEYS = [
  ["Tab / Shift+Tab", "Cycle settings scope: user → project → local"],
  ["/", "Search settings"],
  ["↑↓ / j / k", "Move between categories and items"],
  ["← / →", "Switch focus between categories and items (wide layout)"],
  ["e / Space", "Activate the selected item (toggle, open editor, run action)"],
  ["Enter", "Edit a value inline (text/number/list) or activate"],
  ["r", "Restore the inherited value — removes the local override"],
  ["q / Esc", "Close the menu"],
];

const HOOK_KEYS = [
  ["n", "New hook (PreToolUse, matcher *)"],
  ["e", "Edit the hook command"],
  ["m", "Edit the matcher (not for SessionStart)"],
  ["x", "Edit the timeout in seconds"],
  ["v", "Cycle event: PreToolUse → PostToolUse → SessionStart"],
  ["Space", "Toggle hook enabled / disabled"],
  ["t", "Test the hook with a simulated payload (confirm first)"],
  ["d", "Delete the hook"],
];

const AGENT_KEYS = [
  ["u", "Cycle usage filter: all → primary → subagent"],
  ["o", "Cycle origin filter: all → builtin → user → additional → project → local"],
  ["n", "Create a new agent (name prompt)"],
  ["e", "Edit the agent JSON in $EDITOR"],
  ["p", "Edit the specialization prompt in the markdown editor"],
  ["c", "Duplicate the selected agent"],
  ["d / Space", "Remove at this scope, or disable built-ins / other scopes"],
  ["r", "Restore — removes the scoped override or re-enables a built-in"],
];

const STATUS_ICONS = [
  ["✓ / ✗", "Success / error"],
  ["⚠", "Warning"],
  ["ℹ", "Info (tokens, hints)"],
  ["○ / … / ◌", "Pending / loading / thinking"],
  ["● / ❯", "Assistant / user message"],
  ["$", "Terminal (shell) message"],
  ["◈", "Agent (model in the status bar)"],
  ["⎿", "Subagent"],
];

export default function Keybindings() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Keyboard shortcuts</span>
        </nav>

        <div className="hero">
          <h1>Keyboard shortcuts</h1>
          <p className="tagline">
            The complete keybinding inventory — session control, Emacs-style editing, Vim mode,
            and every dialog and monitor.
          </p>
        </div>

        <section id="session">
          <h2><span className="anchor">#</span>Session control</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Keys</th><th>Action</th></tr>
              </thead>
              <tbody>
                {SESSION_KEYS.map(([k, a]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Mode cycling wraps around, so from the default Build mode a single{" "}
            <code className="inline">Shift+Tab</code> lands on Auto.
          </p>
        </section>

        <section id="emacs">
          <h2><span className="anchor">#</span>Emacs editing</h2>
          <p>
            The input editor speaks Emacs in addition to plain arrow keys. Cursor movement is
            grapheme-aware, kills accumulate in a 10-entry kill ring, and undo/redo keeps a
            50-entry buffer:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Keys</th><th>Action</th></tr>
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
        </section>

        <section id="vim">
          <h2><span className="anchor">#</span>Vim mode</h2>
          <p>
            Toggle with <code className="inline">/vim</code> (or persist it via{" "}
            <code className="inline">settings.interface.vim</code>). Insert mode handles printable
            input normally; in normal mode the classic motion set applies, with counts, operators,
            and text objects:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "36%" }}>Keys</th><th>Action</th></tr>
              </thead>
              <tbody>
                {VIM_KEYS.map(([k, a]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            Chunked input (common over tmux/SSH) is processed per-character, so multi-key sequences
            like <code className="inline">d3w</code> or <code className="inline">ci"</code> work even
            when the terminal delivers them as one paste.
          </Note>
        </section>

        <section id="autocomplete">
          <h2><span className="anchor">#</span>Autocomplete</h2>
          <ul className="capabilities">
            <li><b>Tab / →</b> — accept ghost text (command continuation, argument hint, or history entry) at end of line.</li>
            <li><b>↑ / ↓</b> — navigate the command or file dropdown when it is open.</li>
            <li><b>Tab / Enter</b> — select the highlighted command or file dropdown entry.</li>
          </ul>
        </section>

        <section id="prompts">
          <h2><span className="anchor">#</span>Prompts</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Keys</th><th>Action</th></tr>
              </thead>
              <tbody>
                {PROMPT_KEYS.map(([k, a]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            In the plan approval dialog, <code className="inline">n</code> opens a feedback phase —
            type your revision notes and press <code className="inline">Enter</code> to send them
            back to the model.
          </p>
        </section>

        <section id="workflow">
          <h2><span className="anchor">#</span>Workflow monitor</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Keys</th><th>Action</th></tr>
              </thead>
              <tbody>
                {WORKFLOW_KEYS.map(([k, a]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Config menu</h2>
          <p>
            Opened with <code className="inline">/config</code>. Every field saves per scope —
            User, Project, or Local:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Keys</th><th>Action</th></tr>
              </thead>
              <tbody>
                {CONFIG_KEYS.map(([k, a]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Destructive actions (reset scope, clear memory, clear sessions) ask for{" "}
            <code className="inline">y</code>/<code className="inline">n</code> confirmation first.
          </p>
        </section>

        <section id="hooks">
          <h2><span className="anchor">#</span>Hook library</h2>
          <p>
            Reached from the config menu's Hooks action. Only User-scope hooks are executable —
            Project/Local hooks are ignored for security:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Keys</th><th>Action</th></tr>
              </thead>
              <tbody>
                {HOOK_KEYS.map(([k, a]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="agents">
          <h2><span className="anchor">#</span>Agent library</h2>
          <p>
            Reached from the config menu's Agent library action. Built-ins, user, project, and
            local agents are listed together:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Keys</th><th>Action</th></tr>
              </thead>
              <tbody>
                {AGENT_KEYS.map(([k, a]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="mobile">
          <h2><span className="anchor">#</span>Mobile QR</h2>
          <p>
            <code className="inline">/mobile</code> shows a QR code that pairs a mobile browser with
            the session. <code className="inline">Tab</code> or any arrow key toggles between the iOS
            and Android variants; <code className="inline">Esc</code> or <code className="inline">q</code>{" "}
            closes it.
          </p>
        </section>

        <section id="status-icons">
          <h2><span className="anchor">#</span>Status icons</h2>
          <p>
            The same icon set is used across messages, tool lines, and the status bar — defined
            once in <code className="inline">src/ui/theme.ts</code> as{" "}
            <code className="inline">STATUS_ICONS</code>:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Icon</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {STATUS_ICONS.map(([i, m]) => (
                  <tr key={i}>
                    <td><code className="inline">{i}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <Note>
          Footers and hints show contextual shortcuts constantly — the table above is the complete
          inventory.
        </Note>
      </main>

      <Toc items={TOC} />
    </>
  );
}
