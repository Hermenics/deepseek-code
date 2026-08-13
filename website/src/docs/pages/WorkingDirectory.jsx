import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "meaning", label: "What the working directory controls" },
  { id: "show", label: "Show the current directory" },
  { id: "change", label: "Change directories" },
  { id: "paths", label: "Path resolution rules" },
  { id: "reload", label: "What reloads" },
  { id: "conversation", label: "Conversation behavior" },
  { id: "guards", label: "When a change is refused" },
  { id: "worktrees", label: "Working directory vs worktree" },
  { id: "sessions", label: "Sessions and persistence" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const CONTROLS = [
  ["File tools", "The workspace boundary used to resolve and authorize reads, writes, patches, globbing and search."],
  ["Shell lines", "The directory used by commands entered with the ! prefix."],
  ["Project context", "The AGENTS.md, DEEPSEEK.md and .deepseek/ configuration loaded for the agent."],
  ["Extensions", "Project agents, workflows, skills, memory and enabled MCP servers discovered for the workspace."],
  ["Orchestration", "The project root attached to new tasks and workflow storage."],
  ["Session saves", "The workspace path recorded the next time the conversation is persisted."],
];

const ERRORS = [
  ["✗ Not a directory: …", "The path exists, but it is a file or another non-directory filesystem object."],
  ["✗ Cannot access: …", "The path does not exist, cannot be inspected, or the process lacks access."],
  ["Cannot change directory while a workflow is active", "Pause is not enough: finish or stop the active workflow before moving the workspace."],
  ["… task(s) are active", "A queued, running, paused or blocked task still belongs to the current project."],
  ["… task workspace(s) remain anchored …", "A completed task still owns an isolated workspace tied to the old project; integrate or clean it up first."],
];

export default function WorkingDirectory() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Working directory</span>
        </nav>

        <div className="hero">
          <h1>Working directory</h1>
          <p className="tagline">Inspect or rebase the live agent workspace with <code className="inline">/cwd</code> and <code className="inline">/cd</code>—without restarting the TUI.</p>
        </div>

        <section id="meaning">
          <h2><span className="anchor">#</span>What the working directory controls</h2>
          <p>
            DeepSeek Code has an <b>agent working directory</b>: the root against which its tools,
            project configuration and orchestration operate. It starts as the shell directory from
            which you launch <code className="inline">deepseek</code>, unless a resumed session supplies
            an existing saved workspace.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "25%" }}>Surface</th><th>Effect of the active directory</th></tr></thead>
            <tbody>{CONTROLS.map(([surface, effect]) => (
              <tr key={surface}><td><b>{surface}</b></td><td>{effect}</td></tr>
            ))}</tbody>
          </table></div>
          <Note>
            This is not merely a display preference. Before a mutating turn, verify the directory
            shown by <code className="inline">/cwd</code>; it defines the project safety boundary.
          </Note>
        </section>

        <section id="show">
          <h2><span className="anchor">#</span>Show the current directory</h2>
          <p>
            Run either command without an argument. Both names are identical; <code className="inline">/cd</code>
            is an alias, not a shell built-in.
          </p>
          <CodeBlock lang="text">{"> /cwd\ncwd: /home/you/projects/acme\n\n> /cd\ncwd: /home/you/projects/acme"}</CodeBlock>
          <p>
            The reported value is the agent workspace. It is the directory used by file tools and
            <code className="inline">!</code> shell lines, even though the DeepSeek Code process itself
            retains the directory from which it was launched.
          </p>
        </section>

        <section id="change">
          <h2><span className="anchor">#</span>Change directories</h2>
          <p>
            Pass one directory path. The command first resolves the path, verifies that it is an
            accessible directory, then rebases the agent and refreshes project-scoped discovery.
          </p>
          <CodeBlock lang="text">{"> /cwd /home/you/projects/payments\ncwd: /home/you/projects/payments\n\n> !pwd\n/home/you/projects/payments"}</CodeBlock>
          <p>
            Paths containing spaces can be entered directly because the slash-command parser rejoins
            all words after the command. Do <b>not</b> add shell quotes: slash commands are not parsed by
            a shell, so quote characters become part of the path.
          </p>
          <CodeBlock lang="text">{"> /cwd /home/you/Client Projects/Portal\ncwd: /home/you/Client Projects/Portal"}</CodeBlock>
        </section>

        <section id="paths">
          <h2><span className="anchor">#</span>Path resolution rules</h2>
          <p>
            Absolute paths are the safest choice. A leading <code className="inline">~</code> expands to
            the current <code className="inline">HOME</code>, so <code className="inline">~/code/api</code>
            works. Named-home forms such as <code className="inline">~alice/repo</code> are not supported.
          </p>
          <CodeBlock lang="text">{"> /cwd ~/code/api\ncwd: /home/you/code/api"}</CodeBlock>
          <p>
            A relative path is resolved against the <b>process launch directory</b>, not against the
            agent directory reported by the preceding <code className="inline">/cwd</code>. DeepSeek Code
            intentionally changes its internal workspace without calling the operating system&apos;s
            process-wide <code className="inline">chdir</code> operation.
          </p>
          <CodeBlock lang="text">{"$ cd /home/you/projects\n$ deepseek\n\n> /cwd /srv/acme/api\ncwd: /srv/acme/api\n\n> /cwd docs\ncwd: /home/you/projects/docs"}</CodeBlock>
          <Note>
            After moving once, keep using absolute paths. Treating a later relative path as relative
            to the displayed workspace can silently select a different existing directory.
          </Note>
        </section>

        <section id="reload">
          <h2><span className="anchor">#</span>What reloads</h2>
          <p>
            A successful directory change performs a project rebase. DeepSeek Code reloads the effective
            settings, steering files, <code className="inline">AGENTS.md</code>,
            <code className="inline">DEEPSEEK.md</code>, project memory and the MCP configuration for the
            target. It rebuilds the available tool set, runs configured session-start hooks, refreshes
            saved workflow commands and points orchestration at the new root.
          </p>
          <p>
            The active custom agent is cleared while the new project loads. If an enabled agent with the
            same name exists in the target registry, its target-specific definition is applied again;
            otherwise the main agent continues without that custom-agent allowlist or prompt.
          </p>
          <p>
            Because project settings are reapplied, the effective model, interaction mode, permissions,
            memory scope, agent limits and extension availability can change. Run
            <code className="inline">/system</code>, <code className="inline">/permissions</code> and
            <code className="inline">/tools</code> after a move when the two projects have different policy.
          </p>
        </section>

        <section id="conversation">
          <h2><span className="anchor">#</span>Conversation behavior</h2>
          <p>
            The terminal transcript remains on screen, but the <b>model-facing conversation is rebuilt</b>
            for the target project. The next request starts from the newly loaded system and project
            context rather than carrying the old project&apos;s agent history into the new workspace.
          </p>
          <p>
            This split is deliberate from a safety perspective: you can still read what happened before
            the move, while the model does not continue operating with stale instructions or tool results
            from another repository. If continuity matters, summarize the handoff in your next prompt.
          </p>
          <CodeBlock lang="text">{"> /cwd /home/you/projects/new-api\ncwd: /home/you/projects/new-api\n\n> We moved from the web app. Continue only with the API task: add request validation."}</CodeBlock>
          <Note>
            A directory change is not a new process or a new session ID. Token counters and other
            process-lifetime statistics may still include earlier work even though model context was reset.
          </Note>
        </section>

        <section id="guards">
          <h2><span className="anchor">#</span>When a change is refused</h2>
          <p>
            DeepSeek Code will not strand live orchestration in the old project. A change is rejected when
            a Dynamic Workflow is active, when any task has not reached a terminal state, or when a task
            workspace remains anchored to a different project. The current directory remains unchanged.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "39%" }}>Message</th><th>Meaning and recovery</th></tr></thead>
            <tbody>{ERRORS.map(([message, recovery]) => (
              <tr key={message}><td><code className="inline">{message}</code></td><td>{recovery}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            Use <code className="inline">/tasks</code> and <code className="inline">/workflows</code> to
            inspect live work. For task-owned worktrees, use the task integration or cleanup action before
            trying the move again.
          </p>
        </section>

        <section id="worktrees">
          <h2><span className="anchor">#</span>Working directory vs worktree</h2>
          <p>
            <code className="inline">/cwd</code> points the agent at an existing directory. It does not
            create a branch, copy files, preserve edits or register Git metadata. Use
            <code className="inline">/worktree</code> when you need an isolated Git workspace managed by
            DeepSeek Code.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "24%" }}>Command</th><th>Use it when</th><th>Git isolation</th></tr></thead>
            <tbody>
              <tr><td><code className="inline">/cwd &lt;path&gt;</code></td><td>The directory already exists and should become the project root.</td><td>None is created.</td></tr>
              <tr><td><code className="inline">/worktree</code></td><td>You want a managed isolated branch or copy for mutating work.</td><td>Created and tracked by the worktree manager.</td></tr>
              <tr><td><code className="inline">!cd …</code></td><td>Never for persistent navigation: the shell line runs in a child process.</td><td>No lasting effect.</td></tr>
            </tbody>
          </table></div>
        </section>

        <section id="sessions">
          <h2><span className="anchor">#</span>Sessions and persistence</h2>
          <p>
            Completed turns are saved under a directory bucket derived from the workspace path. After
            <code className="inline">/cwd</code>, the next completed main-agent turn records the new path
            and writes the current session ID under the new workspace bucket. An older copy under the
            former workspace may remain until retention or explicit cleanup removes it.
          </p>
          <p>
            Resume lookup is project-scoped. Start DeepSeek Code from the workspace to which the saved
            record belongs, then use <code className="inline">deepseek --resume</code> or an exact ID.
            See <a href="/docs/session-lifecycle">Session lifecycle</a> for save timing and resume behavior.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <h3>A relative path went somewhere unexpected</h3>
          <p>Run <code className="inline">/cwd</code>, then retry with a fully expanded absolute path. Relative slash-command paths use the directory from which the process started.</p>
          <h3>A path with spaces is rejected</h3>
          <p>Remove shell quotes and enter the path literally. The slash-command parser rejoins words but does not strip quotes or interpret escapes.</p>
          <h3>Tools changed after the move</h3>
          <p>This is expected when project settings, MCP servers, agent definitions or policy differ. Use <code className="inline">/tools</code> and <code className="inline">/permissions</code> to inspect the new effective surface.</p>
          <h3>The visible transcript exists, but the agent forgot it</h3>
          <p>The transcript and model history intentionally diverge across a project rebase. Restate only the context that is safe and relevant to the target repository.</p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
