import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "choosing", label: "Choosing a model" },
  { id: "switching", label: "Switching models" },
  { id: "contextlimit", label: "Context limits" },
  { id: "subagent", label: "A separate model for sub-agents" },
  { id: "effort", label: "Effort" },
  { id: "pricing", label: "How cost is computed" },
  { id: "caching", label: "Cached input" },
  { id: "labels", label: "Model labels & descriptions" },
  { id: "settings", label: "Settings reference" },
  { id: "strategy", label: "A practical strategy" },
];

const LIMITS = [
  ["deepseek (direct)", "1,000,000", "deepseek-v4-flash, deepseek-v4-pro and deepseek-v4-flash-vision-exp; legacy aliases map to Flash."],
  ["vertex", "128,000", "Capped by the provider, not by the model."],
  ["bedrock", "128,000", "Capped by the provider, not by the model."],
  ["unknown / custom", "128,000", "Conservative fallback so compaction is not delayed."],
];

const SETTINGS = [
  ["model.default", "The model for your main session."],
  ["agents.subagentModel", "The preferred model for delegated workers."],
  ["model.subagent", "Compatibility fallback for workers when agents.subagentModel is unset."],
  ["provider.name", "Which provider to talk to."],
  ["provider.endpoint", "Custom base URL — local models and gateways."],
  ["provider.timeoutMs", "Timeout used by Settings center provider discovery and connection tests."],
  ["compaction.threshold", "Interacts with the context limit: the fraction at which compaction fires."],
];

const STRATEGY = [
  ["Default to a strong model", "You pay for reasoning once and for bad reasoning repeatedly."],
  ["Use a fast model for sub-agents", "Workers do bounded, well-specified jobs. Breadth beats depth there."],
  ["Raise effort for design, not for edits", "Deliberation helps decisions. It does not help a rename."],
  ["Watch cachedTokens, not just total", "A high cache ratio means your prefix is stable. A collapsing one means something is churning it."],
  ["Re-check /context after switching", "The same session can jump from comfortable to nearly full on a smaller model."],
];

