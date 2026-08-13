import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "compare", label: "Transport comparison" },
  { id: "stdio", label: "stdio configuration" },
  { id: "commands", label: "Command validation" },
  { id: "environment", label: "Minimal environment" },
  { id: "http", label: "Streamable HTTP" },
  { id: "connection", label: "Connection and discovery" },
  { id: "calls", label: "Tool-call behavior" },
  { id: "errors", label: "Errors by transport" },
  { id: "choice", label: "Choosing a transport" },
  { id: "limits", label: "Protocol boundaries" },
];

const COMPARISON = [
  ["Where it runs", "A child process on your machine", "A URL reached by the MCP SDK"],
  ["Required config", "command", "url"],
  ["Optional config", "args, env", "None"],
  ["Inherited environment", "PATH, TMPDIR, optional LANG", "Not applicable"],
  ["Authentication config", "Explicit non-critical env or args", "No headers/auth fields"],
  ["Command guard", "Empty/traversal/shell-token rejection", "URL parsing"],
  ["Tool timeout", "30 seconds", "30 seconds"],
];

const CRITICAL = [
  "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  "HOME", "USER", "SHELL", "PYTHONPATH", "NODE_OPTIONS", "NODE_PATH", "BUN_INSTALL",
];

const ERRORS = [
  ["stdio", "MCP command cannot be empty", "command is empty or whitespace-only."],
  ["stdio", "MCP command contains path traversal: …", "command contains ../ or ..\\."],
  ["stdio", "MCP command contains shell injection characters: …", "command contains a rejected shell operator."],
  ["stdio", "spawn <command> ENOENT", "executable is not on the minimal PATH or does not exist."],
  ["http", "Invalid URL", "url cannot be parsed."],
  ["either", "MCP tool '<name>' timed out after 30s", "connected server did not finish the call in time."],
];

