import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What Mixture of Agents is" },
  { id: "when", label: "When it is worth the cost" },
  { id: "pipeline", label: "The two layers" },
  { id: "config", label: "Configuration" },
  { id: "dedup", label: "Deduplication by hash" },
  { id: "status", label: "Candidate status" },
  { id: "minresponses", label: "minResponses & failing closed" },
  { id: "security", label: "Candidates are untrusted data" },
  { id: "errors", label: "Error codes" },
  { id: "metrics", label: "Metrics & honest costs" },
  { id: "using", label: "Using it" },
];

const CONFIG = [
  ["referenceModels", "deepseek-v4-flash, deepseek-v4-pro (weight 1 each)", "The models answering independently."],
  ["aggregator", "deepseek-v4-pro @ temperature 0.4", "The synthesizer. Lower temperature than the references on purpose."],
  ["minResponses", "1", "Unique successful candidates required before synthesis may run."],
  ["maxCandidates", "5", "Hard ceiling on reference models per call."],
  ["concurrency", "5", "How many reference calls run at once."],
  ["timeoutMs", "60000", "Per-candidate deadline."],
  ["maxRetries", "1", "Bounded retry per reference model."],
];

const STATUS = [
  ["done", "Returned a usable response.", "Counts toward minResponses."],
  ["failed", "Errored or exhausted retries. The error is preserved.", "Does not count."],
  ["empty", "Returned successfully but with no content.", "Does not count."],
  ["duplicate", "Byte-identical to an earlier candidate, linked by duplicateOf.", "Does not count."],
];

const ERRORS = [
  ["INVALID_CONFIG", "Bad reference-model setup — no models configured, or an unusable aggregator."],
  ["INSUFFICIENT_CANDIDATES", "Fewer unique successful candidates than minResponses."],
  ["AGGREGATOR_FAILED", "The synthesis call failed. Partial candidates are attached."],
  ["BUDGET_EXCEEDED", "The parent's token or cost budget was exhausted mid-run."],
  ["CANCELLED", "Aborted through the abort signal."],
];

const LAYER_FIELDS = [
  ["candidateId", "Stable id for this candidate, referenced by duplicateOf."],
  ["model, provider", "Exactly what answered."],
  ["status", "done | failed | empty | duplicate."],
  ["response", "The text, or null."],
  ["attempts", "How many tries it took."],
  ["tokens, usageAvailable", "Token count, plus whether the provider actually reported one."],
  ["costUsd, costAvailable", "Cost, plus whether it was reported. Never estimated."],
  ["durationMs", "Wall-clock time for this candidate."],
];

const WHEN = [
  ["Yes — architectural decisions", "Three independent takes on a design surface trade-offs one pass hides."],
  ["Yes — ambiguous requirements", "Divergent readings of the same request expose the ambiguity itself."],
  ["Yes — high-cost-of-error changes", "Migrations, auth, money. Being wrong is more expensive than the extra calls."],
  ["No — mechanical edits", "Renaming a symbol has one right answer. Five opinions cost five times as much."],
  ["No — anything with a test", "If a suite can settle it, run the suite. It is cheaper and more reliable."],
  ["No — inside a tight loop", "MoA is a deliberate escalation, not a default mode."],
];

