import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "shape", label: "The shape of agentic cost" },
  { id: "effort", label: "Effort levels (/effort)" },
  { id: "stats", label: "/cost and /stats" },
  { id: "formula", label: "How cost is computed" },
  { id: "pricing", label: "Pricing" },
  { id: "caching", label: "The cache discount" },
  { id: "limits", label: "Context limits" },
  { id: "unavailable", label: "When cost is unavailable" },
  { id: "levers", label: "The five levers" },
  { id: "delegation", label: "Delegation economics" },
  { id: "budgets", label: "Hard budgets" },
];

const EFFORT = [
  ["low", "Appends a concise-response hint. DeepSeek and Bedrock also receive thinking: { type: 'disabled' }."],
  ["high", "Default. Appends a thorough-response hint. DeepSeek and Bedrock receive reasoning_effort: 'high' with thinking enabled."],
  ["max", "Appends the deepest-reasoning hint. DeepSeek and Bedrock receive reasoning_effort: 'max' with thinking enabled."],
];

const PRICING = [
  ["deepseek-v4-flash", "$0.14", "$0.0028", "$0.28"],
  ["deepseek-v4-pro", "$0.435", "$0.003625", "$0.87"],
  ["deepseek-chat (alias)", "$0.14", "$0.0028", "$0.28"],
  ["deepseek-reasoner (alias)", "$0.14", "$0.0028", "$0.28"],
];

const LIMITS = [
  ["deepseek-v4-flash", "1,000,000"],
  ["deepseek-v4-pro", "1,000,000"],
  ["deepseek-chat, deepseek-reasoner", "1,000,000"],
  ["Bedrock / Vertex models", "128,000"],
  ["Unknown / custom models", "128,000"],
];

const USAGE = [
  ["promptTokens", "Prompt-token usage reported by the provider and accumulated across foreground calls."],
  ["completionTokens", "Completion-token usage reported by the provider, including reasoning when the provider counts it there."],
  ["cachedTokens", "Provider-reported prompt_cache_hit_tokens, or zero when that field is absent."],
];

const LEVERS = [
  ["A cheaper sub-agent model", "Large", "Bounded delegated tasks can use agents.subagentModel instead of the foreground model."],
  ["Provider-reported cache hits", "Potentially large", "The CLI applies the cached-input rate only to hits reported by the provider."],
  ["Delegating wide reading", "Large", "A sub-agent burns its own window and returns a summary."],
  ["Lower effort on mechanical work", "Medium", "It asks for shorter reasoning; DeepSeek and Bedrock also disable thinking at the API level."],
  ["Disable unused MCP servers", "Small but recurring", "Loaded MCP tool schemas join the request. Built-in schemas are not removed by agent allowlists."],
];