export default function McpTransports() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Extending</span><span className="sep">/</span><span className="current">MCP transports</span>
        </nav>

        <div className="hero">
          <h1>MCP transports</h1>
          <p className="tagline">
            The exact local-process and Streamable HTTP paths supported by the current MCP client.
          </p>
        </div>

        <section id="compare">
          <h2><span className="anchor">#</span>Transport comparison</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "23%" }}>Concern</th><th>stdio</th><th>http</th></tr></thead>
              <tbody>{COMPARISON.map(([concern, stdio, http]) => <tr key={concern}><td><b>{concern}</b></td><td>{stdio}</td><td>{http}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Both transports use the official MCP client SDK and converge after connection: the client lists
            tools, namespaces them, and applies the same fixed tool-call timeout. They differ mainly in process
            trust, environment and connection configuration.
          </p>
        </section>

        <section id="stdio">
          <h2><span className="anchor">#</span>stdio configuration</h2>
          <p>
            The stdio transport starts an executable directly through the SDK. Put only the executable in
            <code className="inline"> command</code>; put every argument in the ordered
            <code className="inline"> args</code> array. The MCP protocol then travels over the child's standard
            streams.
          </p>
          <CodeBlock lang="json">{`{
  "servers": {
    "workspace": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/you/project"],
      "env": {
        "LOG_LEVEL": "warn",
        "SERVICE_TOKEN": "replace-with-a-local-secret"
      }
    }
  }
}`}</CodeBlock>
          <Note>
            Unlike hook commands, an MCP stdio command is not launched through
            <code className="inline"> sh -c</code>. Shell pipelines, redirects and command chaining do not
            belong in <code className="inline">command</code>; several such characters are rejected before the
            transport is created.
          </Note>
          <p>
            A bare executable such as <code className="inline">npx</code>, an absolute path such as
            <code className="inline"> /usr/bin/node</code>, and a current-directory path such as
            <code className="inline"> ./bin/server</code> pass the current command validator.
          </p>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>Command validation</h2>
          <p>
            Before a stdio client is constructed, the CLI rejects empty or whitespace-only commands, parent
            traversal segments <code className="inline">../</code> and <code className="inline">..\</code>, and
            shell-injection tokens. The rejected set covers semicolon, pipe, backtick, angle brackets,
            <code className="inline"> &&</code>, <code className="inline">||</code>,
            <code className="inline"> $(</code>, redirects and heredoc operators.
          </p>
          <CodeBlock lang="text">{`accepted command values
npx
python3
/usr/bin/node
./bin/my-mcp-server

rejected command values
../bin/server
npx && another-command
npx | sh
npx > output.log
npx $(another-command)`}</CodeBlock>
          <p>
            Validation applies to the <code className="inline">command</code> string, not each value in
            <code className="inline">args</code>. Arguments are passed as separate process arguments rather than
            shell text; still review them because they control the server's own behavior and access scope.
          </p>
        </section>

        <section id="environment">
          <h2><span className="anchor">#</span>Minimal environment</h2>
          <p>
            A stdio server does not inherit the full DeepSeek Code environment. Its base contains
            <code className="inline"> PATH</code>, <code className="inline">TMPDIR</code>, and
            <code className="inline"> LANG</code> only when LANG exists. Missing PATH falls back to
            <code className="inline"> /usr/local/bin:/usr/bin:/bin</code>; missing TMPDIR falls back to
            <code className="inline"> /tmp</code>.
          </p>
          <CodeBlock lang="text">{`base environment passed to a stdio server
PATH=/usr/local/bin:/usr/bin:/bin
TMPDIR=/tmp
LANG=en_US.UTF-8        # only when the parent process has LANG`}</CodeBlock>
          <p>
            Values in the server's <code className="inline">env</code> object are then merged, except for these
            critical names:
          </p>
          <CodeBlock lang="text">{CRITICAL.join("\n")}</CodeBlock>
          <p>
            A critical override is silently ignored. If the critical name was absent from the base, the server
            cannot inject it. Non-critical values such as a service-specific token or log level are accepted and
            can override another non-critical base value.
          </p>
          <Note>
            Because HOME, USER and SHELL are neither inherited nor injectable, a server that relies on implicit
            home-directory credential discovery may fail. Prefer the server's explicit argument or a dedicated
            non-critical environment variable. Do not commit literal secrets in project mcp.json.
          </Note>
        </section>

        <section id="http">
          <h2><span className="anchor">#</span>Streamable HTTP</h2>
          <p>
            The <code className="inline">http</code> transport parses <code className="inline">url</code> with the
            platform URL parser and passes it to the SDK's Streamable HTTP client. The current configuration
            surface has exactly one transport-specific field: <code className="inline">url</code>.
          </p>
          <CodeBlock lang="json">{`{
  "servers": {
    "docs": {
      "transport": "http",
      "url": "https://mcp.example.test/api"
    }
  }
}`}</CodeBlock>
          <p>
            There are no configuration fields for request headers, bearer tokens, OAuth, cookies, TLS options
            or HTTP method. An endpoint that requires those values cannot be described through the current
            <code className="inline"> mcp.json</code> HTTP shape.
          </p>
          <p>
            Use HTTPS for a remote endpoint. The loader also accepts any URL scheme the SDK/URL constructor
            allows, so configuration review—not an explicit HTTPS-only guard—is the protection currently in
            place.
          </p>
        </section>

        <section id="connection">
          <h2><span className="anchor">#</span>Connection and discovery</h2>
          <p>
            Each configured entry gets an independent MCP client identified as
            <code className="inline"> deepseek-code</code> with the installed CLI version. The loader awaits
            transport connection, writes a successful-load audit event, then awaits tool discovery. Entries are
            processed sequentially, so a slow earlier server delays later servers.
          </p>
          <CodeBlock lang="text">{`server entry
  → validate stdio command, when applicable
  → construct client and transport
  → connect
  → write mcp_server_load audit event
  → list tools
  → register <server>__<tool> wrappers`}</CodeBlock>
          <p>
            The loader catches an error around each complete entry. A failed server contributes no tools and
            does not stop later entries. There is no explicit loader-level timeout around connect or tool
            discovery, so the documented 30-second ceiling should not be interpreted as a startup ceiling.
          </p>
        </section>

        <section id="calls">
          <h2><span className="anchor">#</span>Tool-call behavior</h2>
          <p>
            Once registered, stdio and HTTP tools behave identically inside the agent. A call forwards the
            argument object under the server's original tool name and races the MCP request against a fixed
            30-second rejection timer.
          </p>
          <CodeBlock lang="text">{`MCP tool 'search' timed out after 30s`}</CodeBlock>
          <p>
            The timer is fixed: there is no per-server or per-tool timeout field. It rejects the wrapper call,
            but the current code does not cancel the underlying SDK request when the race is lost. Returned
            content is filtered to non-empty text items and joined with newline characters.
          </p>
          <Note>
            Images, audio, embedded resources and structured non-text content are not forwarded by the current
            wrapper. A server whose useful result is exclusively non-text appears to return an empty string.
          </Note>
        </section>

        <section id="errors">
          <h2><span className="anchor">#</span>Errors by transport</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "15%" }}>Transport</th><th style={{ width: "39%" }}>Message</th><th>Meaning</th></tr></thead>
              <tbody>{ERRORS.map(([transport, message, meaning]) => <tr key={message}><td>{transport}</td><td><code className="inline">{message}</code></td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Startup errors are wrapped as <code className="inline">MCP server '&lt;name&gt;': &lt;message&gt;</code>
            and shown together after agent initialization. If no warning appears but no tools load, run
            <code className="inline"> /doctor</code>: invalid JSON is silently treated as no runtime config.
          </p>
          <p>
            See <a href="/docs/mcp-configuration#verify">configuration verification</a> and the general
            <a href="/docs/errors"> error reference</a> for the surrounding checks.
          </p>
        </section>

        <section id="choice">
          <h2><span className="anchor">#</span>Choosing a transport</h2>
          <p>
            Choose stdio when the server is a reviewed local executable or package and explicit process
            arguments/environment are enough. Choose HTTP when a Streamable HTTP endpoint already exists and
            requires no custom client-side headers or authentication configuration.
          </p>
          <CodeBlock lang="text">{`local package or binary + explicit env/args   → stdio
existing URL + no custom headers/auth          → http
SSE-only endpoint                              → unsupported
HTTP endpoint requiring configured headers     → unsupported by current config`}</CodeBlock>
          <p>
            This is a capability choice, not a security ranking. stdio executes local code; HTTP sends requests
            to another trust domain. Review the package or endpoint, its permissions, and the data each exposed
            tool can reach.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Protocol boundaries</h2>
          <ul className="capabilities">
            <li>No legacy SSE transport configuration.</li>
            <li>No custom HTTP headers, auth, proxy or TLS settings.</li>
            <li>No explicit startup connection/list timeout.</li>
            <li>No cancellation of the underlying request after the 30-second wrapper timeout.</li>
            <li>No non-text content forwarding, MCP prompt import or MCP resource import.</li>
            <li>No explicit MCP client close in the current agent shutdown method.</li>
          </ul>
          <p>
            For file placement, consent and tool discovery, see
            <a href="/docs/mcp-configuration"> MCP configuration</a>. Return to
            <a href="/docs/mcp"> MCP</a> for the feature overview.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
