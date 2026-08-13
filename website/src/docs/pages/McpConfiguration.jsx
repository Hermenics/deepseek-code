import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "two-controls", label: "Definition and consent" },
  { id: "config", label: "mcp.json format" },
  { id: "enable", label: "Enable project MCP" },
  { id: "startup", label: "Discovery at startup" },
  { id: "tools", label: "Registered tools" },
  { id: "modes", label: "Modes and authorization" },
  { id: "verify", label: "Verify the setup" },
  { id: "errors", label: "Load errors" },
  { id: "security", label: "Configuration security" },
  { id: "limits", label: "Current limits" },
];

const CONFIG_FIELDS = [
  ["servers", "object", "Required map of server name to one transport definition."],
  ["transport", "stdio | http", "Selects local process or Streamable HTTP."],
  ["command", "string", "stdio executable; required and validated."],
  ["args", "string[]", "Optional stdio arguments, passed separately from command."],
  ["env", "object", "Optional explicit stdio environment values, subject to blocked keys."],
  ["url", "string", "HTTP endpoint parsed as a URL."],
];

const CHECKS = [
  ["/doctor", "Parses .deepseek/mcp.json and counts keys under servers."],
  ["/tools", "Shows tools actually discovered from successful server connections."],
  ["Startup warning", "Lists each server that failed to connect, validate or enumerate tools."],
  ["Audit JSONL", "Records mcp_server_load only after a successful connection."],
];

