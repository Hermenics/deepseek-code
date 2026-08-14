import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "directory-map", label: "Directory map" },
  { id: "agent-loop", label: "The agent loop" },
  { id: "tool-pipeline", label: "Tool execution pipeline" },
  { id: "orchestration", label: "Multi-agent orchestration" },
  { id: "providers", label: "Providers" },
  { id: "workflows", label: "Dynamic workflows" },
  { id: "tests", label: "Testing" },
  { id: "future-wiring", label: "Not yet wired" },
];

const DIRECTORIES = [
  ["src/agent/", "Agent loop, LLM client, providers, session, memory, goals, plan mode, verification, worktree"],
  ["src/tools/", "24 agent tools — file, shell, git, grep, web, SubAgent, MoA, Workflow, Lsp, goals, todo, memory"],
  ["src/commands/", "40+ slash commands with parse-only contracts; side effects live in src/ui/App.tsx"],
  ["src/ui/", "TUI app layer (~9.5k lines): input, messages, setup wizard, monitors, plan view, design system"],
  ["src/ink/", "Vendored terminal renderer (~19.5k lines): reconciler, layout, cell-diff renderer, termio parser, events, selection, hyperlinks"],
  ["src/orchestration/", "Multi-agent runtime: TaskRegistry DAG, mailbox, git-worktree workspaces, file leases, snapshot persistence, events, review"],
  ["src/workflows/", "Dynamic workflow JS programs: discovery, parser, runtime sandbox, manager (journal + replay), storage, approvals"],
  ["src/kernel/", "Dormant reference subsystem — SQLite event sourcing, GoalEngine, HookRuntime, TaskBoard, ThreadRuntime, WorkflowEngine, PathOwnership"],
  ["src/plugins/ + src/skills/", "Plugin installer / registry remains metadata-only; native and project skills are loaded into the prompt and selected by description"],
  ["src/hooks/", "Pre/post tool hooks: matcher + executor, permission-based tool gating"],
  ["src/permissions/", "Permission rule matcher, risk scoring, explain"],
  ["src/settings/", "User / Project / Local scopes, loader, repository, writer"],
  ["src/services/", "Context compaction: autoCompact, microCompact, postCompactCleanup, summaryPrompt"],
  ["src/constants/", "Agent, tools and UI limits"],
  ["src/utils/", "Credentials, update-notifier, fs, env"],
  ["src/entrypoints/", "cli.tsx, pipe.ts"],
  ["tests/", "117 test files (bun test)"],
];

const PIPELINE = [
  ["1", "Mode gate", "canUseTool() rejects tools not available in the current interaction mode (plan / review are read-only). Blocked tools never trigger hooks."],
  ["2", "PreToolUse hooks", "May block a call or rewrite its arguments. Rewritten arguments are re-authorized — every later gate inspects the exact object that will execute."],
  ["3", "Workflow authorization", "For the workflow tool: SHA-256 hash of the script + persisted approval per project hash. DEEPSEEK_DISABLE_WORKFLOWS=1 disables dynamic workflows entirely."],
  ["4", "Risk assessment", "assessRisk() scores the call. High-risk rules are mandatory in every mode; approval keys are scoped per rule + content for the session."],
  ["5", "Path containment", "Paths outside the workspace require an explicit decision; a 'directory' grant applies to the whole tree for the session."],
  ["6", "Plan / review restrictions", "git is limited to status/diff/log; memory and todo only allow list actions."],
  ["7", "Permission rules", "deny / ask decisions from settings. autoApproveLowRisk skips the prompt for unrisky calls; an 'always' decision persists to user settings."],
  ["8", "Agent allowlist", "allowedTools from agent config; '*' means every tool prompts for confirmation."],
  ["9", "Undo snapshot + checkpoint", "Writes are captured for /undo and git checkpoints before execution."],
  ["10", "Execution + audit", "Tool runs, results are audit-logged, PostToolUse hooks fire (fire-and-forget)."],
];

const LIMITS = [
  ["maxTasks", "17", "Total tasks per session — the '17 agents' cap"],
  ["concurrency", "5", "FIFO scheduler: tasks running in parallel"],
  ["maxDepth", "2", "Maximum delegation depth below the root task"],
  ["maxFanOut", "5", "Sibling tasks per parent"],
  ["timeoutMs", "120_000", "Default per-task timeout"],
  ["maxRetries", "1", "Retries with exponential backoff (retryBackoffMs 250)"],
];

