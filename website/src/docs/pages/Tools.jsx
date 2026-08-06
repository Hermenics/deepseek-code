import { CodeBlock, Note, Toc } from "../Layout";

const TOOL_GROUPS = [
  {
    title: "File operations",
    items: [
      ["ReadFile", "Read a file with 1-indexed line numbers — 200-line default window, read large files in ranges using start_line / end_line (the header hints the next start_line to continue)."],
      ["WriteFile", "Atomic full-file write that creates parent directories and returns a structured diff (added / removed / first-changed). Diffs are skipped for files over 5,000 lines."],
      ["EditFile", "Surgical per-line substring replacement — the most token-efficient file tool. Multiple old/new pairs per line, validated before applying, applied bottom-to-top; lines are split on newlines."],
      ["PatchFile", "Replace an exact string with new content. The match must appear exactly once — ambiguous matches fail with “be more specific”. Replacement is literal: $ patterns are never interpreted."],
      ["ReadFolder", "List directory contents (recursive option). Caps at 1,000 entries and depth 5, skipping blocked dirs and .cache."],
    ],
  },
  {
    title: "Search & shell",
    items: [
      ["Glob", "Find files matching a glob pattern via fast-glob with curated ignores (heavy dirs + lockfiles, binaries, media and other non-source files), dot:true, 500-file cap."],
      ["Grep", "Search file contents with grep -rn, optional include-glob filter, heavy-dir exclusions, 200-line cap and a 15s timeout. No matches is reported as such."],
      ["Shell", "Run a shell command — sandboxed with bubblewrap for non-coordinator profiles (no network or inherited secrets). 300s default timeout, 50k-char output cap; destructive commands are blocked unless coordinator-approved."],
      ["Git", "Structured git actions: status, diff, log (default 20), add, commit (message required), branch, stash, pull, push. Push uses --force-with-lease and auto-sets the upstream branch."],
    ],
  },
  {
    title: "Web & context",
    items: [
      ["WebFetch", "Fetch a URL — SSRF-hardened: DNS-pinned, blocks private / localhost / metadata IPs and fails closed on DNS failure. Strips HTML, follows up to 5 redirects, 15s timeout, 20k-char cap."],
      ["Memory", "Persistent memory across sessions, split into agent and user stores. Actions: add, replace, remove, list. 2,000-char cap per store, entries §-delimited, safety-filtered."],
      ["Todo", "Manage a task list visible in the TUI: add, update (pending | in_progress | done), clear, list."],
      ["UpdateKnowledge", "Record project knowledge into DEEPSEEK.md for future sessions — validated section names; creates the file with a header when it doesn't exist."],
      ["Introspect", "Return DeepSeek Code's embedded self-documentation. Note: that embedded doc is stale (version 0.2.0) — treat this website as the source of truth, not the tool."],
    ],
  },
  {
    title: "Code intelligence",
    items: [
      ["Lsp", "Read-only language-server queries: definition, references, hover, document_symbols, workspace_symbols. Requires settings.lsp.servers; 10s timeout; falls back to grep when unavailable."],
    ],
  },
  {
    title: "Goals & planning",
    items: [
      ["CreateGoal", "Set a goal with an objective and an optional tokenBudget. Fails if an unfinished goal already exists — complete or clear it first."],
      ["GetGoal", "Read the current goal: objective, status, tokens used, budget, time elapsed, and block reason."],
      ["UpdateGoal", "Move the goal to complete, paused, active, or blocked. Blocked requires a blocker and only sticks after 3 consecutive occurrences of the same blocker."],
      ["WritePlan", "Write the designated plan markdown file — only available in plan mode; the file path is managed internally."],
      ["SubmitPlan", "Signal that the plan file is complete at the designated path — pauses execution and shows the plan for user approval. No other tool should be called after it."],
    ],
  },
  {
    title: "Orchestration",
    items: [
      ["SubAgent", "Spawn a bounded specialist sub-agent: foreground or background, fresh or fork context, optional verify flag and dependencies, role reader | writer | executor | reviewer | unrestricted. 50-iteration cap; the result must follow the submit_result contract exactly once."],
      ["AskAgent", "Dispatch a question to a named specialist in the background, or broadcast:true to every enabled sub-agent. Responses arrive in the next turn as @agent notes."],
      ["MoA", "Mixture of agents — sends the prompt to up to 5 reference models in parallel (sha256-deduped), synthesizes with an aggregator. Defaults to deepseek-v4-flash + deepseek-v4-pro, temperature 0.4, 60s timeout."],
      ["Workflow", "Execute a user-authored JavaScript coordination program (export const meta, agent / parallel / pipeline / workflow helpers, top-level await). Bounded by timeoutMs, maxTokens and maxCostUsd; 17-agent cap."],
    ],
  },
];

