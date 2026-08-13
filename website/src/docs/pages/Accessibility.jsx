import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "baseline", label: "Accessibility baseline" },
  { id: "cursor", label: "Native cursor mode" },
  { id: "motion", label: "Reduced motion" },
  { id: "themes", label: "Color & contrast" },
  { id: "keyboard", label: "Keyboard-only use" },
  { id: "unicode", label: "Unicode & RTL text" },
  { id: "linear", label: "Linear output" },
  { id: "limitations", label: "Current limitations" },
];

const THEME_CHOICES = [
  ["dark / light", "Full-color themes for dark or bright terminal backgrounds."],
  ["dark-daltonized / light-daltonized", "Use blue/orange semantic contrast where green/red distinctions would be harder to read."],
  ["dark-ansi / light-ansi", "Restrict output to named ANSI colors for limited terminals and predictable palettes."],
];

const KEYBOARD_PATHS = [
  ["Prompt and history", "Arrow keys, Emacs-style movement, optional Vim mode, Enter and Shift+Enter."],
  ["Interaction mode", "Shift+Tab cycles Plan, Review, Build and Auto."],
  ["Activity panel", "Down from an empty prompt opens it; arrows select; Enter opens; Esc returns."],
  ["Configuration", "/config is navigable with arrows, Tab/Shift+Tab, Enter, Space and Escape."],
  ["Dialogs", "Arrow keys plus Enter, or the visible single-key choices; Escape cancels where offered."],
  ["Transcript", "PageUp and PageDown are left to the focused scroll container."],
];