const PROVIDERS = [
  ["deepseek", "api.deepseek.com", "Streaming", "Native tool calling; reasoning_content preserved and passed back"],
  ["bedrock", "bedrock-mantle Chat Completions (V3.2/V3.1) or native InvokeModel (R1)", "DeepSeek streaming; R1 non-streaming", "Native for V3.x; R1 has no tool support — calls emulated via XML in the system prompt"],
  ["vertex", "Vertex AI OpenAI-compatible endpoint", "Non-streaming", "Emulated; GoogleAuth bearer token with a 1-hour cache (refreshed 5 min before expiry)"],
  ["local", "Any OpenAI-compatible endpoint (default http://localhost:11434/v1)", "Streaming", "Emulated"],
];

export default function Architecture() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Architecture</span>
        </nav>

        <div className="hero">
          <h1>Architecture</h1>
          <p className="tagline">
            How DeepSeek Code is put together: the vendored renderer, the agent loop, the authorization
            chain, and the multi-agent runtime — for contributors and advanced users.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Overview</h2>
          <p>
            DeepSeek Code is an <b>agentic coding CLI</b> built with <b>Bun</b> and{" "}
            <b>React 19</b>, driven by a terminal UI that does not depend on the npm{" "}
            <code className="inline">ink</code> package. Instead, it ships a{" "}
            <b>vendored, Ink-compatible terminal renderer</b> in <code className="inline">src/ink/</code>{" "}
            (~19,500 lines) — a full reimplementation covering the reconciler, flexbox layout via a{" "}
            native-ts Yoga binding, a cell-diff renderer, the termio parser, events, selection, and
            hyperlinks.
          </p>
          <p>
            On top of the renderer sits the <b>app layer</b> in <code className="inline">src/ui/</code>{" "}
            (~9,500 lines): the input box, message rendering, the setup wizard, monitors, and the design
            system. The rest of the tree implements the agent itself: the loop, tools, commands,
            permissions, settings, multi-agent orchestration, and dynamic workflows.
          </p>
          <Note>
            Everything in this page was verified against the source tree at version 0.6.3. Line counts
            are approximate (<code className="inline">wc -l</code> over <code className="inline">.ts*</code> files).
          </Note>
        </section>

        <section id="directory-map">
          <h2><span className="anchor">#</span>Directory map</h2>
          <p>The current layout of <code className="inline">src/</code>:</p>
          <CodeBlock lang="text">{`src/
├── agent/          # Agent loop, providers, session, memory, goals, plan mode
├── commands/       # 40+ slash commands (parse-only contracts)
├── constants/      # Agent / tools / UI limits
├── entrypoints/    # cli.tsx, pipe.ts
├── hooks/          # Pre/post tool hooks (matcher, executor)
├── ink/            # Vendored terminal renderer (~19.5k lines)
├── kernel/         # Reference-only dormant subsystem (not imported)
├── orchestration/  # Multi-agent: TaskRegistry DAG, mailboxes, worktrees
├── permissions/    # Rule matcher, risk scoring, explain
├── plugins/        # Installer / registry / validation (metadata only)
├── services/       # Compaction: autoCompact, microCompact, cleanup
├── settings/       # User / Project / Local scopes
├── skills/         # Skill loader plus installer / registry / validation
├── tools/          # 24 agent tools
├── ui/             # TUI app layer (~9.5k lines)
├── utils/          # Credentials, update-notifier, fs, env
└── workflows/      # Dynamic workflow runtime`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Directory</th><th>Responsibility</th></tr>
              </thead>
              <tbody>
                {DIRECTORIES.map(([d, r]) => (
                  <tr key={d}>
                    <td><code className="inline">{d}</code></td>
                    <td>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="agent-loop">
          <h2><span className="anchor">#</span>The agent loop</h2>
          <p>
            Each turn starts in <code className="inline">Agent.run()</code>{" "}
            (<code className="inline">src/agent/agent.ts</code>), which waits for{" "}
            <code className="inline">readyPromise</code> — settings, snapshots and project context —
            before touching turn state:
          </p>
          <ul className="capabilities">
            <li><b>Micro-compact</b> — stale read-only tool results are collapsed before any LLM round-trip (feature-flagged).</li>
            <li><b>Auto-compact</b> — when context usage is above threshold, with a circuit breaker that disables itself after repeated failures.</li>
            <li><b>Prompt refinement</b> — optional; prompts ≥ 30 characters are rewritten by a refiner model unless disabled.</li>
            <li><b>Loop</b> — up to <code className="inline">MAX_AGENT_ITERATIONS = 100</code> iterations.</li>
            <li><b>Streaming</b> — DeepSeek and local providers stream tokens; Bedrock R1 (InvokeModel) and Vertex fall back to non-streaming responses.</li>
            <li><b>Parallel calls</b> — a batch runs concurrently only when every tool is in the{" "}
              <code className="inline">PARALLEL_SAFE</code> set: <code className="inline">subagent</code>,{" "}
              <code className="inline">ask_agent</code>, <code className="inline">grep</code>,{" "}
              <code className="inline">glob</code>, <code className="inline">read_file</code>,{" "}
              <code className="inline">read_folder</code>, <code className="inline">web_fetch</code>,{" "}
              <code className="inline">introspect</code>. Everything else runs sequentially.</li>
            <li><b>completeTurn()</b> — finishes the turn with diff review (when enabled) and post-edit verification over the files this turn modified.</li>
          </ul>
          <p>
            API calls are wrapped in <code className="inline">withRetry()</code>: HTTP{" "}
            <b>429/503</b> responses retry with <code className="inline">[1000, 2000, 4000]</code> ms
            backoff, and aborts are never retried. For DeepSeek models, the model's{" "}
            <code className="inline">reasoning_content</code> field is preserved in message history and{" "}
            <b>passed back to the API on the assistant message</b> — the DeepSeek API rejects requests
            that drop it (a bug reproduced and pinned by a test).
          </p>
        </section>

        <section id="tool-pipeline">
          <h2><span className="anchor">#</span>Tool execution pipeline</h2>
          <p>
            Every tool call passes through <code className="inline">executeToolWithChecks()</code> — an
            ordered authorization chain. A call is authorized only if every gate lets it through; gates
            run on the exact, possibly hook-rewritten, arguments:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "6%" }}>#</th><th style={{ width: "22%" }}>Gate</th><th>Behavior</th></tr>
              </thead>
              <tbody>
                {PIPELINE.map(([n, g, b]) => (
                  <tr key={n}>
                    <td>{n}</td>
                    <td><b style={{ color: "var(--text-strong)" }}>{g}</b></td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            Deny decisions from inherited (higher-scope) settings cannot be suppressed by lower scopes —
            a property the permission tests pin down.
          </Note>
        </section>

        <section id="orchestration">
          <h2><span className="anchor">#</span>Multi-agent orchestration</h2>
          <p>
            Every sub-agent, reviewer, verifier and workflow agent is a{" "}
            <code className="inline">TaskRecordV1</code> in a <b>DAG</b> tracked by{" "}
            <code className="inline">TaskRegistry</code> (<code className="inline">src/orchestration/</code>).
            Tasks move through states{" "}
            <code className="inline">queued → running → blocked / done / failed / cancelled / timed_out</code>;
            dependencies are validated on registration, cancellation cascades to dependents, and retries
            use exponential backoff behind a FIFO scheduler:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Limit</th><th style={{ width: "20%" }}>Default</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([l, d, m]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{d}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <b>Writer agents</b> work in isolated <b>git worktrees</b> under{" "}
            <code className="inline">.deepseek/worktrees/</code>; their changes integrate via{" "}
            <code className="inline">git apply</code> under <b>file leases</b> — an atomic cross-process
            lease in the tmpdir with orphan reclamation. Sessions survive restarts through{" "}
            <b>task snapshots</b> at <code className="inline">~/.deepseek/task-snapshots/&lt;sha256&gt;.json</code>:
            written atomically (tmp + rename), secrets redacted, and the schema, graph and result
            envelopes strictly validated on load — tampered snapshots are rejected.
          </p>
        </section>

        <section id="providers">
          <h2><span className="anchor">#</span>Providers</h2>
          <p>
            <code className="inline">createLLMClient()</code> (<code className="inline">src/agent/llmClient.ts</code>)
            picks the transport for the configured provider:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "12%" }}>Provider</th><th>Endpoint</th><th style={{ width: "22%" }}>Streaming</th><th>Tool calling</th></tr>
              </thead>
              <tbody>
                {PROVIDERS.map(([p, e, s, t]) => (
                  <tr key={p}>
                    <td><code className="inline">{p}</code></td>
                    <td>{e}</td>
                    <td>{s}</td>
                    <td>{t}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Providers without native tool calling use <b>tool-call emulation</b>{" "}
            (<code className="inline">src/agent/providers/utils/prompt-emulation.ts</code>): a JSON{" "}
            <code className="inline">tool_use</code> protocol, <code className="inline">&lt;tool_call&gt;</code>{" "}
            tags, DeepSeek native markers, and DSML. Model output is repaired by a multi-stage JSON
            repair cascade (invalid backslashes, unquoted keys, trailing commas, truncation) and passed
            through an output sanitizer.
          </p>
        </section>

        <section id="workflows">
          <h2><span className="anchor">#</span>Dynamic workflows</h2>
          <p>
            Workflows (<code className="inline">src/workflows/</code>) are <b>user-authored JS programs</b> that
            declare <code className="inline">export const meta = {`{ name, description }`}</code>. A workflow runs
            inside a <b>VM worker sandbox</b>: no <code className="inline">process</code>,{" "}
            <code className="inline">require</code> or <code className="inline">fetch</code>, no constructor
            escapes, a <b>1-second synchronous execution limit</b>, and a 120-second overall timeout. The
            sandbox exposes the helpers <code className="inline">agent</code>,{" "}
            <code className="inline">parallel</code>, <code className="inline">pipeline</code>,{" "}
            <code className="inline">workflow</code>, <code className="inline">log</code>,{" "}
            <code className="inline">phase</code>, <code className="inline">args</code> and{" "}
            <code className="inline">budget</code>.
          </p>
          <p>
            Runs are <b>journaled</b>: the script, arguments and options are fingerprinted with SHA-256,
            so a journal can be <b>replayed without re-spending agents</b>. A run is capped at{" "}
            <b>17 agents</b> and persisted under{" "}
            <code className="inline">~/.deepseek/projects/&lt;hash&gt;/.../workflows/&lt;runId&gt;/</code>.
            Approvals are stored per project hash in{" "}
            <code className="inline">~/.deepseek/workflow-approvals.json</code>.
          </p>
        </section>

        <section id="tests">
          <h2><span className="anchor">#</span>Testing</h2>
          <p>
            The suite lives in <code className="inline">tests/</code> — <b>117 test files</b> run with{" "}
            <code className="inline">bun test</code>. Several behaviors are only observable through the
            tests:
          </p>
          <ul className="capabilities">
            <li><code className="inline">reasoning_content</code> must be passed back to the DeepSeek API — the 400 error this prevents was reproduced as a test.</li>
            <li><code className="inline">web_fetch</code> <b>pins DNS</b> — resolution is mocked via <code className="inline">dns/promises</code> to keep lookups under control.</li>
            <li>Inherited <code className="inline">deny</code> rules are never suppressible by lower scopes.</li>
            <li>HIGH-risk rules are mandatory in every interaction mode.</li>
            <li>Workflow sandbox <b>escape probes</b> assert the VM cannot reach host capabilities.</li>
            <li>Exports and snapshots are redacted — <code className="inline">[REDACTED]</code> is asserted in persistence tests.</li>
          </ul>
        </section>

        <section id="future-wiring">
          <h2><span className="anchor">#</span>Not yet wired</h2>
          <p>
            Two subsystems exist in the tree but are <b>not part of the running app</b>:
          </p>
          <ul className="capabilities">
            <li>
              <b>src/kernel/</b> — a dormant reference implementation (SQLite event sourcing, GoalEngine,
              HookRuntime, TaskBoard, ThreadRuntime, WorkflowEngine, PathOwnership). A grep of the source
              confirms <b>nothing imports it</b>. It is a design reference, not a feature.
            </li>
            <li>
              <b>src/plugins/ and src/skills/</b> — plugin components remain <b>metadata-only</b> in their
              registries, while native and project skills are loaded into the prompt and selected by their
              descriptions.
            </li>
          </ul>
          <Note>
            Treat the registries and standalone/plugin components as <i>future wiring</i>. If you are contributing, the live path is{" "}
            <code className="inline">entrypoints → ui → agent → tools</code> — the kernel and plugin
            registries will not execute your code.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
