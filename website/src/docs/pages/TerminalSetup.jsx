import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "requirements", label: "Terminal requirements" },
  { id: "screen", label: "Screen buffer modes" },
  { id: "color", label: "Color & themes" },
  { id: "keyboard", label: "Keyboard protocols" },
  { id: "paste", label: "Clipboard & paste" },
  { id: "remote", label: "tmux, SSH & resize" },
  { id: "lifecycle", label: "Suspend, resume & exit" },
  { id: "troubleshooting", label: "Terminal recovery" },
];

const MODES = [
  ["Main screen (default)", "Keeps the conversation in normal terminal scrollback. Native selection, search and scrollback keep working as provided by your terminal."],
  ["Alternate screen", "Uses a full-viewport buffer and restores the previous terminal contents on exit. DeepSeek Code owns scrolling while this mode is active."],
  ["Pipe mode", "Skips the interactive TUI. Input comes from stdin and the final result is written to stdout for scripts and CI."],
];

const CAPABILITIES = [
  ["Color", "Derived from COLORTERM, TERM and TTY availability. Truecolor, 256-color and basic ANSI output are selected automatically."],
  ["Bracketed paste", "Enabled while raw input is active so a paste can be distinguished from rapidly typed keys."],
  ["Focus reporting", "Tracks terminal focus when the emulator supports DEC focus events; unknown support is treated as focused."],
  ["Synchronized updates", "Frames use DEC synchronized-update markers where supported; high-frequency alternate-screen rendering skips them on known unsupported paths such as tmux."],
  ["Unicode width", "Measures grapheme clusters, emoji, combining marks and wide characters in terminal cells."],
  ["Hyperlinks", "Emits OSC 8 links only when the terminal is detected as supporting them."],
];

