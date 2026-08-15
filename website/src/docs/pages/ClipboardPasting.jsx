import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "paths", label: "Paste paths" },
  { id: "normalization", label: "Normalization" },
  { id: "large", label: "Large-paste markers" },
  { id: "submit", label: "Submission & queueing" },
  { id: "vim", label: "Vim interaction" },
  { id: "terminal", label: "Terminal fallbacks" },
  { id: "privacy", label: "Privacy & safety" },
  { id: "limits", label: "Limits & accessibility" },
];

const PASTE_PATHS = [
  ["Terminal paste", "Usually Ctrl+Shift+V on Linux/Windows or Cmd+V on macOS. The terminal should send one bracketed-paste event."],
  ["Ctrl+V in DeepSeek Code", "On Linux, read the clipboard through xclip, then xsel, then wl-paste, stopping at the first success."],
  ["Middle-click / menu paste", "Owned by the terminal emulator. It works when the emulator delivers bracketed paste or ordinary text input."],
];

export default function ClipboardPasting() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Clipboard and pasting</span>
        </nav>

        <div className="hero">
          <h1>Clipboard and pasting</h1>
          <p className="tagline">
            Understand terminal-native paste, the Linux clipboard helper, multiline normalization and compact markers for large blocks.
          </p>
        </div>

        <section id="paths">
          <h2><span className="anchor">#</span>Three ways text can arrive</h2>
          <p>
            DeepSeek Code enables terminal bracketed-paste mode while its raw input handler is active. A compatible terminal
            surrounds pasted content with control markers; the editor collects the whole payload and inserts it as data
            rather than interpreting its characters as a rapid sequence of keystrokes.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "32%" }}>Path</th><th>What happens</th></tr></thead>
              <tbody>
                {PASTE_PATHS.map(([path, behavior]) => <tr key={path}><td><b>{path}</b></td><td>{behavior}</td></tr>)}
              </tbody>
            </table>
          </div>
          <Note>
            Ctrl+Shift+V is normally a terminal-emulator shortcut; it is not the same path as pressing Ctrl+V inside the
            editor. The editor&apos;s Ctrl+V helper is Linux-specific and fails silently if no supported clipboard command works.
          </Note>
        </section>

        <section id="normalization">
          <h2><span className="anchor">#</span>Normalization and the 60-character boundary</h2>
          <p>
            Windows CRLF line endings are normalized to LF before the editor classifies a paste. A normalized payload is
            inserted directly only when it is 60 characters or fewer <em>and</em> spans at most 3 lines. If it has
            multiple lines, hard line breaks are replaced with single spaces; the editor does not trim leading, trailing
            or repeated whitespace.
          </p>
          <CodeBlock lang="text">{"Pasted:\nfirst line\nsecond line\n\nInserted:\nfirst line second line"}</CodeBlock>
          <p>
            A payload longer than 60 characters <em>or</em> spanning more than 3 lines uses the large-paste path described
            below. The boundary is an implementation string length, not a byte count or a user-perceived grapheme count.
            Some emoji and composed characters occupy more than one counted unit, so a visually short Unicode paste can
            cross the boundary earlier than expected.
          </p>
          <p>
            An empty bracketed paste has no effect. Pasting never presses Enter on your behalf: even content containing
            newlines arrives as one editor operation, then waits for an explicit submission.
          </p>
        </section>

        <section id="large">
          <h2><span className="anchor">#</span>Large-paste markers</h2>
          <p>
            A payload longer than 60 characters or spanning more than 3 lines is retained in process memory and
            represented in the draft by a numbered marker. Thus, even a short four-line payload gets a marker, while a
            payload of 60 characters or fewer stays inline only when it also spans at most 3 lines. This keeps logs, stack
            traces and source excerpts from expanding the input viewport. The marker is the only indicator — there is no
            separate badge next to the input.
          </p>
          <CodeBlock lang="text">{"Explain this failure and propose the smallest fix:\n[Text #1]"}</CodeBlock>
          <p>
            The marker is editable text that behaves as one unit: pressing Backspace or Delete anywhere inside
            <code className="inline">[Text #n]</code> removes the whole marker at once, so a broken fragment like
            <code className="inline">[Text #1</code> can never linger. Each occurrence of a valid marker expands to the
            same retained block at submission time. Deleting every occurrence means that block is not sent. A marker with
            no matching retained block stays literal.
          </p>
          <Note>
            Manually typing a marker that refers to a block still retained by the current editor can expand that block.
            Treat <code className="inline">[Text #n]</code> as a live reference, not as inert decoration.
          </Note>
        </section>

        <section id="submit">
          <h2><span className="anchor">#</span>Submission, commands and queueing</h2>
          <p>
            Marker expansion happens before the draft reaches the command/prompt dispatcher. If the expanded result starts
            with <code className="inline">/</code> or <code className="inline">!</code>, it can be treated as a slash command
            or shell command after you press Enter. Always review pasted command text before submitting it.
          </p>
          <p>
            During a running turn, Enter expands all markers and places the trimmed result in the prompt queue. The visible
            queue preview can be shortened, but the queued message retains the full expanded text. Submission, command
            completion selection and clearing the editor release the current large-paste store.
          </p>
          <CodeBlock lang="text">{"[Text #1]\nEnter\n⏎ queued: Investigate the complete diagnostic output..."}</CodeBlock>
          <p>
            A normal submitted prompt can enter session state and prompt history according to their normal persistence
            rules. Slash commands and shell lines are excluded from prompt history, but their effects and terminal output
            may still be visible in the session. Paste compaction is not a privacy or redaction feature.
          </p>
        </section>

        <section id="vim">
          <h2><span className="anchor">#</span>Interaction with Vim mode</h2>
          <p>
            External paste is treated as literal content before Vim key processing. It therefore does not replay a pasted
            string such as <code className="inline">dd</code> as commands. This protection also applies when Vim is in normal
            or operator-pending mode.
          </p>
          <p>
            Pasting does not change the Vim state. If you paste while normal mode is active, the text is inserted but the
            next ordinary key is still interpreted as a normal-mode command. Press <code className="inline">i</code> before
            continuing to type, or paste while already in insert mode.
          </p>
          <p>
            Vim&apos;s <code className="inline">p</code> and <code className="inline">P</code> use a separate internal register.
            They do not read the desktop clipboard and do not use large-paste markers.
          </p>
        </section>

        <section id="terminal">
          <h2><span className="anchor">#</span>Terminal and Linux fallbacks</h2>
          <p>
            The in-editor Ctrl+V path launches a clipboard reader with a two-second timeout. The probe order is
            <code className="inline">xclip</code>, <code className="inline">xsel</code>, then
            <code className="inline">wl-paste</code>. Missing commands, an unavailable display and a timeout all leave the
            draft unchanged without an error message or availability indicator.
          </p>
          <CodeBlock lang="bash">{"# Check which helper is available in your shell\ncommand -v xclip\ncommand -v xsel\ncommand -v wl-paste"}</CodeBlock>
          <p>
            On macOS, Windows, containers, remote hosts and Linux desktops without those helpers, prefer the terminal&apos;s
            own paste shortcut. Over SSH, clipboard integration normally belongs to the local terminal, while Ctrl+V runs
            helpers on the remote machine. tmux must also pass bracketed-paste markers through correctly.
          </p>
          <p>
            If a paste begins but its closing terminal marker never arrives, the parser waits longer than it does for an
            ordinary escape sequence and then flushes buffered content as a paste. This recovery avoids holding input
            forever, but a broken terminal path can add a perceptible delay.
          </p>
        </section>

        <section id="privacy">
          <h2><span className="anchor">#</span>Privacy and safe handling</h2>
          <ul className="capabilities">
            <li><b>In-memory compaction:</b> large blocks are held by the running process, not written to a temporary paste file.</li>
            <li><b>Expansion at dispatch:</b> the complete block becomes part of the prompt or command only after Enter.</li>
            <li><b>Persistence after submit:</b> normal history, session storage and provider transmission can contain the expanded text.</li>
            <li><b>No content scan:</b> paste handling does not classify secrets, dangerous shell commands or confidential data.</li>
            <li><b>No automatic submit:</b> terminal paste inserts data, but you remain responsible for reviewing and submitting it.</li>
          </ul>
          <p>
            Do not paste credentials merely because the editor shows a compact marker. Remove the marker before submission
            if the retained block should not be sent, then clear or submit the editor to release its paste store.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and accessibility</h2>
          <p>
            The marker and paste count are textual, so understanding a large paste does not depend only on color. Bracketed
            paste also prevents assistive input from being mistaken for a burst of commands. However, the editor does not
            announce clipboard-helper failures, marker expansion or the number of hidden characters through a semantic
            accessibility channel; terminal readers may announce only changed cells.
          </p>
          <ul className="capabilities">
            <li><b>Inline threshold:</b> 60 counted string units and at most 3 normalized lines; exceeding either limit forces a marker.</li>
            <li><b>Inline multiline paste:</b> line breaks become spaces and cannot be preserved in a short paste.</li>
            <li><b>Large paste:</b> normalized LF line breaks are preserved when the marker expands.</li>
            <li><b>Clipboard helper:</b> Linux command-line readers only, with silent failure after two seconds.</li>
            <li><b>Selection and copying:</b> primarily controlled by the terminal emulator, especially in the main screen buffer.</li>
          </ul>
          <p>
            See <a href="/docs/terminal-setup">Terminal setup</a> for tmux, SSH and raw-mode recovery, and
            <a href="/docs/vim-mode"> Vim mode</a> for modal-editor interaction.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
