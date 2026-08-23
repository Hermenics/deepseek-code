import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "how", label: "How slash commands work" },
  { id: "custom", label: "Custom commands" },
  { id: "aliases", label: "Aliases" },
  { id: "session", label: "Session & conversation" },
  { id: "context-cmds", label: "Context & cost" },
  { id: "files", label: "Files & recovery" },
  { id: "agents", label: "Agents & tasks" },
  { id: "workflows", label: "Workflows & goals" },
  { id: "extend", label: "Plugins, skills & MCP" },
  { id: "config", label: "Configuration" },
  { id: "inspect", label: "Inspection & diagnostics" },
  { id: "misc", label: "Everything else" },
];

const ALIASES = [
  ["/cwd", "/cd", "Show or change working directory"],
  ["/context", "/ctx", "Context window usage breakdown"],
  ["/features", "/experimental", "Toggle experimental feature flags"],
  ["/mobile", "/ios, /android", "QR code for the mobile app"],
  ["/catalog", "/marketplace", "Curated MCP, plugin and skill recommendations"],
  ["/memory", "/mem", "View or clear persistent memory"],
  ["/plugin", "/plugins", "Manage plugins"],
  ["/skill", "/skills", "Manage skills"],
  ["/quit", "/q", "Exit"],
  ["/config", "/settings", "Fullscreen settings center"],
  ["/verify", "/test", "Run the project test command"],
  ["/worktree", "/wt", "Create or manage an isolated project copy"],
];

const SESSION = [
  ["/clear", "—", "Clear chat history. The system prompt, memory and tools remain."],
  ["/compact", "—", "Summarize history into a nine-section summary to save context."],
  ["/retry", "—", "Re-run the last message."],
  ["/sessions", "export <id> md|json", "List sessions, or export one sanitized."],
  ["/checkpoint", "save [label] · list · restore <id>", "Snapshot or restore the conversation."],
  ["/quit", "—", "Exit the application."],
];

const CONTEXT_CMDS = [
  ["/context", "—", "Category breakdown of context usage, with reduction suggestions."],
  ["/cost", "—", "Estimated session cost from token usage."],
  ["/stats", "—", "Session statistics."],
  ["/effort", "<level>", "Set reasoning effort. Rebuilds the system prompt hint."],
  ["/model", "[name]", "Switch model interactively or by name."],
];

const FILES = [
  ["/files", "—", "List files modified this session."],
  ["/undo", "· all · list", "Restore the last modified file, all of them, or list entries."],
  ["/cwd", "[path]", "Show or change the working directory."],
  ["/worktree", "create · list · enter <name> · exit [keep] · status", "Isolated git worktrees. Aliases: ls, leave."],
  ["/verify", "—", "Run the project's detected test command after confirmation."],
  ["/review", "[path]", "Multi-agent review of the project or one path."],
];

const AGENTS = [
  ["/agent", "<name>", "Load a custom agent."],
  ["/agents", "—", "List available agents."],
  ["/task", "<id> status|cancel|resume|result|message|integrate|cleanup", "Inspect or control one task."],
  ["/tasks", "—", "Render the session task DAG with live state."],
  ["/btw", "<question>", "Ask a quick side question without interrupting the agent."],
  ["/plan", "<task>", "Read-only exploration ending in an approval dialog."],
];

const WORKFLOWS = [
  ["/workflow", "run <name> [args-json] · save <run-id> <name> · pause|resume|stop|restart <run-id>", "Run or control a dynamic workflow."],
  ["/workflows", "—", "Monitor workflow runs."],
  ["/goal", "[<objective> [--turns <n>]] · clear · edit · pause · resume", "Set, view or manage a persistent goal."],
];

const EXTEND = [
  ["/plugin", "install <owner/repo> · list · remove <name> · update <name> · help", "Manage plugins."],
  ["/skill", "install <owner/repo> · list · remove <name> · update <name> · help", "Manage skills."],
  ["/catalog", "—", "Curated MCP, plugin and skill recommendations."],
];

const CONFIG_CMDS = [
  ["/config", "—", "Open the fullscreen settings center."],
  ["/permissions", "—", "Show tool permission settings."],
  ["/features", "[flag] [on|off]", "List or toggle experimental feature flags."],
  ["/memory", "· clear", "View or clear persistent memory."],
  ["/vim", "—", "Toggle vim keybindings."],
  ["/logout", "—", "Clear all stored credentials and API keys."],
];

