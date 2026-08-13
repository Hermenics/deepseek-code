import { Note, Toc } from "../Layout";

const TOC = [
  { id: "core", label: "Core concepts" },
  { id: "context", label: "Context & memory" },
  { id: "orchestration", label: "Orchestration" },
  { id: "permissions", label: "Permissions & isolation" },
  { id: "extension", label: "Extension" },
  { id: "interface", label: "Interface" },
  { id: "confusions", label: "Commonly confused pairs" },
];

const CORE = [
  ["Agent", "The loop that calls a model, executes the tools it asks for, and repeats until it stops asking. Owns one orchestrator session.", "/docs/how-it-works"],
  ["Turn", "One user message and everything that follows until the model replies without tool calls. May contain many model calls.", "/docs/how-it-works"],
  ["Tool", "A named capability the model can invoke with structured arguments — read a file, run a shell command, search.", "/docs/tools"],
  ["Tool call / tool result", "The request and its paired response. Linked by tool_call_id; they must stay paired in history.", "/docs/how-it-works"],
  ["Session", "One run of the agent, with its history, token accounting and audit log.", "/docs/sessions-context"],
  ["Provider", "The service answering model calls: DeepSeek, Bedrock, Vertex, or a local endpoint.", "/docs/providers"],
  ["Effort", "How much deliberation the model spends per turn. Injected as a system-prompt hint by /effort.", "/docs/model-config"],
];

const CONTEXT = [
  ["Context window", "The token ceiling on everything sent per call: system prompt, tools, history, tool results.", "/docs/context-window"],
  ["Fixed floor", "The part of context that never shrinks — system prompt, memory, steering, tool schemas.", "/docs/context-window"],
  ["Compaction", "Replacing the conversation with a structured nine-section summary.", "/docs/compaction"],
  ["Micro-compaction", "Blanking the contents of old read-only tool results. No model call.", "/docs/compaction"],
  ["Boundary", "A local marker (__compact_boundary__) splitting compacted history from live history. Never sent to a provider.", "/docs/compaction"],
  ["Memory", "Facts the agent persists across sessions, injected between --- MEMORY --- delimiters.", "/docs/memory"],
  ["Steering", "Markdown files you write in .deepseek/steering/, concatenated into every session's prompt.", "/docs/steering"],
  ["Cached tokens", "The prompt prefix a provider served from its cache, billed at a lower rate.", "/docs/costs"],
];

const ORCH = [
  ["Task", "A unit of orchestrated work: stable id, state, deadline, workspace, permission profile, result envelope.", "/docs/parallel-tasks"],
  ["Sub-agent", "An agent loop running as a task, with fresh context and a narrowed tool set.", "/docs/subagents"],
  ["Coordinator", "The session that spawns tasks and receives their results. Your main session.", "/docs/agent-teams"],
  ["Worker", "A process executing one task, terminating by submitting a validated result.", "/docs/agent-teams"],
  ["Result envelope", "The versioned terminal record of a task: status, typed value, partial, artifacts, metrics, error.", "/docs/parallel-tasks"],
  ["Fresh vs fork", "Whether a worker gets only its task, or additionally receives prior results as untrusted JSON.", "/docs/agent-teams"],
  ["Mailbox", "The ordered, deduplicated, acknowledged channel between coordinator and workers.", "/docs/agent-messaging"],
  ["Integration", "Applying a worker's patch back into the project under a project-scoped lease.", "/docs/agent-teams"],
  ["MoA", "Mixture of Agents: several models answer independently, one synthesizes.", "/docs/moa"],
  ["Perspective", "One of the nine fixed review lenses — correctness, security, concurrency, and so on.", "/docs/code-review"],
  ["Classification", "A finding's verdict after verification: CONFIRMED, PLAUSIBLE or REFUTED.", "/docs/code-review"],
];

const PERMS = [
  ["Permission profile", "A capability envelope checked before allow rules: researcher-readonly, tester, writer-worktree, coordinator-integrator.", "/docs/agent-teams"],
  ["Risk rule", "A pattern classifying an operation as high, medium or low risk — rm, force-push, package installs.", "/docs/permissions"],
  ["Ask", "A permission decision requiring a human answer. Never treated as allow; blocks the whole tool-call batch.", "/docs/agent-messaging"],
  ["Grant", "A structured, sender-checked approval bound to an exact request id, tool and arguments.", "/docs/agent-messaging"],
  ["Suppress", "Removing an inherited allow rule at a narrower scope. Deny rules cannot be suppressed.", "/docs/permissions"],
  ["Worktree", "A second working directory on its own branch, sharing the repository's history.", "/docs/worktrees"],
  ["Lease", "A time-bound, pid-recorded claim on a resource. Serializes access when isolation is unavailable.", "/docs/kernel-persistence"],
  ["Isolation", "readonly-shared, git-worktree, or serialized-writer — how a task sees the filesystem.", "/docs/agent-teams"],
];

