import { CodeBlock, Note, Toc } from "../Layout";

const ALL = [
  ["/help", "Show available commands", "Prints the full command list in the TUI."],
  ["/model [name]", "Switch model", "No argument opens the interactive model picker; a name switches directly to that model."],
  ["/clear", "Clear chat history", "Clears the in-memory conversation and the agent's history."],
  ["/compact", "Summarize history", "Compacts the conversation — history is replaced by a summary to free context window space."],
  ["/plan <task>", "Enter plan mode", "Switches to plan mode for the task: read-only exploration that can only write the designated plan file, then shows an approval dialog."],
  ["/review [file]", "Code review", "Runs a senior-reviewer pass over the project or a specific file — bugs, quality, performance, security, and suggested fixes."],
  ["/config · /settings", "Open settings", "Opens the fullscreen settings center: models, theme, language, keys, and other preferences."],
  ["/agent <name>", "Load a custom agent", "Loads a custom agent JSON for the session — from the project, user, or local agents directory."],
  ["/agents", "List agents", "Lists the available custom agents from all sources."],
  ["/vim", "Toggle vim keybindings", "Turns vim input mode on or off for the TUI."],
  ["/quit · /q", "Exit", "Exits the application cleanly — restores the cursor and prints the resume command for the session."],
  ["/checkpoint [save [label]|list|restore <id>]", "Manage checkpoints", "save snapshots the session state (optionally with a label), list shows saved checkpoints, restore <id> reloads one."],
  ["/sessions [export <id> [json|md]]", "List or export sessions", "No arguments lists recent sessions. export writes a sanitized transcript of the 12-character session id in JSON or Markdown (default md)."],
  ["/undo [all|list]", "Restore agent file changes", "Restores the last file the agent modified. all restores every agent change; list shows what can be undone."],
  ["/retry", "Re-run last message", "Reruns the previous user message through the agent."],
  ["/cost", "Show session cost", "Shows the estimated cost of the current session."],
  ["/files", "List session file changes", "Lists the files the agent modified this session."],
  ["/tools", "List available tools", "Shows every tool the agent can call in this session."],
  ["/doctor", "System diagnostics", "Checks runtime, workspace, credentials, settings, and MCP configuration."],
  ["/verify · /test", "Run tests", "Detects the project test command and runs it after confirmation."],
  ["/catalog · /marketplace [mcp|plugin|skill]", "Browse integrations", "No argument opens the curated list; a kind filters to MCP, plugin, or skill integrations."],
  ["/system", "Show system prompt", "Prints the active system prompt of the current agent."],
  ["/permissions", "Show tool permissions", "Shows the current tool permission settings — mode, allow/deny rules, and risk checks."],
  ["/btw <question>", "Ask a side question", "Asks a quick question in the background without interrupting the agent's current work."],
  ["/stats", "Show session statistics", "Shows tokens, cost, duration, and tool calls for the session."],
  ["/memory · /mem [clear [agent|user]]", "View or clear memory", "No arguments shows the persistent memory. clear wipes it — optionally just the agent store or the user store."],
  ["/effort [low|high|max|auto]", "Set reasoning effort", "Sets the reasoning effort level. No argument (or status) shows the current level; auto resets to the default."],
  ["/skill · /skills", "Manage skills", "install <owner/repo> installs a skill from GitHub; list shows installed skills; remove <name> and update <name> manage them (names must be kebab-case)."],
  ["/plugin · /plugins", "Manage plugins", "Same actions as /skill but for plugins: install <owner/repo>, list, remove <name>, update <name>."],
  ["/context · /ctx", "Show context usage", "Shows the estimated context window usage breakdown."],
  ["/tasks", "Show session tasks", "Inspects the session task DAG — the sub-agent and workflow tasks spawned this session."],
  ["/task <id> <action>", "Inspect or control a task", "status (default) shows the task; cancel stops it; resume restarts it; result returns its output; message <text> sends it a message; integrate merges its result; cleanup removes it."],
  ["/cwd · /cd [path]", "Show or change directory", "No path prints the current working directory; a path changes the agent's working directory."],
  ["/worktree · /wt [create|enter|exit|list|status]", "Manage worktrees", "Bare /worktree creates a new isolated Git worktree. enter <name> switches into one, exit [keep] leaves it (optionally keeping changes), list and status show the worktrees."],
  ["/mobile · /ios · /android", "Mobile app QR code", "Shows a QR code to download the DeepSeek mobile app."],
  ["/logout", "Clear credentials", "Removes all stored credentials and API keys from disk."],
  ["/features · /experimental [flag] [on|off]", "Toggle feature flags", "No arguments lists the experimental flags. A flag alone toggles it; on/off sets it explicitly."],
  ["/goal [<objective>|edit|pause|resume|clear] [--turns <n>]", "Manage a persistent goal", "No arguments shows the current goal; edit, pause, resume, and clear manage it. Any other text sets a new objective — append --turns <n> to limit auto-continuations."],
  ["/workflow run <name> [args] | pause|resume|stop|restart <run-id> | save <run-id> <name>", "Run or control a workflow", "run executes a saved Dynamic Workflow (optional JSON args); pause, resume, stop, and restart control a run by id; save stores a finished run under a name."],
  ["/workflows", "Monitor workflow runs", "Shows the Dynamic Workflow runs for the session."],
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
          <ul>
            <li><b>Dispatch</b> — input is trimmed and matched exactly (after the <code className="inline">/</code>) against every registered command name and alias. There is no fuzzy matching: <code className="inline">/model</code> is a command, <code className="inline">/models</code> is not.</li>
            <li><b>Workflow fallback</b> — if no command matches, the input is resolved against your saved Dynamic Workflows: <code className="inline">/&lt;workflow-name&gt;</code> runs that workflow, with any remaining text passed as arguments.</li>
            <li><b>Palette &amp; autocomplete</b> — the palette suggests every command name and alias, plus discovered workflow names, as you type.</li>
          </ul>
          <CodeBlock lang="bash">$ deepseek
❯ /model</CodeBlock>
          <Note>
            Some commands take arguments — for example{" "}
            <code className="inline">/sessions export &lt;id&gt; json</code>.
          </Note>
        </section>

        <section id="full-list">
          <h2><span className="anchor">#</span>Full reference</h2>
          <p>
            All 40 commands. Aliases are shown after the <code className="inline">·</code>.
          </p>
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
