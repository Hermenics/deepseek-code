import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "scope", label: "Scope and activation" },
  { id: "startup", label: "Startup sequence" },
  { id: "turn", label: "Prompt and tool turn" },
  { id: "tools", label: "Tool boundaries" },
  { id: "compact", label: "Compaction" },
  { id: "agents", label: "Tasks and sub-agents" },
  { id: "workspace", label: "Directory and worktrees" },
  { id: "stop", label: "Stop and shutdown" },
  { id: "ordering", label: "Ordering rules" },
  { id: "not-wired", label: "Declared but not emitted" },
];

const PHASES = [
  ["Setup", "Agent initialization", "Matcher value is the initialization trigger.", "Observe"],
  ["InstructionsLoaded", "Each AGENTS.md or DEEPSEEK.md loaded", "Matcher value is session_start.", "Observe"],
  ["SessionStart", "After settings, instructions and tools are initialized", "Matcher value is startup/resume/clear/compact when supplied.", "Observe"],
  ["UserPromptSubmit", "At the beginning of each user turn", "Flat command list.", "Block or add context"],
  ["PermissionRequest", "When a tool or workflow needs permission", "Matcher value is the tool name.", "Allow or deny"],
  ["PreToolUse", "Before normal authorization and execution", "Matcher value is the tool name.", "Block or rewrite"],
  ["PostToolUse", "After a successful tool result", "Matcher value is the tool name.", "Observe"],
  ["PostToolUseFailure", "When tool execution throws", "Matcher value is the tool name.", "Observe"],
  ["PostToolBatch", "After a tool batch is appended to history", "Flat command list.", "Observe"],
  ["PreCompact / PostCompact", "Around manual or automatic compaction", "Matcher value is manual/auto.", "Pre blocks; Post observes"],
  ["Stop", "Before a turn is completed", "Flat command list.", "Continue with feedback"],
  ["SessionEnd", "During agent shutdown", "Matcher value is the shutdown reason.", "Observe"],
];

