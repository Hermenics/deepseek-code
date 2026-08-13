import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "roots", label: "Persistent locations" },
  { id: "home", label: "The home directory" },
  { id: "project", label: "The project directory" },
  { id: "legacy-runtime", label: "The .deepseek-code directory" },
  { id: "config", label: "Config & credentials" },
  { id: "sessions", label: "Sessions & history" },
  { id: "memory", label: "Memory & steering" },
  { id: "extensions", label: "Agents, skills & workflows" },
  { id: "runtime", label: "Runtime state" },
  { id: "logs", label: "Logs & audit" },
  { id: "gitignore", label: "What to commit" },
  { id: "cleanup", label: "Safe cleanup" },
];

const HOME_TREE = [
  ["config.json", "file", "Private credentials plus legacy-compatible bootstrap values."],
  ["settings.json", "file", "User-level settings — the lowest-priority settings layer."],
  ["features.json", "file", "Feature-flag overrides. Unknown keys are filtered on load."],
  ["history.json", "file", "A bounded compatibility copy of recent agent messages; sessions are the resume source."],
  ["input_history.json", "file", "Your typed prompt history, recalled with the up arrow."],
  ["kernel.db", "file", "Only if the reference kernel subsystem is exercised. Not created in normal use."],
  ["sessions/", "dir", "One subdirectory per project, keyed by a readable project name."],
  ["memory/", "dir", "Facts persisted by the memory tool and auto memory."],
  ["agents/", "dir", "User-level custom agent definitions."],
  ["checkpoints/", "dir", "Conversation checkpoints. File backups use ~/.deepseek-code/checkpoints/."],
  ["logs/", "dir", "Append-only JSONL audit logs, one file per session."],
  ["workflows/", "dir", "User-level workflow definitions discovered after project workflows."],
  ["workflow-approvals.json", "file", "Approved workflow-script hashes, partitioned by project."],
  ["projects/", "dir", "Per-project and per-session workflow run journals used for deterministic replay."],
  ["task-snapshots/", "dir", "Restorable orchestration snapshots for resumed sessions."],
  ["last-update-check, update-cooldown", "file", "Update-notifier bookkeeping. Safe to delete."],
];

const PROJECT_TREE = [
  ["DEEPSEEK.md", "file", "Project instructions, loaded every session and re-injected after compaction."],
  ["settings.json", "file", "Project settings — commit this. Overrides user level."],
  ["settings.local.json", "file", "Local overrides — do not commit. Highest priority."],
  ["steering/*.md", "dir", "Every markdown file here is concatenated into the system prompt."],
  ["agents/", "dir", "Project-level agent definitions, shared with the team."],
  ["agents.local/", "dir", "Personal agent overrides that stay out of git."],
  ["skills/", "dir", "Skills installed for this checkout, plus their .registry.json index."],
  ["memory/", "dir", "Agent and user memory when memory.scope is project."],
  ["workflows/", "dir", "Saved workflow scripts."],
  ["mcp.json", "file", "MCP server definitions for this project."],
  ["worktrees/", "dir", "Git worktrees created for isolated parallel work."],
  ["worktree-state.json", "file", "Bookkeeping for active worktrees."],
  ["session-*.sanitized.{json,md}", "file", "Redacted exports produced by /sessions export."],
  ["settings-export-*.json", "file", "Secret-free effective-settings diagnostics."],
];

const LEGACY_RUNTIME_TREE = [
  ["plugins/", "Installed plugins and registry.json. Override with DEEPSEEK_PLUGINS_DIR."],
  ["checkpoints/", "Per-session file backups and manifests used by /undo."],
  ["memory/", "Legacy user memory imported into ~/.deepseek/memory when possible."],
];

const PRECEDENCE = [
  ["local", ".deepseek/settings.local.json", "Highest. Personal, uncommitted."],
  ["project", ".deepseek/settings.json", "Team-shared, committed."],
  ["user", "~/.deepseek/settings.json", "Lowest. Your defaults across all projects."],
];

const GITIGNORE = [
  [".deepseek/settings.json", "Commit", "Team configuration belongs in version control."],
  [".deepseek/DEEPSEEK.md", "Commit", "Project instructions are for everyone."],
  [".deepseek/steering/", "Commit", "Coding standards benefit the whole team."],
  [".deepseek/agents/", "Commit", "Shared agent definitions."],
  [".deepseek/workflows/", "Commit", "Shared workflow scripts."],
  [".deepseek/settings.local.json", "Ignore", "Personal overrides, often machine-specific paths."],
  [".deepseek/agents.local/", "Ignore", "Personal agent tweaks."],
  [".deepseek/worktrees/", "Ignore", "Working directories, not source."],
  [".deepseek/worktree-state.json", "Ignore", "Runtime bookkeeping."],
  [".deepseek/memory/", "Choose", "Commit only when project-scoped memory is intentionally shared."],
  [".deepseek/skills/", "Choose", "Installed content is executable guidance; review before sharing."],
  [".deepseek/session-*.sanitized.*", "Ignore", "Exports can still contain project conversation content."],
  [".deepseek/settings-export-*.json", "Ignore", "Machine-specific diagnostics, despite secret redaction."],
  [".plans/", "Ignore", "Plan-mode drafts are local working artifacts unless your team chooses otherwise."],
];