export default function McpConfiguration() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Extending</span><span className="sep">/</span><span className="current">MCP configuration</span>
        </nav>

        <div className="hero">
          <h1>MCP configuration</h1>
          <p className="tagline">
            Define per-project servers, grant User-scoped consent, and verify the tools that actually loaded.
          </p>
        </div>

        <section id="two-controls">
          <h2><span className="anchor">#</span>Definition and consent are separate</h2>
          <p>
            MCP uses two files with different trust roles. The project defines servers in
            <code className="inline"> &lt;project&gt;/.deepseek/mcp.json</code>. Your User settings decide whether
            any project definition may load through <code className="inline">mcp.enabled</code> in
            <code className="inline"> ~/.deepseek/settings.json</code>.
          </p>
          <CodeBlock lang="text">{`project declaration   .deepseek/mcp.json
user consent          ~/.deepseek/settings.json → mcp.enabled
default               disabled
activation            next agent initialization`}</CodeBlock>
          <Note>
            Project and Local settings cannot grant MCP consent. Their <code className="inline">mcp</code> blocks
            are reported as ignored so a cloned repository cannot turn on its own executable integrations.
          </Note>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>mcp.json format</h2>
          <p>Create the file at the active project root:</p>
          <CodeBlock lang="json">{`{
  "servers": {
    "project-files": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/you/project"],
      "env": { "LOG_LEVEL": "warn" }
    },
    "internal-docs": {
      "transport": "http",
      "url": "https://docs.example.test/mcp"
    }
  }
}`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "20%" }}>Field</th><th style={{ width: "22%" }}>Shape</th><th>Current meaning</th></tr></thead>
              <tbody>{CONFIG_FIELDS.map(([field, shape, meaning]) => <tr key={field}><td><code className="inline">{field}</code></td><td>{shape}</td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Server names become part of every tool name, so keep them short, stable and distinct. Use one of
            the two exact transport values documented above. Transport behavior and environment rules are in
            <a href="/docs/mcp-transports"> MCP transports</a>.
          </p>
        </section>

        <section id="enable">
          <h2><span className="anchor">#</span>Enable project MCP</h2>
          <ol style={{ margin: "0 0 14px 20px" }}>
            <li>Start DeepSeek Code inside the project whose <code className="inline">mcp.json</code> you reviewed.</li>
            <li>Open <code className="inline">/settings</code> or its alias <code className="inline">/config</code>.</li>
            <li>Keep the scope on <b>User</b>.</li>
            <li>Open <b>Advanced</b> and toggle <b>Enable project MCP servers</b>.</li>
            <li>Restart the session so server discovery runs again.</li>
          </ol>
          <CodeBlock lang="json">{`{
  "mcp": {
    "enabled": true
  }
}`}</CodeBlock>
          <p>
            The settings screen labels this change <code className="inline">Applies next session</code>. Updating
            the boolean changes consent immediately in settings, but it does not connect servers or rebuild the
            current tool registry.
          </p>
        </section>

        <section id="startup">
          <h2><span className="anchor">#</span>Discovery at startup</h2>
          <p>
            During agent initialization, the CLI reads effective settings, then reads the active workspace's
            <code className="inline"> .deepseek/mcp.json</code>. With consent disabled, it does neither server
            connection nor error reporting. With consent enabled, it processes server entries in file order.
          </p>
          <p>
            For each entry it creates a client, connects the selected transport, records a successful-load audit
            event, calls the server's tool-list operation, and wraps each returned tool. One failed server is
            added to the error list while remaining entries continue.
          </p>
          <Note>
            Changing the working directory through the CLI reinitializes the agent for the new project and
            repeats MCP discovery. Ordinary settings reload does not.
          </Note>
        </section>

        <section id="tools">
          <h2><span className="anchor">#</span>Registered tools</h2>
          <p>
            A discovered tool is named <code className="inline">&lt;serverName&gt;__&lt;toolName&gt;</code>, keeps the
            server's input schema, and receives a description prefixed with
            <code className="inline"> [MCP:&lt;serverName&gt;]</code>. Run <code className="inline">/tools</code> to
            inspect the current registry:
          </p>
          <CodeBlock lang="text">{`> /tools
Built-in tools (24):
  read_file
  shell
  …

MCP tools (2):
  project-files__read_text_file
  internal-docs__search`}</CodeBlock>
          <p>
            Tool results keep only MCP content items whose type is text and whose text is non-empty. Multiple
            text items are joined with newlines. Images, resources and other content types are currently omitted
            from the string returned to the agent.
          </p>
        </section>

        <section id="modes">
          <h2><span className="anchor">#</span>Modes and authorization</h2>
          <p>
            Discovery makes a tool available; it does not authorize every call. Dynamic names containing a
            double underscore follow the shell mode rule: available in Build and Auto, unavailable in Plan and
            Review. The mode gate runs before hooks, so a blocked MCP call does not execute PreToolUse.
          </p>
          <p>
            In an allowed mode, MCP calls continue through the same hook and authorization path as native tools.
            A project server is not a shortcut around permission rules, risk confirmation or user intent. See
            <a href="/docs/interaction-modes"> Interaction modes</a> and
            <a href="/docs/permissions"> Permissions</a>.
          </p>
        </section>

        <section id="verify">
          <h2><span className="anchor">#</span>Verify the setup</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "24%" }}>Signal</th><th>What it proves</th></tr></thead>
              <tbody>{CHECKS.map(([signal, proof]) => <tr key={signal}><td><code className="inline">{signal}</code></td><td>{proof}</td></tr>)}</tbody>
            </table>
          </div>
          <CodeBlock lang="text">{`> /doctor
DeepSeek Code doctor · /home/you/project

✓ MCP config: 2 servers configured

Everything looks ready.`}</CodeBlock>
          <Note>
            <code className="inline">/doctor</code> does not check consent, field shapes, executable availability,
            network reachability, protocol negotiation or tool discovery. Pair it with a restarted session and
            <code className="inline"> /tools</code>.
          </Note>
        </section>

        <section id="errors">
          <h2><span className="anchor">#</span>Load errors</h2>
          <p>
            Connection, URL, command validation and tool-enumeration failures appear after initialization in one
            assistant message. Each line is scoped to its server:
          </p>
          <CodeBlock lang="text">{`⚠ MCP connection errors:
  • MCP server 'project-files': spawn npx ENOENT
  • MCP server 'internal-docs': Invalid URL`}</CodeBlock>
          <p>
            Invalid or unreadable <code className="inline">mcp.json</code> is swallowed by the runtime loader and
            yields no MCP tools. Use <code className="inline">/doctor</code> to surface JSON parse errors. A valid
            JSON object with no <code className="inline">servers</code> key, or an empty map, simply loads no
            tools.
          </p>
          <p>
            A successful connection is written as <code className="inline">mcp_server_load</code> under
            <code className="inline"> ~/.deepseek/logs/</code> before tool discovery. A connection failure emits
            no event; a later tool-list failure can therefore coexist with a successful connection event. See
            <a href="/docs/monitoring-audit"> Monitoring & audit</a>.
          </p>
        </section>

        <section id="security">
          <h2><span className="anchor">#</span>Configuration security</h2>
          <ul className="capabilities">
            <li>Review every local executable, package and remote endpoint before enabling project MCP.</li>
            <li>Keep secrets out of tracked mcp.json; stdio env values are literal project configuration.</li>
            <li>Grant each server only the filesystem roots and credentials its own arguments require.</li>
            <li>Treat tool descriptions, schemas and returned text as external, untrusted input.</li>
            <li>Use <code className="inline">/catalog mcp</code> for recommendations, then review and configure manually.</li>
          </ul>
          <p>
            The catalog does not install or activate an MCP entry. Its output explicitly points you back to
            <code className="inline"> .deepseek/mcp.json</code>. More controls are covered in
            <a href="/docs/security"> Security</a>.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Current limits</h2>
          <ul className="capabilities">
            <li>Configuration is project-only; there is no global server-definition file in the active loader.</li>
            <li>There is no MCP add/remove/reload slash command; edit JSON and reinitialize the agent.</li>
            <li>Supported transports are stdio and Streamable HTTP only.</li>
            <li>There is no complete mcp.json schema validator; /doctor checks JSON syntax and server count only.</li>
            <li>HTTP configuration accepts a URL only—no headers, OAuth settings or per-server timeout fields.</li>
            <li>The fixed 30-second timeout applies to tool calls, not explicitly to startup connect or listTools.</li>
            <li>The loader does not expose MCP prompts or resources as native capabilities.</li>
            <li>The current agent shutdown path does not explicitly close stored MCP clients.</li>
          </ul>
          <p>
            Continue to <a href="/docs/mcp-transports">MCP transports</a> for the exact stdio and HTTP behavior,
            or return to the <a href="/docs/mcp">MCP overview</a>.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