export default function HookLifecycle() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Extending</span><span className="sep">/</span><span className="current">Hook lifecycle</span>
        </nav>

        <div className="hero">
          <h1>Hook lifecycle</h1>
          <p className="tagline">
            Where each hook runs, which ones can stop progress, and how the agent avoids turning observation into an authorization bypass.
          </p>
        </div>

        <section id="scope">
          <h2><span className="anchor">#</span>Scope and activation</h2>
          <p>
            The active hook configuration is the effective User settings file at{" "}
            <code className="inline">~/.deepseek/settings.json</code>. Project and local settings may contain a
            <code className="inline">hooks</code> key for portability, but executable hook entries are reported as
            ignored and removed before the agent uses them.
          </p>
          <p>
            Hook library edits reload the active settings when the library closes. Reloading does not synthesize a
            SessionStart event, so an initialization hook will not run merely because you changed a setting.
          </p>
          <Note>
            Every active command is real shell execution with your account and environment. Review the command,
            timeout, matcher and scope together before enabling it.
          </Note>
        </section>

        <section id="startup">
          <h2><span className="anchor">#</span>Startup sequence</h2>
          <p>
            The agent builds settings, project instructions, memory and MCP/tool state before it begins normal work.
            The startup hooks observe those transitions in this order:
          </p>
          <CodeBlock lang="text">{'load settings and effective configuration\n  → Setup (trigger: init)\n  → load AGENTS.md / DEEPSEEK.md and project memory\n  → InstructionsLoaded for each loaded instruction file\n  → SessionStart (source: startup)\n  → accept user prompts'}</CodeBlock>
          <p>
            <code className="inline">Setup</code>, <code className="inline">InstructionsLoaded</code> and{" "}
            <code className="inline">SessionStart</code> are observational in the current startup path. A command
            failure is recorded and startup continues; it does not make the agent silently trust a failed setup hook.
          </p>
        </section>

        <section id="turn">
          <h2><span className="anchor">#</span>Prompt and tool turn</h2>
          <p>
            A normal turn begins with <code className="inline">UserPromptSubmit</code>. A blocking result rejects the
            prompt. <code className="inline">additionalContext</code> is appended to the effective model message,
            while the original text remains the user's recorded message.
          </p>
          <CodeBlock lang="text">{'user prompt\n  → UserPromptSubmit\n  → optional prompt hook context\n  → prompt refinement / model request\n  → tool calls, if any'}</CodeBlock>
          <p>
            Each tool call then passes the interaction-mode gate, permission hooks, ordinary authorization and
            <code className="inline">PreToolUse</code>. A hook approval means only that its own chain did not block;
            workspace containment, risk, permissions, external paths and confirmation still run afterward.
          </p>
        </section>

        <section id="tools">
          <h2><span className="anchor">#</span>Tool boundaries</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Boundary</th><th>Behavior</th></tr></thead>
              <tbody>
                {PHASES.slice(4, 9).map(([event, position, matcher, effect]) => <tr key={event}><td><code className="inline">{event}</code></td><td>{position}. {matcher} {effect}.</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">PreToolUse</code> is the special legacy-compatible runner: matching commands
            execute serially, and each <code className="inline">modified_input</code> becomes the next command's
            input. The final object is authorized and then executed.
          </p>
          <p>
            <code className="inline">PostToolUse</code> is fire-and-forget. It receives the effective input and the
            first 10,000 characters of the result, but it cannot block or replace a result already delivered. A
            thrown tool also emits <code className="inline">PostToolUseFailure</code> when configured.
          </p>
          <p>
            Parallel-safe tool calls finish as a batch and then emit <code className="inline">PostToolBatch</code>;
            sequential or mixed execution also emits the batch event after its results are appended. The payload
            contains the tool names, effective inputs, results and tool-use ids.
          </p>
        </section>

        <section id="compact">
          <h2><span className="anchor">#</span>Compaction</h2>
          <p>
            Both manual <code className="inline">/compact</code> and automatic context-threshold compaction carry a
            trigger value. <code className="inline">PreCompact</code> runs before the model summary request and can
            block it; <code className="inline">PostCompact</code> runs after the new boundary, summary and refreshed
            project instructions have been saved.
          </p>
          <CodeBlock lang="text">{'context threshold or /compact\n  → PreCompact (trigger: auto or manual)\n  → compaction model request\n  → boundary + summary + refreshed project context\n  → save history\n  → PostCompact'}</CodeBlock>
          <p>
            A failed PreCompact hook prevents the compaction operation. Automatic compaction catches that failure,
            increments its failure state and can disable automatic retries after the configured consecutive-failure
            limit; manual compaction reports the blocking error directly.
          </p>
        </section>

        <section id="agents">
          <h2><span className="anchor">#</span>Tasks and sub-agents</h2>
          <p>
            A delegated task emits <code className="inline">TaskCreated</code> before the worker starts. The worker
            then passes <code className="inline">SubagentStart</code>, matched by agent type. Either gate can block
            the task before it begins.
          </p>
          <p>
            On completion, the runtime emits <code className="inline">TaskCompleted</code> and{" "}
            <code className="inline">SubagentStop</code>. These are observational in the current integration. A
            sub-agent may use an isolated Git worktree; hook cwd fields identify the project or worker workspace
            supplied at that boundary.
          </p>
          <CodeBlock lang="text">{'TaskCreated\n  → SubagentStart\n  → worker acquires shared or Git-worktree workspace\n  → worker tools and nested lifecycle\n  → TaskCompleted\n  → SubagentStop'}</CodeBlock>
        </section>

        <section id="workspace">
          <h2><span className="anchor">#</span>Directory changes and worktrees</h2>
          <p>
            Changing the active directory reinitializes project context and then emits{" "}
            <code className="inline">CwdChanged</code> with <code className="inline">old_cwd</code> and{" "}
            <code className="inline">new_cwd</code>. The event observes the completed change.
          </p>
          <p>
            Managed Git worktree creation emits <code className="inline">WorktreeCreate</code> before the worktree is
            created; a blocking result aborts creation. Cleanup emits <code className="inline">WorktreeRemove</code>
            before removal and refuses cleanup when the hook blocks or the workspace no longer matches its recorded
            patch. <code className="inline">FileChanged</code> observes successful write, patch and edit operations.
          </p>
        </section>

        <section id="stop">
          <h2><span className="anchor">#</span>Stop and shutdown</h2>
          <p>
            Before a normal turn completes, flat <code className="inline">Stop</code> commands receive the last
            assistant message. A block does not immediately fail: the reason is inserted as feedback and the agent
            runs the loop again. A guard prevents the stop hook from recursively blocking its own continuation.
          </p>
          <p>
            <code className="inline">MessageDisplay</code> observes the final assistant message after stop handling.
            If the tool/model loop fails, <code className="inline">StopFailure</code> receives error details.
            Finally, agent shutdown runs <code className="inline">SessionEnd</code> once; shutdown catches hook
            failures so cleanup can continue.
          </p>
        </section>

        <section id="ordering">
          <h2><span className="anchor">#</span>Ordering and concurrency</h2>
          <ul className="capabilities">
            <li><b>PreToolUse:</b> serial within matcher and command order, because rewrites must flow into the next hook.</li>
            <li><b>PostToolUse:</b> launched without awaiting; side effects can overlap and must be idempotent or self-serialized.</li>
            <li><b>Lifecycle runner:</b> matching command/timeout duplicates are removed and the event group is dispatched together.</li>
            <li><b>Correlation:</b> commands in one event phase share a correlation id; every command has its own run id.</li>
            <li><b>Failure:</b> command failure blocks a gate, but an observational event cannot retroactively undo completed work.</li>
          </ul>
          <p>
            The hook audit is in-memory only and retains the newest 500 runs. There is no current slash command that
            exports this hook-specific buffer.
          </p>
        </section>

        <section id="not-wired">
          <h2><span className="anchor">#</span>Declared but not emitted</h2>
          <p>
            The settings schema accepts the following event names for compatibility and future wiring, but the current
            agent has no producer call site for them:
          </p>
          <CodeBlock lang="text">{'UserPromptExpansion\nNotification\nConfigChange\nDirectoryAdded\nElicitation\nElicitationResult\nTeammateIdle'}</CodeBlock>
          <Note>
            Do not use a configured-but-unemitted event as a policy boundary. Verify the lifecycle with a test command
            or choose an event that the current agent actually emits.
          </Note>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