const INSPECT = [
  ["/doctor", "—", "Check runtime, workspace, credentials and MCP setup."],
  ["/system", "—", "Show the active mode and permission summary."],
  ["/tools", "—", "List available tools."],
  ["/help", "—", "Show available commands."],
];

const MISC = [
  ["/mobile", "—", "QR code to download the DeepSeek mobile app."],
  ["/gui", "—", "Open the local browser workspace; the TUI owns and cleans up the child process."],
];

function CmdTable({ rows }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <thead>
          <tr>
            <th style={{ width: "16%" }}>Command</th>
            <th style={{ width: "34%" }}>Arguments</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([c, a, d]) => (
            <tr key={c}>
              <td><code className="inline">{c}</code></td>
              <td>{a === "—" ? <span style={{ opacity: 0.5 }}>none</span> : <code className="inline">{a}</code>}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SlashCommands() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Slash commands</span>
        </nav>

        <div className="hero">
          <h1>Slash commands</h1>
          <p className="tagline">
            41 built-in commands that act on the session rather than prompting the model — plus saved workflows and
            custom prompt commands — with their arguments,
            subcommands and aliases.
          </p>
        </div>

        <section id="how">
          <h2><span className="anchor">#</span>How slash commands work</h2>
          <p>
            A recognized message starting with <code className="inline">/</code> is parsed by the command
            layer instead of being sent verbatim as an ordinary prompt. The resolver checks built-ins first,
            then saved workflows and custom command files. Some handlers are local and
            token-free, while commands such as <code className="inline">/btw</code>,{" "}
            <code className="inline">/plan</code>, <code className="inline">/review</code>, and workflow actions
            can deliberately invoke a model or tool and therefore consume resources.
          </p>
          <p>
            Each command owns a <code className="inline">parse()</code> function that turns its arguments into
            a typed action. That is why argument handling is consistent: an unknown subcommand produces an
            error naming the valid ones rather than a generic failure, and a missing argument usually means
            "show me" rather than "do the default thing".
          </p>
          <CodeBlock lang="text">{`/features                    → list
/features microCompact       → toggle
/features microCompact off   → set
/features nonsense           → Unknown flag: nonsense. Available: wordDiff, …`}</CodeBlock>
          <p>
            Confirmation is command-specific. <code className="inline">/verify</code> asks before running the
            detected test command and worktree cleanup refuses unsafe removal, but{" "}
            <code className="inline">/logout</code> and <code className="inline">/memory clear</code> act
            immediately. Read destructive command syntax before submitting it. See{" "}
            <a href="/docs/commands">Commands</a> for the conceptual overview and{" "}
            <a href="/docs/cli-reference">CLI reference</a> for flags you pass at launch.
          </p>
        </section>

        <section id="custom">
          <h2><span className="anchor">#</span>Custom commands</h2>
          <p>
            Add a reusable prompt as a Markdown file in <code className="inline">.deepseek/commands/</code> for a
            project command, or <code className="inline">~/.deepseek/commands/</code> for a user command. The filename
            becomes the slash name; optional frontmatter supplies the palette description:
          </p>
          <CodeBlock lang="markdown">{`---
description: Review the current diff
---

Inspect the current diff and focus on $ARGUMENTS.`}</CodeBlock>
          <p>
            <code className="inline">$ARGUMENTS</code> expands to all trailing arguments.{" "}
            <code className="inline">$1</code> through <code className="inline">$9</code> expand positional arguments;
            if the prompt has no placeholder, trailing arguments are appended as an{" "}
            <code className="inline">Arguments:</code> block. A custom command is submitted as an ordinary agent
            prompt, so it may use the model and tools.
          </p>
          <p>
            Project directories are discovered from the current directory upward until the repository&apos;s{" "}
            <code className="inline">.git</code>; the nearest project command wins over a parent or user command with
            the same name. Names must be lowercase kebab-case, files must be Markdown no larger than 128&nbsp;KB, and a
            directory contributes at most 256 entries. Unsafe paths, symlinks escaping the command root and malformed
            files are ignored. Suggestions refresh when the working directory or worktree changes.
          </p>
          <Note>
            Built-in commands take precedence over saved workflows, and saved workflows take precedence over custom
            commands. Custom commands are available in the Browser Workspace through the shared resolver.
          </Note>
        </section>

        <section id="aliases">
          <h2><span className="anchor">#</span>Aliases</h2>
          <p>
            Twelve commands have shorter or more familiar names. They are exact synonyms, not variants:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "18%" }}>Command</th>
                  <th style={{ width: "26%" }}>Alias</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {ALIASES.map(([c, a, p]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td><code className="inline">{a}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Two patterns are visible in that list. Some aliases exist because the plural is what people
            type — <code className="inline">/plugins</code>, <code className="inline">/skills</code>. Others
            exist because another tool trained your fingers: <code className="inline">/cd</code> for{" "}
            <code className="inline">/cwd</code>, <code className="inline">/settings</code> for{" "}
            <code className="inline">/config</code>, <code className="inline">/test</code> for{" "}
            <code className="inline">/verify</code>.
          </p>
          <Note>
            <code className="inline">/mobile</code> answers to both <code className="inline">/ios</code> and{" "}
            <code className="inline">/android</code>, because you know which phone you have and not what the
            command is called.
          </Note>
        </section>

        <section id="session">
          <h2><span className="anchor">#</span>Session & conversation</h2>
          <CmdTable rows={SESSION} />
          <p>
            <code className="inline">/clear</code> and <code className="inline">/compact</code> both free
            context and are not interchangeable. Compaction spends a model call to <b>preserve</b> what
            happened as a structured summary; clearing discards it. When you are moving to unrelated work,
            clearing is better — summarizing work you are abandoning is pure waste. See{" "}
            <a href="/docs/compaction">Compaction</a>.
          </p>
          <p>
            <code className="inline">/sessions export</code> takes a format:{" "}
            <code className="inline">md</code> for reading, <code className="inline">json</code> for processing.
            Exports are sanitized rather than raw dumps.
          </p>
          <CodeBlock lang="bash">{`/checkpoint save before refactor # labelled snapshot
/checkpoint list                # newest first, max 20 kept
/checkpoint restore 1754923000000-9f2a1c`}</CodeBlock>
        </section>

        <section id="context-cmds">
          <h2><span className="anchor">#</span>Context & cost</h2>
          <CmdTable rows={CONTEXT_CMDS} />
          <p>
            <code className="inline">/context</code> is the diagnostic one. It reports the exact
            provider-reported total plus a proportional breakdown across System Prompt, Memory, Tools,
            Messages, Tool Results and Free — and generates suggestions when one category dominates. See{" "}
            <a href="/docs/context-window">Context window</a>.
          </p>
          <p>
            <code className="inline">/effort</code> changes the system prompt and, for DeepSeek or Bedrock,
            provider reasoning parameters. Cache reuse after that change is provider-specific. See{" "}
            <a href="/docs/model-config">Model configuration</a>.
          </p>
        </section>

        <section id="files">
          <h2><span className="anchor">#</span>Files & recovery</h2>
          <CmdTable rows={FILES} />
          <p>
            <code className="inline">/worktree</code> has the richest subcommand set, and two of them have
            aliases of their own — <code className="inline">ls</code> for{" "}
            <code className="inline">list</code> and <code className="inline">leave</code> for{" "}
            <code className="inline">exit</code>:
          </p>
          <CodeBlock lang="bash">{`/worktree create        # generated name, new branch, enter it
/worktree list          # or /worktree ls
/worktree enter <name>
/worktree exit          # removes it — refuses if there are uncommitted changes
/worktree exit keep     # leave it on disk
/worktree status`}</CodeBlock>
          <p>
            The refusal on uncommitted changes is not overridable. Commit, stash, or exit with{" "}
            <code className="inline">keep</code>. See <a href="/docs/worktrees">Worktrees</a>.
          </p>
        </section>

        <section id="agents">
          <h2><span className="anchor">#</span>Agents & tasks</h2>
          <CmdTable rows={AGENTS} />
          <p>
            <code className="inline">/task</code> is the control surface for one task, and its subcommands map
            onto the task lifecycle:
          </p>
          <CodeBlock lang="bash">{`/task t-4f21 status              # full record: attempts, errors, usage, workspace
/task t-4f21 result              # the typed result envelope
/task t-4f21 message allow shell # grant a pending permission request
/task t-4f21 resume              # continue the same handle
/task t-4f21 integrate           # apply the worker's patch
/task t-4f21 cleanup             # remove the worktree, when safe`}</CodeBlock>
          <p>
            <code className="inline">message</code> accepts free text as an answer to a question, or the
            structured forms <code className="inline">allow &lt;tool&gt;</code> and{" "}
            <code className="inline">deny &lt;tool&gt;</code> as permission grants. Grants are bound to the exact
            request — see <a href="/docs/agent-messaging">Agent messaging</a>.
          </p>
          <p>
            <code className="inline">/btw</code> opens a dedicated side-answer panel while the main turn keeps
            its own state. The answer is a single tool-free model response over a safe conversation snapshot;
            it is not injected into the next main-agent turn. See{" "}
            <a href="/docs/side-questions">Side questions</a>.
          </p>
        </section>

        <section id="workflows">
          <h2><span className="anchor">#</span>Workflows & goals</h2>
          <CmdTable rows={WORKFLOWS} />
          <p>
            <code className="inline">/workflow</code> covers a full run lifecycle —{" "}
            <code className="inline">run</code>, <code className="inline">pause</code>,{" "}
            <code className="inline">resume</code>, <code className="inline">stop</code>,{" "}
            <code className="inline">restart</code>, plus <code className="inline">save</code> to persist a script
            to <code className="inline">.deepseek/workflows/</code>.
          </p>
          <p>
            <code className="inline">/goal</code> takes an objective plus an optional{" "}
            <code className="inline">--turns</code> budget, and can be cleared, edited, paused and resumed. A
            goal persists across turns and is checked against its criteria — see{" "}
            <a href="/docs/goals">Goals</a>.
          </p>
          <CodeBlock lang="bash">{`/goal migrate every callsite to the new token store --turns 20
/goal pause
/goal resume
/goal clear`}</CodeBlock>
        </section>

        <section id="extend">
          <h2><span className="anchor">#</span>Plugins, skills & MCP</h2>
          <CmdTable rows={EXTEND} />
          <p>
            <code className="inline">/plugin</code> and <code className="inline">/skill</code> share the same
            verb set deliberately — <code className="inline">install</code>, <code className="inline">list</code>,{" "}
            <code className="inline">remove</code>, <code className="inline">update</code>,{" "}
            <code className="inline">help</code>. Both install from a{" "}
            <code className="inline">owner/repo</code> slug and pin the exact commit.
          </p>
          <CodeBlock lang="bash">{`/plugin install acme/release-tools
/plugin list
/plugin update release-tools

/skill install acme/agent-skills
/skill list`}</CodeBlock>
          <p>
            The repo slug is validated against a strict pattern before anything is cloned — it becomes part
            of a filesystem path and a git argument. See{" "}
            <a href="/docs/plugin-authoring">Plugin authoring</a> and{" "}
            <a href="/docs/skill-authoring">Skill authoring</a>.
          </p>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Configuration</h2>
          <CmdTable rows={CONFIG_CMDS} />
          <p>
            <code className="inline">/logout</code> clears <b>all</b> stored credentials and API keys, not just
            the active provider. It is the one command here you cannot undo from inside the session — you
            reconfigure from scratch.
          </p>
          <p>
            <code className="inline">/memory clear</code> wipes the persistent memory store. Memory is written
            by the agent across sessions, so clearing it is closer to "forget this project" than to a cache
            flush. See <a href="/docs/memory">Memory</a>.
          </p>
        </section>

        <section id="inspect">
          <h2><span className="anchor">#</span>Inspection & diagnostics</h2>
          <CmdTable rows={INSPECT} />
          <p>
            When something behaves unexpectedly, the order is{" "}
            <code className="inline">/doctor</code> → <code className="inline">/system</code> →{" "}
            <code className="inline">/context</code>: environment, then what the model actually sees, then what
            it costs. See <a href="/docs/debug-config">Debug your config</a>.
          </p>
        </section>

        <section id="misc">
          <h2><span className="anchor">#</span>Everything else</h2>
          <CmdTable rows={MISC} />
          <p>
            That is the full built-in set. Saved workflows and custom project/user commands may add more suggestions;
            plugin command definitions can still be inventoried, but the current runtime does not register them into
            this command palette.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