const EXT = [
  ["Skill", "One packaged procedure: a SKILL.md with frontmatter, installed from git and commit-pinned.", "/docs/skill-authoring"],
  ["Plugin", "A bundle of commands, agents, skills and hooks installed as one unit.", "/docs/plugin-authoring"],
  ["Hook", "A shell command run at PreToolUse, PostToolUse or SessionStart. Can approve or block.", "/docs/hooks"],
  ["Workflow", "A declarative script coordinating steps deterministically, which may spawn tasks.", "/docs/workflows"],
  ["Agent definition", "A JSON file describing a named agent: role, model, tools, profile, limits.", "/docs/agents"],
  ["MCP", "Model Context Protocol — connects external tool servers into the session.", "/docs/mcp"],
  ["Commit pin", "The exact commitHash recorded at install, making a plugin or skill reproducible.", "/docs/plugin-authoring"],
];

const UI = [
  ["TUI", "The terminal user interface, built with Ink.", "/docs/interface"],
  ["Slash command", "A command typed as /name that acts on the session rather than prompting the model.", "/docs/slash-commands"],
  ["Interaction mode", "How input is interpreted — normal, plan, vim and others.", "/docs/interaction-modes"],
  ["Plan mode", "A mode where the agent proposes a plan for approval before acting.", "/docs/interaction-modes"],
  ["Headless / pipe mode", "Running the agent as a Unix filter with --pipe. No interactivity.", "/docs/headless"],
  ["Diff review", "The end-of-turn consolidated view of files changed during that turn.", "/docs/how-it-works"],
  ["Goal", "A durable objective with checkable criteria that persists across turns.", "/docs/goals"],
  ["Checkpoint", "A conversation snapshot (/checkpoint) or a pre-edit file backup (behind /undo).", "/docs/checkpointing"],
];

const CONFUSED = [
  ["Task vs sub-agent", "A task is the accounting record. A sub-agent is one thing that can run inside it."],
  ["Task vs workflow", "A task is one unit of work. A workflow is a script that may create many."],
  ["Memory vs steering", "The agent writes memory. You write steering."],
  ["Steering vs DEEPSEEK.md", "Both are yours. Only DEEPSEEK.md is re-injected after compaction."],
  ["Verification vs verifier", "Verification runs your test command. A verifier independently checks an agent's claim."],
  ["Compaction vs micro-compaction", "Compaction summarizes with a model call. Micro-compaction blanks old tool results with none."],
  ["Skill vs plugin", "A skill is one capability. A plugin bundles many — and only a plugin can ship hooks."],
  ["Checkpoint vs file checkpoint", "One restores the conversation. The other restores files. Neither does both."],
  ["Profile vs role", "A profile is the runtime capability envelope. A role is the task-level intent that gets narrowed by it."],
];

function Table({ rows, term = "Term" }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <thead>
          <tr><th style={{ width: "22%" }}>{term}</th><th>Definition</th></tr>
        </thead>
        <tbody>
          {rows.map(([t, d, href]) => (
            <tr key={t}>
              <td><b style={{ color: "var(--text-strong)" }}>{t}</b></td>
              <td>
                {d}{" "}
                {href ? <a href={href}>→</a> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Glossary() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Glossary</span>
        </nav>

        <div className="hero">
          <h1>Glossary</h1>
          <p className="tagline">
            Every term this documentation uses with a specific meaning, defined once, with a link to the
            page that owns it.
          </p>
        </div>

        <section id="core">
          <h2><span className="anchor">#</span>Core concepts</h2>
          <Table rows={CORE} />
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Context & memory</h2>
          <Table rows={CONTEXT} />
          <Note>
            <b>Fixed floor</b> is the term that changes how people think about cost. Compaction shrinks the
            conversation; it never touches the floor. If the floor is large, the fix is editorial.
          </Note>
        </section>

        <section id="orchestration">
          <h2><span className="anchor">#</span>Orchestration</h2>
          <Table rows={ORCH} />
        </section>

        <section id="permissions">
          <h2><span className="anchor">#</span>Permissions & isolation</h2>
          <Table rows={PERMS} />
        </section>

        <section id="extension">
          <h2><span className="anchor">#</span>Extension</h2>
          <Table rows={EXT} />
        </section>

        <section id="interface">
          <h2><span className="anchor">#</span>Interface</h2>
          <Table rows={UI} />
        </section>

        <section id="confusions">
          <h2><span className="anchor">#</span>Commonly confused pairs</h2>
          <p>
            These pairs share a word or a shape and mean genuinely different things. Getting them straight
            resolves most of the confusion people hit in this documentation:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Pair</th><th>Distinction</th></tr>
              </thead>
              <tbody>
                {CONFUSED.map(([p, d]) => (
                  <tr key={p}>
                    <td><b style={{ color: "var(--text-strong)" }}>{p}</b></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            One theme runs through several of them: <b>who writes it</b>. Memory is written by the agent,
            steering by you. A grant is written by the coordinator, never synthesized from a worker's text. A
            message is data the recipient reads, not an instruction it obeys. When a term is ambiguous,
            asking who authored the thing usually resolves it.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
