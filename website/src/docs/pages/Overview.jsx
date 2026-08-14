import { CodeBlock, Note, Toc, Icon } from "../Layout";
import useNpmVersion from "../../lib/useNpmVersion";

const PROVIDERS = [
  { name: "DeepSeek API", badge: "default", auth: "API key from platform.deepseek.com", env: ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"] },
  { name: "Amazon Bedrock", auth: "AWS IAM via ~/.aws/credentials", env: ["AWS_REGION", "AWS_PROFILE"] },
  { name: "Google Vertex AI", auth: "GCP service account JSON key", env: ["GCP_PROJECT", "GCP_LOCATION", "GCP_CREDENTIALS"] },
  { name: "Local (Ollama / LM Studio)", auth: "No auth — point to your endpoint", env: ["LOCAL_BASE_URL", "LOCAL_MODEL"] },
];

const MODELS = [
  { id: "deepseek-v4-flash", desc: "Fast, general purpose", tag: "default", ctx: "1M" },
  { id: "deepseek-v4-pro", desc: "Advanced reasoning", tag: null, ctx: "1M" },
];

const SLASH = [
  ["/model", "Switch model"],
  ["/agent", "Spawn a sub-agent"],
  ["/memory", "Manage persistent memory"],
  ["/plan", "Enter plan mode"],
  ["/review", "Code review"],
  ["/vim", "Toggle vim keybindings"],
  ["/tools", "List available tools"],
  ["/doctor", "Check runtime, workspace, credentials, settings, and MCP configuration"],
  ["/verify", "Run the detected project test command"],
  ["/sessions export <id> [json|md]", "Export a sanitized session transcript"],
  ["/catalog, /marketplace", "Browse curated MCP, plugin, and skill integrations"],
  ["/permissions", "Explain mode, allow/deny rules, risk checks, and session approvals"],
  ["/config, /settings", "Open the fullscreen settings center"],
  ["/help", "Show all commands"],
  ["/btw", "Ask a quick side question without interrupting the agent"],
  ["/checkpoint", "Manage checkpoints"],
  ["/compact", "Summarize history to save context"],
  ["/clear", "Clear chat history"],
  ["/context", "Show context window usage breakdown (estimated)"],
  ["/cost", "Show estimated session cost"],
  ["/cwd", "Show or change working directory"],
  ["/effort", "Set reasoning effort level"],
  ["/features", "Toggle experimental feature flags"],
  ["/files", "List modified files this session"],
  ["/goal", "Set, view, or manage a persistent goal"],
  ["/logout", "Clear all stored credentials and API keys"],
  ["/mobile", "Show QR code to download the DeepSeek mobile app"],
  ["/plugin", "Manage plugins (install, list, remove, update)"],
  ["/retry", "Re-run last message"],
  ["/skill", "Manage skills (install, list, remove, update)"],
  ["/stats", "Show session statistics"],
  ["/system", "Show active mode and permission summary"],
  ["/task", "Inspect or control a task"],
  ["/tasks", "Inspect the session task DAG"],
  ["/undo", "Restore last file modified by the agent (all | list)"],
  ["/workflow", "Run or control a Dynamic Workflow"],
  ["/workflows", "Monitor Dynamic Workflow runs"],
  ["/worktree", "Create or manage an isolated project copy"],
  ["/agents", "List available agents"],
  ["/quit", "Exit application"],
];

const TOOLS = [
  "ReadFile", "WriteFile", "PatchFile", "Shell", "Glob", "Grep", "Git",
  "ReadFolder", "WebFetch", "SubAgent", "Memory", "Todo", "Introspect", "MoA",
  "EditFile", "Lsp", "AskAgent", "Workflow", "UpdateKnowledge", "SubmitPlan",
  "WritePlan", "GetGoal", "CreateGoal", "UpdateGoal",
];

const TOC = [
  { id: "what-is", label: "What is DeepSeek Code?" },
  { id: "quick-start", label: "Quick start" },
  { id: "providers-sec", label: "Providers" },
  { id: "models-sec", label: "Models" },
  { id: "slash-sec", label: "Slash commands" },
  { id: "tools-sec", label: "Built-in tools" },
  { id: "next-sec", label: "Next steps" },
];

export default function Overview() {
  const version = useNpmVersion();

  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Get Started</span><span className="sep">/</span><span className="current">Overview</span>
        </nav>

        <div className="hero">
          <h1>DeepSeek Code</h1>
          <p className="tagline">
            An open-source, DeepSeek-powered coding assistant that lives in your terminal.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href="/docs/quickstart">
              Get started <Icon.Chevron />
            </a>
            <a className="btn btn-secondary" href="/docs/installation">Install</a>
          </div>
          <div className="badges">
            <span className="badge"><b>model</b><span className="sep">—</span>DeepSeek</span>
            <span className="badge"><b>license</b><span className="sep">—</span>Apache 2.0</span>
            <span className="badge"><b>{version}</b></span>
          </div>

          <div className="terminal-demo">
            <img
              src={`${process.env.PUBLIC_URL}/demo.gif`}
              alt="DeepSeek Code TUI demo"
            />
          </div>
        </div>

        <section id="what-is">
          <h2><span className="anchor">#</span>What is DeepSeek Code?</h2>
          <p>
            DeepSeek Code is an open-source coding assistant that lives in your terminal. It
            runs an agent loop that reads and writes files, executes shell commands, searches
            your codebase, and manages git — all rendered as a full TUI built with{" "}
            <code className="inline">Ink + React</code>. It supports multiple LLM providers and
            is extensible through slash commands, tools, memory, sessions, and themes.
          </p>
          <ul className="capabilities">
            <li>Reads/writes files, runs shell commands, searches code, manages git</li>
            <li>Full TUI interface — alternate-screen buffer, streamed thinking, rich markdown, vim mode, configurable status bar, and live sub-agent / workflow monitors</li>
            <li>Multi-provider: DeepSeek API, Amazon Bedrock, Google Vertex AI, or local models (Ollama, LM Studio)</li>
            <li>Unified agents — primary agent and sub-agents with editable base prompts</li>
            <li>MCP support — connect any Model Context Protocol server</li>
            <li>Project guidance via <code className="inline">AGENTS.md</code> / <code className="inline">DEEPSEEK.md</code></li>
            <li>Optional LSP navigation (definitions, references, hover, symbols)</li>
            <li>Persistent goals with auto-continuation (<code className="inline">/goal</code>)</li>
            <li>Extensible — slash commands, custom tools, memory, sessions, themes</li>
          </ul>
        </section>

        <section id="quick-start">
          <h2><span className="anchor">#</span>Quick start</h2>
          <p className="lead">Install globally with Bun and run it inside any project.</p>
          <CodeBlock lang="bash">{`# npm
$ npm install -g @hermenics/deepseek-code

# or with bun
$ bun add -g @hermenics/deepseek-code`}</CodeBlock>
          <p>
            Then run <code className="inline">deepseek</code> inside any project. On first run
            you'll pick a provider and configure authentication.
          </p>
          <CodeBlock lang="bash">{`# Headless pipe mode
$ echo "explain this project" | deepseek --pipe
$ cat src/index.tsx | deepseek --pipe --json "summarize"`}</CodeBlock>
          <Note>Requires <b>Bun 1.1+</b> and a supported LLM provider.</Note>
        </section>

        <section id="providers-sec">
          <h2><span className="anchor">#</span>Providers</h2>
          <p className="lead">
            DeepSeek Code speaks natively to multiple LLM backends. Pick one at first launch
            or switch anytime with <code className="inline">/model</code>.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "26%" }}>Provider</th>
                  <th style={{ width: "38%" }}>How to authenticate</th>
                  <th>Env / config keys</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDERS.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <b style={{ color: "var(--text-strong)" }}>{p.name}</b>
                      {p.badge && <span className="badge" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 10 }}>{p.badge}</span>}
                    </td>
                    <td>{p.auth}</td>
                    <td>{p.env.map((e, i) => (
                      <span key={e}>
                        <code className="inline">{e}</code>{i < p.env.length - 1 && <span style={{ margin: "0 4px", color: "var(--text-faint)" }}>·</span>}
                      </span>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            Secrets are saved only to <code className="inline">~/.deepseek/config.json</code>; non-secret
            preferences use <code className="inline">settings.json</code> with{" "}
            <b>User &lt; Project &lt; Local</b> precedence.
          </Note>
        </section>

        <section id="models-sec">
          <h2><span className="anchor">#</span>Models</h2>
          <p className="lead">Two first-class DeepSeek models ship out of the box.</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Model ID</th>
                  <th>Description</th>
                  <th style={{ width: "14%" }}>Context</th>
                </tr>
              </thead>
              <tbody>
                {MODELS.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <code className="inline">{m.id}</code>
                      {m.tag && <span className="badge" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 10 }}>{m.tag}</span>}
                    </td>
                    <td>{m.desc}</td>
                    <td><code className="inline">{m.ctx}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            The built-in Bedrock and Vertex discovery paths filter for DeepSeek model IDs. A local endpoint
            can expose whatever model IDs its OpenAI-compatible server reports.
          </p>
        </section>

        <section id="slash-sec">
          <h2><span className="anchor">#</span>Slash commands</h2>
          <p className="lead">Type <code className="inline">/</code> in the TUI to open the command palette.</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "38%" }}>Command</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {SLASH.map(([cmd, desc]) => (
                  <tr key={cmd}>
                    <td><code className="inline">{cmd}</code></td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="tools-sec">
          <h2><span className="anchor">#</span>Built-in tools</h2>
          <p className="lead">Every tool ships enabled by default and can be gated, extended, or replaced.</p>
          <div className="tools-grid">
            {TOOLS.map((t) => (
              <span className="tool-chip" key={t}><span className="dot-tool" />{t}</span>
            ))}
          </div>
        </section>

        <section id="next-sec">
          <h2><span className="anchor">#</span>Next steps</h2>
          <div className="next-links">
            <a className="next-card" href="/docs/quickstart">
              <div className="nc-title">Quickstart <Icon.Arrow /></div>
              <div className="nc-desc">Install and run your first DeepSeek Code session.</div>
            </a>
            <a className="next-card" href="/docs/commands">
              <div className="nc-title">Commands <Icon.Arrow /></div>
              <div className="nc-desc">Explore the full command palette and shortcuts.</div>
            </a>
            <a className="next-card" href="/docs/settings">
              <div className="nc-title">Configuration <Icon.Arrow /></div>
              <div className="nc-desc">Configure providers, settings, and precedence.</div>
            </a>
            <a className="next-card" href="/docs/tools">
              <div className="nc-title">Tools <Icon.Arrow /></div>
              <div className="nc-desc">Learn how tools compose your agent's capabilities.</div>
            </a>
          </div>
        </section>

        <footer className="doc-footer">
          <span>© {new Date().getFullYear()} DeepSeek Code · Apache 2.0</span>
          <span>
            <a href="https://github.com/Hermenics/deepseek-code">Edit this page</a>{" · "}
            <a href="https://github.com/Hermenics/deepseek-code/issues">Report an issue</a>
          </span>
        </footer>
      </main>

      <Toc items={TOC} />
    </>
  );
}
