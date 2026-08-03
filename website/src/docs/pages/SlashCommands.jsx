import { CodeBlock, Note, Toc } from "../Layout";

const ALL = [
  ["/model", "Switch model", "Cycle through available models for the current provider."],
  ["/agent", "Spawn a sub-agent", "Launch a focused sub-agent for a bounded task and return its result."],
  ["/memory", "Manage persistent memory", "Inspect, add, and remove facts the assistant remembers across sessions."],
  ["/plan", "Enter plan mode", "Switch to a read-only mode that can only write the designated plan file."],
  ["/review", "Code review", "Run a review pass over the current changes."],
  ["/vim", "Toggle vim keybindings", "Turn vim mode on or off for the TUI."],
  ["/theme", "Change color theme", "Switch the color theme of the interface."],
  ["/tools", "List available tools", "Show every tool the agent can call in this session."],
  ["/doctor", "System diagnostics", "Check runtime, workspace, credentials, settings, and MCP configuration."],
  ["/verify", "Run tests", "Detect and run the project's test command."],
  ["/sessions export <id> [json|md]", "Export a session", "Write a sanitized transcript of a session in JSON or Markdown."],
  ["/catalog", "Browse integrations", "Browse curated MCP, plugin, and skill integrations."],
  ["/marketplace", "Browse marketplace", "Discover installable integrations for the agent."],
  ["/permissions", "Explain permissions", "Explain the current mode, allow/deny rules, risk checks, and session approvals."],
  ["/config", "Open settings", "Open the fullscreen settings center."],
  ["/settings", "Open settings", "Alias for /config."],
  ["/help", "Show all commands", "Print the full list of available commands."],
];

const TOC = [
  { id: "intro", label: "How commands work" },
  { id: "full-list", label: "Full reference" },
];

export default function SlashCommands() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Slash commands</span>
        </nav>

        <div className="hero">
          <h1>Slash commands</h1>
          <p className="tagline">
            The complete reference for every slash command in DeepSeek Code.
          </p>
        </div>

        <section id="intro">
          <h2><span className="anchor">#</span>How commands work</h2>
          <p>
            Slash commands start with <code className="inline">/</code> and are typed directly in
            the TUI input. The command palette opens automatically when you type{" "}
            <code className="inline">/</code>, filtering commands as you type.
          </p>
          <CodeBlock lang="bash">$ deepseek
❯ /model</CodeBlock>
          <Note>
            Some commands take arguments — for example{" "}
            <code className="inline">/sessions export &lt;id&gt; json</code>.
          </Note>
        </section>

        <section id="full-list">
          <h2><span className="anchor">#</span>Full reference</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "32%" }}>Command</th>
                  <th>Summary</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {ALL.map(([cmd, summary, details]) => (
                  <tr key={cmd}>
                    <td><code className="inline">{cmd}</code></td>
                    <td>{summary}</td>
                    <td>{details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
