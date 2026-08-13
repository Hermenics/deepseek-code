import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "themes", label: "The six themes" },
  { id: "tokens", label: "Design tokens" },
  { id: "daltonized", label: "Daltonized themes" },
  { id: "ansi", label: "ANSI themes" },
  { id: "glyphs", label: "Status icons & progress chars" },
  { id: "applying", label: "Applying a theme" },
];

const THEME_LIST = [
  ["dark", "Default. Cyan/blue brand on black — the classic DeepSeek look"],
  ["light", "Blue brand on white, tuned for bright terminals"],
  ["dark-daltonized", "Dark with red/green success–error pairs replaced by blue/orange"],
  ["light-daltonized", "Light variant of the colorblind-friendly palette"],
  ["dark-ansi", "Dark using only the 16-color ANSI palette — no truecolor"],
  ["light-ansi", "ANSI palette on black text (inherits dark-ansi, swaps text color)"],
];

const TOKEN_GROUPS = [
  [
    "Brand",
    [
      ["primary / primaryShimmer", "Accent color and its shimmer variant (cyan/blue)"],
    ],
  ],
  [
    "Semantic",
    [
      ["success / error / warning / info", "Status colors — green/red/yellow/cyan (blue in daltonized)"],
      ["suggestion / suggestionShimmer", "Assistant-message accent and its shimmer counterpart"],
    ],
  ],
  [
    "Text",
    [
      ["text / textDim / textSubtle / textInactive", "Four-step text hierarchy from full to faded"],
    ],
  ],
  [
    "Backgrounds",
    [
      ["userMessageBg / bashMessageBg", "Message surfaces (empty in most themes)"],
      ["thinkingBg", "Thinking panel background — #111118 in dark, #f0f0f8 in light"],
      ["selectionBg", "Selected region fill"],
    ],
  ],
  [
    "Borders",
    [
      ["promptBorder / promptBorderShimmer", "Input chrome border and its shimmer"],
      ["bashBorder", "Shell prompt border — magenta in every theme"],
    ],
  ],
  [
    "Diff",
    [
      ["diffAdded / diffRemoved", "Line-level diff backgrounds"],
      ["diffAddedWord / diffRemovedWord", "Word-level highlight for the LCS-based word diff"],
    ],
  ],
  [
    "Modes",
    [
      ["modeChat / modePlan / modeAgent / modeAutoAccept", "blue / yellow / green / red — mode colors"],
    ],
  ],
  [
    "Markdown",
    [
      ["codeBlock / h1 / h2 / h3 / bullet / rule", "Markdown rendering palette (e.g. #c3e88d code, #82aaff h1 in dark)"],
    ],
  ],
  [
    "Agents",
    [
      ["agentRed … agentCyan", "Eight per-agent colors — red, blue, green, yellow, magenta, orange, pink, cyan"],
    ],
  ],
];

const DALTONIZED = [
  ["success", "rgb(0,176,240)", "rgb(0,120,200)"],
  ["error", "rgb(255,150,0)", "rgb(200,100,0)"],
  ["warning", "rgb(255,255,0)", "rgb(180,180,0)"],
  ["diffAdded", "rgb(0,60,120)", "rgb(200,230,255)"],
  ["diffRemoved", "rgb(120,60,0)", "rgb(255,230,200)"],
  ["diffAddedWord", "rgb(0,150,255)", "rgb(0,100,200)"],
  ["diffRemovedWord", "rgb(255,150,0)", "rgb(200,100,0)"],
];