export default function MoA() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Mixture of Agents</span>
        </nav>

        <div className="hero">
          <h1>Mixture of Agents (MoA)</h1>
          <p className="tagline">
            Ask several models the same question independently, then have one synthesize the answers. For
            decisions where a single pass is not enough.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What Mixture of Agents is</h2>
          <p>
            The <code className="inline">moa</code> tool sends one prompt to several reference models in
            parallel, discards duplicates and failures, and passes the surviving answers to an{" "}
            <b>aggregator</b> model that produces a single synthesis.
          </p>
          <p>
            The value is not majority voting. It is that independently generated answers <em>disagree in
            informative ways</em>: one model surfaces a constraint another missed, two propose different
            approaches with different failure modes, and the aggregator sees a spread of reasoning rather
            than a single chain it has to trust.
          </p>
          <p>
            Independence is the load-bearing property. The reference models never see each other's output.
            If they did, the second answer would anchor on the first and you would be paying extra for
            correlated noise.
          </p>
          <Note>
            MoA answers <em>questions</em>. It does not edit files. Use it to decide what to do, then use
            normal tools to do it.
          </Note>
        </section>

        <section id="when">
          <h2><span className="anchor">#</span>When it is worth the cost</h2>
          <p>
            MoA multiplies your token spend by roughly the number of reference models, plus the synthesis
            call. That is a real price, so the question is always whether the decision justifies it:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "36%" }}>Situation</th><th>Reasoning</th></tr>
              </thead>
              <tbody>
                {WHEN.map(([s, r]) => (
                  <tr key={s}>
                    <td><b style={{ color: "var(--text-strong)" }}>{s}</b></td>
                    <td>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The clearest disqualifier is the second "no". Anything a test suite can decide should be decided
            by the test suite — <a href="/docs/verification">verification</a> is faster, cheaper, and
            produces a definite answer rather than a considered opinion.
          </p>
        </section>

        <section id="pipeline">
          <h2><span className="anchor">#</span>The two layers</h2>
          <CodeBlock lang="text">{`layer 1 — reference models (parallel, independent, bounded)

   deepseek-v4-flash ──► candidate A   done       1.2s
   deepseek-v4-pro   ──► candidate B   done       3.8s
   deepseek-v4-pro   ──► candidate C   duplicate  of B
                              │
                              ▼  unique successful candidates only
layer 2 — aggregator (one call, temperature 0.4)

   labeled JSON in a user message  ──►  synthesis`}</CodeBlock>
          <p>
            Layer one runs with bounded concurrency, a per-candidate timeout, and bounded retries. Each
            candidate is tracked independently, so one model timing out does not stall the others.
          </p>
          <p>
            Layer two is a single separate model call. The aggregator's default temperature (0.4) is lower
            than what you would use for generation, because its job is to reconcile existing material
            faithfully rather than to invent new material.
          </p>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Configuration</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Key</th><th style={{ width: "34%" }}>Default</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {CONFIG.map(([k, d, m]) => (
                  <tr key={k}>
                    <td><code className="inline">{k}</code></td>
                    <td><code className="inline">{d}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Reference models can be overridden per call, including their provider and temperature. A model
            may also carry a <code className="inline">weight</code>, which the aggregator can use to prefer one
            source over another when candidates conflict.
          </p>
          <CodeBlock lang="json">{`{
  "name": "moa",
  "arguments": {
    "prompt": "Should the token store live in the kernel or in agent/? Argue both.",
    "referenceModels": [
      { "model": "deepseek-v4-pro", "temperature": 0.8 },
      { "model": "deepseek-v4-pro", "temperature": 0.3 },
      { "model": "deepseek-v4-flash" }
    ],
    "aggregatorModel": { "model": "deepseek-v4-pro", "temperature": 0.4 }
  }
}`}</CodeBlock>
          <p>
            The same model at different temperatures is a legitimate configuration — it produces genuine
            divergence in exploration without needing a second provider. Cross-provider references produce
            more independence still, at the cost of managing two sets of credentials.
          </p>
        </section>

        <section id="dedup">
          <h2><span className="anchor">#</span>Deduplication by hash</h2>
          <p>
            Candidates are hashed with <b>SHA-256</b> and byte-identical responses are marked{" "}
            <code className="inline">duplicate</code>, linked to the original through{" "}
            <code className="inline">duplicateOf</code>.
          </p>
          <p>
            Duplicates are <b>preserved, not deleted</b>. That is a deliberate reporting choice: knowing that
            three of five models produced the identical answer is information about consensus. Silently
            dropping them would make a strongly agreed answer look like a single lonely one.
          </p>
          <p>
            But a duplicate does <b>not</b> count toward <code className="inline">minResponses</code>. Identical
            text is not an independent confirmation — it is the same answer arriving twice, and treating it
            as corroboration is exactly the error the deduplication exists to prevent.
          </p>
          <Note>
            Matching is exact. Two answers that agree in substance but differ by a word are distinct
            candidates, and the aggregator is what reconciles them.
          </Note>
        </section>

        <section id="status">
          <h2><span className="anchor">#</span>Candidate status</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Status</th><th style={{ width: "48%" }}>Meaning</th><th>Counts?</th></tr>
              </thead>
              <tbody>
                {STATUS.map(([s, m, c]) => (
                  <tr key={s}>
                    <td><code className="inline">{s}</code></td>
                    <td>{m}</td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Every candidate is reported regardless of status, with full detail:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Field</th><th>Contents</th></tr>
              </thead>
              <tbody>
                {LAYER_FIELDS.map(([f, c]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">empty</code> deserves its own status rather than being folded into{" "}
            <code className="inline">failed</code>. A model that returns successfully with nothing to say is a
            different signal from one that errored — it usually means the prompt was underspecified, not
            that the provider broke.
          </p>
        </section>

        <section id="minresponses">
          <h2><span className="anchor">#</span>minResponses & failing closed</h2>
          <p>
            Synthesis runs only if the number of <b>unique successful</b> candidates meets{" "}
            <code className="inline">minResponses</code>. Otherwise the call raises{" "}
            <code className="inline">INSUFFICIENT_CANDIDATES</code>.
          </p>
          <p>
            The critical property is what happens on aggregator failure. The call{" "}
            <b>never falls back to returning candidate one</b>:
          </p>
          <CodeBlock lang="text">{`aggregator fails
  → MoAExecutionError('AGGREGATOR_FAILED', …, { references, aggregator })
  → partial candidates attached for inspection
  → NOT: "here is the first model's answer instead"`}</CodeBlock>
          <p>
            A silent fallback would be the worst possible outcome. You asked for a synthesis of several
            perspectives, you would be handed one unreviewed perspective, and nothing in the response would
            tell you the difference. Raising an error preserves the distinction between "several models
            considered this" and "one model said this".
          </p>
          <p>
            The partial data travels with the error, so the candidates are not lost — you can read them and
            decide for yourself.
          </p>
        </section>

        <section id="security">
          <h2><span className="anchor">#</span>Candidates are untrusted data</h2>
          <p>
            When candidates reach the aggregator they are <b>labeled JSON in a user message</b>, kept
            separate from the synthesizer's own instruction.
          </p>
          <p>
            This is the same boundary as <a href="/docs/agent-teams#context">fork context</a> and{" "}
            <a href="/docs/agent-messaging#security">agent messaging</a>: model output is data, never
            instruction. If candidates were concatenated into the aggregator's system prompt, any reference
            model could rewrite the synthesizer's behavior by emitting text that reads like an instruction —
            a prompt injection where the attacker is one of your own model calls.
          </p>
          <p>
            Labeling matters as much as placement. Each candidate is tagged with its source, so the
            aggregator can attribute claims and weigh them rather than reading one undifferentiated blob.
          </p>
        </section>

        <section id="errors">
          <h2><span className="anchor">#</span>Error codes</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Code</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {ERRORS.map(([c, m]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            All five arrive as <code className="inline">MoAExecutionError</code> carrying{" "}
            <code className="inline">partial</code> — the reference results collected so far and the aggregator
            result if it got that far. Typed codes rather than message strings mean a caller can branch on{" "}
            <code className="inline">BUDGET_EXCEEDED</code> differently from{" "}
            <code className="inline">INVALID_CONFIG</code> without parsing prose.
          </p>
        </section>

        <section id="metrics">
          <h2><span className="anchor">#</span>Metrics & honest costs</h2>
          <p>
            <code className="inline">MoAResult</code> reports <code className="inline">totalTokens</code>,{" "}
            <code className="inline">totalCostUsd</code> and <code className="inline">totalDurationMs</code> — each
            paired with an availability flag.
          </p>
          <p>
            Those flags are not redundant. Not every provider reports usage, and{" "}
            <code className="inline">usageAvailable: false</code> means "unknown", which is a different claim
            from <code className="inline">totalTokens: 0</code>. Cost is <b>never estimated</b> from token counts
            and a price table — if the provider did not report it, it is reported as unavailable.
          </p>
          <p>
            This is the same rule the orchestrator applies to{" "}
            <a href="/docs/agent-teams#limits">task metrics</a>. A number you can act on and a number
            someone inferred should never look the same.
          </p>
        </section>

        <section id="using">
          <h2><span className="anchor">#</span>Using it</h2>
          <CodeBlock lang="json">{`{
  "name": "moa",
  "arguments": {
    "prompt": "We need idempotent webhook processing. Compare storing a
               dedup key in Redis vs a unique constraint in Postgres.
               Cover failure modes and operational cost.",
    "systemPrompt": "You are a senior backend engineer. Be concrete about
                     failure modes; state assumptions explicitly."
  }
}`}</CodeBlock>
          <p>
            Prompt design matters more here than in a normal call. Asking for a <em>comparison with failure
            modes</em> gives models room to diverge usefully; asking a yes/no question collapses them into
            near-identical answers that deduplicate into one candidate and waste the whole mechanism.
          </p>
          <p>
            <code className="inline">moa</code> is also available as a delegation target from a{" "}
            <a href="/docs/subagents">sub-agent</a>, with the parent's token budget enforced end to end.
            Related: <a href="/docs/code-review">multi-agent review</a> applies the same
            many-perspectives idea to finding defects rather than answering questions.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
