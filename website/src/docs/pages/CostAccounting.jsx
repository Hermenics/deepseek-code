import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "scope", label: "What is being accounted" },
  { id: "counters", label: "Primary-agent counters" },
  { id: "commands", label: "/cost and /stats" },
  { id: "formula", label: "Estimation formula" },
  { id: "pricing", label: "Embedded price table" },
  { id: "cache", label: "Cached input" },
  { id: "included", label: "Included and excluded work" },
  { id: "models", label: "Model-switch caveat" },
  { id: "agents", label: "Subagents, workflows and MoA" },
  { id: "headless", label: "Headless limitations" },
  { id: "interpretation", label: "How to interpret the number" },
];
const COUNTERS = [
  ["Total tokens", "Sum of each tracked response's provider-reported total_tokens."],
  ["Prompt tokens", "Sum of provider-reported prompt_tokens across tracked responses."],
  ["Completion tokens", "Sum of provider-reported completion_tokens across tracked responses."],
  ["Cached tokens", "Sum of prompt_cache_hit_tokens when that provider field is present."],
  ["Context usage", "Prompt-token count from the most recent main-loop response, not a cumulative total."],
];
const PRICING = [
  ["deepseek-v4-flash", "$0.140000", "$0.002800", "$0.280000"],
  ["deepseek-v4-pro", "$0.435000", "$0.003625", "$0.870000"],
  ["deepseek-chat", "$0.140000", "$0.002800", "$0.280000"],
  ["deepseek-reasoner", "$0.140000", "$0.002800", "$0.280000"],
  ["Any other model ID", "$0.140000", "$0.002800", "$0.280000"],
];
const COVERAGE = [
  ["Main agent-loop responses", "Included when usage is returned", "Streaming usage events and non-streaming response usage update all primary counters."],
  ["Side questions (/btw)", "Included when usage is returned", "Their non-streaming response usage updates primary counters."],
  ["Prompt refinement", "Excluded", "The refinement request's usage is not added to primary counters."],
  ["Manual or automatic compaction", "Excluded", "The summarization request's usage is not added."],
  ["Model-description generation", "Excluded", "Background description requests do not update counters."],
  ["Tool execution", "Excluded", "Filesystem, shell, MCP and external-service compute is not priced here."],
  ["Subagent and verifier requests", "Separate token accounting", "They do not increment the primary agent's counters."],
  ["Provider usage omitted", "Excluded", "The run completes, but no inferred tokens are added."],
];
const LIMITATIONS = [
  ["Estimate, not invoice", "The provider dashboard remains authoritative for billed usage and provider-specific adjustments."],
  ["Unknown is displayed like tiny", "Zero tracked cost formats as <$0.0001 even when usage metadata was unavailable."],
  ["One active rate", "All accumulated primary usage is repriced with the currently selected model."],
  ["Fallback pricing", "Unknown, local, Bedrock and Vertex model IDs use flash rates in the estimator."],
  ["No headless field", "The pipe JSON envelope contains output and tool names, not usage or cost."],
];
export default function CostAccounting() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Cost accounting</span>
        </nav>

        <div className="hero">
          <h1>Cost accounting</h1>
          <p className="tagline">
            The exact counters, rates and blind spots behind the session estimate—so a useful convenience
            number is not mistaken for billing-grade telemetry.
          </p>
        </div>

        <section id="scope">
          <h2><span className="anchor">#</span>What is being accounted</h2>
          <p>
            DeepSeek Code keeps in-memory usage counters on the primary agent. Selected provider responses add
            their reported token fields to those counters. The interactive
            <code className="inline">/cost</code> command applies a built-in per-million-token price table to the
            accumulated prompt, cache-hit and completion counts.
          </p>
          <p>
            This is session-process accounting, not provider billing reconciliation. It does not query an
            account, attach request IDs, persist a rate ledger per call, include every internal model request or
            price external tool execution.
          </p>
          <Note>
            A displayed estimate of <code className="inline">&lt;$0.0001</code> can mean genuinely tiny tracked
            usage, zero usage, or missing usage metadata. The primary counter has no availability flag.
          </Note>
        </section>

        <section id="counters">
          <h2><span className="anchor">#</span>Primary-agent counters</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "25%" }}>Counter</th><th>How it changes</th></tr></thead>
              <tbody>{COUNTERS.map(([counter, behavior]) => <tr key={counter}><td>{counter}</td><td>{behavior}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            The totals start at zero when a new primary agent is constructed. Clearing conversation history,
            loading or resetting an agent configuration, and changing model do not reset them. They therefore
            describe the lifetime of that in-memory agent process more closely than the visible message list.
          </p>
          <p>
            The total-token counter is not recomputed from prompt plus completion; it independently sums the
            provider's total field. A provider that reports inconsistent fields can therefore produce totals
            that do not add up exactly.
          </p>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span><code className="inline">/cost</code> and <code className="inline">/stats</code></h2>
          <p>
            Both commands read the same primary counters and calculate the estimate at display time.
            <code className="inline">/cost</code> is the compact accounting view:
          </p>
          <CodeBlock lang="text">{"Model: deepseek-v4-flash\nTokens: 18,420 total\n  prompt: 17,900 (12,100 cached)\n  completion: 520\nEstimated cost: $0.0010"}</CodeBlock>
          <p>
            <code className="inline">/stats</code> adds duration, provider, user turns, tool calls, files modified
            and the most recent context-usage percentage. Its prompt line presents cache hits as a rounded
            percentage rather than the raw cached-token count.
          </p>
          <CodeBlock lang="text">{"**Session Statistics**\nDuration:       4m 12s\nModel:          deepseek-v4-flash\nProvider:       deepseek\n\n**Tokens**\nTotal:          18,420\nPrompt:         17,900 (68% cached)\nCompletion:     520\n\n**Activity**\nUser turns:     3\nTool calls:     7\nFiles modified: 1\nContext usage:  4%\n\n**Cost**\nEstimated:      $0.0010"}</CodeBlock>
          <Note>
            These are interactive slash commands. Supplying
            <code className="inline">/cost</code> through <code className="inline">--pipe</code> sends those
            characters to the model; it does not invoke the command.
          </Note>
        </section>

        <section id="formula">
          <h2><span className="anchor">#</span>Estimation formula</h2>
          <p>
            Fresh input is prompt tokens minus cached tokens, with a floor at zero. The estimate adds three
            independently priced quantities: fresh input multiplied by its rate, cached input multiplied by its
            rate, and completion tokens multiplied by its rate. Each quantity is divided by one million because
            every embedded rate is expressed per million tokens.
          </p>
          <p>
            The zero floor prevents a malformed report with more cache hits than prompt tokens from producing a
            negative fresh-input charge. It does not clamp the cached count itself, so such an inconsistent
            report can still overstate cached-input cost.
          </p>
          <p>
            Formatting uses four decimal places at or above $0.0001. Every lower value, including exact zero, is
            displayed as <code className="inline">&lt;$0.0001</code>.
          </p>
          <CodeBlock lang="text">{"Estimated cost: <$0.0001\nEstimated cost: $0.0042\nEstimated cost: $1.2345"}</CodeBlock>
        </section>

        <section id="pricing">
          <h2><span className="anchor">#</span>Embedded price table</h2>
          <p>
            The implementation labels its static rates as July 2026 pricing. These are the exact values used by
            the local estimator, regardless of later provider-side price changes.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "31%" }}>Model ID</th><th>Fresh input / 1M</th><th>Cached input / 1M</th><th>Output / 1M</th></tr></thead>
              <tbody>{PRICING.map(([model, input, cached, output]) => <tr key={model}><td><code className="inline">{model}</code></td><td>{input}</td><td>{cached}</td><td>{output}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            The legacy aliases <code className="inline">deepseek-chat</code> and
            <code className="inline">deepseek-reasoner</code> map to the flash rates. Every unrecognized model
            also falls back to flash rates rather than returning “unavailable.”
          </p>
          <Note>
            A plausible-looking cost for a local, Bedrock, Vertex or custom model is therefore not evidence that
            the matching provider tariff was known. It is the estimator's fallback.
          </Note>
        </section>

        <section id="cache">
          <h2><span className="anchor">#</span>Cached input</h2>
          <p>
            Cache accounting depends on the provider returning
            <code className="inline">prompt_cache_hit_tokens</code>. When the field is absent, the estimator
            treats every reported prompt token as fresh input. It does not estimate cache hits from repeated
            message prefixes.
          </p>
          <p>
            Streaming usage often arrives in a final event with no text choices; it is still recorded. On the
            non-streaming path, usage is read from the complete response. Repeated tool-loop iterations each add
            their full provider-reported prompt usage, because every request can resend conversation context.
          </p>
          <CodeBlock lang="text">{"Tokens: 1,500,000 total\n  prompt: 1,200,000 (900,000 cached)\n  completion: 300,000"}</CodeBlock>
          <p>
            Cache hits reduce the estimate only through the lower cached-input rate. They do not reduce the
            displayed prompt-token total or total-token counter.
          </p>
        </section>

        <section id="included">
          <h2><span className="anchor">#</span>Included and excluded work</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "29%" }}>Work</th><th style={{ width: "23%" }}>Primary /cost</th><th>Current treatment</th></tr></thead>
              <tbody>{COVERAGE.map(([work, status, treatment]) => <tr key={work}><td>{work}</td><td>{status}</td><td>{treatment}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Prompt refinement and compaction can be meaningful billable requests while remaining absent from
            the primary estimate. Likewise, a subagent tool call is represented in the primary conversation,
            but the subagent's own iterative provider usage is kept elsewhere.
          </p>
          <Note>
            Disabling prompt refinement may reduce untracked requests, but do it for deterministic behavior or
            measured value—not to force the displayed estimate to match the invoice. It still will not include
            every category.
          </Note>
        </section>

        <section id="models">
          <h2><span className="anchor">#</span>Model-switch caveat</h2>
          <p>
            Usage is aggregated without storing the model used for each response. When
            <code className="inline">/cost</code> runs, the estimator applies the currently active model's rates
            to every accumulated token. Switching model therefore reprices earlier usage retroactively in the
            displayed estimate.
          </p>
          <CodeBlock lang="text">{"# Before switching\nModel: deepseek-v4-flash\nEstimated cost: $0.0042\n\n# Same counters after selecting deepseek-v4-pro\nModel: deepseek-v4-pro\nEstimated cost: $0.0131"}</CodeBlock>
          <p>
            The precise values depend on the prompt/cache/output mix; the important behavior is that the count
            did not change while the rate did. Start a fresh process when comparing model costs, or calculate
            per-call costs from provider telemetry outside DeepSeek Code.
          </p>
        </section>

        <section id="agents">
          <h2><span className="anchor">#</span>Subagents, workflows and MoA</h2>
          <p>
            Subagent loops sum provider-reported total tokens for their own task records. A task marks usage as
            available only when its accumulated token total is greater than zero. It does not currently attach
            a calculated cost to that task record, so a requested cost budget cannot be enforced when no cost
            metric exists.
          </p>
          <p>
            Workflow accounting aggregates the usage returned by its agent calls. Missing cost values contribute
            zero to the workflow total. MoA records token availability independently and explicitly reports cost
            as unavailable rather than deriving it from the primary agent's price table.
          </p>
          <Note>
            Zero workflow cost, absent task cost and
            <code className="inline">costAvailable: false</code> are different representations. None should be
            interpreted as proof that external provider cost was zero.
          </Note>
        </section>

        <section id="headless">
          <h2><span className="anchor">#</span>Headless limitations</h2>
          <p>
            Pipe mode uses the same primary counters internally while it runs, but exposes no command or output
            field that returns them before the one-shot process exits. Its JSON success envelope contains only
            <code className="inline">ok</code>, <code className="inline">output</code> and
            <code className="inline">tools</code>.
          </p>
          <CodeBlock lang="json">{"{\"ok\":true,\"output\":\"Analysis complete.\",\"tools\":[\"grep\",\"read_file\"]}"}</CodeBlock>
          <p>
            Asking the model to mention token use is not equivalent to reading the private session counters.
            For CI chargeback, collect usage from the provider or gateway rather than attempting to derive it
            from output length or tool count.
          </p>
        </section>

        <section id="interpretation">
          <h2><span className="anchor">#</span>How to interpret the number</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "29%" }}>Constraint</th><th>Practical interpretation</th></tr></thead>
              <tbody>{LIMITATIONS.map(([constraint, interpretation]) => <tr key={constraint}><td>{constraint}</td><td>{interpretation}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Use <code className="inline">/cost</code> for a quick directional view within a single-model session.
            Use provider-side request telemetry for budgets, invoices, per-model comparisons and automated
            financial controls.
          </p>
          <CodeBlock lang="text">{"Good use:     Is this session roughly tiny, moderate or unusually large?\nWrong use:    Did every request cost exactly $0.0187?\nWrong use:    Is a zero workflow total proof of zero billed usage?\nWrong use:    Can this headless JSON record support chargeback?"}</CodeBlock>
          <Note>
            The estimator is intentionally small and useful. Its limits matter most when the number leaves the
            interactive session and becomes a policy, alert or invoice.
          </Note>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
