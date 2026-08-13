import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What the context window is" },
  { id: "reading", label: "Reading /context" },
  { id: "categories", label: "The five categories" },
  { id: "estimates", label: "Exact totals, estimated slices" },
  { id: "stale", label: "The stale state" },
  { id: "suggestions", label: "Automatic suggestions" },
  { id: "limits", label: "Limits per model" },
  { id: "reducing", label: "Reducing context pressure" },
  { id: "caching", label: "Context & prompt caching" },
  { id: "faq", label: "Common questions" },
];

const CATEGORIES = [
  ["System Prompt", "cyan", "The assembled system message minus the memory block: base prompt, effort hint, steering, DEEPSEEK.md."],
  ["Memory", "green", "Everything between the --- MEMORY --- delimiters. Split out so you can see what persistence costs."],
  ["Tools", "blue", "JSON schemas for every enabled tool, exactly as serialized for the provider."],
  ["Messages", "yellow", "User and assistant turns, including tool_calls payloads and reasoning_content."],
  ["Tool Results", "magenta", "Every role:\"tool\" message. Also catches <tool_result> blocks embedded in user messages."],
  ["Free", "dim", "contextLimit − contextUsage. Measured against the limit, not against usage."],
];

const SUGGESTIONS = [
  ["Usage ≥ 85% of limit", "⚠️ Context nearly full. Run /compact to free up space."],
  ["Tool Results > 40% of used", "💡 Tool results consuming >40% of used context. Consider /compact."],
  ["Messages > 60% of used", "💡 Message history consuming >60%. Use /compact or /clear."],
];

const REDUCERS = [
  ["/compact", "Large", "Summarizes the conversation into one block and inserts a boundary. History before it stops being sent."],
  ["/clear", "Total", "Drops the conversation entirely. System prompt, memory, and tools remain."],
  ["Micro-compaction", "Medium", "Clears old read-only tool results automatically. No model call, no summarization."],
  ["Disable MCP loading", "Fixed", "Removes external MCP schemas; built-in schemas remain present even when a mode or agent blocks execution."],
  ["Trim steering", "Fixed", "Steering files are re-read every session and never compacted away."],
  ["Delegate to sub-agents", "Large", "A sub-agent burns its own context and returns only a typed summary."],
];

const FAQ = [
  [
    "Why did my percentage jump after a single read?",
    "Reading a large file adds its full contents as one tool result. A 4,000-line file can be several percent of a 128k window on its own.",
  ],
  [
    "Why is Free measured differently?",
    "Every other category is a share of what you are using; Free is a share of the total limit. Mixing the two denominators is intentional — Free answers \"how much room is left\", not \"how much of my usage is empty\".",
  ],
  [
    "Why do the categories not add up to exactly 100%?",
    "The five used-context categories sum to 100%. Free uses a different denominator and is additional, so all six displayed percentages are not meant to sum to 100%.",
  ],
  [
    "Does /compact reset usage to zero?",
    "No. The summary itself occupies context, and the system prompt, memory, and tool schemas are untouched. Expect to land at the fixed floor plus the summary.",
  ],
  [
    "Why is reasoning counted under Messages?",
    "reasoning_content is attached to the assistant message it belongs to. It is billed as completion tokens and it is resent as part of history, so it is context like any other.",
  ],
];