export default function Accessibility() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Accessibility</span>
        </nav>

        <div className="hero">
          <h1>Accessibility</h1>
          <p className="tagline">
            Configure cursor visibility, motion, color and screen-buffer behavior, with clear limits for assistive technology.
          </p>
        </div>

        <section id="baseline">
          <h2><span className="anchor">#</span>Accessibility baseline</h2>
          <p>
            DeepSeek Code is keyboard-first: the prompt, configuration screens, permission dialogs, activity list and
            workflow monitors all expose keyboard controls. Statuses combine text or symbols with color, and the renderer
            measures Unicode terminal cells instead of assuming that every character occupies one column.
          </p>
          <p>
            Terminal applications do not expose the browser accessibility tree used by a web UI. The experience therefore
            depends on the terminal emulator, shell, multiplexer and assistive technology working together. Start with the
            normal main-screen buffer, reduced motion and a high-contrast theme; opt into alternate-screen mode only after
            confirming that it works well with your setup.
          </p>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "alternateScreen": false,\n    "reducedMotion": true,\n    "theme": "dark-ansi"\n  }\n}'}</CodeBlock>
        </section>

        <section id="cursor">
          <h2><span className="anchor">#</span>Keep the native cursor visible</h2>
          <p>
            The vendored terminal renderer accepts a compatibility accessibility flag. When enabled, it does not hide the
            native terminal cursor during mount, resume or explicit cursor restoration. This can help screen magnifiers and
            tools that follow the physical cursor.
          </p>
          <CodeBlock lang="bash">{"CLAUDE_CODE_ACCESSIBILITY=1 deepseek"}</CodeBlock>
          <p>
            Only the exact values <code className="inline">1</code> and <code className="inline">true</code> enable it.
            The name is retained for compatibility with the upstream renderer layer even though the application is
            DeepSeek Code.
          </p>
          <Note>
            This flag changes cursor visibility; it is not a complete screen-reader mode. It does not linearize the React
            TUI, disable the alternate buffer, remove color, stop animation or narrate incremental frame updates. Combine it
            with the settings in the following sections.
          </Note>
        </section>

        <section id="motion">
          <h2><span className="anchor">#</span>Reduce motion</h2>
          <p>
            Set <code className="inline">interface.reducedMotion</code> through <code className="inline">/config</code>{" "}
            or an effective settings file. In the current TUI, the visible runtime effect is intentionally concrete: the
            animated working/refining spinner is replaced by static <code className="inline">Working…</code> or
            <code className="inline">Refining…</code> text.
          </p>
          <CodeBlock lang="json">{'{\n  "interface": {\n    "reducedMotion": true\n  }\n}'}</CodeBlock>
          <p>
            The setting takes effect immediately when changed through the configuration screen. It does not change token
            streaming, elapsed-duration updates or the semantic content of status rows.
          </p>
        </section>

        <section id="themes">
          <h2><span className="anchor">#</span>Color and contrast</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "34%" }}>Theme family</th><th>When to use it</th></tr></thead>
              <tbody>
                {THEME_CHOICES.map(([theme, use]) => <tr key={theme}><td><code className="inline">{theme}</code></td><td>{use}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Choose a theme from the Interface category in <code className="inline">/config</code>. Daltonized
            themes remap success/error and diff colors; ANSI themes avoid
            RGB assumptions entirely. Terminal profile colors still influence named ANSI output, so verify the combination
            in the emulator you actually use.
          </p>
          <p>
            Important states also have visible labels or icons: Build/Plan/Review/Auto are named, permissions include
            numbered choices, activity rows carry status text in details, and errors use both an icon and an explanation.
            See <a href="/docs/themes">Themes</a> for the complete token mapping.
          </p>
        </section>

        <section id="keyboard">
          <h2><span className="anchor">#</span>Keyboard-only operation</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Area</th><th>Keyboard path</th></tr></thead>
              <tbody>
                {KEYBOARD_PATHS.map(([area, path]) => <tr key={area}><td><b>{area}</b></td><td>{path}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            Mouse input is not required for normal operation. Use <code className="inline">/help</code> and the
            <a href="/docs/keybindings"> keyboard reference</a> for screen-specific controls. When a panel captures input,
            Escape generally returns one level before closing it.
          </p>
          <Note>
            On Unix-like systems Ctrl+Z suspends the whole process before the prompt editor handles it. Resume with
            <code className="inline">fg</code>. This means Ctrl+Z should not be relied on as the editor undo shortcut there.
          </Note>
        </section>

        <section id="unicode">
          <h2><span className="anchor">#</span>Unicode, wide text and right-to-left scripts</h2>
          <p>
            Input movement uses grapheme segmentation, so composed accents, emoji sequences and joined characters are not
            split by ordinary Left, Right, Backspace or Delete. Rendering tracks narrow, wide and spacer cells so CJK text
            and emoji remain aligned with borders and the cursor after a resize.
          </p>
          <p>
            Windows Terminal, native Windows consoles, WSL under Windows Terminal and VS Code&apos;s integrated terminal receive
            software bidirectional reordering for Hebrew, Arabic and related scripts when RTL characters are present.
            Terminals with native bidi support keep their native ordering path.
          </p>
          <p>
            Terminal font choice still matters. If symbols display as empty boxes or double-width characters drift, choose
            a font with the needed glyphs, verify the emulator&apos;s ambiguous-width setting and retry with an ANSI theme.
          </p>
        </section>

        <section id="linear">
          <h2><span className="anchor">#</span>Prefer linear output when needed</h2>
          <p>
            The main-screen buffer is easier for many terminal readers because the conversation remains in ordinary
            scrollback. Keep <code className="inline">interface.alternateScreen</code> false unless you specifically need a
            fixed viewport. For fully linear, non-interactive consumption, use pipe mode:
          </p>
          <CodeBlock lang="bash">{"printf '%s\\n' 'Summarize the project architecture' | deepseek --pipe\nprintf '%s\\n' 'List the failing checks' | deepseek --pipe --json"}</CodeBlock>
          <p>
            Pipe mode avoids animated frames and interactive dialogs, but it also cannot ask you for setup or approval.
            Configure the provider and an appropriate permission policy before relying on it in scripts.
          </p>
        </section>

        <section id="limitations">
          <h2><span className="anchor">#</span>Current limitations and reporting issues</h2>
          <ul className="capabilities">
            <li><b>No semantic accessibility tree:</b> terminal output is ANSI text and cursor movement, not browser-style roles and labels.</li>
            <li><b>Incremental redraws:</b> assistive tools may announce changed cells differently across terminal emulators.</li>
            <li><b>Cursor flag scope:</b> the compatibility environment variable only keeps the terminal cursor visible.</li>
            <li><b>Alternate screen:</b> native scrollback is unavailable while the full-viewport buffer is active.</li>
            <li><b>Terminal-dependent keys:</b> some emulators cannot distinguish every modified-key combination.</li>
            <li><b>Motion setting scope:</b> reduced motion currently replaces the loading animation, not every time-based refresh.</li>
          </ul>
          <p>
            When reporting an accessibility bug, include the operating system, terminal and version, whether tmux/SSH is
            involved, the effective interface settings, the exact keystroke or announcement, and whether main-screen or
            alternate-screen mode was active. That separates application behavior from terminal capability differences.
          </p>
          <p>
            If the terminal is left in raw mode after a crash, follow the recovery commands in
            <a href="/docs/terminal-setup"> Terminal setup</a> before restarting the session.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
