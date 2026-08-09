import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "What it gives you" },
  { id: "configuration", label: "Configuration" },
  { id: "languageids", label: "Language ID inference" },
  { id: "operations", label: "Operations" },
  { id: "protocol", label: "Protocol details" },
  { id: "fallback", label: "When LSP is unavailable" },
];

const OPERATIONS = [
  ["definition", "path, line, character", "Jump to the definition of the symbol at the position"],
  ["references", "path, line, character", "Find references to the symbol — includes the declaration"],
  ["hover", "path, line, character", "Hover documentation for the symbol at the position"],
  ["document_symbols", "path", "All symbols in a single file"],
  ["workspace_symbols", "query", "Symbols across the workspace, matched by query"],
];

const LANGUAGE_IDS = [
  [".ts", "typescript"],
  [".tsx", "typescriptreact"],
  [".js", "javascript"],
  [".jsx", "javascriptreact"],
  [".py", "python"],
  [".rs", "rust"],
  [".go", "go"],
];

export default function Lsp() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">LSP navigation</span>
        </nav>

        <div className="hero">
          <h1>LSP navigation</h1>
          <p className="tagline">
            Wire up a language server and the agent gets real code intelligence — definitions, references, hover, and symbols — as read-only tools.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>What it gives you</h2>
          <p>
            With a language server configured, the agent gains five <b>read-only</b> code-intelligence
            operations: <code className="inline">definition</code>, <code className="inline">references</code>,{" "}
            <code className="inline">hover</code>, <code className="inline">document_symbols</code>, and{" "}
            <code className="inline">workspace_symbols</code>. These answer questions like "where is this
            function defined?" or "who calls this method?" with the precision of a real language server, instead
            of text-based guesswork.
          </p>
          <p>
            When no server is configured for a file, the agent falls back to <b>grep</b> — the LSP tool is a
            nice-to-have, never a hard dependency.
          </p>
        </section>

        <section id="configuration">
          <h2><span className="anchor">#</span>Configuration</h2>
          <p>
            Servers are declared under <code className="inline">settings.lsp.servers</code> in{" "}
            <code className="inline">settings.json</code>, <b>User scope only</b> (like hooks — the settings type
            marks them as user-scoped executable configuration). Each entry has a name, the command to spawn, and
            the file extensions it handles:
          </p>
          <CodeBlock lang="json">{`{
  "lsp": {
    "timeoutMs": 10000,
    "servers": [
      {
        "name": "typescript",
        "command": "typescript-language-server",
        "args": ["--stdio"],
        "extensions": [".ts", ".tsx"],
        "languageId": "typescript"
      }
    ]
  }
}`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Field</th><th style={{ width: "28%" }}>Type</th><th>Notes</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><code className="inline">name</code></td>
                  <td><code className="inline">string</code></td>
                  <td>Display name used in error messages.</td>
                </tr>
                <tr>
                  <td><code className="inline">command</code></td>
                  <td><code className="inline">string</code></td>
                  <td>Executable to spawn.</td>
                </tr>
                <tr>
                  <td><code className="inline">args</code></td>
                  <td><code className="inline">string[]</code></td>
                  <td>Optional arguments, e.g. <code className="inline">["--stdio"]</code>.</td>
                </tr>
                <tr>
                  <td><code className="inline">extensions</code></td>
                  <td><code className="inline">string[]</code></td>
                  <td>File extensions this server handles, e.g. <code className="inline">[".ts"]</code>. Matched case-insensitively.</td>
                </tr>
                <tr>
                  <td><code className="inline">languageId</code></td>
                  <td><code className="inline">string</code></td>
                  <td>Optional. Overrides the language ID sent in <code className="inline">didOpen</code>.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            When a tool call names a file, <code className="inline">findLspServer</code> picks the first server
            whose <code className="inline">extensions</code> include the file's extension. If{" "}
            <code className="inline">languageId</code> is not set, it is inferred from the extension (see below).
          </p>
        </section>

        <section id="languageids">
          <h2><span className="anchor">#</span>Language ID inference</h2>
          <p>
            Without an explicit <code className="inline">languageId</code>, the extension maps as follows:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "50%" }}>Extension</th><th>Language ID</th></tr>
              </thead>
              <tbody>
                {LANGUAGE_IDS.map(([ext, id]) => (
                  <tr key={ext}>
                    <td><code className="inline">{ext}</code></td>
                    <td><code className="inline">{id}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Any other extension falls back to <code className="inline">plaintext</code>.
          </p>
        </section>

        <section id="operations">
          <h2><span className="anchor">#</span>Operations</h2>
          <p>
            The <code className="inline">lsp</code> tool takes an <code className="inline">operation</code> plus
            the arguments shown below. Positions are <b>1-based</b> (line 1 is the first line), matching what a
            human sees in an editor:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Operation</th><th style={{ width: "30%" }}>Arguments</th><th>What it resolves to</th></tr>
              </thead>
              <tbody>
                {OPERATIONS.map(([op, args, what]) => (
                  <tr key={op}>
                    <td><code className="inline">{op}</code></td>
                    <td><code className="inline">{args}</code></td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">workspace_symbols</code> is the only operation that does not target a file —
            it uses the <b>first configured server</b> and searches the whole workspace by query.
          </p>
        </section>

        <section id="protocol">
          <h2><span className="anchor">#</span>Protocol details</h2>
          <p>
            The client speaks real LSP over <b>stdio</b>, with standard{" "}
            <code className="inline">Content-Length</code> message framing:
          </p>
          <ol>
            <li>Spawns the server with the configured command and args, cwd set to the workspace.</li>
            <li>Sends the <code className="inline">initialize</code> handshake with the workspace as root URI, followed by <code className="inline">initialized</code>.</li>
            <li>Opens the target file with <code className="inline">textDocument/didOpen</code>, sending its full content and inferred language ID.</li>
            <li>Issues the operation request, converting 1-based tool positions to the 0-based positions LSP expects (<code className="inline">line - 1</code>, <code className="inline">character - 1</code>).</li>
            <li>Shuts the server down cleanly after the response.</li>
          </ol>
          <p>
            Requests time out after <code className="inline">settings.lsp.timeoutMs</code>, defaulting to{" "}
            <b>10 seconds</b>. On timeout, the tool reports{" "}
            <code className="inline">LSP request timed out after {`{timeoutMs}`}ms</code>.
          </p>
        </section>

        <section id="fallback">
          <h2><span className="anchor">#</span>When LSP is unavailable</h2>
          <p>
            If no configured server supports the file's extension, the tool errors with a message telling the
            agent to configure <code className="inline">lsp.servers</code> in User settings — and, since the
            tool is read-only sugar, the agent simply uses <code className="inline">grep</code> instead.
          </p>
          <Note>
            Language servers are spawned per request and shut down afterward — there is no persistent server
            process. Expect a small startup cost per call; the timeout covers it.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
