import { CodeBlock, Note, Toc, Icon } from "../Layout";

const TOC = [
  { id: "what", label: "What are agents?" },
  { id: "primary", label: "Primary agent" },
  { id: "subagents", label: "Sub-agents" },
  { id: "prompts", label: "Editable base prompts" },
  { id: "config", label: "Agent config reference" },
  { id: "next", label: "Next steps" },
];

const FIELDS = [
  ["name (required)", "Unique identifier, ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$"],
  ["extends", "Inherit from another agent — or a builtin with builtin:coder"],
  ["systemPrompt / basePrompt", "The role prompt; systemPrompt required unless extends is set"],
  ["role", "reader, writer, executor, reviewer, unrestricted"],
  ["model", "Override the model used for this agent"],
  ["tools", "Tool allowlist for this agent ('*' for all)"],
  ["permissionProfile", "researcher-readonly, tester, writer-worktree, coordinator-integrator"],
  ["workspaceIsolation", "readonly-shared, git-worktree, serialized-writer (runtime-only)"],
  ["allowDelegation, maxDepth", "Delegation switch — requires maxDepth > 0"],
  ["maxFanOut, maxTokens, maxCostUsd", "Budget limits for the agent's tasks"],
  ["files", "Glob patterns injected into the system prompt — 50k char budget, workspace-contained"],
];

export default function Agents() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Agents</span>
        </nav>

        <div className="hero">
          <h1>Agents</h1>
          <p className="tagline">
            One primary agent, many focused sub-agents — all with editable base prompts.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What are agents?</h2>
          <p>
            DeepSeek Code uses a <b>unified agent system</b>: a primary agent drives the main
            conversation, and sub-agents can be spawned to handle focused, bounded tasks. Each
            agent carries a <b>base prompt</b> that defines its role, and every prompt is editable.
          </p>
        </section>

        <section id="primary">
          <h2><span className="anchor">#</span>Primary agent</h2>
          <p>
            The primary agent is the main loop you talk to. It holds the session context, plans
            work, calls tools, and coordinates any sub-agents it spawns. Its base prompt defines
            the default behavior of the assistant.
          </p>
        </section>

        <section id="subagents">
          <h2><span className="anchor">#</span>Sub-agents</h2>
          <p>
            Sub-agents are scoped workers with their own base prompt and a bounded task. Spawn one
            with <code className="inline">/agent</code> or programmatically via the{" "}
            <code className="inline">SubAgent</code> tool:
          </p>
          <CodeBlock lang="text">SubAgent("research-user-flows", "Map the three onboarding flows and report").run()</CodeBlock>
          <p>
            Sub-agents are ideal for research, review, or any task that should run without
            polluting the main conversation context.
          </p>
        </section>

        <section id="prompts">
          <h2><span className="anchor">#</span>Editable base prompts</h2>
          <p>
            Base prompts live in the config and can be edited per scope. This lets you customize
            how the primary agent and each sub-agent behave:
          </p>
          <CodeBlock lang="text"># project .deepseek/agent-config
primary: "You are a senior TypeScript engineer..."
subagents:
  research: "You gather facts and cite sources precisely."
  reviewer: "You review code for correctness and security."</CodeBlock>
          <Note>
            Editing a base prompt is a <b>Project or Local</b> scope change — it doesn't touch the
            global config.
          </Note>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Agent config reference</h2>
          <p>
            Custom agents are JSON files validated against a strict schema ({" "}
            <code className="inline">additionalProperties: false</code> — unknown fields are rejected
            outright) with consistency rules on top: a{" "}
            <code className="inline">researcher-readonly</code> profile requires{" "}
            <code className="inline">readonly-shared</code> isolation,{" "}
            <code className="inline">writer-worktree</code> requires{" "}
            <code className="inline">git-worktree</code>, and <code className="inline">allowDelegation</code>{" "}
            requires <code className="inline">maxDepth &gt; 0</code>. Every file needs a{" "}
            <code className="inline">name</code> plus either a <code className="inline">systemPrompt</code> or
            an <code className="inline">extends</code>.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Field</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {FIELDS.map(([f, d]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Agents resolve through five layers; the last layer to define a name wins, and earlier
            definitions are marked as overridden:
          </p>
          <ul>
            <li><b>Builtins</b> — <code className="inline">coder</code>, <code className="inline">reviewer</code>, <code className="inline">tester</code></li>
            <li><code className="inline">~/.deepseek/agents/</code> — global agents</li>
            <li><code className="inline">settings.agents.additionalDirectories</code> — extra agent folders</li>
            <li><code className="inline">.deepseek/agents/</code> — project agents</li>
            <li><code className="inline">.deepseek/agents.local/</code> — local-only agents</li>
          </ul>
          <p>
            Inherited config is <b>revalidated after merging</b> — an override that would break a
            consistency rule is rejected, and <code className="inline">extends</code> cycles are refused.
            A delegated worker can never be elevated to{" "}
            <code className="inline">coordinator-integrator</code>, and{" "}
            <code className="inline">files</code> globs must stay inside the project (absolute paths,
            traversal, and symlink escapes are rejected).
          </p>
          <CodeBlock lang="json">{`// .deepseek/agents/strict-coder.json
{
  "name": "strict-coder",
  "extends": "builtin:coder",
  "systemPrompt": "Be even more conservative about new abstractions...",
  "role": "executor",
  "maxDepth": 2,
  "maxCostUsd": 0.5
}`}</CodeBlock>
          <Note>
            <code className="inline">settings.agents.disabledBuiltins</code> switches built-ins off,{" "}
            <code className="inline">settings.agents.default</code> picks the default agent, and{" "}
            <code className="inline">settings.agents.subagentModel</code> sets the model for spawned
            sub-agents.
          </Note>
          <p>
            <code className="inline">/agent &lt;name&gt;</code> loads a custom agent into the session — a
            project <code className="inline">.deepseek/agents/&lt;name&gt;.json</code> overrides the global{" "}
            <code className="inline">~/.deepseek/agents/</code> one. <code className="inline">/agents</code>{" "}
            lists every resolvable agent with its origin.
          </p>
        </section>

        <section id="next">
          <h2><span className="anchor">#</span>Next steps</h2>
          <div className="next-links">
            <a className="next-card" href="/docs/tools">
              <div className="nc-title">Tools <Icon.Arrow /></div>
              <div className="nc-desc">What sub-agents can call.</div>
            </a>
            <a className="next-card" href="/docs/settings">
              <div className="nc-title">Settings <Icon.Arrow /></div>
              <div className="nc-desc">Where agent configs live.</div>
            </a>
          </div>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
