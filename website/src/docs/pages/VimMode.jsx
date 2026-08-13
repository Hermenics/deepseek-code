import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "enable", label: "Enable Vim mode" },
  { id: "model", label: "Editing model" },
  { id: "motions", label: "Motions & counts" },
  { id: "operators", label: "Operators & text objects" },
  { id: "register", label: "Register & paste" },
  { id: "history", label: "History, submit & multiline" },
  { id: "terminal", label: "Terminal behavior" },
  { id: "limits", label: "Limits & accessibility" },
];

const MODE_KEYS = [
  ["Esc", "From insert mode, enter normal mode and move one position left when possible. From operator-pending mode, cancel the operator."],
  ["i / a", "Enter insert mode at the cursor or one position after it."],
  ["I / A", "Enter insert mode at the beginning or end of the current hard line."],
  ["o", "Insert a hard newline after the current line and enter insert mode. Uppercase O is not implemented."],
  ["Enter", "Submit the complete draft in insert or normal mode."],
];

const MOTIONS = [
  ["h / l", "Move one position left or right."],
  ["w / b / e", "Move by word and punctuation runs: next word, previous word, or word end."],
  ["0 / $", "Move to the beginning or end of the current hard line."],
  ["gg / G", "Move to the start of the draft or to its final character."],
  ["f<char>", "Find the next occurrence of a character on the current line and land on it."],
  ["t<char>", "Find forward and land immediately before the character."],
  ["1–9, then digits", "Prefix a supported motion or x with a count, such as 4w, 3l or 2x."],
];

const OPERATORS = [
  ["d + motion", "Delete the motion range into the single Vim register."],
  ["c + motion", "Delete the range into the register, then enter insert mode."],
  ["y + motion", "Copy the range into the register without changing the draft."],
  ["dd / cc / yy", "Apply the operator to the current hard line."],
  ["x", "Delete the character under the cursor; a count is supported."],
  ["D", "Delete from the cursor to the end of the current line."],
  ["p / P", "Insert the internal register after or before the cursor."],
];

