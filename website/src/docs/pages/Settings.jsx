import { CodeBlock, Note, Toc, Icon } from "../Layout";

const TOC = [
  { id: "scopes", label: "Config scopes" },
  { id: "precedence", label: "Precedence" },
  { id: "secrets", label: "Secrets" },
  { id: "settings-center", label: "Settings center" },
  { id: "mcp", label: "MCP servers" },
  { id: "next", label: "Next steps" },
];

export default function Settings() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Settings</span>
        </nav>

        <div className="hero">
          <h1>Settings</h1>
          <p className="tagline">
            Configure DeepSeek Code at User, Project, or Local scope — with visible origins.
          </p>
        </div>

        <section id="scopes">
          <h2><span className="anchor">#</span>Config scopes</h2>
          <p>
            Non-secret preferences live in <code className="inline">settings.json</code> and are
            resolved across three scopes:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Scope</th>
                  <th>Where it lives</th>
                  <th>Use for</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><b>User</b></td><td><code className="inline">~/.deepseek/</code></td><td>Defaults for every project you open</td></tr>
                <tr><td><b>Project</b></td><td><code className="inline">.deepseek/</code> in the repo</td><td>Settings that travel with the project</td></tr>
                <tr><td><b>Local</b></td><td>Local, git-ignored overrides</td><td>Machine-specific tweaks (not committed)</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="precedence">
          <h2><span className="anchor">#</span>Precedence</h2>
          <p>
            When the same key exists in multiple scopes, the effective value is resolved as:
          </p>
          <CodeBlock lang="text">User &lt; Project &lt; Local</CodeBlock>
          <p>
            So <b>Local wins</b> over Project, which wins over User. The settings center shows the
            <b> origin</b> of every value, so you always know where a setting came from.
          </p>
        </section>

        <section id="secrets">
          <h2><span className="anchor">#</span>Secrets</h2>
          <p>
            Secrets — like provider API keys — are <b>never</b> stored in{" "}
            <code className="inline">settings.json</code>. They're saved only to:
          </p>
          <CodeBlock lang="bash">~/.deepseek/config.json</CodeBlock>
          <Note>
            Secrets stay out of the repo and out of logs. If you spot a key in a log, report it
            via the security policy.
          </Note>
        </section>

        <section id="settings-center">
          <h2><span className="anchor">#</span>Settings center</h2>
          <p>
            Open the fullscreen settings center with <code className="inline">/config</code> or{" "}
            <code className="inline">/settings</code>. It's searchable and adapts from three panes
            to a sequential flow on narrow terminals.
          </p>
        </section>

        <section id="mcp">
          <h2><span className="anchor">#</span>MCP servers</h2>
          <p>
            Project MCP servers are <b>off by default</b>. Enable them with the User-scoped{" "}
            <b>Enable project MCP servers</b> setting, then restart DeepSeek Code.
          </p>
          <Note>
            Browse integrations with <code className="inline">/catalog</code> or{" "}
            <code className="inline">/marketplace</code>.
          </Note>
        </section>

        <section id="next">
          <h2><span className="anchor">#</span>Next steps</h2>
          <div className="next-links">
            <a className="next-card" href="/docs/providers">
              <div className="nc-title">Providers <Icon.Arrow /></div>
              <div className="nc-desc">Configure authentication for each backend.</div>
            </a>
            <a className="next-card" href="/docs/commands">
              <div className="nc-title">Commands <Icon.Arrow /></div>
              <div className="nc-desc">Open settings from the palette.</div>
            </a>
          </div>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
