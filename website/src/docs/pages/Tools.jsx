import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "how", label: "How tools work" },
  { id: "reading", label: "Reading & search" },
  { id: "writing", label: "Writing" },
  { id: "shell", label: "Shell & git" },
  { id: "nav", label: "Code navigation" },
  { id: "delegation", label: "Delegation" },
  { id: "interaction", label: "User interaction" },
  { id: "state", label: "Memory, goals & plans" },
  { id: "terminal", label: "Terminal-only tools" },
  { id: "risk", label: "Which tools trigger prompts" },
  { id: "compaction", label: "Which results get cleared" },
  { id: "restricting", label: "Restricting the tool set" },
];

const READ = [
  ["read_file", "path", "start_line, end_line", "Read a file. Defaults to a 200-line window from start_line."],
  ["read_folder", "path", "recursive", "List files and directories."],
  ["glob", "pattern", "cwd", "Find files matching a glob pattern."],
  ["grep", "pattern", "path, include", "Regex search. include filters by file glob, e.g. \"*.ts\"."],
  ["web_fetch", "url", "—", "Fetch a URL and return the page text."],
];

const WRITE = [
  ["write_file", "path, content", "—", "Write a file, creating parent directories as needed."],
  ["edit_file", "path, line, old, new", "—", "Line-addressed edits. old/new are parallel lists of substrings."],
  ["patch_file", "path, old_content, new_content", "—", "Exact string replacement."],
];

const SHELL = [
  ["shell", "command", "timeout", "Run a shell command. Default timeout 5 minutes. Worker tasks are sandboxed."],
  ["git", "action", "message, items, file, staged, n, create, switch, pop, force", "Structured git operations."],
];

const NAV = [
  ["lsp", "operation", "path, line, character, query", "Language-server operations: definitions, references, symbols."],
];

const DELEGATION = [
  ["subagent", "task", "role, mode, context, verify, agent, dependencies, timeoutMs, model", "Spawn a bounded specialist worker."],
  ["ask_agent", "question", "agent, broadcast", "Ask configured specialists in the background. Returns handles immediately."],
  ["moa", "prompt", "systemPrompt, referenceModels, aggregatorModel", "Several models answer independently; one synthesizes."],
  ["workflow", "script", "name", "Run a dynamic workflow script."],
];

const INTERACTION = [
  ["ask_user_questions", "questions", "1-4 question objects", "Pause the main session for structured user input: choice, text or yes/no."],
];

const STATE = [
  ["memory", "action, target", "content, match", "Read or modify the memory store. target is agent or user."],
  ["update_knowledge", "section, content", "—", "Record knowledge under a named section."],
  ["todo", "action", "title, id, status", "Manage the session todo list."],
  ["create_goal", "objective", "maxTokens", "Create a persistent goal with an optional token budget."],
  ["get_goal", "—", "—", "Read the current goal."],
  ["update_goal", "status", "blockedReason", "Update goal status. blockedReason is required when status is blocked."],
  ["write_plan", "content", "—", "Write a plan document."],
  ["submit_plan", "path", "summary", "Submit a written plan for approval."],
];

const TERMINAL_TOOLS = [
  ["submit_result", "Sub-agent workers", "The only way a worker terminates. Schema-validated, exactly once."],
  ["submit_verification", "Verifiers", "Returns CONFIRMED, PLAUSIBLE or REFUTED with a reason and evidence."],
  ["submit_workflow_result", "Workflow runs", "Terminates a workflow with its result."],
  ["introspect", "The agent itself", "Inspect the tool surface at runtime."],
];

const RISK_TOOLS = [
  ["shell", "high / medium", "rm, sudo, chmod, systemctl, package installs, deploys, git push/reset/clean."],
  ["git", "high", "push, pull and force-push are high risk even through the structured tool."],
  ["write_file", "high / medium", "Anything under .deepseek/, plus large overwrites and edit bursts."],
  ["edit_file", "high / medium", "Same paths and burst conditions as write_file."],
  ["patch_file", "high / medium", "Same paths and burst conditions as write_file."],
];

const COMPACTABLE = [
  "read_file", "grep", "glob", "list_files", "web_search", "web_fetch", "file_search", "directory_tree",
];

