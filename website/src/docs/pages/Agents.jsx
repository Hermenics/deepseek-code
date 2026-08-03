import { CodeBlock, Note, Toc, Icon } from "../Layout";

const TOC = [
  { id: "what", label: "What are agents?" },
  { id: "primary", label: "Primary agent" },
  { id: "subagents", label: "Sub-agents" },
  { id: "prompts", label: "Editable base prompts" },
  { id: "next", label: "Next steps" },
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
