import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "pipeline", label: "Rendering pipeline" },
  { id: "buffers", label: "Main vs alternate screen" },
  { id: "resize", label: "Resize & recovery" },
  { id: "color", label: "Color fallbacks" },
  { id: "unicode", label: "Unicode & width" },
  { id: "content", label: "Markdown & truncation" },
  { id: "terminal", label: "Terminal capability fallbacks" },
  { id: "accessibility", label: "Accessibility & limits" },
];

const BUFFER_MODES = [
  ["Main screen (default)", "Conversation remains in ordinary terminal scrollback. Native selection, search and scroll history are generally available."],
  ["Alternate screen", "The TUI owns a fixed-height viewport and enables terminal mouse reporting. Wheel navigation is handled through key input; the current application shim disables click and drag handling. Native scrollback is unavailable while active."],
  ["Pipe mode", "No interactive frames. Final answer goes to stdout; tool names go to stderr, or --json emits a compact result object."],
];

const MARKDOWN = [
  ["Headings", "Lines beginning with one to six # characters and a space."],
  ["Lists", "Dash, asterisk or plus bullets, and numbered items."],
  ["Blocks", "Fenced code, block quotes beginning with >, horizontal rules and blank lines."],
  ["Inline", "Double-asterisk bold, double-underscore italic, combined bold/italic and backtick code."],
];