export default function ModelConfig() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Model configuration</span>
        </nav>

        <div className="hero">
          <h1>Model configuration</h1>
          <p className="tagline">
            Which model runs your session, which one runs your workers, how much deliberation each spends,
            and what all of that costs.
          </p>
        </div>

        <section id="choosing">
          <h2><span className="anchor">#</span>Choosing a model</h2>
          <p>
            Model choice trades three things against each other: <b>capability</b>, <b>latency</b> and{" "}
            <b>price</b>. In an agentic loop the trade is not the one people expect, because a weaker model
            does not simply produce a worse answer — it produces <em>more turns</em>. It reads files it did
            not need, takes an approach that fails verification, and comes back around.
          </p>
          <p>
            That means the cheap model is not always cheaper. A flash-tier model at a fraction of the price
            that needs three times the turns is more expensive and slower. The place a fast model genuinely
            wins is bounded, well-specified work: a{" "}
            <a href="/docs/subagents">sub-agent</a> told exactly what to look for, a mechanical
            transformation, a summarization pass.
          </p>
          <p>
            <code className="inline">/model</code> lists what your provider actually offers — the list is
            fetched, not hardcoded, so it reflects your account rather than a table in the documentation.
          </p>
        </section>

        <section id="switching">
          <h2><span className="anchor">#</span>Switching models</h2>
          <CodeBlock lang="bash">{`/model                    # list available models and pick one
/model deepseek-v4-pro    # switch directly`}</CodeBlock>
          <p>
            Switching mid-session does three things at once. It changes which model answers, it re-resolves
            the context limit, and it reconfigures the orchestrator and the workflow runtime so tasks spawned
            afterwards use the new model.
          </p>
          <p>
            The conversation is <b>not</b> reset. History carries over, which is usually what you want —
            escalating to a stronger model to get past a hard step, then continuing.
          </p>
          <Note>
            A model switch changes the destination and model identifier for later requests. Whether any
            previously cached input can be reused, and how it is billed, is entirely provider-specific.
          </Note>
        </section>

        <section id="contextlimit">
          <h2><span className="anchor">#</span>Context limits</h2>
          <p>
            The limit is resolved from provider and model together, and the provider can override the model:
          </p>
          <p>
            The direct-provider table lists the model IDs with explicit client-side limits, including the real
            API model <code className="inline">deepseek-v4-flash-vision-exp</code>. Other unknown IDs follow
            the conservative fallback rather than being treated as unsupported by the provider.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Provider</th><th style={{ width: "22%" }}>Limit</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([p, l, n]) => (
                  <tr key={p}>
                    <td><code className="inline">{p}</code></td>
                    <td><code className="inline">{l}</code></td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Vertex and Bedrock are fixed regardless of model because those platforms impose their own ceiling
            — the model may support more, the deployment does not.
          </p>
          <p>
            The fallback comment states the reasoning plainly: a <b>conservative</b> value for unknown models{" "}
            <em>to avoid delaying compaction</em>. Guessing high on an unknown model would mean compaction
            fires too late and requests start getting rejected. Guessing low means compacting slightly
            earlier than necessary, which costs a little and breaks nothing.
          </p>
          <p>
            See <a href="/docs/context-window">Context window</a> for what happens as you approach the limit.
          </p>
        </section>

        <section id="subagent">
          <h2><span className="anchor">#</span>A separate model for sub-agents</h2>
          <p>
            <code className="inline">agents.subagentModel</code> sets the model workers use, independently of
            your session. The compatibility setting <code className="inline">model.subagent</code> is used
            when the agent-specific value is absent.
          </p>
          <CodeBlock lang="json">{`// .deepseek/settings.json
{
  "model": {
    "default": "deepseek-v4-pro"
  },
  "agents": {
    "subagentModel": "deepseek-v4-flash"
  }
}`}</CodeBlock>
          <p>
            This is the highest-leverage cost setting in the product, and it is under-used.
          </p>
          <p>
            The asymmetry is real: your session holds the whole problem, makes the judgment calls, and
            benefits from every bit of capability. A worker gets a narrow, self-contained task with an
            explicit output schema, runs in{" "}
            <a href="/docs/agent-teams#context">fresh context</a>, and returns a summary. Most worker tasks —
            inventory this directory, check this claim, summarize this module — are not capability-bound.
          </p>
          <p>
            With a default concurrency of 5, the sub-agent model is also the one you are buying the most of.
            Halving its price while keeping your own session strong is usually a strict improvement.
          </p>
          <p>
            When left unset, workers use the session model.
          </p>
        </section>

        <section id="effort">
          <h2><span className="anchor">#</span>Effort</h2>
          <p>
            <code className="inline">/effort</code> changes the active agent&apos;s reasoning request. Every
            level rebuilds the system-prompt effort instruction. Direct DeepSeek and Bedrock calls also
            receive provider parameters: low disables thinking, high enables it with high effort, and max
            enables it with maximum effort. Other providers receive only the prompt instruction.
          </p>
          <CodeBlock lang="bash">{`/effort            # open the effort selector
/effort low        # request a quick, concise response
/effort high       # default comprehensive level
/effort max        # request maximum available reasoning
/effort auto       # currently resets to high`}</CodeBlock>
          <p>
            The default is high. <code className="inline">auto</code> and <code className="inline">unset</code>{" "}
            currently reset to high rather than selecting an adaptive fourth level. A provider can ignore an
            unsupported effort request or return no visible reasoning, so a higher level is a request rather
            than a guaranteed token count or reasoning panel.
          </p>
          <p>
            When a provider returns reasoning, those tokens count as completion output and{" "}
            <b>also occupy context</b>. The reasoning field is preserved with the assistant message and can
            be resent on later provider calls while that message remains in active history. Billing and cache
            treatment remain provider-specific.
          </p>
          <p>
            Because effort can change both the system prompt and provider parameters, set it deliberately for
            a task rather than toggling it accidentally. Cache reuse after that change is provider-specific.
          </p>
          <p>
            Raise it for design decisions, subtle debugging, and anything where being wrong is expensive.
            Leave it alone for mechanical work — a rename does not become more correct with more
            deliberation.
          </p>
        </section>

        <section id="pricing">
          <h2><span className="anchor">#</span>How cost is computed</h2>
          <p>
            The estimate adds three independently priced parts: fresh input, cached input and completion.
            Each token count is divided by one million and multiplied by its model rate. Fresh input is the
            reported prompt total minus cached tokens, clamped to zero.
          </p>
          <p>
            Three rates, not two. Cached input is billed separately and far more cheaply than fresh input,
            which is why the calculation subtracts cached tokens from the prompt total rather than charging
            them twice.
          </p>
          <p>
            The zero floor is defensive: if a provider ever reports
            more cached tokens than prompt tokens, the result is zero rather than a negative charge that
            would silently discount the rest of the session.
          </p>
          <p>
            An unknown model falls back to the flash-tier price table. That is an estimate for display, and
            it is the reason the orchestrator reports{" "}
            <a href="/docs/agent-teams#limits">provider-reported cost as unavailable</a> rather than
            substituting an estimate — a number shown in a task record should be a fact, not an inference.
          </p>
          <p>
            Very small amounts display as <code className="inline">&lt;$0.0001</code> rather than as{" "}
            <code className="inline">$0.0000</code>, so a cheap call is never confused with a free one.
          </p>
        </section>

        <section id="caching">
          <h2><span className="anchor">#</span>Cached input</h2>
          <p>
            DeepSeek Code reports cached input only when the provider returns
            <code className="inline">prompt_cache_hit_tokens</code>. The CLI does not create a cache, choose
            its prefix or control its invalidation policy.
          </p>
          <p>
            The request includes the current system prompt, tool schemas and active messages. Switching
            models, changing effort, saving memory and editing steering can change that request, but only the
            provider can determine whether a later call is a cache hit.
          </p>
          <p>
            <code className="inline">/cost</code> shows the cached fraction. A session where{" "}
            <code className="inline">cachedTokens</code> is a large share of{" "}
            <code className="inline">promptTokens</code> is one where the provider reported substantial cache
            reuse. Consult that provider's billing rules to interpret the discount.
          </p>
        </section>

        <section id="labels">
          <h2><span className="anchor">#</span>Model labels & descriptions</h2>
          <p>
            Model ids are formatted for display —{" "}
            <code className="inline">deepseek-v4-flash</code> renders as{" "}
            <code className="inline">DeepSeek V4 Flash</code> — so the picker is readable without a hardcoded
            label per model.
          </p>
          <p>
            Descriptions come from a known-descriptions table where one exists, and are otherwise generated
            and cached to disk. Generation happens once per model; afterwards the cache answers.
          </p>
          <p>
            This is why <code className="inline">/model</code> can describe models that did not exist when your
            version was built. A new model appears in the provider's list, gets a formatted label
            automatically, and gets a description on first sight.
          </p>
        </section>

        <section id="settings">
          <h2><span className="anchor">#</span>Settings reference</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Key</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {SETTINGS.map(([k, m]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`// .deepseek/settings.json
{
  "provider": { "name": "deepseek", "timeoutMs": 120000 },
  "model": { "default": "deepseek-v4-pro" },
  "agents": { "subagentModel": "deepseek-v4-flash" },
  "compaction": { "threshold": 0.85 }
}`}</CodeBlock>
          <p>
            These resolve through the usual three levels — user, project, local — so a team can commit a
            model policy and an individual can override it locally. See{" "}
            <a href="/docs/settings">Settings</a> and <a href="/docs/providers">Providers</a>.
          </p>
        </section>

        <section id="strategy">
          <h2><span className="anchor">#</span>A practical strategy</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Rule</th><th>Reasoning</th></tr>
              </thead>
              <tbody>
                {STRATEGY.map(([r, w]) => (
                  <tr key={r}>
                    <td><b style={{ color: "var(--text-strong)" }}>{r}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The combination that works for most teams: a strong session model, a fast sub-agent model,
            default effort, and compaction left at its default. Reach for <code className="inline">/effort</code>{" "}
            and <a href="/docs/moa">MoA</a> as deliberate escalations on hard decisions rather than as
            standing configuration.
          </p>
          <p>
            Related: <a href="/docs/costs">Costs & usage</a>,{" "}
            <a href="/docs/context-window">Context window</a>, <a href="/docs/providers">Providers</a>.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
