import { CodeBlock, Note, Toc, Icon } from "../Layout";

const GROUPS = [
  {
    title: "Control",
    items: [
      ["/plan", "Enter plan mode — read-only, writes only the designated plan"],
      ["/review", "Run a code review of the current changes"],
      ["/verify", "Run the detected project test command"],
      ["/permissions", "Explain mode, allow/deny rules, risk checks, and session approvals"],
    ],
  },
  {
    title: "Agent & memory",
    items: [
      ["/agent", "Spawn a sub-agent for a focused task"],
      ["/memory", "Manage persistent memory across sessions"],
      ["/sessions export <id> [json|md]", "Export a sanitized session transcript"],
    ],
  },
  {
    title: "Customize",
    items: [
      ["/model", "Switch model"],
      ["/theme", "Change color theme"],
      ["/vim", "Toggle vim keybindings"],
    ],
  },
  {
    title: "Inspect",
    items: [
      ["/tools", "List available tools"],
      ["/doctor", "Check runtime, workspace, credentials, settings, and MCP configuration"],
      ["/catalog, /marketplace", "Browse curated MCP, plugin, and skill integrations"],
      ["/config, /settings", "Open the fullscreen settings center"],
      ["/help", "Show all commands"],
    ],
  },
];

const TOC = [
  { id: "palette", label: "Command palette" },
  { id: "reference", label: "Reference" },
  { id: "next", label: "Next steps" },
];

export default function Commands() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Commands</span>
        </nav>

        <div className="hero">
          <h1>Commands</h1>
          <p className="tagline">
            Everything you can do from inside the DeepSeek Code TUI, grouped by intent.
          </p>
        </div>

        <section id="palette">
          <h2><span className="anchor">#</span>Command palette</h2>
          <p>
            Type <code className="inline">/</code> in the TUI to open the command palette and
            browse available commands. Commands are matched as you type, so you can jump to
            what you need without remembering the exact name.
          </p>
          <CodeBlock lang="bash">$ deepseek
❯ /</CodeBlock>
        </section>

        <section id="reference">
          <h2><span className="anchor">#</span>Reference</h2>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3>{g.title}</h3>
              <div className="doc-table-wrap">
                <table className="doc-table">
                  <thead>
                    <tr>
                      <th style={{ width: "38%" }}>Command</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(([cmd, desc]) => (
                      <tr key={cmd}>
                        <td><code className="inline">{cmd}</code></td>
                        <td>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <Note>
            See the <a href="/docs/slash-commands">Slash commands</a> page for the full list with
            details.
          </Note>
        </section>

        <section id="next">
          <h2><span className="anchor">#</span>Next steps</h2>
          <div className="next-links">
            <a className="next-card" href="/docs/slash-commands">
              <div className="nc-title">Slash commands <Icon.Arrow /></div>
              <div className="nc-desc">The complete command reference.</div>
            </a>
            <a className="next-card" href="/docs/tools">
              <div className="nc-title">Tools <Icon.Arrow /></div>
              <div className="nc-desc">What the agent can do for you.</div>
            </a>
          </div>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
