import { CodeBlock, Note, Toc, Icon } from "../Layout";

const GROUPS = [
  {
    title: "Control",
    items: [
      ["/plan <task>", "Enter plan mode for a task — read-only exploration that writes only the designated plan file, then shows an approval dialog"],
      ["/review [file]", "Run a code review of the current changes or a specific file"],
      ["/verify · /test", "Run the detected project test command after confirmation"],
      ["/permissions", "Show the current tool permission settings — mode, allow/deny rules, and risk checks"],
      ["/quit · /q", "Exit the application cleanly"],
      ["/clear", "Clear the chat history"],
      ["/undo [all|list]", "Restore the last file modified by the agent — 'all' restores everything, 'list' shows what can be undone"],
      ["/retry", "Re-run the last message"],
    ],
  },
  {
    title: "Agent & memory",
    items: [
      ["/agent <name>", "Load a custom agent (project or user directory)"],
      ["/agents", "List available custom agents"],
      ["/memory · /mem [clear [agent|user]]", "View or clear persistent memory — optionally clearing just the agent or user store"],
      ["/goal [<objective>|edit|pause|resume|clear] [--turns <n>]", "Set, view, or manage a persistent goal; --turns limits auto-continuations"],
      ["/model [name]", "Switch model — interactive picker without an argument, or directly by name"],
      ["/effort [low|high|max|auto]", "Set the reasoning effort level"],
      ["/btw <question>", "Ask a quick side question without interrupting the agent"],
    ],
  },
  {
    title: "Sessions & history",
    items: [
      ["/sessions [export <id> [json|md]]", "List recent sessions, or export a sanitized transcript of one"],
      ["/stats", "Show session statistics — tokens, cost, duration, tool calls"],
      ["/cost", "Show the estimated session cost"],
      ["/context · /ctx", "Show the context window usage breakdown (estimated)"],
      ["/files", "List the files modified by the agent this session"],
      ["/checkpoint [save [label]|list|restore <id>]", "Snapshot the session (save), list checkpoints, or restore one by id"],
      ["/compact", "Summarize history to save context window space"],
    ],
  },
  {
    title: "Customize",
    items: [
      ["/config · /settings", "Open the fullscreen settings center"],
      ["/gui", "Launch the local browser workspace in a separate web process and open it in the system browser"],
      ["/vim", "Toggle vim keybindings in the TUI"],
      ["/features · /experimental [flag] [on|off]", "List, toggle, or set experimental feature flags"],
      ["/mobile · /ios · /android", "Show a QR code to download the DeepSeek mobile app"],
    ],
  },
  {
    title: "Extend",
    items: [
      ["/skill · /skills", "Manage skills — install, list, remove, update"],
      ["/plugin · /plugins", "Manage plugins — install, list, remove, update"],
      ["/catalog · /marketplace [mcp|plugin|skill]", "Browse curated MCP, plugin, and skill integrations"],
    ],
  },
  {
    title: "Tasks & workflows",
    items: [
      ["/task <id> <action>", "Inspect or control a task — status, cancel, resume, result, message, integrate, cleanup"],
      ["/tasks", "Show the session task DAG"],
      ["/workflow run <name> [args] | pause|resume|stop|restart <run-id> | save <run-id> <name>", "Run or control a Dynamic Workflow"],
      ["/workflows", "Monitor Dynamic Workflow runs"],
    ],
  },
  {
    title: "Directory & isolation",
    items: [
      ["/cwd · /cd [path]", "Show or change the working directory"],
      ["/worktree · /wt [create|enter|exit|list|status]", "Create or manage an isolated Git worktree copy of the project"],
    ],
  },
  {
    title: "Inspect",
    items: [
      ["/tools", "List the tools available in this session"],
      ["/system", "Show the active interaction-mode and permission summary"],
      ["/doctor", "Check runtime, workspace, credentials, settings, and MCP configuration"],
      ["/logout", "Clear all stored credentials and API keys"],
      ["/help", "Show all commands"],
    ],
  },
];

const TOC = [
  { id: "palette", label: "Command palette" },
  { id: "custom", label: "Saved & custom commands" },
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
            Everything you can do from inside the DeepSeek Code TUI or Browser Workspace, grouped by intent.
          </p>
        </div>

        <section id="palette">
          <h2><span className="anchor">#</span>Command palette</h2>
          <p>
            Type <code className="inline">/</code> in the TUI or Browser Workspace composer to open the command palette
            and browse available commands. Commands are matched as you type, so you can jump to what you need without
            remembering the exact name.
          </p>
          <CodeBlock lang="bash">$ deepseek
❯ /</CodeBlock>
        </section>

        <section id="custom">
          <h2><span className="anchor">#</span>Saved and custom commands</h2>
          <p>
            In addition to the built-in set below, saved workflows and Markdown prompts in{" "}
            <code className="inline">.deepseek/commands/</code> or{" "}
            <code className="inline">~/.deepseek/commands/</code> can add slash-command suggestions. The Browser
            Workspace and TUI use the same resolver, so a discovered command has the same name and argument expansion
            in both interfaces.
          </p>
          <p>
            Built-ins win name collisions, followed by saved workflows and then custom commands. Custom command files
            support <code className="inline">$ARGUMENTS</code> and positional{" "}
            <code className="inline">$1</code>–<code className="inline">$9</code>; malformed or unsafe files are
            ignored. See <a href="/docs/slash-commands#custom">Custom commands</a> for limits and the file format.
          </p>
        </section>

        <section id="reference">
          <h2><span className="anchor">#</span>Reference</h2>
          <p>
            All 41 built-in commands, grouped by intent. Aliases are shown after the <code className="inline">·</code>.
          </p>
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
            Color theme and preferred language are configured in the settings center (<code className="inline">/config</code>),
            not as slash commands.
          </Note>
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
