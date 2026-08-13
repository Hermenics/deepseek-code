import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "mental-model", label: "Editor mental model" },
  { id: "submit", label: "Submit, clear & cancel" },
  { id: "movement", label: "Movement & editing" },
  { id: "history", label: "History & suggestions" },
  { id: "paste", label: "Paste behavior" },
  { id: "queue", label: "Typing while busy" },
  { id: "vim", label: "Vim mode" },
  { id: "limits", label: "Limits & edge cases" },
];

const EDIT_KEYS = [
  ["Left / Right", "Move one grapheme cluster. Emoji and composed characters move as one unit."],
  ["Up / Down", "Move between visual lines; at the top or bottom boundary, navigate prompt history."],
  ["Home / End", "Move to the beginning or end of the current visual line."],
  ["Ctrl+A / Ctrl+E", "Move to the beginning or end of the current visual line."],
  ["Ctrl+B / Ctrl+F", "Move one grapheme left or right."],
  ["Alt+B / Alt+F", "Move to the previous or next word boundary."],
  ["Backspace / Delete", "Delete the grapheme before or under the cursor."],
  ["Ctrl+K / Ctrl+U", "Delete to the end or beginning of the current line."],
  ["Ctrl+W / Alt+D", "Delete the word before or after the cursor."],
  ["Ctrl+Y", "Insert the latest entry from the editor kill ring."],
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo or redo when the platform does not reserve Ctrl+Z for process suspension."],
  ["Shift+Enter", "Insert a hard newline in the standard editor."],
];

const VIM_KEYS = [
  ["Esc", "Leave insert mode and enter normal mode. In operator-pending mode, cancel the operator."],
  ["i / a / I / A", "Insert at the cursor, after it, at line start or at line end."],
  ["o", "Insert a newline after the current line and enter insert mode."],
  ["h / l", "Move left or right."],
  ["w / b / e", "Move to the next word, previous word or end of the next word."],
  ["0 / $", "Move to the beginning or end of the line."],
  ["gg / G", "Move to the beginning or end of the complete input."],
  ["f<char> / t<char>", "Move to a character or to the position immediately before it."],
  ["x / D", "Delete under the cursor or from the cursor to line end."],
  ["d / c / y + motion", "Delete, change or yank a range. Counts such as d3w are supported."],
  ["dd / cc / yy", "Apply the operator to the current line."],
  ["iw / aw", "Use inner/around word; quote, bracket, brace and parenthesis text objects are also supported."],
  ["p / P", "Paste the internal Vim register after or before the cursor."],
  ["j / k or Down / Up", "Navigate input history in normal mode."],
  ["Enter", "Submit the input."],
];