function ToolTable({ rows }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <thead>
          <tr>
            <th style={{ width: "16%" }}>Tool</th>
            <th style={{ width: "22%" }}>Required</th>
            <th style={{ width: "26%" }}>Optional</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([t, r, o, d]) => (
            <tr key={t}>
              <td><code className="inline">{t}</code></td>
              <td><code className="inline">{r}</code></td>
              <td>{o === "—" ? <span style={{ opacity: 0.5 }}>none</span> : <code className="inline">{o}</code>}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Tools() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Tools</span>
        </nav>

        <div className="hero">
          <h1>Tools</h1>
          <p className="tagline">
            Every capability the model can invoke, with its required and optional parameters, its risk
            level, and whether its output survives compaction.
          </p>
        </div>

        <section id="how">
          <h2><span className="anchor">#</span>How tools work</h2>
          <p>
            A tool is a named capability with a JSON schema. The model emits a{" "}
            <code className="inline">tool_call</code> with arguments; the executor resolves the name against a
            map built once at startup, runs it, and appends the result as a message with{" "}
            <code className="inline">role: "tool"</code> keyed by the originating{" "}
            <code className="inline">tool_call_id</code>.
          </p>
          <p>
            Every schema is sent to the provider on <b>every call</b>. That makes the enabled tool set a
            fixed cost on your context budget — usually the second-largest block after conversation history,
            visible as <b>Tools</b> in <a href="/docs/context-window">/context</a>. It is also the reason{" "}
            <a href="#restricting">restricting the tool set</a> is one of the few real levers on that cost.
          </p>
          <p>
            Before any tool runs it passes three gates: workspace containment, risk assessment, and
            permission resolution — plus any <a href="/docs/hooks">PreToolUse hook</a>. See{" "}
            <a href="/docs/how-it-works#gates">How it works</a>.
          </p>
        </section>

        <section id="reading">
          <h2><span className="anchor">#</span>Reading & search</h2>
          <ToolTable rows={READ} />
          <p>
            <code className="inline">read_file</code> defaults to a <b>200-line window</b>:{" "}
            <code className="inline">end_line</code> falls back to{" "}
            <code className="inline">start_line + 199</code> rather than to the end of the file. Reading a
            10,000-line file therefore costs 200 lines of context by default, not 10,000 — the model has to
            ask for more explicitly, which makes large reads a decision rather than an accident.
          </p>
          <p>
            <code className="inline">grep</code> takes <code className="inline">include</code> as a file glob,
            which is the parameter that most changes result quality.{" "}
            <code className="inline">include: "*.ts"</code> on a repository with a{" "}
            <code className="inline">node_modules</code> or a build directory is the difference between four
            matches and four hundred.
          </p>
          <CodeBlock lang="json">{`{ "name": "grep", "arguments": {
    "pattern": "refreshToken",
    "path": "src",
    "include": "*.ts"
} }`}</CodeBlock>
        </section>

        <section id="writing">
          <h2><span className="anchor">#</span>Writing</h2>
          <ToolTable rows={WRITE} />
          <p>
            Three write tools exist because they fail differently, and the choice matters.
          </p>
          <p>
            <code className="inline">write_file</code> replaces the whole file. Correct for new files,
            dangerous for existing ones — which is why a large overwrite is its own{" "}
            <a href="#risk">risk condition</a>.
          </p>
          <p>
            <code className="inline">patch_file</code> replaces an exact string. It fails loudly if the string
            is not found or is ambiguous, which is the property you want: a patch that silently applied to the
            wrong occurrence is worse than one that refused.
          </p>
          <p>
            <code className="inline">edit_file</code> is line-addressed and takes <b>parallel lists</b> —{" "}
            <code className="inline">old</code> and <code className="inline">new</code> are arrays of substrings
            applied at the given line. It is the right tool for several small edits in one pass.
          </p>
          <Note>
            Every write is preceded by an automatic file backup, which is what makes{" "}
            <code className="inline">/undo</code> work without any setup. See{" "}
            <a href="/docs/checkpointing">Checkpointing</a>.
          </Note>
        </section>

        <section id="shell">
          <h2><span className="anchor">#</span>Shell & git</h2>
          <ToolTable rows={SHELL} />
          <p>
            <code className="inline">shell</code> has a <b>five-minute default timeout</b>. Pass an explicit{" "}
            <code className="inline">timeout</code> for a command with a known shorter or longer bound, and use
            an observable background workflow for a service that is meant to keep running.
          </p>
          <p>
            When a worker task runs <code className="inline">shell</code>, it is sandboxed — cleared
            environment, private home and tmp, no network, namespace isolation. Testers additionally get a
            read-only project mount. If sandboxing is unavailable on the host, the tool returns an error
            rather than running unsandboxed. See <a href="/docs/agent-teams#sandbox">Agent teams</a>.
          </p>
          <p>
            <code className="inline">git</code> exists as a structured alternative to shelling out, with one
            parameter per operation rather than a command string. It is not a security boundary:{" "}
            <code className="inline">push</code>, force-push and <code className="inline">pull</code> are classified
            high risk <b>through this tool too</b>, precisely so the structured path is not a way around the
            confirmation.
          </p>
          <CodeBlock lang="json">{`{ "name": "git", "arguments": { "action": "commit", "message": "fix token refresh race" } }
{ "name": "git", "arguments": { "action": "diff", "staged": true } }
{ "name": "git", "arguments": { "action": "log", "n": 5 } }`}</CodeBlock>
        </section>

        <section id="nav">
          <h2><span className="anchor">#</span>Code navigation</h2>
          <ToolTable rows={NAV} />
          <p>
            <code className="inline">lsp</code> answers structural questions that grep cannot: where is this
            symbol defined, who references it, what symbols does this file export. Its parameter requirements
            vary by operation, and the schema says so explicitly —{" "}
            <code className="inline">path</code> is required except for{" "}
            <code className="inline">workspace_symbols</code>, and{" "}
            <code className="inline">line</code>/<code className="inline">character</code> are required except for{" "}
            <code className="inline">document_symbols</code> and <code className="inline">workspace_symbols</code>.
          </p>
          <p>
            Encoding conditional requirements in the description rather than the JSON schema is a pragmatic
            choice: JSON Schema can express it, but the resulting schema is large, and every byte is resent
            on every call. See <a href="/docs/lsp">LSP navigation</a>.
          </p>
        </section>

        <section id="delegation">
          <h2><span className="anchor">#</span>Delegation</h2>
          <ToolTable rows={DELEGATION} />
          <p>
            These four are how one session becomes several. <code className="inline">subagent</code> spawns a
            bounded worker and is the general case; <code className="inline">ask_agent</code> is the background
            question that returns a handle immediately; <code className="inline">moa</code> asks several models
            the same thing; <code className="inline">workflow</code> runs a deterministic script.
          </p>
          <p>
            All of them cost their own context rather than yours, which is the point. A sub-agent that reads
            twenty files returns a summary — your session pays for the conclusion, not the evidence.
          </p>
          <p>
            See <a href="/docs/subagents">Sub-agents</a>, <a href="/docs/moa">MoA</a>,{" "}
            <a href="/docs/parallel-tasks">Parallel tasks</a> and{" "}
            <a href="/docs/workflows">Workflows</a>.
          </p>
        </section>

        <section id="interaction">
          <h2><span className="anchor">#</span>User interaction</h2>
          <ToolTable rows={INTERACTION} />
          <p>
            <code className="inline">ask_user_questions</code> is available only in an interactive main session. It
            presents one to four questions together and supports <code className="inline">choice</code>,
            <code className="inline">text</code> and <code className="inline">yesno</code> types. Choice questions
            accept two to four options; a choice can be multi-select, and a free-form “Other” option is available
            where the interface supports it.
          </p>
          <p>
            Answers are returned as strings keyed by question index. Multi-select values are JSON-encoded arrays
            inside that string contract, so labels containing commas remain unambiguous. Esc or Ctrl+C returns a
            cancellation result; pipe mode and non-interactive workers receive an unavailable error instead of a
            hidden prompt.
          </p>
          <CodeBlock lang="json">{'{\n  "questions": [\n    {\n      "header": "Runtime",\n      "question": "Which runtime should this use?",\n      "type": "choice",\n      "options": [\n        { "label": "Bun", "description": "Fast JavaScript runtime." },\n        { "label": "Node", "description": "Broad ecosystem compatibility." }\n      ]\n    }\n  ]\n}'}</CodeBlock>
        </section>

        <section id="state">
          <h2><span className="anchor">#</span>Memory, goals & plans</h2>
          <ToolTable rows={STATE} />
          <p>
            <code className="inline">memory</code> takes a <code className="inline">target</code> that decides which
            store is written: <code className="inline">agent</code> for facts and conventions,{" "}
            <code className="inline">user</code> for preferences and style. Separating them means "this project
            uses Bun" and "this person prefers terse answers" do not travel together.
          </p>
          <p>
            <code className="inline">update_goal</code> has a conditional requirement worth noting:{" "}
            <code className="inline">blockedReason</code> is <b>required</b> when status is{" "}
            <code className="inline">blocked</code>. A goal cannot be marked blocked without saying by what,
            which is what makes a blocked goal actionable rather than just stalled.
          </p>
          <p>
            <code className="inline">write_plan</code> and <code className="inline">submit_plan</code> are a pair:
            one writes a plan document, the other submits it for approval with a one-line summary shown in
            the dialog header. That split is what allows plan mode to be read-only until you approve. See{" "}
            <a href="/docs/interaction-modes">Interaction modes</a>.
          </p>
        </section>

        <section id="terminal">
          <h2><span className="anchor">#</span>Terminal-only tools</h2>
          <p>
            Four tools are not part of the ordinary surface. They exist to <b>end</b> something, and are only
            available in the context that can end it:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Tool</th><th style={{ width: "22%" }}>Available to</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {TERMINAL_TOOLS.map(([t, a, p]) => (
                  <tr key={t}>
                    <td><code className="inline">{t}</code></td>
                    <td>{a}</td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">submit_result</code> is the one with real consequences. A worker must call
            it <b>exactly once</b> and the result must pass schema validation. Missing, repeated, mixed or
            invalid calls get one correction attempt, then fail as{" "}
            <code className="inline">INVALID_RESULT</code> with the raw content preserved. See{" "}
            <a href="/docs/parallel-tasks#envelope">the result envelope</a>.
          </p>
        </section>

        <section id="risk">
          <h2><span className="anchor">#</span>Which tools trigger prompts</h2>
          <p>
            Risk is assessed per tool <em>and per argument</em>, so the same tool can be silent or blocking
            depending on what it was asked to do:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Tool</th><th style={{ width: "18%" }}>Levels</th><th>Triggers</th></tr>
              </thead>
              <tbody>
                {RISK_TOOLS.map(([t, l, tr]) => (
                  <tr key={t}>
                    <td><code className="inline">{t}</code></td>
                    <td><code className="inline">{l}</code></td>
                    <td>{tr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Every other tool is <b>low risk by default</b> — reads, searches and navigation do not prompt
            unless a permission rule or workspace-containment check says otherwise.
          </p>
          <p>
            Two conditions are contextual rather than pattern-based:{" "}
            <code className="inline">large_overwrite</code> fires on a write above the configured line
            threshold, and <code className="inline">multi_edit_burst</code> fires when several edits happen in
            quick succession. Both catch the case where an individually reasonable operation becomes
            concerning at volume. See <a href="/docs/permissions">Permissions</a>.
          </p>
        </section>

        <section id="compaction">
          <h2><span className="anchor">#</span>Which results get cleared</h2>
          <p>
            Micro-compaction clears the contents of old tool results to reclaim context. It only touches
            tools whose output is <b>reproducible by re-running them</b>:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Compactable</th><th>Why safe</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{COMPACTABLE.map((t) => <code className="inline" key={t} style={{ marginRight: 6 }}>{t}</code>)}</td>
                  <td>All read-only. If the content is needed again it can simply be read again.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Results from <code className="inline">shell</code>, <code className="inline">git</code> and the write
            tools are <b>never</b> cleared. Discarding "created 3 files" or a test run's output destroys
            evidence the model cannot recover without causing side effects. See{" "}
            <a href="/docs/compaction">Compaction</a>.
          </p>
        </section>

        <section id="restricting">
          <h2><span className="anchor">#</span>Restricting the tool set</h2>
          <p>
            Fewer tools means a smaller fixed context cost and a narrower blast radius. Three mechanisms
            narrow it, and they compose:
          </p>
          <p>
            <b>Permission rules</b> deny a tool outright or restrict it to matching arguments. A deny rule
            cannot be suppressed at a narrower scope.
          </p>
          <p>
            <b>Agent definitions</b> declare a <code className="inline">tools</code> allowlist, so a named agent
            only ever sees what it needs.
          </p>
          <p>
            <b>Permission profiles</b> cap workers by role — a{" "}
            <code className="inline">researcher-readonly</code> worker has no write tools at all, regardless of
            what its task asks for.
          </p>
          <p>
            The final set a worker gets is the <b>intersection</b> of its role's tools, its profile's tools,
            and its parent's allowlist. Delegation can therefore only ever narrow privileges, never widen
            them. See <a href="/docs/agent-teams#profiles">Agent teams</a> and{" "}
            <a href="/docs/permissions">Permissions</a>.
          </p>
          <CodeBlock lang="bash">{`/tools          # what is enabled right now
/permissions    # effective allow, deny and risk rules`}</CodeBlock>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
