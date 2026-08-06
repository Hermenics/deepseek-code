import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "effort", label: "Effort levels (/effort)" },
  { id: "stats", label: "Tracking usage (/stats, /cost)" },
  { id: "limits", label: "Context limits" },
  { id: "tips", label: "Reducing usage" },
];

const EFFORT = [
  ["low", "Appends a \"Be concise and quick\" hint to the system prompt and sends thinking: { type: 'disabled' } — fastest and cheapest"],
  ["high", "Default. \"Be thorough and comprehensive\" hint, thinking enabled with reasoning_effort: 'high'"],
  ["max", "\"Use your deepest reasoning\" hint plus reasoning_effort: 'max' with thinking enabled"],
];

const PRICING = [
  ["deepseek-v4-flash", "$0.14", "$0.0028", "$0.28"],
  ["deepseek-v4-pro", "$0.435", "$0.003625", "$0.87"],
];

const LIMITS = [
  ["deepseek-v4-flash", "1,000,000"],
  ["deepseek-v4-pro", "1,000,000"],
  ["deepseek-chat, deepseek-reasoner", "1,000,000"],
  ["Bedrock / Vertex models", "128,000"],
  ["Unknown / custom models", "128,000"],
];

export default function Costs() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Costs &amp; usage</span>
        </nav>

        <div className="hero">
          <h1>Costs, effort &amp; usage</h1>
          <p className="tagline">
            Three levers: reasoning depth, session tokens, and which models get called.
          </p>
        </div>

        <section id="effort">
          <h2><span className="anchor">#</span>Effort levels (/effort)</h2>
          <p>
            <code className="inline">/effort</code> sets the reasoning depth for the session. Valid levels are{" "}
            <code className="inline">low</code>, <code className="inline">high</code> (the default), and{" "}
            <code className="inline">max</code>; <code className="inline">auto</code> resets to{" "}
            <code className="inline">high</code>. Running <code className="inline">/effort</code> with no argument shows the
            current level.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Level</th><th>What changes</th></tr>
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
          <CodeBlock lang="bash">{`/effort low     # concise, thinking off
/effort max     # deepest reasoning
/effort         # show the current level`}</CodeBlock>
          <Note>
            <code className="inline">high</code> and <code className="inline">max</code> both send{" "}
            <code className="inline">thinking: {"{ type: 'enabled' }"}</code> — with{" "}
            <code className="inline">reasoning_effort</code> <code className="inline">high</code> or{" "}
            <code className="inline">max</code> — while <code className="inline">low</code> sends{" "}
            <code className="inline">{"{ type: 'disabled' }"}</code>. These API-level params only reach the
            DeepSeek and Bedrock providers; elsewhere the effort hint still lands in the system
            prompt, but no <code className="inline">reasoning_effort</code> / <code className="inline">thinking</code>{" "}
            params are passed to the API.
          </Note>
        </section>

        <section id="stats">
          <h2><span className="anchor">#</span>Tracking usage (/stats, /cost)</h2>
          <p>
            <code className="inline">/stats</code> prints a full session breakdown: duration, model, provider,
            total / prompt / completion tokens, the <b>cached-token hit percentage</b>, user-turn count,
            and current context usage.
          </p>
          <p>
            <code className="inline">/cost</code> prints the estimated cost for the session — model, prompt
            tokens (with the cached count), completion tokens, and a USD estimate. The estimate
            discounts cached tokens from the prompt count: only the uncached remainder bills at the
            input rate, and cached tokens bill at their own, much lower rate.
          </p>
          <p>
            Reasoning text is part of the session too: when a DeepSeek model returns{" "}
            <code className="inline">reasoning_content</code>, it is kept in the conversation history and passed
            back to the API on every later request — the API rejects a turn that omits it (HTTP 400).
            Models without reasoning never produce the field, so nothing is added for them.
          </p>
          <CodeBlock lang="bash">{`/stats   # duration, tokens, cache hit %, activity, context %
/cost    # model, tokens, estimated USD`}</CodeBlock>
          <p>
            Cached tokens matter: input that hits the provider cache bills at a fraction of the normal
            input rate, so the hit percentage in <code className="inline">/stats</code> tells you how well the
            session is reusing cache across turns. Reference pricing (USD per million tokens):
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th>Model</th><th style={{ width: "20%" }}>Input</th><th style={{ width: "24%" }}>Cached input</th><th style={{ width: "20%" }}>Output</th></tr>
              </thead>
              <tbody>
                {PRICING.map(([m, i, c, o]) => (
                  <tr key={m}>
                    <td><code className="inline">{m}</code></td>
                    <td>{i}</td><td>{c}</td><td>{o}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            For a live view of where the window is going, run <code className="inline">/context</code> (alias{" "}
            <code className="inline">/ctx</code>) — it breaks usage into <b>System Prompt</b>, <b>Memory</b>,{" "}
            <b>Tools</b>, <b>Messages</b>, <b>Tool Results</b>, and <b>Free</b>. Per-category counts are
            proportional estimates based on character length; only the total is exact, since it comes
            from the provider's usage report. As the window fills it suggests actions: a warning to run{" "}
            <code className="inline">/compact</code> at ≥85% usage, a nudge when tool results exceed 40% of used
            context, and another when message history passes 60%.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Context limits</h2>
          <p>
            DeepSeek models default to a 1M-token window; everything else falls back to a conservative
            cap.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th>Model / provider</th><th style={{ width: "30%" }}>Context limit</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([m, c]) => (
                  <tr key={m}>
                    <td><code className="inline">{m}</code></td>
                    <td><code className="inline">{c}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Compaction is tied to the same limit: when a session passes <b>85%</b> of its window,
            auto-compact summarizes history to free space. The threshold and toggle are configurable
            (<code className="inline">autoCompact</code> / <code className="inline">autoCompactThreshold</code>, or{" "}
            <code className="inline">compaction.enabled</code> / <code className="inline">compaction.threshold</code>), and a
            circuit breaker backs off if compaction fails repeatedly.
          </p>
        </section>

        <section id="tips">
          <h2><span className="anchor">#</span>Reducing usage</h2>
          <ul className="capabilities">
            <li><b>Manual compact</b> — <code className="inline">/compact</code> summarizes the history on demand; <code className="inline">/clear</code> wipes the chat entirely. Between unrelated tasks, <code className="inline">/clear</code> is the cheapest option.</li>
            <li><b>Auto-compact</b> — the 85% threshold above runs automatically mid-session.</li>
            <li><b>Micro-compact</b> — clears old tool results (keeping the last 8) instead of paying for an LLM summary; a cheap first line of defense behind the <code className="inline">microCompact</code> feature flag.</li>
            <li><b>Subagent models</b> — spawn <code className="inline">/agent</code> roles like <code className="inline">reader</code> or <code className="inline">writer</code> backed by a cheaper model via <code className="inline">agents.subagentModel</code> in settings, so orchestration doesn't always run the full-priced model.</li>
            <li><b>MoA reference models</b> — the <code className="inline">moa</code> tool fans a prompt out to <code className="inline">deepseek-v4-flash</code> and <code className="inline">deepseek-v4-pro</code> by default; override <code className="inline">referenceModels</code> with cheaper candidates when divergent perspectives aren't worth the extra cost.</li>
          </ul>
          <Note>
            <code className="inline">/context</code> surfaces its own suggestions as the window fills — for
            example, a "Context nearly full. Run /compact" warning, or a nudge when tool results
            consume more than 40% of used context.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