export default function InputEditor() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Input editor</span>
        </nav>

        <div className="hero">
          <h1>Input editor</h1>
          <p className="tagline">
            Compose multiline prompts, navigate history, accept completions, queue follow-ups and optionally use Vim-style editing.
          </p>
        </div>

        <section id="mental-model">
          <h2><span className="anchor">#</span>Editor mental model</h2>
          <p>
            The prompt is a real terminal text editor rather than a single-line readline field. It tracks text and cursor
            position together, wraps to the current terminal width, keeps up to ten visual lines around the caret and
            shows counters when additional lines are hidden above or below the viewport.
          </p>
          <p>
            Cursor movement is grapheme-aware. A family emoji, combining accent or other composed character is treated
            as one editing unit even when it occupies several JavaScript code units. Word movement uses Unicode word
            segmentation, while displayed columns account for wide CJK and emoji cells.
          </p>
          <p>
            The input chrome also communicates state. The normal placeholder asks what to do, a busy session says
            <code className="inline">Queue a message...</code>, and context at 90% or higher suggests
            <code className="inline">/compact</code>. A prompt beginning with <code className="inline">!</code> uses the
            shell-colored indicator because it will be handled as a shell command.
          </p>
        </section>

        <section id="submit">
          <h2><span className="anchor">#</span>Submit, clear and cancel</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Keys</th><th>Behavior</th></tr></thead>
              <tbody>
                <tr><td><code className="inline">Enter</code></td><td>Submit the current prompt. Empty or whitespace-only input is ignored.</td></tr>
                <tr><td><code className="inline">Shift+Enter</code></td><td>Insert a newline in the standard editor. See the Vim-mode exception below.</td></tr>
                <tr><td><code className="inline">Ctrl+C</code></td><td>Cancel a running turn. While idle, press twice within 800 ms to exit.</td></tr>
                <tr><td><code className="inline">Esc</code></td><td>Cancel a running turn. In the standard editor, press twice within 800 ms to clear the draft and pasted blocks.</td></tr>
                <tr><td><code className="inline">Shift+Tab</code></td><td>Advance through Plan, Review, Build and Auto in their fixed cycle.</td></tr>
                <tr><td><code className="inline">PageUp / PageDown</code></td><td>Leave the event for the focused transcript or scroll container rather than editing the prompt.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Double-press state is cancelled by a different key or by waiting longer than 800 ms. The yellow inline hint
            tells you when Ctrl+C or Esc is armed, preventing a stray key from silently exiting or deleting a draft.
          </p>
          <Note>
            On Unix-like systems Ctrl+Z is reserved by the terminal renderer for process suspension. Run
            <code className="inline">fg</code> in the shell to resume. Although the editor maintains a 50-snapshot
            undo buffer, Ctrl+Z reaches editor undo only on platforms where process suspension is not intercepted.
          </Note>
        </section>

        <section id="movement">
          <h2><span className="anchor">#</span>Movement and editing</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Keys</th><th>Action</th></tr></thead>
              <tbody>
                {EDIT_KEYS.map(([keys, action]) => <tr key={keys}><td><code className="inline">{keys}</code></td><td>{action}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Consecutive delete-to-boundary operations feed an Emacs-style kill ring with a maximum of ten entries.
            Ctrl+Y inserts the newest killed text. The Vim register described later is separate from this ring, and
            neither one is the operating system clipboard.
          </p>
          <p>
            The editor reflows when the terminal width changes. Vertical movement follows the rendered lines rather than
            only hard newlines; moving above the first or below the last rendered line transfers control to input history.
          </p>
        </section>

        <section id="history">
          <h2><span className="anchor">#</span>History, commands and ghost suggestions</h2>
          <p>
            Submitted natural-language prompts are stored in <code className="inline">~/.deepseek/input_history.json</code>.
            The file retains the newest 200 entries, skips consecutive duplicates and deliberately excludes slash commands
            and <code className="inline">!</code> shell lines. Up saves the current draft before entering history; Down from
            the newest history item restores that draft.
          </p>
          <p>
            Suggestions appear only when the cursor is at the end of the input. Command completion has first priority,
            then recognized command argument hints, then the newest history entry that begins with the typed prefix.
            Press Tab, or Right while already at the end, to accept a command or history completion. Argument placeholders
            such as <code className="inline">&lt;model-name&gt;</code> are informational and are not inserted for you. History
            ghost text starts after at least two typed characters.
          </p>
          <p>
            Typing a slash command without spaces opens a completion list. Exact prefix matches are preferred; otherwise
            fuzzy matching is used. Up and Down wrap through the results, while Tab or Enter selects and immediately
            submits the highlighted command. The dropdown displays a moving window of six rows; fuzzy lookup contributes
            at most eight candidates, while an exact prefix can match more. Once an argument contains whitespace, command
            completion closes so normal prompt editing can continue.
          </p>
          <CodeBlock lang="text">{"/checkp        → command completion\n/checkpoint     → exact command\n/checkpoint save be  → normal argument editing"}</CodeBlock>
          <Note>
            Selecting a slash-command completion executes it; it does not merely insert the text for another review step.
            Use ghost-text acceptance when you want insertion without immediate command dispatch.
          </Note>
        </section>

        <section id="paste">
          <h2><span className="anchor">#</span>Paste behavior</h2>
          <p>
            Bracketed terminal paste and the editor&apos;s Ctrl+V clipboard path share the same normalization. CRLF becomes
            LF. A paste of 60 characters or fewer is inserted inline; if it contains newlines, those lines are joined with
            spaces. A paste longer than 60 characters becomes a compact <code className="inline">[Text #n]</code> marker.
          </p>
          <CodeBlock lang="text">{"Investigate this failure: [Text #1]"}</CodeBlock>
          <p>
            The full block stays in memory and replaces the marker when the prompt is submitted or queued. A badge reports
            how many long blocks the draft currently holds. Clearing or submitting the draft also clears those stored
            blocks. If you type a marker manually and there is no corresponding stored paste, it remains literal text.
          </p>
          <p>
            On Linux, Ctrl+V tries xclip, xsel and wl-paste with a two-second timeout. If all helpers fail, the editor stays
            unchanged and does not show an error. Your terminal&apos;s ordinary paste shortcut may still work through bracketed
            paste; see <a href="/docs/terminal-setup">Terminal setup</a>.
          </p>
        </section>

        <section id="queue">
          <h2><span className="anchor">#</span>Type while the agent is busy</h2>
          <p>
            Enter during a running turn does not replace the active request. It queues the trimmed prompt in FIFO order,
            displays it below the transcript with an <code className="inline">⏎</code> marker and submits one queued item
            after each completed turn. The visible preview is shortened after 60 characters; the actual queued message is not.
          </p>
          <p>
            The queue holds at most ten messages. Once full, additional submissions are ignored, so combine related steering
            into one follow-up rather than filling every slot. Long-paste markers are expanded before the message enters the queue.
          </p>
          <p>
            Two control paths bypass ordinary waiting. <code className="inline">/btw &lt;question&gt;</code> starts a side
            question immediately through the shared command parser. Workflow listing plus pause, resume and stop controls
            are dispatched immediately so you can supervise a live workflow without waiting for the main turn to finish.
          </p>
          <CodeBlock lang="text">{"/btw which test is currently failing?\n/workflow pause <run-id>"}</CodeBlock>
        </section>

        <section id="vim">
          <h2><span className="anchor">#</span>Vim mode</h2>
          <p>
            Enable Vim editing live through <code className="inline">/config</code> or settings. New drafts start in insert
            mode; Escape moves to normal mode and places the cursor on the previous character when possible.
          </p>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "vim": true\n  }\n}'}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Keys</th><th>Action</th></tr></thead>
              <tbody>
                {VIM_KEYS.map(([keys, action]) => <tr key={keys}><td><code className="inline">{keys}</code></td><td>{action}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Text objects cover words, single/double/backtick quotes, parentheses, brackets and braces. The implementation
            supports normal, insert and operator-pending states; it does not provide visual mode, command-line mode,
            macros, search, repeat-dot or a full Vim undo model.
          </p>
          <Note>
            In Vim insert mode, Enter submits before the standard editor handles Shift+Enter, so Shift+Enter also submits.
            Use normal-mode <code className="inline">o</code> when you need to create a multiline Vim draft.
          </Note>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and edge cases</h2>
          <ul className="capabilities">
            <li><b>Input viewport:</b> at most ten visual lines are shown around the caret; hidden text remains in the draft.</li>
            <li><b>Undo snapshots:</b> the internal buffer retains the newest 50 text-and-cursor states and drops redo states after a new edit.</li>
            <li><b>Queue:</b> ten pending messages; overflow has no visible error.</li>
            <li><b>History:</b> 200 natural-language entries; slash and shell commands are never persisted there.</li>
            <li><b>Kill ring:</b> ten editor entries, separate from Vim&apos;s single register and the system clipboard.</li>
            <li><b>Escape-prefixed input:</b> unknown ANSI sequences are discarded so terminal control bytes do not become prompt text.</li>
          </ul>
          <Note>
            Ordinary slash-command completion can still be visible while the agent is busy. Prefer typing the full busy-safe
            control, including its arguments, instead of selecting a bare completion: only queued prompts, <code className="inline">/btw</code>{" "}
            questions and live workflow controls have explicit busy-session handling.
          </Note>
          <p>
            File completion with <code className="inline">@</code> has its own matching and security rules. Read
            <a href="/docs/file-references"> File references</a> before assuming that a selected path automatically
            uploads or embeds its contents.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