export default function TerminalRendering() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Terminal rendering</span>
        </nav>

        <div className="hero">
          <h1>Terminal rendering</h1>
          <p className="tagline">
            Learn how the TUI lays out, redraws and degrades across terminal buffers, color levels, Unicode widths, tmux and SSH.
          </p>
        </div>

        <section id="pipeline">
          <h2><span className="anchor">#</span>From React layout to terminal cells</h2>
          <p>
            DeepSeek Code renders the interface as a terminal cell grid. Layout responds to the current columns and rows,
            text becomes styled narrow, wide or spacer cells, and each new frame is compared with the previous frame. The
            renderer writes only the changed regions as a buffered ANSI update instead of clearing and repainting every
            character for each token.
          </p>
          <p>
            Streamed assistant output is buffered briefly before it reaches the transcript, so the display updates in small
            batches rather than once per provider token. Status clocks, spinners, tool progress and input edits can produce
            independent frames. A resize invalidates layout and forces a more complete redraw to prevent stale cells.
          </p>
          <Note>
            Terminal rendering is capability-driven, not pixel-perfect. Font metrics, emulator width tables, multiplexers
            and remote PTYs can change the visible result even when the same character grid is produced.
          </Note>
        </section>

        <section id="buffers">
          <h2><span className="anchor">#</span>Main screen, alternate screen and pipe mode</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "32%" }}>Mode</th><th>Rendering behavior</th></tr></thead>
              <tbody>
                {BUFFER_MODES.map(([mode, behavior]) => <tr key={mode}><td><b>{mode}</b></td><td>{behavior}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Main-screen mode is the safer default for terminal readers, copy/search workflows and long-lived scrollback.
            Alternate-screen mode enters the terminal&apos;s DEC 1049 buffer, clears and homes that buffer, constrains the app
            to the visible rows and restores the main buffer when the application exits cleanly.
          </p>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "alternateScreen": false\n  }\n}'}</CodeBlock>
          <p>
            Change Alternate screen in <code className="inline">/config</code> or settings, then restart DeepSeek Code.
            Unlike theme and density changes, this startup setting does not move an already-running session between buffers.
          </p>
          <CodeBlock lang="bash">{"printf '%s\\n' 'Summarize the repository' | deepseek --pipe\nprintf '%s\\n' 'List checks' | deepseek --pipe --json"}</CodeBlock>
        </section>

        <section id="resize">
          <h2><span className="anchor">#</span>Resize, suspend and crash recovery</h2>
          <p>
            Width changes reflow the transcript, prompt and panels. Narrow headers switch to compact forms, status items
            drop lower-priority fields when space is exhausted, command descriptions truncate and the prompt keeps a
            minimum editing width. The input viewport shows at most ten visual lines around the caret and adds textual
            counters for hidden lines.
          </p>
          <p>
            In alternate-screen mode, resize and resume events reset stale frame state, repaint the viewport and reassert
            the required buffer or mouse modes. Normal exits disable mouse tracking, extended keyboard reporting, focus
            events and bracketed paste, restore the cursor and leave raw mode. An uncatchable kill, terminal crash or broken
            SSH connection can prevent that cleanup.
          </p>
          <CodeBlock lang="bash">{"# If the shell no longer echoes or line editing is broken\nstty sane\nreset"}</CodeBlock>
          <p>
            If <code className="inline">reset</code> clears useful scrollback, try <code className="inline">stty sane</code>
            first. Resume a deliberately suspended process with <code className="inline">fg</code>; the renderer rebuilds its
            frame after SIGCONT.
          </p>
        </section>

        <section id="color">
          <h2><span className="anchor">#</span>Color detection and fallbacks</h2>
          <p>
            Startup derives a color level from <code className="inline">COLORTERM</code>, <code className="inline">TERM</code>
            and TTY availability: truecolor, 256-color or basic ANSI. VS Code/xterm.js can be promoted to truecolor when its
            environment underreports support. Inside tmux, truecolor is conservatively clamped to 256 colors unless
            <code className="inline">CLAUDE_CODE_TMUX_TRUECOLOR</code> is set.
          </p>
          <CodeBlock lang="bash">{"# Use only after tmux and the outer terminal are configured for RGB\nCLAUDE_CODE_TMUX_TRUECOLOR=1 deepseek"}</CodeBlock>
          <p>
            Choose one of six application themes: dark, light, dark-daltonized, light-daltonized, dark-ansi or light-ansi.
            ANSI themes are the most predictable fallback for limited emulators because named colors come from the terminal
            profile rather than exact RGB values. Daltonized themes reduce reliance on red/green distinctions.
          </p>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "theme": "dark-ansi"\n  }\n}'}</CodeBlock>
          <Note>
            Environment detection can be wrong across SSH, nested tmux and unusual terminal profiles. If backgrounds vanish
            or colors wash out, use an ANSI theme first; enable the tmux truecolor escape hatch only after RGB passthrough is verified.
          </Note>
        </section>

        <section id="unicode">
          <h2><span className="anchor">#</span>Unicode, wide cells and bidirectional text</h2>
          <p>
            The renderer groups grapheme clusters and tracks terminal display width, including two-cell CJK and emoji glyphs
            plus zero-width combining marks. The standard input editor also moves and deletes by grapheme, and pasted input
            is normalized to NFC. This prevents most cursor and border drift caused by treating every code unit as one cell.
          </p>
          <p>
            Windows consoles, Windows Terminal/WSL and VS Code&apos;s xterm.js path receive software bidirectional reordering
            when Hebrew, Arabic or related RTL characters are present. Other terminals keep their native bidi behavior.
            Mixed-direction editing remains dependent on terminal cursor semantics and should be verified with your emulator.
          </p>
          <p>
            The prompt&apos;s word-aware wrapping currently estimates break positions from string length before the cell renderer
            lays text out. Very wide glyphs, emoji sequences and ambiguous-width fonts can therefore wrap at a surprising
            place even when final cell rendering is correct. Resizing or switching to a compatible monospace font usually
            makes the mismatch easier to diagnose, but does not change the underlying text.
          </p>
        </section>

        <section id="content">
          <h2><span className="anchor">#</span>Markdown, tools and deliberate truncation</h2>
          <p>
            Assistant and expanded reasoning text use a compact terminal Markdown renderer, not a complete CommonMark or
            browser engine. The supported surface is intentionally bounded:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Construct</th><th>Recognized form</th></tr></thead>
              <tbody>
                {MARKDOWN.map(([name, form]) => <tr key={name}><td><b>{name}</b></td><td>{form}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Tables, images, task-list widgets and general browser HTML are not rendered as rich UI. Standard single-asterisk
            emphasis is not the supported italic form. Fenced code displays its language label and indented lines but does
            not provide a browser-style copy button or full syntax-highlighting contract.
          </p>
          <p>
            Completed tool rows are compact by default: long arguments are shortened after 60 characters and output shows
            the first five non-empty lines plus a remaining-line count. Press <code className="inline">Ctrl+O</code> to
            toggle full mode, which expands tool arguments, tool output and reasoning panels. This is a display toggle and
            does not rerun tools or change stored content.
          </p>
        </section>

        <section id="terminal">
          <h2><span className="anchor">#</span>Capability fallbacks across terminals</h2>
          <ul className="capabilities">
            <li><b>Synchronized frames:</b> known DEC 2026 terminals receive atomic-looking updates; tmux skips high-frequency synchronization markers.</li>
            <li><b>Extended keys:</b> enabled only for an allowlist of terminals; unsupported combinations fall back to ordinary key sequences.</li>
            <li><b>Hyperlinks:</b> OSC 8 is used only when detected; otherwise link components render their visible label or explicit fallback.</li>
            <li><b>Size:</b> missing dimensions fall back to an 80-column by 24-row layout until real values arrive.</li>
            <li><b>Mouse:</b> alternate screen reports wheel, click and drag; main screen favors native terminal selection.</li>
            <li><b>Paste:</b> bracketed paste is preferred; a missing end marker times out and flushes buffered paste content.</li>
          </ul>
          <p>
            SSH often removes <code className="inline">TERM_PROGRAM</code> while preserving only
            <code className="inline">TERM</code>. DeepSeek Code can probe some terminal identity through the PTY, but every
            capability is not remotely discoverable. Keep <code className="inline">TERM</code> accurate and test modified
            keys, colors, clipboard and mouse separately through each multiplexer layer.
          </p>
        </section>

        <section id="accessibility">
          <h2><span className="anchor">#</span>Accessibility and current limits</h2>
          <p>
            The TUI is keyboard-first and important states generally combine symbols, words and color. It does not expose a
            browser-style semantic accessibility tree: assistive software receives ANSI text, cursor movement and incremental
            cell changes. Main-screen mode and pipe mode are the most linear output paths.
          </p>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "alternateScreen": false,\n    "reducedMotion": true,\n    "theme": "light-ansi"\n  }\n}'}</CodeBlock>
          <p>
            Reduced motion replaces the animated working/refining spinner with static text; it does not disable token
            streaming, elapsed timers or every redraw. Alternate screen removes native scrollback and can make selection
            terminal-dependent. The prompt renders a visible block caret, but the current application does not provide a
            complete announced edit-mode or selection model for screen readers.
          </p>
          <p>
            See <a href="/docs/accessibility">Accessibility</a>, <a href="/docs/themes">Themes</a> and
            <a href="/docs/terminal-setup"> Terminal setup</a> for focused setup and troubleshooting guidance.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