export default function ContextWindow() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Concepts</span><span className="sep">/</span><span className="current">Context window</span>
        </nav>

        <div className="hero">
          <h1>The context window</h1>
          <p className="tagline">
            The single scarcest resource in an agentic session. This page explains what fills it, how{" "}
            <code className="inline">/context</code> measures it, and which levers actually move the number.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What the context window is</h2>
          <p>
            Every call to the model resends the active request context: the system prompt, tool schemas, and
            messages retained after the latest compact boundary. The model has no hidden memory between calls —
            that payload is its working memory. The context window is the ceiling on how large it can get.
          </p>
          <p>
            Without caching or compaction, cumulative input can approach quadratic growth as turns of similar
            size accumulate: turn 20 includes retained context from earlier turns. A large early tool result
            remains in later prompts until micro-compaction, full compaction, or clearing removes it.
          </p>
          <p>
            <code className="inline">/context</code> exists to make that visible before it becomes a problem.
          </p>
        </section>

        <section id="reading">
          <h2><span className="anchor">#</span>Reading /context</h2>
          <CodeBlock lang="text">{`Context: 42.3% (422,969 / 1,000,000 tokens)

  (proportional estimates — total is exact from provider)

  System Prompt  █░░░░░░░░░░░░░░░░░░░    9%    38,067
  Memory         ░░░░░░░░░░░░░░░░░░░░    3%    12,689
  Tools          █░░░░░░░░░░░░░░░░░░░   14%    59,216
  Messages       ██░░░░░░░░░░░░░░░░░░   26%   109,972
  Tool Results   ████░░░░░░░░░░░░░░░░   48%   203,025
  Free           ████████████░░░░░░░░   58%   577,031

  💡 Tool results consuming >40% of used context. Consider /compact.`}</CodeBlock>
          <p>
            Read it top-down. The header line is the only exact number on screen. The bars underneath are
            proportional estimates of how that exact total is distributed. Anything below the bars is a
            suggestion generated from thresholds, not from a model.
          </p>
          <p>
            Percentages in the middle column are <b>share of used context</b> for the five real categories,
            and <b>share of the limit</b> for Free. That asymmetry is deliberate and explained{" "}
            <a href="#faq">below</a>.
          </p>
        </section>

        <section id="categories">
          <h2><span className="anchor">#</span>The five categories</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Category</th><th style={{ width: "12%" }}>Color</th><th>Contents</th></tr>
              </thead>
              <tbody>
                {CATEGORIES.map(([c, col, contents]) => (
                  <tr key={c}>
                    <td><b style={{ color: "var(--text-strong)" }}>{c}</b></td>
                    <td><code className="inline">{col}</code></td>
                    <td>{contents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The <b>Memory</b> split is worth dwelling on. Memory is physically part of the system prompt —
            it is injected into the same string. The breakdown finds the{" "}
            <code className="inline">--- MEMORY ---</code> and <code className="inline">--- END MEMORY ---</code>{" "}
            markers, extracts that slice, and reports it separately. Without the delimiters you would have
            no way to tell an expensive memory store from a verbose system prompt.
          </p>
          <p>
            <b>Tool Results</b> catches two shapes. The normal one is any message with{" "}
            <code className="inline">role: "tool"</code>. The second is a{" "}
            <code className="inline">user</code> message whose content contains{" "}
            <code className="inline">&lt;tool_result&gt;</code> — the format used by providers without native
            tool calling. Both are classified as tool output rather than conversation, so the category
            stays honest across providers.
          </p>
          <Note>
            A message's estimated weight in this breakdown is content length <em>plus</em> serialized{" "}
            <code className="inline">tool_calls</code> <em>plus</em>{" "}
            <code className="inline">reasoning_content</code>. An assistant turn that says three words but
            requests six file reads is not a cheap message.
          </Note>
        </section>

        <section id="estimates">
          <h2><span className="anchor">#</span>Exact totals, estimated slices</h2>
          <p>
            The parenthetical in the output — <em>proportional estimates, total is exact</em> — is a precise
            claim, not a disclaimer.
          </p>
          <p>
            The <b>total</b> comes from the provider's own usage accounting. It is exact. The{" "}
            <b>distribution</b> is computed locally by measuring the character length of each category and
            distributing the exact total proportionally:
          </p>
          <CodeBlock lang="text">{`totalChars = systemChars + memoryChars + toolsChars + messageChars + toolResultChars

tokensFor(category) = round( categoryChars / totalChars × contextUsage )`}</CodeBlock>
          <p>
            This trades a small amount of per-category accuracy for two large wins: it needs no tokenizer,
            and the categories always sum to the provider's number. Messages receives the rounding remainder
            rather than each category rounding independently, which is why the columns add up exactly.
          </p>
          <p>
            The approximation is weakest when categories have very different token density — dense JSON
            tool schemas tokenize differently from English prose. Treat the slices as proportions to reason
            about, not as billing figures. The header is the exact prompt-token count reported for the latest
            provider response, not the session's total billable usage.
          </p>
        </section>

        <section id="stale">
          <h2><span className="anchor">#</span>The stale state</h2>
          <p>
            Sometimes <code className="inline">/context</code> answers:
          </p>
          <CodeBlock lang="text">{`⏳ Waiting for first API response; breakdown unavailable.`}</CodeBlock>
          <p>
            The breakdown depends on a provider-reported usage number. Before the first response of a
            session there isn't one, so <code className="inline">contextUsage</code> is zero and the report is
            flagged <code className="inline">stale</code> instead of guessing.
          </p>
          <p>
            The same flag is raised immediately after <code className="inline">/compact</code>. Compaction
            rewrites the message array locally, but the usage figure on file still describes the{" "}
            <em>pre-compaction</em> request. Rather than show a number that is knowably wrong, the breakdown
            waits for the next real response. Send one message and it resolves.
          </p>
          <Note>
            Stale means "no trustworthy measurement yet", not "something is broken". It clears on its own.
          </Note>
        </section>

        <section id="suggestions">
          <h2><span className="anchor">#</span>Automatic suggestions</h2>
          <p>
            Three thresholds produce advice. They are pure functions of the numbers above — no model call
            is involved:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Condition</th><th>Suggestion</th></tr>
              </thead>
              <tbody>
                {SUGGESTIONS.map(([c, s]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{s}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The two composition thresholds are the useful ones, because they diagnose <em>why</em> you are
            full rather than just telling you that you are. High <b>Tool Results</b> means the session read
            or searched a lot — micro-compaction may shrink older allowlisted results. High <b>Messages</b> means a long
            conversation, which only a real summarizing compaction or a{" "}
            <code className="inline">/clear</code> will fix.
          </p>
          <p>
            The 85% warning matches the current fixed post-stream compaction check. The configurable pre-turn
            threshold defaults to 90%, so the warning and settings value are reported separately in{" "}
            <a href="/docs/compaction">Compaction</a>.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits per model</h2>
          <p>
            <code className="inline">contextLimit</code> is resolved per provider and model when you connect or
            run <code className="inline">/model</code>. DeepSeek's mapped models use 1,000,000 tokens; Bedrock,
            Vertex, and unknown or custom model names use the conservative 128,000-token fallback. Switching
            between those groups can move the percentage without changing the retained messages.
          </p>
          <p>
            The resolved auto-compact configuration carries a <code className="inline">13,000</code>-token
            buffer field, but the current trigger compares usage ratios directly and does not apply it.
            Treat the threshold—not implied reserved headroom—as the operative limit.
          </p>
          <p>
            See <a href="/docs/model-config">Model configuration</a> for per-model limits.
          </p>
        </section>

        <section id="reducing">
          <h2><span className="anchor">#</span>Reducing context pressure</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Lever</th><th style={{ width: "14%" }}>Impact</th><th>Mechanism</th></tr>
              </thead>
              <tbody>
                {REDUCERS.map(([l, i, m]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td>{i}</td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            There is a <b>fixed floor</b> you cannot compact below: system prompt, memory, steering, and tool
            schemas are rebuilt on every call regardless of conversation length. If that floor is already a
            large share of your window, the available fixes are shorter steering and memory, or disabling
            unneeded MCP loading. Mode restrictions and agent allowlists gate execution but do not remove
            built-in tool schemas from the request.
          </p>
          <p>
            Delegation is the underrated lever. A <a href="/docs/subagents">sub-agent</a> runs its own loop in
            its own window and returns a typed summary. Reading twenty files to answer one question costs the
            parent session a paragraph instead of twenty file bodies.
          </p>
        </section>

        <section id="caching">
          <h2><span className="anchor">#</span>Context & prompt caching</h2>
          <p>
            DeepSeek Code does not create, invalidate, or tune a prompt cache itself. When a response includes
            <code className="inline">prompt_cache_hit_tokens</code>, the CLI adds that number to its cumulative
            cached-token counter and uses it in the DeepSeek cost estimate.
          </p>
          <p>
            Whether any prefix is cached, how long it stays cached, and which provider reports the field are
            provider behaviors. A zero cached count can therefore mean no hit, no support, or no compatible
            usage field; the CLI does not infer which case occurred.
          </p>
          <Note>
            <code className="inline">/context</code> describes the latest prompt size, while{" "}
            <code className="inline">/cost</code> reports cumulative prompt, completion, and cached counters.
            Do not use one as a substitute for the other.
          </Note>
        </section>

        <section id="faq">
          <h2><span className="anchor">#</span>Common questions</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Question</th><th>Answer</th></tr>
              </thead>
              <tbody>
                {FAQ.map(([q, a]) => (
                  <tr key={q}>
                    <td><b style={{ color: "var(--text-strong)" }}>{q}</b></td>
                    <td>{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Next: <a href="/docs/compaction">Compaction</a> for what happens when the window fills, and{" "}
            <a href="/docs/costs">Costs & usage</a> for what it costs you.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
