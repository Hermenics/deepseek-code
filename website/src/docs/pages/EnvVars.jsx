import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "precedence", label: "Precedence" },
  { id: "provider", label: "Provider & credentials" },
  { id: "aws", label: "Amazon Bedrock" },
  { id: "gcp", label: "Google Vertex AI" },
  { id: "local", label: "Local models" },
  { id: "paths", label: "Paths" },
  { id: "features", label: "Feature toggles" },
  { id: "terminal", label: "Terminal & rendering" },
  { id: "editor", label: "Editor" },
  { id: "debug", label: "Development & debug" },
  { id: "ci", label: "In CI" },
];

const PROVIDER = [
  ["DEEPSEEK_API_KEY", "—", "API key for the DeepSeek provider. Used when no saved credentials exist."],
  ["DEEPSEEK_BASE_URL", "https://api.deepseek.com", "Override the API base URL. Gateways, proxies and compatible endpoints."],
];

const AWS = [
  ["AWS_ACCESS_KEY_ID", "When paired with AWS_SECRET_ACCESS_KEY, selects environment credentials for Bedrock."],
  ["AWS_SECRET_ACCESS_KEY", "Secret half of the required environment credential pair."],
  ["AWS_SESSION_TOKEN", "Optional session token consumed by the AWS environment credential provider."],
];

const PATHS = [
  ["HOME", "System", "Used directly by session, checkpoint and input-history paths; other stores use the OS home lookup."],
  ["DEEPSEEK_PLUGINS_DIR", "~/.deepseek-code/plugins", "Where plugins are installed."],
  ["BUN_INSTALL", "System", "Used when detecting a Bun global installation for update checks."],
];

const FEATURES = [
  ["DEEPSEEK_DISABLE_WORKFLOWS", "1", "Disables dynamic workflows entirely. Equivalent to settings.workflows.enabled = false."],
  ["CLAUDE_CODE_ACCESSIBILITY", "1 or true", "Keeps the native terminal cursor visible; it is not a full screen-reader mode."],
];

const TERMINAL = [
  ["TERM, COLORTERM", "Capability detection — color depth and terminal features."],
  ["TERM_PROGRAM, TERM_PROGRAM_VERSION", "Terminal identification for per-emulator behavior."],
  ["TMUX", "Detects tmux, which changes how color and escape sequences are handled."],
  ["WT_SESSION", "Detects Windows Terminal."],
  ["KITTY_WINDOW_ID, ZED_TERM, VTE_VERSION", "Emulator detection for specific capabilities."],
  ["MSYSTEM", "Detects MSYS/Git Bash on Windows."],
  ["ConEmuANSI, ConEmuPID, ConEmuTask", "Detect ConEmu progress-report support."],
  ["STY", "Detects GNU screen for escape-sequence passthrough."],
  ["SSH_CONNECTION, LC_TERMINAL", "Select safe clipboard behavior for remote, tmux and iTerm2 sessions."],
  ["CLAUDE_CODE_TMUX_TRUECOLOR", "Forces truecolor handling under tmux when detection gets it wrong."],
];

const DEBUG = [
  ["NODE_ENV", "development enables development behavior. Set by bun run dev and bun run start."],
  ["CLAUDE_CODE_DEBUG_REPAINTS", "Diagnostics for terminal repainting."],
  ["CLAUDE_CODE_COMMIT_LOG", "Filesystem path receiving renderer commit, layout and paint timing diagnostics."],
];