const CLEANUP = [
  ["~/.deepseek/logs/", "Safe", "Audit history only. Delete freely unless you need the trail."],
  ["~/.deepseek/checkpoints/", "Safe", "You lose saved conversation restore points from /checkpoint."],
  ["~/.deepseek-code/checkpoints/", "Safe", "You lose file-level /undo history."],
  ["~/.deepseek-code/plugins/", "Careful", "Installed plugins disappear until reinstalled."],
  ["~/.deepseek/sessions/", "Careful", "You lose /sessions and --resume for those projects."],
  ["~/.deepseek/memory/", "Careful", "You lose everything the memory tool learned."],
  ["~/.deepseek/kernel.db", "Safe", "Normally absent. Belongs to the reference kernel subsystem, not the runtime."],
  ["~/.deepseek/config.json", "Destructive", "You will be asked to configure a provider again."],
  [".deepseek/worktrees/", "Destructive", "Delete only via /worktree — raw rm can orphan git metadata."],
];

export default function DeepSeekDirectory() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Concepts</span><span className="sep">/</span><span className="current">The .deepseek directory</span>
        </nav>

        <div className="hero">
          <h1>The .deepseek directory</h1>
          <p className="tagline">
            A precise map of user state, project state, compatibility storage, plan files, version-control
            policy, and the consequences of cleanup.
          </p>
        </div>

        <section id="roots">
          <h2><span className="anchor">#</span>Persistent locations</h2>
          <p>
            DeepSeek Code uses a user directory, a project directory, and one compatibility/runtime
            directory. It also writes Plan-mode drafts to <code className="inline">&lt;project&gt;/.plans/</code>.
            These locations serve different lifetimes and do not mirror each other.
          </p>
          <p>
            <code className="inline">~/.deepseek/</code> is <b>yours</b>: credentials, defaults, history across
            every project, sessions, conversation checkpoints, workflow state, agents, and audit logs. It
            follows you between repositories.
          </p>
          <p>
            <code className="inline">&lt;project&gt;/.deepseek/</code> is <b>the project's</b>: instructions the
            model should read here, layered settings, agent definitions, skills, workflows, memory, worktrees,
            and diagnostic exports. Some entries are team configuration; runtime artifacts are not.
          </p>
          <Note>
            <code className="inline">~/.deepseek-code/</code> is not a typo. Plugins and file-level undo still
            use this compatibility root, while most current state lives under <code className="inline">~/.deepseek/</code>.
            See <a href="#legacy-runtime">the exact split</a> below.
          </Note>
        </section>

        <section id="home">
          <h2><span className="anchor">#</span>The home directory</h2>
          <CodeBlock lang="text">{`~/.deepseek/
├── config.json              private credentials + legacy bootstrap values
├── settings.json            user-level settings
├── features.json            feature flags
├── history.json             bounded compatibility copy of recent agent messages
├── input_history.json       your typed prompts
├── kernel.db                (reference subsystem only — normally absent)
├── sessions/                per-project session files
├── memory/                  user-scoped persisted facts
├── agents/                  user-level agent definitions
├── checkpoints/             conversation checkpoints
├── logs/                    session-*.jsonl audit trail
├── workflows/               user workflow definitions
├── workflow-approvals.json  approved workflow hashes
├── projects/                workflow run journals
└── task-snapshots/          resumable orchestration state`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Entry</th><th style={{ width: "12%" }}>Kind</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {HOME_TREE.map(([e, k, p]) => (
                  <tr key={e}>
                    <td><code className="inline">{e}</code></td>
                    <td>{k}</td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="project">
          <h2><span className="anchor">#</span>The project directory</h2>
          <CodeBlock lang="text">{`<project>/.deepseek/
├── DEEPSEEK.md              project instructions
├── settings.json            team settings (commit)
├── settings.local.json      personal overrides (ignore)
├── steering/*.md            standards injected into the prompt
├── agents/                  shared agent defs (commit)
├── agents.local/            personal agent defs (ignore)
├── skills/                  checkout-local installed skills
├── memory/                  optional project-scoped memory
├── workflows/               saved workflow scripts
├── mcp.json                 MCP server definitions
├── worktrees/               isolated git worktrees
└── worktree-state.json      worktree bookkeeping`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Entry</th><th style={{ width: "12%" }}>Kind</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {PROJECT_TREE.map(([e, k, p]) => (
                  <tr key={e}>
                    <td><code className="inline">{e}</code></td>
                    <td>{k}</td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Two of these directly shape what the model sees on every turn:{" "}
            <code className="inline">DEEPSEEK.md</code> and <code className="inline">steering/</code>. Everything
            else is configuration, extension content, or runtime state. Session and settings exports also
            appear here only after you explicitly request them.
          </p>
        </section>

        <section id="legacy-runtime">
          <h2><span className="anchor">#</span>The .deepseek-code directory</h2>
          <p>
            Two active subsystems still use <code className="inline">~/.deepseek-code/</code>. Do not merge
            this directory into <code className="inline">~/.deepseek/</code> by hand; each subsystem resolves
            its own path.
          </p>
          <CodeBlock lang="text">{`~/.deepseek-code/
├── plugins/                  installed plugins + registry.json
├── checkpoints/              file backups used by /undo
└── memory/                   legacy memory, imported when available`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "30%" }}>Entry</th><th>Purpose</th></tr></thead>
              <tbody>
                {LEGACY_RUNTIME_TREE.map(([entry, purpose]) => (
                  <tr key={entry}><td><code className="inline">{entry}</code></td><td>{purpose}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">DEEPSEEK_PLUGINS_DIR</code> relocates the plugin root only. It does not
            relocate file checkpoints or any state under <code className="inline">~/.deepseek/</code>.
          </p>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Config & credentials</h2>
          <p>
            Settings resolve across three levels. The loader reads all three, merges them, and records which
            level supplied each effective value:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Level</th><th style={{ width: "38%" }}>File</th><th>Precedence</th></tr>
              </thead>
              <tbody>
                {PRECEDENCE.map(([l, f, p]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{f}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">config.json</code> is separate from{" "}
            <code className="inline">settings.json</code> on purpose. Config is the private credential store:
            it may contain the DeepSeek API key, the Vertex service-account path and legacy bootstrap values.
            Settings hold the layered, mergeable, non-secret configuration surface. The credentials file is
            owner-readable only and must never be committed or shared.
          </p>
          <Note>
            Run <code className="inline">/doctor</code> to see the resolved value of every setting along with
            the level it came from. See <a href="/docs/debug-config">Debug your config</a>.
          </Note>
        </section>

        <section id="sessions">
          <h2><span className="anchor">#</span>Sessions & history</h2>
          <p>
            Sessions are stored per project under{" "}
            <code className="inline">~/.deepseek/sessions/&lt;readable-project-name&gt;/</code>. The project name
            is derived from the absolute workspace path, so two checkouts of the same repository in different
            directories keep separate session histories.
          </p>
          <p>
            Resuming reads the per-project session files. <code className="inline">history.json</code> is a
            bounded compatibility copy of recent agent messages, not the source selected by{" "}
            <code className="inline">--resume</code>. <code className="inline">input_history.json</code> is
            unrelated to the model transcript: it stores what <em>you</em> typed for arrow-key recall.
          </p>
          <p>
            A <code className="inline">.bak-&lt;timestamp&gt;</code> file next to{" "}
            <code className="inline">input_history.json</code> is a defensive backup written before a risky
            rewrite. It is safe to delete.
          </p>
        </section>

        <section id="memory">
          <h2><span className="anchor">#</span>Memory & steering</h2>
          <p>
            These are the two mechanisms people confuse, and the directory layout makes the difference clear:
          </p>
          <p>
            <code className="inline">~/.deepseek/memory/</code> is <b>written by the agent</b>. The memory tool
            and auto memory persist facts here, and they are injected into the system prompt inside{" "}
            <code className="inline">--- MEMORY ---</code> delimiters. You rarely edit these by hand.
          </p>
          <p>
            <code className="inline">&lt;project&gt;/.deepseek/steering/*.md</code> is <b>written by you</b>. Every
            markdown file in that directory is read and concatenated into the prompt at session start. There
            is no index and no frontmatter requirement — dropping a file in is the entire API.
          </p>
          <CodeBlock lang="bash">{`# a typical steering directory
.deepseek/steering/
├── architecture.md     # how the system is laid out
├── conventions.md      # naming, file size limits, test placement
└── review-checklist.md # what to check before saying "done"`}</CodeBlock>
          <p>
            See <a href="/docs/steering">Steering</a> for authoring guidance and{" "}
            <a href="/docs/memory">Memory</a> for the agent-written side.
          </p>
        </section>

        <section id="extensions">
          <h2><span className="anchor">#</span>Agents, skills & workflows</h2>
          <p>
            Agent definitions resolve through the same layering as settings: built-ins first, then{" "}
            <code className="inline">~/.deepseek/agents</code>, then <code className="inline">.deepseek/agents</code>,
            then <code className="inline">.deepseek/agents.local</code>. A definition at a later level can{" "}
            <code className="inline">extends</code> an earlier one rather than replacing it wholesale.
          </p>
          <p>
            Skills installed with <code className="inline">/skill</code> live in the current checkout at{" "}
            <code className="inline">.deepseek/skills/</code>. Its <code className="inline">.registry.json</code>
            records the source repository and exact installed commit. A legacy{" "}
            <code className="inline">.claude/skills/</code> install can still be listed and migrated on update.
            See <a href="/docs/skill-authoring">Skills</a>.
          </p>
          <p>
            Workflows are project-scoped in <code className="inline">.deepseek/workflows/</code> because a
            workflow encodes how <em>this</em> codebase gets work done.
          </p>
        </section>

        <section id="runtime">
          <h2><span className="anchor">#</span>Runtime state</h2>
          <p>
            <code className="inline">kernel.db</code> belongs to the{" "}
            <a href="/docs/kernel-persistence">reference kernel subsystem</a>, which nothing imports at
            runtime — so in normal use this file is <b>never created</b>. If you do see it, along with{" "}
            <code className="inline">kernel.db-wal</code> and <code className="inline">kernel.db-shm</code>, those
            are the WAL-mode companions of one database rather than leftovers, and all three should be
            treated as a unit.
          </p>
          <p>
            <code className="inline">task-snapshots/</code> holds resumable orchestrator state for sessions
            that opt into a snapshot path. Snapshots are written atomically, schema-validated on read, and
            redact credential-shaped values before persistence. Live task state otherwise remains in memory.
          </p>
          <p>
            <code className="inline">worktrees/</code> in the project holds real git worktrees. Never delete
            these with <code className="inline">rm -rf</code> — use <code className="inline">/worktree</code>, which
            also cleans up the git metadata pointing at them. See <a href="/docs/worktrees">Worktrees</a>.
          </p>
        </section>

        <section id="logs">
          <h2><span className="anchor">#</span>Logs & audit</h2>
          <p>
            <code className="inline">~/.deepseek/logs/session-&lt;id&gt;.jsonl</code> is an append-only audit trail,
            one JSON object per line, one file per session. It records session start, every tool call with
            its arguments, and every tool result with its duration.
          </p>
          <p>
            Secrets are redacted before anything is written. The log files are created with restrictive
            permissions, and nothing is ever rewritten in place — only appended. See{" "}
            <a href="/docs/monitoring-audit">Monitoring & audit</a> for the event schema.
          </p>
        </section>

        <section id="gitignore">
          <h2><span className="anchor">#</span>What to commit</h2>
          <p>
            The short rule: commit what describes the project, ignore what describes your machine.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Path</th><th style={{ width: "14%" }}>Action</th><th>Why</th></tr>
              </thead>
              <tbody>
                {GITIGNORE.map(([p, a, w]) => (
                  <tr key={p}>
                    <td><code className="inline">{p}</code></td>
                    <td><b style={{ color: "var(--text-strong)" }}>{a}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="text">{`# .gitignore
.deepseek/settings.local.json
.deepseek/agents.local/
.deepseek/worktrees/
.deepseek/worktree-state.json
.deepseek/memory/
.deepseek/session-*.sanitized.*
.deepseek/settings-export-*.json
.plans/`}</CodeBlock>
          <Note>
            <code className="inline">~/.deepseek/</code> never belongs in a repository. It is in your home
            directory precisely so it stays out of version control.
          </Note>
        </section>

        <section id="cleanup">
          <h2><span className="anchor">#</span>Safe cleanup</h2>
          <p>
            Disk pressure usually comes from audit logs, workflow journals, plugins, and file backups. Here
            is what you lose by deleting each persistent area:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Path</th><th style={{ width: "16%" }}>Risk</th><th>Consequence</th></tr>
              </thead>
              <tbody>
                {CLEANUP.map(([p, r, c]) => (
                  <tr key={p}>
                    <td><code className="inline">{p}</code></td>
                    <td><b style={{ color: "var(--text-strong)" }}>{r}</b></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Conversation checkpoints are capped at the 20 most recent entries. File-level undo backups and
            audit logs do not use that cap, so inspect those directories when storage grows unexpectedly.
            Logs do not rotate automatically; if you keep long-lived sessions, prune them on a schedule.
          </p>
          <CodeBlock lang="bash">{`# prune audit logs older than 30 days
find ~/.deepseek/logs -name 'session-*.jsonl' -mtime +30 -delete`}</CodeBlock>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
