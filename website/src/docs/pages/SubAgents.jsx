import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Why delegate" },
  { id: "subagent-tool", label: "The subagent tool" },
  { id: "builtins", label: "Built-in agents" },
  { id: "askagent", label: "Background questions (ask_agent)" },
  { id: "moa", label: "Mixture of Agents (moa)" },
  { id: "config", label: "Connecting to agent config" },
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

        <section id="askagent">
          <h2><span className="anchor">#</span>Background questions (ask_agent)</h2>
          <p>
            <code className="inline">ask_agent</code> dispatches a question in the <b>background</b> to a named
            configured agent — or to every enabled sub-agent with <code className="inline">broadcast: true</code>{" "}
            — and returns a task handle immediately. It always uses fresh context:
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