export default function EnvVars() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Environment variables</span>
        </nav>

        <div className="hero">
          <h1>Environment variables</h1>
          <p className="tagline">
            User-relevant variables read directly by DeepSeek Code, plus the credential variables delegated
            to provider SDKs and their exact relationship to saved settings.
          </p>
        </div>

        <section id="precedence">
          <h2><span className="anchor">#</span>Precedence</h2>
          <p>
            Environment variables and settings files answer different questions, and they do not simply
            override each other in one direction.
          </p>
          <p>
            <b>Credentials</b> come from saved configuration first, then from the environment. If you have
            configured a provider interactively, that configuration is used and{" "}
            <code className="inline">DEEPSEEK_API_KEY</code> is not consulted. In an environment with no saved
            config — CI, a container, a fresh machine — the variable is the whole story.
          </p>
          <p>
            <b>Endpoints</b> resolve the other way: an explicit setting wins, and the variable is the
            fallback. <code className="inline">provider.endpoint</code> in settings takes priority over{" "}
            <code className="inline">DEEPSEEK_BASE_URL</code>, which takes priority over the built-in default.
          </p>
          <p>
            <b>Feature kill-switches</b> are unconditional. Setting{" "}
            <code className="inline">DEEPSEEK_DISABLE_WORKFLOWS=1</code> disables workflows regardless of what
            any settings file says — a kill-switch that can be overridden by configuration is not a
            kill-switch.
          </p>
          <Note>
            Secrets belong in environment variables or the private credentials file, never in project
            settings. <code className="inline">~/.deepseek/config.json</code> does hold the saved DeepSeek API
            key and Vertex credential path and is written with owner-only permissions.
          </Note>
        </section>

        <section id="provider">
          <h2><span className="anchor">#</span>Provider & credentials</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Variable</th><th style={{ width: "24%" }}>Default</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {PROVIDER.map(([v, d, e]) => (
                  <tr key={v}>
                    <td><code className="inline">{v}</code></td>
                    <td><code className="inline">{d}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`export DEEPSEEK_API_KEY="sk-…"
deepseek --pipe "summarize the last three commits"`}</CodeBlock>
          <p>
            Without either a saved config or the key, headless mode fails with a specific message rather
            than a generic auth error:
          </p>
          <CodeBlock lang="text">{`DEEPSEEK_API_KEY not set and no saved config found`}</CodeBlock>
        </section>

        <section id="aws">
          <h2><span className="anchor">#</span>Amazon Bedrock</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Variable</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {AWS.map(([v, e]) => (
                  <tr key={v}>
                    <td><code className="inline">{v}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Bedrock selects one of two credential sources: when both access-key variables are present it uses
            the AWS environment provider (and consumes the optional session token); otherwise it loads the
            configured shared-credentials profile, defaulting to profile name <code className="inline">default</code>.
            Region and profile are set in <a href="/docs/settings">settings</a> under{" "}
            <code className="inline">provider.region</code> and <code className="inline">provider.profile</code>.
          </p>
          <p>
            There is a failure mode worth knowing about, because the error message calls it out explicitly:{" "}
            <code className="inline">/model</code> can succeed while chat fails. Model listing uses the native
            AWS SDK; chat uses either the signed Bedrock Mantle endpoint for V3.x or signed native InvokeModel
            for R1. Seeing models is not proof that the selected runtime endpoint and model invocation work. See{" "}
            <a href="/docs/errors">Error reference</a>.
          </p>
        </section>

        <section id="gcp">
          <h2><span className="anchor">#</span>Google Vertex AI</h2>
          <p>
            Vertex authenticates with a service-account JSON path saved by the setup flow in the private
            credential file. The uppercase label shown by setup and some errors is{" "}
            <code className="inline">GCP_CREDENTIALS</code>, but a fresh process does <b>not</b> read it as an
            environment-variable fallback.
          </p>
          <CodeBlock lang="text">{`$ deepseek
Provider: Google Vertex AI
GCP Project ID: my-project
GCP Location: us-central1
Service Account JSON path: /home/you/.config/gcloud/deepseek.json`}</CodeBlock>
          <p>
            Project and location live in settings as{" "}
            <code className="inline">provider.projectId</code> and{" "}
            <code className="inline">provider.location</code>.
          </p>
          <p>
            Both model discovery and chat use the saved service-account path. An error mentioning{" "}
            <code className="inline">PERMISSION_DENIED</code> or <code className="inline">UNAUTHENTICATED</code>{" "}
            is diagnosed as a credentials problem and reported with that context attached.
          </p>
        </section>

        <section id="local">
          <h2><span className="anchor">#</span>Local models</h2>
          <p>
            Local runtimes — Ollama, LM Studio, anything exposing an OpenAI-compatible API — are configured
            by pointing the base URL at them:
          </p>
          <CodeBlock lang="json">{`{
  "provider": {
    "name": "local",
    "endpoint": "http://localhost:11434/v1"
  },
  "model": { "default": "deepseek-r1:8b" }
}`}</CodeBlock>
          <p>
            The setup UI labels its temporary fields <code className="inline">LOCAL_BASE_URL</code> and{" "}
            <code className="inline">LOCAL_MODEL</code>, but they are not general startup environment
            variables. The endpoint is persisted as <code className="inline">provider.endpoint</code>; choose a
            persistent model with <code className="inline">model.default</code> or the model selector.
          </p>
          <p>
            Context limits for unknown models fall back to <code className="inline">128,000</code> — see{" "}
            <a href="/docs/model-config#contextlimit">Model configuration</a>. If your local model has a
            smaller window, the CLI cannot discover or configure that exact ceiling today. Use shorter
            sessions and manual <code className="inline">/compact</code> before the server rejects an oversized request.
          </p>
        </section>

        <section id="paths">
          <h2><span className="anchor">#</span>Paths</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Variable</th><th style={{ width: "26%" }}>Default</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {PATHS.map(([v, d, e]) => (
                  <tr key={v}>
                    <td><code className="inline">{v}</code></td>
                    <td><code className="inline">{d}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Path resolution is mixed: sessions, conversation checkpoints, file checkpoints and input history
            consult <code className="inline">HOME</code> directly, while settings, credentials, plugins, memory,
            logs and workflows use the operating system's home-directory lookup. Overriding{" "}
            <code className="inline">HOME</code> therefore does not reliably relocate all DeepSeek Code state.
          </p>
          <p>
            <code className="inline">DEEPSEEK_PLUGINS_DIR</code> is the cleanest way to test a plugin without
            touching your installed set.
          </p>
        </section>

        <section id="features">
          <h2><span className="anchor">#</span>Feature toggles</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Variable</th><th style={{ width: "14%" }}>Value</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {FEATURES.map(([v, val, e]) => (
                  <tr key={v}>
                    <td><code className="inline">{v}</code></td>
                    <td><code className="inline">{val}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">DEEPSEEK_DISABLE_WORKFLOWS</code> is checked at two independent points —
            when a workflow starts and inside the workflow manager — so it holds even for a code path that
            reaches the manager directly. The check is exact string equality with{" "}
            <code className="inline">'1'</code>; <code className="inline">true</code> or{" "}
            <code className="inline">yes</code> will not work.
          </p>
          <p>
            <code className="inline">CLAUDE_CODE_ACCESSIBILITY</code> accepts exactly <code className="inline">1</code>{" "}
            or <code className="inline">true</code>. Its current effect is narrow: it prevents the renderer from
            hiding the native cursor. It does not linearize output, suppress color, or disable animation.
          </p>
          <Note>
            Runtime feature flags — <code className="inline">wordDiff</code>,{" "}
            <code className="inline">microCompact</code>, <code className="inline">fuzzyFileSearch</code> — are not
            environment variables. They live in{" "}
            <code className="inline">~/.deepseek/features.json</code>; see{" "}
            <a href="/docs/features">Feature flags</a>.
          </Note>
        </section>

        <section id="terminal">
          <h2><span className="anchor">#</span>Terminal & rendering</h2>
          <p>
            These are read for capability detection. You will rarely set them by hand — they are documented
            so you can override detection when it gets your terminal wrong:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Variable</th><th>Used for</th></tr>
              </thead>
              <tbody>
                {TERMINAL.map(([v, u]) => (
                  <tr key={v}>
                    <td><code className="inline">{v}</code></td>
                    <td>{u}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">TERM_PROGRAM</code> is the most consulted variable in the codebase, which
            reflects how much terminal behavior varies by emulator. If colors look wrong under tmux,{" "}
            <code className="inline">CLAUDE_CODE_TMUX_TRUECOLOR</code> is the escape hatch. See{" "}
            <a href="/docs/interface">Interface</a> and <a href="/docs/themes">Themes</a>.
          </p>
        </section>

        <section id="editor">
          <h2><span className="anchor">#</span>Editor</h2>
          <CodeBlock lang="bash">{`export VISUAL="code --wait"     # checked first
export EDITOR="vim"             # fallback`}</CodeBlock>
          <p>
            Standard Unix convention: <code className="inline">VISUAL</code> for a full-screen editor,{" "}
            <code className="inline">EDITOR</code> as the fallback. Used wherever an external editor is opened.
          </p>
          <p>
            With a GUI editor, include its wait flag (<code className="inline">--wait</code>,{" "}
            <code className="inline">-w</code>). Without it the command returns immediately and the session
            continues before you have typed anything.
          </p>
        </section>

        <section id="debug">
          <h2><span className="anchor">#</span>Development & debug</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Variable</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {DEBUG.map(([v, e]) => (
                  <tr key={v}>
                    <td><code className="inline">{v}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">NODE_ENV=development</code> is set automatically by{" "}
            <code className="inline">bun run dev</code> and <code className="inline">bun run start</code>. You do
            not normally set it yourself.
          </p>
        </section>

        <section id="ci">
          <h2><span className="anchor">#</span>In CI</h2>
          <CodeBlock lang="yaml">{`env:
  DEEPSEEK_API_KEY: \${{ secrets.DEEPSEEK_API_KEY }}
  # optional
  DEEPSEEK_BASE_URL: https://gateway.internal/v1
  DEEPSEEK_DISABLE_WORKFLOWS: "1"`}</CodeBlock>
          <p>
            In practice CI needs exactly one variable — the API key — because there is no saved config to
            take precedence over it. Add a base URL if you route through a gateway, and the workflows
            kill-switch if you want a strictly bounded run.
          </p>
          <p>
            Remember that <a href="/docs/headless#safety">headless mode denies commands</a> that would need
            interactive confirmation. Anything destructive must be granted explicitly through{" "}
            <a href="/docs/permissions">permission rules</a>, not through the environment.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
