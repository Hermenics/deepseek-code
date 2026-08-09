import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Why delegate" },
  { id: "subagent-tool", label: "The subagent tool" },
  { id: "verification", label: "Verification triggers" },
  { id: "builtins", label: "Built-in agents" },
  { id: "roles", label: "Roles & least privilege" },
  { id: "limits", label: "Limits" },
  { id: "askagent", label: "Background questions (ask_agent)" },
  { id: "moa", label: "Mixture of Agents (moa)" },
  { id: "config", label: "Connecting to agent config" },
];

const TRIGGERS = [
  ["Files changed &amp; confidence &lt; 0.7", "A sub-agent that touched files but isn't sure gets an independent check"],
  ["More than 2 issues &amp; confidence &lt; 0.8", "Many findings with moderate confidence also trigger one"],
  ["verify: true", "Explicit opt-in forces verification; verify: false disables it"],
];

const INFERRED_ROLES = [
  ["review / audit / check for", "reviewer — read + search only (no writes, no shell)"],
  ["run / execute / install / build / test", "executor — files plus shell"],
  ["write / create / refactor (no shell words)", "writer — files only, no shell"],
  ["Anything ambiguous", "reader — read-only by default (least privilege)"],
];

const LIMITS = [
  ["SUBAGENT_MAX_ITERATIONS", "50", "Max loop iterations per sub-agent"],
  ["timeoutMs", "120000 (2 min)", "Default per-task timeout"],
  ["concurrency", "5", "Parallel tasks per session"],
  ["maxTasks", "17", "Total tasks per session"],
  ["maxDepth", "2", "Max delegation depth"],
  ["maxFanOut", "5", "Max children per parent"],
  ["maxRetries", "1", "Retry attempts for failed tasks"],
];

const MOA_ERRORS = [
  ["INVALID_CONFIG", "Bad reference-model setup (e.g. no models configured)"],
  ["INSUFFICIENT_CANDIDATES", "Fewer unique candidates than the minimum required"],
  ["AGGREGATOR_FAILED", "The synthesis model failed"],
  ["BUDGET_EXCEEDED", "Token or cost budget exhausted mid-run"],
  ["CANCELLED", "Cancelled via abort signal"],
];

const COMPONENTS = [
  ["Task registry", "Spawns tasks, tracks state and per-task metrics"],
  ["Workspaces", "git-worktree isolation for writers, readonly-shared for readers, file leases"],
  ["Mailbox", "Coordinator ↔ worker messaging (permission requests, results, cancellation)"],
  ["Limits", "Retries, timeouts, maxDepth, maxFanOut, maxTokens, maxCostUsd"],
];

const PARAMS = [
  ["task (required)", "Focused, self-contained task"],
  ["role", "reader, writer, executor, reviewer, unrestricted"],
  ["mode", "foreground waits for a typed result; background returns a cancellable task handle"],
  ["context", "fresh (no parent context) or fork (inject prior results as untrusted reference)"],
  ["verify", "Run an independent verifier over the result"],
  ["agent", "Load a configured agent by name"],
  ["dependencies", "Wait on sibling task ids before running"],
  ["timeoutMs, model", "Per-task overrides"],
];

const BUILTINS = [
  ["coder", "executor", "Senior implementation engineer: smallest diff, strict YAGNI, follow existing patterns"],
  ["reviewer", "reviewer", "Senior code reviewer: rates findings CRITICAL / IMPORTANT / SUGGESTION"],
  ["tester", "executor", "Senior test engineer: tests that catch real failures"],
];

const MOA_SETTINGS = [
  ["referenceModels", "deepseek-v4-flash, deepseek-v4-pro"],
  ["aggregator", "deepseek-v4-pro @ temperature 0.4"],
  ["maxCandidates", "5"],
  ["timeoutMs / maxRetries", "60000 / 1"],
];

