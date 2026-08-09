import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "What MCP gives you" },
  { id: "config", label: "Configuring servers" },
  { id: "enabling", label: "Enabling MCP" },
  { id: "transports", label: "Transports: stdio and HTTP" },
  { id: "security", label: "Security hardening" },
  { id: "catalog", label: "Finding servers (/catalog)" },
  { id: "permissions", label: "Permissions in mode" },
];

const TRANSPORTS = [
  ["stdio", "Spawns a local process. The server receives a minimal environment — only PATH, TMPDIR, and LANG are inherited. Add any server-specific value explicitly in its env."],
  ["http", "Connects to a remote server over Streamable HTTP."],
];

const GUARDS = [
  ["validateMcpCommand", "Rejects empty commands, ../ path traversal, and shell-injection characters (;, `, <, >, &&, ||, $(, >>, <<)"],
  ["sanitizeMcpEnv", "Strips server-supplied overrides of critical env vars (PATH, HOME, SHELL, LD_*, PYTHONPATH, NODE_OPTIONS, …)"],
  ["30s timeout", "callTool races a 30-second timer, so an unresponsive server can't hang the agent"],
  ["Audit log", "Successful loads are written as mcp_server_load events"],
];

const CATALOG = [
  ["GitHub", "github/github-mcp-server", "Repos, issues, pull requests"],
  ["Playwright", "microsoft/playwright-mcp", "Browser automation and UI verification"],
  ["Context7", "upstash/context7", "Current library documentation"],
];

export default function Mcp() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">MCP</span>
        </nav>

        <div className="hero">
          <h1>Model Context Protocol (MCP)</h1>
          <p className="tagline">
            Wire external tools and data sources into the agent as native tools.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>What MCP gives you</h2>
          <p>
            DeepSeek Code is a full MCP client. Wire external tools and data sources — filesystem
            access, browser automation, current library documentation — into the agent as native
            tools. Servers are configured in <code className="inline">.deepseek/mcp.json</code> and
            stay off until you explicitly enable them.
          </p>
          <p>
            MCP connects your agent to external tools through the official{" "}
            <code className="inline">@modelcontextprotocol/sdk</code>. When a server connects,
            DeepSeek Code calls <code className="inline">listTools()</code> and registers each
            returned tool as a native tool:
          </p>
          <ul className="capabilities">
            <li>Named <code className="inline">&lt;serverName&gt;__&lt;toolName&gt;</code> — tools from different servers never collide</li>
            <li>Description prefixed with <code className="inline">[MCP:&lt;server&gt;]</code> — the agent knows where a tool came from</li>
          </ul>
          <p>
            Wrapped tools are plain tools from the agent's point of view: they show up in{" "}
            <code className="inline">/tools</code>, take an input schema, and return text.
          </p>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Configuring servers</h2>
          <p>
            Servers live in <code className="inline">.deepseek/mcp.json</code> at the project root:
          </p>
          <CodeBlock lang="text">{`{
  "servers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    },
    "my-api": {
      "transport": "http",
      "url": "http://localhost:19816/mcp"
    }
  }
}`}</CodeBlock>
          <p>
            Each entry is either a <code className="inline">stdio</code> server (a local process
            with <code className="inline">command</code>, optional <code className="inline">args</code> and{" "}
            <code className="inline">env</code>) or an <code className="inline">http</code> server (a
            remote <code className="inline">url</code>). <code className="inline">/doctor</code>{" "}
            checks that the file exists, parses as valid JSON, and reports how many servers are
            configured.
          </p>
        </section>

        <section id="enabling">
          <h2><span className="anchor">#</span>Enabling MCP</h2>
          <p>
            Project MCP servers are <b>off by default</b> — loading <code className="inline">mcp.json</code>{" "}
            requires an explicit opt-in:
          </p>
          <ol style={{ margin: "0 0 14px 20px" }}>
            <li>Open the settings center (<code className="inline">/settings</code> or <code className="inline">/config</code>)</li>
            <li>Set <b>Enable project MCP servers</b> at User scope (<code className="inline">settings.mcp.enabled = true</code>)</li>
            <li>Restart DeepSeek Code</li>
          </ol>
          <Note>
            Project and Local scope cannot enable project MCP. The setting is intentionally
            User-scoped consent, so a cloned repo can't silently activate its servers for you.
          </Note>
        </section>

        <section id="transports">
          <h2><span className="anchor">#</span>Transports: stdio and HTTP</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Transport</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {TRANSPORTS.map(([t, d]) => (
                  <tr key={t}>
                    <td><b style={{ color: "var(--text-strong)" }}>{t}</b></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            On connect, the client calls <code className="inline">listTools()</code> and registers
            each tool under its <code className="inline">&lt;serverName&gt;__&lt;toolName&gt;</code> name.
          </p>
        </section>

        <section id="security">
          <h2><span className="anchor">#</span>Security hardening</h2>
          <p>
            MCP is a code-execution surface, so DeepSeek Code hardens it at several layers:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Guard</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {GUARDS.map(([g, d]) => (
                  <tr key={g}>
                    <td><code className="inline">{g}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="catalog">
          <h2><span className="anchor">#</span>Finding servers (/catalog)</h2>
          <p>
            <code className="inline">/catalog [mcp|plugin|skill]</code> (alias{" "}
            <code className="inline">/marketplace</code>) lists curated integrations to copy into{" "}
            <code className="inline">mcp.json</code>:
          </p>
          <CodeBlock lang="bash">$ <span className="k">deepseek</span>
❯ <span className="k">/catalog</span> <span className="m">mcp</span></CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Server</th><th style={{ width: "40%" }}>Source</th><th>Use for</th></tr>
              </thead>
              <tbody>
                {CATALOG.map(([s, src, use]) => (
                  <tr key={s}>
                    <td><b style={{ color: "var(--text-strong)" }}>{s}</b></td>
                    <td><code className="inline">{src}</code></td>
                    <td>{use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            These are recommendations only — review the source and its permissions before installing.
          </Note>
        </section>

        <section id="permissions">
          <h2><span className="anchor">#</span>Permissions in mode</h2>
          <p>
            Outside Auto mode, MCP tools follow the same shell permission rules as regular tools,
            so approvals and deny rules apply before a server tool runs.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