export default function Costs() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Costs & usage</span>
        </nav>

        <div className="hero">
          <h1>Costs, effort & usage</h1>
          <p className="tagline">
            What you are billed for, how the number is computed, and the five levers that actually move it.
          </p>
        </div>

        <section id="shape">
          <h2><span className="anchor">#</span>The shape of agentic cost</h2>
          <p>
            An agent session does not cost what a chat costs. Every call resends the entire message array,
            so an uncompacted session with similarly sized turns can approach <b>quadratic prompt growth</b>:
            turn twenty includes the active history from turns one through nineteen.
          </p>
          <p>
            The practical consequence is that a wasteful tool result early in a session is paid for again on
            every iteration after it. A 4,000-line file read at turn three is still in the prompt at turn
            thirty unless something removes it.
          </p>
          <p>
            This is also why a cheaper model is not automatically cheaper. A weaker model does not just give
            a worse answer — it takes <em>more turns</em>, and each extra turn resends everything.
          </p>
          <Note>
            Two mechanisms fight this automatically:{" "}
            <a href="/docs/compaction#micro">micro-compaction</a> clears old read-only tool results with no
            model call. <a href="/docs/compaction#auto">Auto-compaction</a> checks the configured threshold
            before a new turn (90% by default), while a separate post-response check uses 85% during a turn.
          </Note>
        </section>

        <section id="effort">
          <h2><span className="anchor">#</span>Effort levels (/effort)</h2>
          <p>
            <code className="inline">/effort</code> sets reasoning depth for the session. Valid levels are{" "}
            <code className="inline">low</code>, <code className="inline">high</code> (the default) and{" "}
            <code className="inline">max</code>; <code className="inline">auto</code> resets to{" "}
            <code className="inline">high</code>. With no argument it shows the current level.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "14%" }}>Level</th><th>What changes</th></tr>
              </thead>
              <tbody>
                {EFFORT.map(([l, d]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            When a provider returns reasoning content, DeepSeek Code preserves it on the assistant message
            for subsequent calls. Providers that count those tokens as completion usage therefore increase
            both the reported output total and the size of later requests.
          </p>
          <p>
            All providers receive the effort hint in the system prompt. Only the DeepSeek and Bedrock
            adapters also receive the API parameters shown above; Vertex and local endpoints get the prompt
            hint but no effort-specific request fields. Cache eligibility and invalidation remain a provider
            behavior rather than something the CLI can guarantee.
          </p>
        </section>

        <section id="stats">
          <h2><span className="anchor">#</span>/cost and /stats</h2>
          <CodeBlock lang="bash">{`/cost     # estimated session cost from token usage
/stats    # session statistics`}</CodeBlock>
          <p>
            Both read the same three counters, accumulated across the session:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Counter</th><th>Covers</th></tr>
              </thead>
              <tbody>
                {USAGE.map(([c, m]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The number to watch is <code className="inline">cachedTokens</code> as a fraction of{" "}
            <code className="inline">promptTokens</code>. A high ratio means the provider reported more cache
            hits and the estimator applied the cached-input rate to them. The counter alone does not explain
            which prefix was eligible or why a miss occurred.
          </p>
          <p>
            For a breakdown of <em>what</em> is filling the prompt rather than what it costs, use{" "}
            <a href="/docs/context-window">/context</a>.
          </p>
        </section>

        <section id="formula">
          <h2><span className="anchor">#</span>How cost is computed</h2>
          <p>
            Cost is the sum of fresh input, cached input and completion. Each category is priced per million
            tokens. Fresh input equals total prompt tokens minus cached tokens, with a zero floor for
            inconsistent provider reports.
          </p>
          <p>
            Three rates, not two. Cached input is billed separately and far more cheaply, which is why cached
            tokens are <b>subtracted</b> from the prompt total rather than counted twice.
          </p>
          <p>
            The <code className="inline">Math.max(0, …)</code> guard is defensive: if a provider ever reported
            more cached tokens than prompt tokens, the result would go negative and silently discount the
            rest of the session. Clamping at zero fails toward over-reporting rather than under-reporting.
          </p>
          <p>
            An unrecognized model falls back to the flash-tier table, so a custom endpoint still produces a
            figure — an estimate, and labelled as such by its context. Very small amounts display as{" "}
            <code className="inline">&lt;$0.0001</code> rather than <code className="inline">$0.0000</code>, so a
            cheap call is never confused with a free one.
          </p>
        </section>

        <section id="pricing">
          <h2><span className="anchor">#</span>Pricing</h2>
          <p>USD per million tokens:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Model</th>
                  <th style={{ width: "18%" }}>Input</th>
                  <th style={{ width: "22%" }}>Cached input</th>
                  <th>Output</th>
                </tr>
              </thead>
              <tbody>
                {PRICING.map(([m, i, c, o]) => (
                  <tr key={m}>
                    <td><code className="inline">{m}</code></td>
                    <td><code className="inline">{i}</code></td>
                    <td><code className="inline">{c}</code></td>
                    <td><code className="inline">{o}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Two ratios are worth internalizing. <b>Output costs twice input</b> — a verbose answer is more
            expensive than a long prompt. And <b>cached input costs about a fiftieth of fresh input</b>,
            according to the bundled DeepSeek price table.
          </p>
          <p>
            <code className="inline">deepseek-chat</code> and <code className="inline">deepseek-reasoner</code> are
            deprecated aliases mapping to the flash tier.
          </p>
        </section>

        <section id="caching">
          <h2><span className="anchor">#</span>The cache discount</h2>
          <p>
            DeepSeek Code does not implement a prompt cache. It consumes the provider's optional{" "}
            <code className="inline">prompt_cache_hit_tokens</code> usage field and prices that reported slice
            at the cached-input rate.
          </p>
          <p>
            The provider decides what is cacheable and what invalidates a cached prefix. Changes to the model,
            system prompt, tools or conversation can affect provider-side reuse, but the CLI neither predicts
            those rules nor attributes a miss to one change. Use the reported counter as evidence, not as a
            cache debugger.
          </p>
          <p>
            A provider that omits the field leaves <code className="inline">cachedTokens</code> at zero. That
            means "no hits reported to the CLI," not proof that the upstream service performed no caching.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Context limits</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "44%" }}>Model / provider</th><th>Limit</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([m, l]) => (
                  <tr key={m}>
                    <td><code className="inline">{m}</code></td>
                    <td><code className="inline">{l}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            DeepSeek Code's context accounting assigns 128,000 tokens to Bedrock, Vertex and unrecognized
            custom models regardless of the model's upstream limit. This is a CLI fallback used for usage
            percentages and compaction decisions; an early summary is still lossy, so check the configured
            model's real limit when using a custom endpoint.
          </p>
          <p>
            Switching from a 1M model to a 128k one moves your usage percentage sharply without a single
            token changing hands. Re-check <a href="/docs/context-window">/context</a> after a switch.
          </p>
        </section>

        <section id="unavailable">
          <h2><span className="anchor">#</span>When cost is unavailable</h2>
          <p>
            Not every provider reports usage. Where that happens, the orchestrator and{" "}
            <a href="/docs/moa">MoA</a> report cost as <b>unavailable</b> rather than estimating it — every
            metric is paired with an availability flag such as{" "}
            <code className="inline">usageAvailable</code> or <code className="inline">costAvailable</code>.
          </p>
          <p>
            <code className="inline">costAvailable: false</code> means "unknown", which is a different claim
            from <code className="inline">totalCostUsd: 0</code>. Presenting an inferred number identically to a
            reported one would make a task record untrustworthy exactly where it matters.
          </p>
          <p>
            The session-level <code className="inline">/cost</code> figure is an estimate from local token
            counts and the price table above. Treat it as a good guide and your provider's dashboard as the
            invoice.
          </p>
        </section>

        <section id="levers">
          <h2><span className="anchor">#</span>The five levers</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Lever</th><th style={{ width: "18%" }}>Impact</th><th>Why</th></tr>
              </thead>
              <tbody>
                {LEVERS.map(([l, i, w]) => (
                  <tr key={l}>
                    <td><b style={{ color: "var(--text-strong)" }}>{l}</b></td>
                    <td>{i}</td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`{
  "model": { "default": "deepseek-v4-pro" },
  "agents": { "subagentModel": "deepseek-v4-flash" }
}`}</CodeBlock>
          <p>
            There is also a <b>fixed floor</b> you cannot compact below: system prompt, memory, steering and
            tool schemas are rebuilt on every call. If that floor is already large, no operational change
            helps — the fix is editorial. Check its size in{" "}
            <a href="/docs/context-window#reducing">/context</a>.
          </p>
        </section>

        <section id="delegation">
          <h2><span className="anchor">#</span>Delegation economics</h2>
          <p>
            Delegation adds model calls, but can reduce the foreground context. A sub-agent runs its own loop
            and returns its terminal result rather than inserting its full internal transcript into the
            foreground conversation.
          </p>
          <p>
            Reading twenty files to answer one question costs your session a paragraph instead of twenty file
            bodies — and, crucially, that paragraph is what gets resent on every subsequent turn. The
            evidence never enters your quadratic growth curve.
          </p>
          <p>
            <a href="/docs/moa">MoA</a> is the opposite case and worth being deliberate about: it multiplies
            spend by roughly the number of reference models plus a synthesis call. Reserve it for decisions
            where being wrong costs more than the extra calls, and never for anything a test suite can
            settle.
          </p>
        </section>

        <section id="budgets">
          <h2><span className="anchor">#</span>Hard budgets</h2>
          <CodeBlock lang="json">{`{ "agents": { "maxTokens": 2000000, "maxCostUsd": 5 } }`}</CodeBlock>
          <p>
            <code className="inline">agents.maxTokens</code> and{" "}
            <code className="inline">agents.maxCostUsd</code> set default bounds for delegated work. Generic
            tasks report <code className="inline">TOKEN_BUDGET_EXCEEDED</code> or{" "}
            <code className="inline">COST_BUDGET_EXCEEDED</code>; MoA uses its own{" "}
            <code className="inline">BUDGET_EXCEEDED</code> failure and can attach completed references.
          </p>
          <p>
            Individual agents can narrow these further in their own definitions, and{" "}
            orchestration task limits require positive values. A zero cost limit is rejected by that task
            boundary rather than interpreted as "run nothing." See{" "}
            <a href="/docs/agents#limits">Agents</a>.
          </p>
          <p>
            Related: <a href="/docs/model-config">Model configuration</a>,{" "}
            <a href="/docs/context-window">Context window</a>,{" "}
            <a href="/docs/compaction">Compaction</a>.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