const LIMITS = [
  ["grep", "200 result lines"],
  ["glob", "500 files"],
  ["read_file", "200-line window (per call)"],
  ["read_folder", "1,000 entries, depth 5"],
  ["shell", "50k output chars, 300s timeout"],
  ["web_fetch", "20k chars, 15s timeout"],
  ["subagent", "50 iterations per task"],
  ["moa", "60s timeout"],
];

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "groups", label: "Tool groups" },
  { id: "limits", label: "Limits" },
  { id: "contracts", label: "Tool contracts" },
  { id: "customize", label: "Extending tools" },
];

export default function Tools() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Tools</span>
        </nav>

        <div className="hero">
          <h1>Tools</h1>
          <p className="tagline">
            The 24 capabilities DeepSeek Code ships with out of the box.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Overview</h2>
          <p>
            Tools are how the agent acts on your behalf. Every tool below is enabled by default
            and can be gated, extended, or replaced through configuration and hooks.
          </p>
          <div className="tools-grid">
            {["ReadFile", "WriteFile", "EditFile", "PatchFile", "ReadFolder", "Glob", "Grep", "Lsp", "Shell", "Git", "WebFetch", "Memory", "Todo", "UpdateKnowledge", "Introspect", "CreateGoal", "GetGoal", "UpdateGoal", "WritePlan", "SubmitPlan", "SubAgent", "AskAgent", "MoA", "Workflow"].map((t) => (
              <span className="tool-chip" key={t}><span className="dot-tool" />{t}</span>
            ))}
          </div>
        </section>

        <section id="groups">
          <h2><span className="anchor">#</span>Tool groups</h2>
          {TOOL_GROUPS.map((g) => (
            <div key={g.title}>
              <h3>{g.title}</h3>
              <div className="doc-table-wrap">
                <table className="doc-table">
                  <thead>
                    <tr>
                      <th style={{ width: "18%" }}>Tool</th>
                      <th>What it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(([name, desc]) => (
                      <tr key={name}>
                        <td><code className="inline">{name}</code></td>
                        <td>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits</h2>
          <p>
            Tools are bounded so a runaway call can never hang the session. These are the
            built-in caps:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Tool</th>
                  <th>Limit</th>
                </tr>
              </thead>
              <tbody>
                {LIMITS.map(([tool, limit]) => (
                  <tr key={tool}>
                    <td><code className="inline">{tool}</code></td>
                    <td>{limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="contracts">
          <h2><span className="anchor">#</span>Tool contracts</h2>
          <p>
            Two guarantees apply to every tool call:
          </p>
          <ul>
            <li><b>Schema validation</b> — arguments are validated against the tool's JSON schema before execution.</li>
            <li><b>Path safety</b> — file-taking tools resolve every path through the safety layer: blocked dirs are <code className="inline">.agent</code>, <code className="inline">.claude</code>, <code className="inline">.kiro</code>, <code className="inline">.github</code>, <code className="inline">.deepseek</code>, <code className="inline">node_modules</code>, <code className="inline">dist</code>, <code className="inline">build</code> and <code className="inline">.git</code>; sensitive files (<code className="inline">.env*</code>, keys, credentials, and similar) are rejected outright.</li>
          </ul>
          <Note>
            Writes are atomic: content is staged to a temp file, validated, and renamed into
            place under a file lease, so a cancelled write can never corrupt a file.
          </Note>
        </section>

        <section id="customize">
          <h2><span className="anchor">#</span>Extending tools</h2>
          <p>
            Tools can be extended or replaced with <b>custom tools</b> defined by the project, and
            <b> pre/post hooks</b> run around tool execution to validate or transform results.
          </p>
          <CodeBlock lang="text">{`// a custom tool module
export default {
  name: "MyTool",
  description: "Does something useful",
  async execute(args) { /* ... */ },
};`}</CodeBlock>
          <Note>
            Use <code className="inline">/tools</code> inside a session to see which tools are
            active in the current project.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