export default function SubAgents() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Sub-agents</span>
        </nav>

        <div className="hero">
          <h1>Sub-agents &amp; delegation</h1>
          <p className="tagline">
            Bounded specialist workers with their own context, tools, and permission profile.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Why delegate</h2>
          <p>
            Sub-agents are bounded specialist workers: each one runs its own LLM loop in an isolated
            context, with its own tool allowlist and permission profile, and reports back only a typed
            summary. Delegation is how the primary agent parallelizes research, gets an independent
            review, or offloads a focused implementation without polluting the main conversation.
          </p>
          <p>
            When a sub-agent spawns it gets a <b>fresh context</b>, its <b>own tools</b>, and an
            isolated <b>permission profile</b>; the parent only ever receives a summary, never the raw
            transcript. Behind the scenes the parent Agent owns an <code className="inline">OrchestratorSession</code>{" "}
            that tracks every task:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Component</th><th>Responsibility</th></tr>
              </thead>
              <tbody>
                {COMPONENTS.map(([c, r]) => (
                  <tr key={c}>
                    <td><b style={{ color: "var(--text-strong)" }}>{c}</b></td>
                    <td>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            This is the runtime behind <code className="inline">/agent</code>, the{" "}
            <code className="inline">SubAgent</code> tool, and background <code className="inline">ask_agent</code>{" "}
            dispatch.
          </p>
        </section>

        <section id="subagent-tool">
          <h2><span className="anchor">#</span>The subagent tool</h2>
          <p>
            The <code className="inline">subagent</code> tool spawns a bounded specialist task. Its parameters:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Param</th><th>Description</th></tr>
              </thead>
              <tbody>
                {PARAMS.map(([p, d]) => (
                  <tr key={p}>
                    <td><code className="inline">{p}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`{
  "name": "subagent",
  "arguments": {
    "task": "Audit src/agent/session.ts for null dereferences",
    "role": "reviewer",
    "mode": "foreground",
    "verify": true
  }
}`}</CodeBlock>
          <p>
            A sub-agent runs its own loop capped at <code className="inline">SUBAGENT_MAX_ITERATIONS</code> (50),
            gets role-filtered tools, and is isolated to a permission profile —{" "}
            <code className="inline">researcher-readonly</code>, <code className="inline">tester</code>,{" "}
            <code className="inline">writer-worktree</code>, or <code className="inline">coordinator-integrator</code>.
            It must terminate by calling <code className="inline">submit_result</code> <b>exactly once</b> with a
            validated schema: <code className="inline">summary</code>, <code className="inline">confidence</code>,{" "}
            <code className="inline">filesRead</code>, <code className="inline">filesChanged</code>,{" "}
            <code className="inline">issuesFound</code>, <code className="inline">suggestions</code>,{" "}
            <code className="inline">metadata</code>. With <code className="inline">verify</code> enabled, an
            independent verifier re-checks the result and can mark it <code className="inline">CONFIRMED</code>,{" "}
            <code className="inline">PLAUSIBLE</code>, or <code className="inline">REFUTED</code>.
          </p>
          <Note>
            Sub-agents cannot delegate further unless the agent config sets{" "}
            <code className="inline">allowDelegation: true</code>.
          </Note>
        </section>

        <section id="verification">
          <h2><span className="anchor">#</span>Verification triggers</h2>
          <p>
            An independent verifier runs automatically when the heuristics below fire — or whenever{" "}
            <code className="inline">verify: true</code> is set explicitly:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "38%" }}>Trigger</th><th>Why</th></tr>
              </thead>
              <tbody>
                {TRIGGERS.map(([t, w]) => (
                  <tr key={t}>
                    <td><code className="inline">{t}</code></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The verifier is a separate agent loop that is <b>blind to the candidate's working
            transcript</b> — it only sees the task and the candidate's summary and file list, which
            it must treat as untrusted data. Only a <code className="inline">CONFIRMED</code> verdict with{" "}
            <b>direct evidence</b> passes; <code className="inline">PLAUSIBLE</code> and{" "}
            <code className="inline">REFUTED</code> fail the task (<code className="inline">VERIFICATION_INCONCLUSIVE</code>{" "}
            and <code className="inline">VERIFICATION_REFUTED</code> respectively).
          </p>
        </section>

        <section id="builtins">
          <h2><span className="anchor">#</span>Built-in agents</h2>
          <p>
            DeepSeek Code ships three fixed agents you can target by name:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Agent</th><th style={{ width: "18%" }}>Role</th><th>System prompt</th></tr>
              </thead>
              <tbody>
                {BUILTINS.map(([a, r, p]) => (
                  <tr key={a}>
                    <td><code className="inline">{a}</code></td>
                    <td>{r}</td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            All three end with the same protected <code className="inline">submit_result</code> protocol, and all
            are usable as primary agents or sub-agents. Extend or override one from agent config:
          </p>
          <CodeBlock lang="text">{`// .deepseek/agents/strict-coder.json
{
  "name": "strict-coder",
  "extends": "builtin:coder",
  "systemPrompt": "Be even more conservative about new abstractions..."
}`}</CodeBlock>
          <Note>
            Built-ins can also be switched off entirely via{" "}
            <code className="inline">settings.agents.disabledBuiltins</code>.
          </Note>
        </section>

        <section id="roles">
          <h2><span className="anchor">#</span>Roles &amp; least privilege</h2>
          <p>
            When no role is given, it is <b>inferred from the task wording</b> — and ambiguity
            defaults to the narrowest role:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "40%" }}>Task contains</th><th>Inferred role</th></tr>
              </thead>
              <tbody>
                {INFERRED_ROLES.map(([k, r]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The final tool set is the <b>intersection</b> of three allowlists: the role's tools, the
            permission profile's tools, and the parent's own allowlist. A worker can therefore never
            exceed its parent's privileges — even an <code className="inline">unrestricted</code> role is
            capped by the profile and the parent.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits</h2>
          <p>
            Every session enforces hard task limits (configurable via{" "}
            <code className="inline">settings.agents</code>):
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Limit</th><th style={{ width: "24%" }}>Default</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([l, v, m]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{v}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="askagent">
          <h2><span className="anchor">#</span>Background questions (ask_agent)</h2>
          <p>
            <code className="inline">ask_agent</code> dispatches a question in the <b>background</b> to a named
            configured agent — or, with <code className="inline">broadcast: true</code>, to{" "}
            <b>every enabled agent whose usage is <code className="inline">subagent</code> or{" "}
            <code className="inline">both</code></b> — and returns a task handle immediately. It always
            uses fresh context:
          </p>
          <CodeBlock lang="json">{`{ "name": "ask_agent", "arguments": { "question": "What changed in session.ts this week?", "agent": "reviewer" } }`}</CodeBlock>
          <p>
            Responses are injected into your <b>next foreground turn</b> as{" "}
            <code className="inline">@agent</code> notes — informational context, never new tasks.
          </p>
        </section>

        <section id="moa">
          <h2><span className="anchor">#</span>Mixture of Agents (moa)</h2>
          <p>
            <code className="inline">moa</code> sends the same prompt to up to <b>5 reference models in
            parallel</b>, de-duplicates identical answers by sha256, then synthesizes the survivors with
            an aggregator model:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "40%" }}>Setting</th><th>Default</th></tr>
              </thead>
              <tbody>
                {MOA_SETTINGS.map(([s, v]) => (
                  <tr key={s}>
                    <td><code className="inline">{s}</code></td>
                    <td><code className="inline">{v}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            You can override <code className="inline">referenceModels</code>,{" "}
            <code className="inline">aggregatorModel</code>, and <code className="inline">systemPrompt</code> per call.
            Timeouts, retries, and the parent's token budget are enforced end to end. Reach for{" "}
            <code className="inline">moa</code> on critical decisions where a few independent perspectives beat a
            single pass.
          </p>
          <p>
            Failures surface as typed error codes — and the call <b>fails closed</b>, never falling
            back to a raw candidate:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Code</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {MOA_ERRORS.map(([c, m]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Connecting to agent config</h2>
          <p>
            The <code className="inline">subagent</code> tool's <code className="inline">agent</code> param loads a
            configured agent by name through the layered registry in{" "}
            <code className="inline">src/agent/config.ts</code> — builtin, then{" "}
            <code className="inline">~/.deepseek/agents</code>, then project, then local. The sub-agent inherits the
            agent's role, model, tools, permission profile, and limits. See the{" "}
            <a href="/docs/agents">Agents guide</a> for authoring custom agents.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