export default function VimMode() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Vim mode</span>
        </nav>

        <div className="hero">
          <h1>Vim mode</h1>
          <p className="tagline">
            Use a focused subset of Vim motions, operators and text objects inside the prompt editor, with explicit boundaries around what is not emulated.
          </p>
        </div>

        <section id="enable">
          <h2><span className="anchor">#</span>Enable Vim mode</h2>
          <p>
            Run <code className="inline">/vim</code> to toggle Vim behavior for the current process. The command reports
            whether the mode is enabled, but that live toggle does not write a settings file. For a persistent choice,
            use the Vim input switch in <code className="inline">/config</code> or set
            <code className="inline">interface.vim</code> in an effective settings file.
          </p>
          <CodeBlock lang="text">{"/vim\nVim mode enabled."}</CodeBlock>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "vim": true\n  }\n}'}</CodeBlock>
          <p>
            Every fresh editor state starts in insert mode, including after submission and after choosing a slash command
            from completion. Disable Vim mode with <code className="inline">/vim</code> again, or persist
            <code className="inline">false</code> through configuration.
          </p>
        </section>

        <section id="model">
          <h2><span className="anchor">#</span>Editing model</h2>
          <p>
            The implementation has three states: insert, normal and operator-pending. Insert mode retains the standard
            editor for printable text, movement and Emacs-style editing shortcuts. Escape and Enter are intercepted by
            Vim first. Normal mode interprets supported Vim keys, and an operator such as <code className="inline">d</code>,
            <code className="inline">c</code> or <code className="inline">y</code> waits for a motion or text object.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Keys</th><th>Behavior</th></tr></thead>
              <tbody>
                {MODE_KEYS.map(([keys, action]) => <tr key={keys}><td><code className="inline">{keys}</code></td><td>{action}</td></tr>)}
              </tbody>
            </table>
          </div>
          <Note>
            There is currently no persistent on-screen insert/normal/operator label. If a printable key appears to do
            nothing, press <code className="inline">i</code> to enter insert mode or toggle Vim off with
            <code className="inline">/vim</code> after submitting the current draft.
          </Note>
        </section>

        <section id="motions">
          <h2><span className="anchor">#</span>Motions and counts</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Keys</th><th>Action</th></tr></thead>
              <tbody>
                {MOTIONS.map(([keys, action]) => <tr key={keys}><td><code className="inline">{keys}</code></td><td>{action}</td></tr>)}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="text">{"3w        move forward three word motions\nd3w       delete three word motions\n2f:       find the second following colon\ngg        move to the beginning of the draft"}</CodeBlock>
          <p>
            Counts begin with 1–9; zero becomes part of a count only after another digit, so a standalone
            <code className="inline">0</code> remains the line-start motion. Counts are implemented for motions,
            character deletion and operator-plus-motion sequences. They are not applied to
            <code className="inline">dd</code>, <code className="inline">cc</code>, <code className="inline">yy</code>,
            <code className="inline">D</code>, <code className="inline">p</code> or <code className="inline">P</code>.
          </p>
          <p>
            Word motions use a compact ASCII-style word/punctuation model, not the Unicode segmentation used by the
            standard editor. Mixed scripts, combining characters and emoji can therefore stop or move differently from
            Left, Right, Alt+B and Alt+F in insert mode.
          </p>
        </section>

        <section id="operators">
          <h2><span className="anchor">#</span>Operators and text objects</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Keys</th><th>Action</th></tr></thead>
              <tbody>
                {OPERATORS.map(([keys, action]) => <tr key={keys}><td><code className="inline">{keys}</code></td><td>{action}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Text objects are available only after an operator. Use <code className="inline">iw</code> or
            <code className="inline">aw</code> for a word, and use inner/around forms for single quotes, double quotes,
            backticks, parentheses, square brackets or braces. Either member of a bracket pair is accepted as the object key.
          </p>
          <CodeBlock lang="text">{"ci\"      change inside double quotes\nda(      delete around parentheses\nyi{      yank inside braces\ndaw      delete around the current word"}</CodeBlock>
          <p>
            Around-word prefers one following whitespace character and otherwise includes preceding whitespace. Quoted and
            bracketed objects are intentionally simple: they find a nearby opening delimiter and the following closing
            delimiter. They do not parse escaping, language syntax or arbitrarily nested structures.
          </p>
          <p>
            Escape cancels an operator. An unsupported continuation also returns to normal mode without changing text or
            sounding an error, so a mistyped sequence can appear silent.
          </p>
        </section>

        <section id="register">
          <h2><span className="anchor">#</span>Register and paste</h2>
          <p>
            Delete, change and yank operations share one in-memory Vim register. It is separate from the standard editor
            kill ring and from the operating-system clipboard. There are no named, numbered, black-hole or system-clipboard
            registers, and the register resets with a new editor state.
          </p>
          <p>
            <code className="inline">p</code> and <code className="inline">P</code> do nothing while the register is empty.
            Terminal bracketed paste and the editor&apos;s Ctrl+V clipboard path bypass Vim command interpretation and insert
            literal paste content even while normal mode is active; the Vim state itself does not switch to insert mode.
          </p>
          <Note>
            Long external pastes can appear as <code className="inline">[Text #n]</code> markers. That is the prompt
            editor&apos;s paste compaction, not a Vim register. The marker expands only when the prompt is submitted or queued.
          </Note>
        </section>

        <section id="history">
          <h2><span className="anchor">#</span>History, submit and multiline drafts</h2>
          <p>
            In normal mode, <code className="inline">k</code> and Up navigate older prompt history;
            <code className="inline">j</code> and Down navigate toward newer entries. They do not move vertically inside a
            multiline draft. Use supported motions for horizontal editing, or return to insert mode for the standard
            editor&apos;s visual-line navigation.
          </p>
          <p>
            Enter submits in every Vim state where it is handled. In insert mode, Shift+Enter is also seen as Enter and
            submits instead of inserting a newline. Use normal-mode <code className="inline">o</code> to create a hard
            newline, then continue typing in insert mode.
          </p>
          <CodeBlock lang="text">{"Esc  o  type the next line  Enter"}</CodeBlock>
          <p>
            Submitting, clearing the editor or selecting a command completion resets Vim to insert mode. Prompt-history
            navigation replaces the current draft with the selected entry while leaving Vim editing enabled.
          </p>
        </section>

        <section id="terminal">
          <h2><span className="anchor">#</span>Terminal delivery and fallbacks</h2>
          <p>
            Some tmux and SSH paths deliver several printable keys in one input chunk. DeepSeek Code processes an ordinary
            chunk character by character, so sequences such as <code className="inline">d3w</code> and
            <code className="inline">ci&quot;</code> still work. A terminal-declared bracketed paste is different: it is
            deliberately inserted as data and never replayed as normal-mode commands.
          </p>
          <p>
            Modified keys and escape sequences remain terminal-dependent. When a key cannot be distinguished, the reliable
            fallback is to use unmodified Vim keys or temporarily enter insert mode. Unknown sequences do not become prompt text.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and accessibility</h2>
          <ul className="capabilities">
            <li><b>Modes:</b> insert, normal and operator-pending only; no visual, select, command-line or replace mode.</li>
            <li><b>Navigation:</b> no search, reverse character find, repeat-find, marks, matching-delimiter command or vertical Vim motion.</li>
            <li><b>Editing:</b> no Vim undo/redo commands, repeat-dot, macros, recording, replace-character, join or indentation operators.</li>
            <li><b>Registers:</b> one private register; no system clipboard integration through Vim register syntax.</li>
            <li><b>Parsing:</b> word and delimiter objects are editor heuristics, not a programming-language parser.</li>
            <li><b>Feedback:</b> unsupported normal-mode keys are silent and the current mode has no textual status indicator.</li>
          </ul>
          <p>
            Vim mode is fully keyboard-operated, but the missing mode announcement can be difficult for screen-reader and
            low-vision workflows. The standard editor provides clearer direct manipulation and grapheme-aware movement;
            keep <code className="inline">interface.vim</code> false if explicit state feedback matters more than modal editing.
          </p>
          <p>
            See <a href="/docs/input-editor">Input editor</a> for standard editing and
            <a href="/docs/clipboard-pasting"> Clipboard and pasting</a> for external paste behavior.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