export default function Themes() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Themes</span>
        </nav>

        <div className="hero">
          <h1>Themes</h1>
          <p className="tagline">
            Six color themes backed by a ~40-token design system, including colorblind-friendly
            and pure-ANSI variants.
          </p>
        </div>

        <section id="themes">
          <h2><span className="anchor">#</span>The six themes</h2>
          <p>
            The primary transcript, status, Markdown and diff palettes come from one
            <code className="inline">ThemeColors</code> object per theme, defined in
            <code className="inline">src/ui/theme.ts</code>:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Theme</th><th>Description</th></tr>
              </thead>
              <tbody>
                {THEME_LIST.map(([t, d]) => (
                  <tr key={t}>
                    <td><code className="inline">{t}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">isDarkTheme(theme)</code> derives darkness from the name
            prefix — anything starting with <code className="inline">dark</code> is treated as a
            dark theme.
          </p>
        </section>

        <section id="tokens">
          <h2><span className="anchor">#</span>Design tokens</h2>
          <p>Roughly 40 tokens in nine groups cover the main themed surfaces:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Group</th><th>Tokens</th></tr>
              </thead>
              <tbody>
                {TOKEN_GROUPS.map(([g, tokens]) => (
                  <tr key={g}>
                    <td><b style={{ color: "var(--text-strong)" }}>{g}</b></td>
                    <td>
                      {tokens.map(([name, desc]) => (
                        <div key={name}>
                          <code className="inline">{name}</code> — {desc}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            Theme coverage is not universal. Some input chrome, dropdown selection, ghost text and
            transient tool UI still use direct ANSI/hex colors or a component&apos;s dark-theme default.
            For example, ghost text is currently a fixed dim gray rather than the suggestion token.
          </Note>
        </section>

        <section id="daltonized">
          <h2><span className="anchor">#</span>Daltonized themes</h2>
          <p>
            <code className="inline">dark-daltonized</code> and{" "}
            <code className="inline">light-daltonized</code> start from their base theme and swap
            the red/green success–error pair for blue/orange hues that remain distinguishable for
            common red-green color vision deficiencies:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Token</th><th>Dark</th><th>Light</th></tr>
              </thead>
              <tbody>
                {DALTONIZED.map(([t, d, l]) => (
                  <tr key={t}>
                    <td><code className="inline">{t}</code></td>
                    <td><code className="inline">{d}</code></td>
                    <td><code className="inline">{l}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Everything else — text, borders, markdown, agent colors — is inherited unchanged from
            the base theme.
          </p>
        </section>

        <section id="ansi">
          <h2><span className="anchor">#</span>ANSI themes</h2>
          <p>
            <code className="inline">dark-ansi</code> and <code className="inline">light-ansi</code>{" "}
            are for terminals with no truecolor support: active color tokens resolve to basic ANSI names
            (<code className="inline">blue</code>, <code className="inline">green</code>,{" "}
            <code className="inline">red</code>, <code className="inline">gray</code>,{" "}
            <code className="inline">white</code>...), with shimmer, gradients, and subtle
            background surfaces stripped out. The diff tokens collapse to plain green/red, and
            markdown maps to green/blue/cyan/magenta.
          </p>
          <Note>
            <code className="inline">light-ansi</code> spreads <code className="inline">dark-ansi</code>{" "}
            and only changes the text color to black — the rest of the palette is shared.
          </Note>
        </section>

        <section id="glyphs">
          <h2><span className="anchor">#</span>Status icons & progress chars</h2>
          <p>
            Beyond colors, the theme module exports the shared glyph sets used across the UI:
          </p>
          <ul className="capabilities">
            <li>
              <b><code className="inline">STATUS_ICONS</code></b> — ✓ ✗ ⚠ ℹ ○ … ◌ ● ❯ $ ◈ ⎿ for
              success, error, warning, info, pending, loading, thinking, assistant, user,
              terminal, agent, and subagent.
            </li>
            <li>
              <b><code className="inline">PROGRESS_CHARS</code></b> — the 8-step partial fill
              █ ▉ ▊ ▋ ▌ ▍ ▎ ▏ used by the context bar to render a smooth 10-cell progress meter.
            </li>
            <li>
              <b><code className="inline">DIVIDER_CHAR</code></b> — <code className="inline">─</code>,
              repeated for status-bar dividers and the full-width work divider.
            </li>
          </ul>
        </section>

        <section id="applying">
          <h2><span className="anchor">#</span>Applying a theme</h2>
          <p>
            Theme-aware components resolve colors through{" "}
            <code className="inline">getThemeColors(theme)</code>, which falls back to{" "}
            <code className="inline">dark</code> for unknown names. The active theme persists to
            settings — set it with the <code className="inline">interface.theme</code> setting
            (enum of the six themes) in the settings menu:
          </p>
          <CodeBlock lang="text">{`interface: {
  "theme": "dark-daltonized"
}`}</CodeBlock>
          <p>
            The first-run setup wizard shows a <b>live diff preview</b> while you pick a theme —
            a sample <code className="inline">- console.log</code> /{" "}
            <code className="inline">+ console.log</code> pair rendered with the selected theme's
            diff tokens — and the change is saved the moment you confirm.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