export default function TerminalSetup() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Terminal setup</span>
        </nav>

        <div className="hero">
          <h1>Terminal setup</h1>
          <p className="tagline">
            Configure the screen buffer, colors, keyboard input and clipboard behavior for a stable DeepSeek Code session.
          </p>
        </div>

        <section id="requirements">
          <h2><span className="anchor">#</span>Terminal requirements</h2>
          <p>
            Interactive mode needs a TTY that supports raw keyboard input and ANSI cursor control. Modern Linux,
            macOS and Windows terminal emulators provide the required baseline. A viewport of at least 80 columns
            is comfortable, but the interface adapts below that width by shortening labels and reducing footer detail.
          </p>
          <p>
            Do not feed a pipeline into the interactive entry point. For redirected stdin, automation, log capture or
            a terminal that cannot enter raw mode, use explicit pipe mode instead:
          </p>
          <CodeBlock lang="bash">{"printf '%s\\n' 'Explain the failing test' | deepseek --pipe\nprintf '%s\\n' 'Summarize this diff' | deepseek --pipe --json"}</CodeBlock>
          <Note>
            Pipe mode is a separate execution path, not an interactive session with hidden rendering. It does not open
            setup screens, the status bar or permission dialogs, so configure credentials before using it unattended.
          </Note>
        </section>

        <section id="screen">
          <h2><span className="anchor">#</span>Choose a screen buffer mode</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "26%" }}>Mode</th><th>Behavior</th></tr></thead>
              <tbody>
                {MODES.map(([mode, behavior]) => <tr key={mode}><td><b>{mode}</b></td><td>{behavior}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            The main screen is the default because it preserves native scrollback. Alternate-screen mode is useful when
            you want a fixed application-like viewport, especially for long-running sessions and full-screen monitors.
            Change it in <code className="inline">/config</code> or in an effective settings file:
          </p>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "alternateScreen": true\n  }\n}'}</CodeBlock>
          <p>
            The setting is read during startup and therefore takes effect in the next process. Entering the alternate
            buffer clears that buffer, constrains the UI to the terminal row count and enables terminal mouse reporting.
            Leaving it disables reporting and restores the main buffer that was visible before launch.
          </p>
          <Note>
            Alternate-screen mode has no native scrollback. Use the TUI&apos;s own scroll controls, or keep the default main
            screen when terminal-native selection and historical output matter more than a fixed viewport.
          </Note>
        </section>

        <section id="color">
          <h2><span className="anchor">#</span>Color and themes</h2>
          <p>
            DeepSeek Code selects a color level from the terminal environment. <code className="inline">COLORTERM=truecolor</code>{" "}
            or <code className="inline">COLORTERM=24bit</code> enables 24-bit color; a 256-color TERM selects the
            256-color path; other recognized TTYs use basic ANSI colors. Pick a regular, daltonized or ANSI-only theme
            from the Interface category in <code className="inline">/config</code>.
          </p>
          <CodeBlock lang="bash">{"export TERM=xterm-256color\nexport COLORTERM=truecolor\ndeepseek"}</CodeBlock>
          <p>
            tmux is deliberately conservative: unless passthrough is declared, truecolor output is reduced to the
            256-color palette so background colors do not disappear between tmux and the outer terminal. If your tmux
            configuration already advertises RGB/Tc correctly, the compatibility escape hatch is:
          </p>
          <CodeBlock lang="bash">{"export CLAUDE_CODE_TMUX_TRUECOLOR=1\ndeepseek"}</CodeBlock>
          <Note>
            The compatibility variable retains its upstream renderer name. Set it only when tmux truecolor is already
            configured; otherwise the default 256-color clamp is the more reliable choice.
          </Note>
        </section>

        <section id="keyboard">
          <h2><span className="anchor">#</span>Keyboard protocols and focus</h2>
          <p>
            The renderer enables raw input, bracketed paste and focus reporting for the life of the interactive session.
            On a conservative allowlist of terminals it also requests extended key reporting, which helps distinguish
            combinations such as Ctrl+Shift+letter. Unsupported terminals may ignore these sequences; DeepSeek Code
            continues with ordinary ANSI key parsing.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "26%" }}>Capability</th><th>What DeepSeek Code does</th></tr></thead>
              <tbody>
                {CAPABILITIES.map(([name, behavior]) => <tr key={name}><td><b>{name}</b></td><td>{behavior}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Escape sequences are parsed as a stream, so a key sequence split across reads is held briefly instead of
            leaking suffix characters into the prompt. An incomplete ordinary sequence waits 50 ms; a bracketed-paste
            sequence waits up to 500 ms. See <a href="/docs/input-editor">Input editor</a> for the application shortcuts.
          </p>
        </section>

        <section id="paste">
          <h2><span className="anchor">#</span>Clipboard and paste on Linux</h2>
          <p>
            Normal terminal paste and middle-click arrive through bracketed-paste events when the emulator supports it.
            DeepSeek Code also handles Ctrl+V by trying common Linux clipboard readers in this order: xclip, xsel, then
            wl-paste. The lookup has a two-second timeout and fails silently when none is available.
          </p>
          <CodeBlock lang="bash">{"# X11: install either one\nsudo apt install xclip\n# or\nsudo apt install xsel\n\n# Wayland\nsudo apt install wl-clipboard"}</CodeBlock>
          <p>
            Package names vary by distribution. You do not need these helpers if your terminal&apos;s own paste shortcut
            already produces a bracketed-paste event. Long pastes are represented compactly in the input and expanded
            only when submitted; this is an editor feature, not clipboard truncation.
          </p>
        </section>

        <section id="remote">
          <h2><span className="anchor">#</span>tmux, SSH and resize</h2>
          <p>
            The UI recalculates layout after a terminal resize and redraws against the new column and row counts. After
            more than five seconds without input, the next event reasserts extended-key reporting and, while the alternate
            screen is active, mouse tracking. It does not re-enable bracketed paste or focus reporting through this idle-gap
            path. Resize and resume handling perform their own broader redraw and terminal-state recovery.
          </p>
          <p>
            Terminal identity normally comes from environment variables such as <code className="inline">TERM_PROGRAM</code>,
            but an identity query can also travel through the pseudo-terminal when SSH does not forward those variables.
            Missing capability information is treated as a reason to use the conservative fallback, not as a fatal error.
          </p>
          <Note>
            Under tmux, enable focus events in tmux itself if you depend on focus-aware behavior. DeepSeek Code cannot
            receive events that the multiplexer chooses not to forward.
          </Note>
        </section>

        <section id="lifecycle">
          <h2><span className="anchor">#</span>Suspend, resume and clean exit</h2>
          <p>
            On Unix-like systems Ctrl+Z yields the terminal to the shell. Raw mode, focus reporting and mouse tracking
            are disabled before suspension; run <code className="inline">fg</code> to resume, and the session restores its
            input modes. This global terminal shortcut takes precedence over input-editor undo on those platforms.
          </p>
          <CodeBlock lang="bash">{"# after Ctrl+Z\nfg"}</CodeBlock>
          <p>
            A normal exit restores the cursor and terminal modes. Ctrl+C while idle is intentionally a double press
            within 800 ms; while the agent is working, one Ctrl+C requests cancellation instead. The exit message prints
            the exact <code className="inline">deepseek --resume &lt;session-id&gt;</code> command for returning later.
          </p>
          <p>
            The exit screen clears the active display, leaves the alternate buffer when that mode is enabled, disables
            mouse tracking and prints the blue DeepSeek Code banner before the resume command. The session id in that
            command is the current conversation&apos;s id, so it is the reliable handoff after closing the TUI.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Recover a damaged terminal</h2>
          <p>
            A hard kill, terminal crash or lost remote connection can prevent normal cleanup. Symptoms include invisible
            input, keys appearing as escape fragments, mouse events printing as text or a shell left in raw mode. Start
            with the least destructive recovery command:
          </p>
          <CodeBlock lang="bash">{"stty sane\nprintf '\\033[?25h\\033[?1000l\\033[?1002l\\033[?1003l\\033[?1006l'\n# if the display is still corrupted\nreset"}</CodeBlock>
          <p>
            If rendering is merely cramped or flickering, resize the terminal once, disable alternate-screen mode and
            retry with an ANSI theme. If stdin is not a TTY, switch to <code className="inline">--pipe</code> instead of
            trying to force raw mode.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
