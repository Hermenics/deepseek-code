import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "loop", label: "The agent loop" },
  { id: "prompt", label: "What goes into the prompt" },
  { id: "toolcalls", label: "How tool calls are executed" },
  { id: "bedrock", label: "Providers without native tool calling" },
  { id: "gates", label: "The three gates" },
  { id: "reasoning", label: "Reasoning & thinking blocks" },
  { id: "turn", label: "What happens at end of turn" },
  { id: "budget", label: "The token budget" },
  { id: "retry", label: "Retries & failure handling" },
  { id: "state", label: "What survives the loop" },
  { id: "next", label: "Where to go next" },
];

const PROMPT_PARTS = [
  ["Base system prompt", "src/agent/system-prompt.md", "Identity, tool protocol, output rules. Fixed at build time."],
  ["Effort hint", "rebuildSystemPromptEffort()", "Injected by /effort. Changes how much deliberation the model spends per turn."],
  ["Memory block", "--- MEMORY ---", "A startup snapshot of saved facts. The current prompt does not append an END MEMORY marker."],
  ["Steering files", ".deepseek/steering/*.md", "Every markdown file in the project's steering directory, concatenated."],
  ["DEEPSEEK.md", "Project root", "Project instructions. Re-injected after every compaction."],
  ["Tool schemas", "toOpenAITools(current tools)", "JSON schema for built-ins and connected MCP tools. An agent allowlist gates execution; it does not remove schemas."],
];

const PERMISSION_RESULTS = [
  ["once", "Approve this single call. The next identical call asks again."],
  ["session", "Approve this tool for the rest of the session."],
  ["directory", "Approve this tool for the current directory tree."],
  ["always", "Persist an allow rule to settings so future sessions inherit it."],
  ["deny", "Reject the call. Raises DenyAbortError and unwinds the turn."],
];

const PERMISSION_REASONS = [
  ["outside_workspace", "The target path resolves outside the session workspace root."],
  ["risk", "A rule in DEFAULT_RISK_RULES matched (rm -rf, git push --force, package installs…)."],
  ["permission", "No allow rule covers this call and it is not low-risk."],
  ["agent_config", "The active agent config restricts this tool."],
  ["workflow", "A workflow script requested a capability outside its authorized set."],
];

const LOOP_STEPS = [
  ["1. Assemble", "System prompt + memory + steering + full message history + tool schemas."],
  ["2. Call", "One streaming chat completion against the active provider and model."],
  ["3. Split", "Text goes to the transcript; tool_calls go to the executor; reasoning_content is stored separately."],
  ["4. Gate", "Each tool call passes the workspace, risk, and permission gates, plus any PreToolUse hook."],
  ["5. Execute", "The tool runs. Result is appended as a role:\"tool\" message keyed by tool_call_id."],
  ["6. Repeat", "If the model emitted tool calls, loop back to step 1 with the enlarged history."],
  ["7. Settle", "No tool calls means the turn is over: run end-of-turn work, then wait for input."],
];

const END_OF_TURN = [
  ["Diff review", "diffReviewHandler", "If files changed this turn, the TUI can present a consolidated diff before continuing."],
  ["Verification", "verificationHandler", "Runs the project's detected verify commands over the changed file set."],
  ["Auto memory", "parseAutoMemoryFact", "The model may emit a user_preference or project_fact to persist across sessions."],
  ["History save", "saveHistory(messages)", "The full message array is written to disk so the session can be resumed."],
  ["Auto-compact check", "shouldAutoCompact", "If usage crossed the threshold, a compaction is scheduled before the next turn."],
];

const BUDGET = [
  ["promptTokens", "Everything sent up: system prompt, tools, history, tool results."],
  ["completionTokens", "Everything the model generated, including reasoning tokens."],
  ["cachedTokens", "The provider-reported prompt_cache_hit_tokens accumulated by the CLI, when supplied."],
];

const SURVIVES = [
  ["Message history", "Per-project session file", "Used by --resume and /sessions; history.json is only a bounded compatibility copy."],
  ["Undo stack", "In memory, capped at UNDO_STACK_MAX (10)", "Lost on exit; file checkpoints are the durable layer."],
  ["Approved tools", "In memory (sessionApprovedTools)", "Cleared on exit unless you chose always, which writes to settings."],
  ["Token usage", "In memory, surfaced by /cost and /stats", "Reset per session."],
  ["Audit log", "~/.deepseek/logs/session-*.jsonl", "Append-only, survives everything."],
];

export default function HowItWorks() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Concepts</span><span className="sep">/</span><span className="current">How it works</span>
        </nav>

        <div className="hero">
          <h1>How DeepSeek Code works</h1>
          <p className="tagline">
            One loop, three gates, and a message array that never lies to you. Everything else in this
            documentation is a detail hanging off this page.
          </p>
        </div>

        <section id="loop">
          <h2><span className="anchor">#</span>The agent loop</h2>
          <p>
            DeepSeek Code is not a chat window with a code plugin bolted on. It is a loop. You give it a
            goal; it calls a model; the model asks for tools; the tools run; the results go back into the
            same conversation; the model calls again. The loop ends when the model stops asking for tools —
            that is the only termination condition.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Step</th><th>What happens</th></tr>
              </thead>
              <tbody>
                {LOOP_STEPS.map(([s, w]) => (
                  <tr key={s}>
                    <td><b style={{ color: "var(--text-strong)" }}>{s}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The whole state of that loop lives in one place: a <code className="inline">messages</code> array
            held by the <code className="inline">Agent</code> class. It starts as a single system message and
            grows by one entry per model reply and one entry per tool result. Nothing is hidden from it, and
            nothing outside it influences the next model call.
          </p>
          <CodeBlock lang="text">{`messages[0]  system     ← system prompt + memory + steering
messages[1]  user       ← "fix the failing test in auth.test.ts"
messages[2]  assistant  ← tool_calls: [read_file, grep]
messages[3]  tool       ← contents of auth.test.ts
messages[4]  tool       ← grep matches
messages[5]  assistant  ← tool_calls: [edit_file]
messages[6]  tool       ← "edited 1 file"
messages[7]  assistant  ← "Fixed. The assertion compared…"   ← no tool calls: turn ends`}</CodeBlock>
          <Note>
            This is why <a href="/docs/context-window">context</a> is the central resource of the product.
            The loop has no memory other than this array, so every token in it is a token you are paying
            for on <em>every subsequent</em> iteration of the same turn.
          </Note>
        </section>

        <section id="prompt">
          <h2><span className="anchor">#</span>What goes into the prompt</h2>
          <p>
            The system message is assembled during initialization. Some controls, such as effort, update it
            during the session; persisted memory and steering changes are otherwise read on a later
            initialization or working-directory refresh:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Block</th><th style={{ width: "30%" }}>Source</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {PROMPT_PARTS.map(([b, s, n]) => (
                  <tr key={b}>
                    <td><b style={{ color: "var(--text-strong)" }}>{b}</b></td>
                    <td><code className="inline">{s}</code></td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The memory block is wrapped in explicit delimiters rather than merged into the prose. That is
            not cosmetic: <code className="inline">/context</code> splits the system prompt on those markers so
            it can report <b>System Prompt</b> and <b>Memory</b> as separate categories. If you ever wonder
            why memory has its own bar in the context breakdown, this is why.
          </p>
          <p>
            Tool schemas are the block people underestimate. The current registered built-ins and connected
            MCP tools contribute their schemas on every single call. An agent allowlist controls execution,
            not whether built-in schemas are sent; disabling an unused MCP server is the supported way to
            remove its dynamic schemas.
          </p>
        </section>

        <section id="toolcalls">
          <h2><span className="anchor">#</span>How tool calls are executed</h2>
          <p>
            When the model replies, its message is split three ways. Prose is streamed to the transcript.
            Reasoning content is stored on the message but rendered separately. And{" "}
            <code className="inline">tool_calls</code> are handed to the executor, which resolves each name
            against a <code className="inline">toolMap</code> built once at startup.
          </p>
          <p>
            Every tool result is appended as a message with <code className="inline">role: "tool"</code> and the
            originating <code className="inline">tool_call_id</code>. That pairing matters: if a tool result is
            ever dropped or reordered relative to its call, the provider rejects the next request. This is
            also why <a href="/docs/compaction">micro-compaction</a> replaces the <em>content</em> of old tool
            results rather than deleting the messages — the skeleton of call and result has to stay intact.
          </p>
          <p>
            Multiple tool calls in a single assistant message are normal and expected. The model routinely
            asks to read three files at once; they execute and return as three separate tool messages before
            the loop iterates.
          </p>
        </section>

        <section id="bedrock">
          <h2><span className="anchor">#</span>Providers without native tool calling</h2>
          <p>
            Not every provider exposes the OpenAI-style <code className="inline">tools</code> parameter. For
            those — Bedrock in particular — DeepSeek Code falls back to a text protocol. The tool schemas are
            rendered into the prompt by <code className="inline">buildBedrockToolsPrompt()</code>, the model is
            asked to emit calls as structured text, and the reply is run through{" "}
            <code className="inline">parseBedrockToolCalls()</code> to recover the same{" "}
            <code className="inline">ParsedToolCall</code> shape the native path produces.
          </p>
          <p>
            <code className="inline">stripToolCalls()</code> then removes that machinery from the text before it
            reaches your screen, so the fallback is invisible in normal use. The consequence worth knowing:
            on these providers the tool schemas are counted as ordinary prompt text, so the fixed cost per
            turn is higher than on a provider with native tool calling.
          </p>
          <Note>
            Tool results on this path arrive embedded in <code className="inline">user</code> messages wrapped in{" "}
            <code className="inline">&lt;tool_result&gt;</code>. The context breakdown detects that wrapper and
            still classifies them as <b>Tool Results</b> rather than conversation.
          </Note>
        </section>

        <section id="gates">
          <h2><span className="anchor">#</span>The three gates</h2>
          <p>
            No tool call reaches a tool without clearing three checks, in order. Each one can stop the call
            on its own.
          </p>
          <p>
            <b>Gate 1 — workspace containment.</b> Any path argument is resolved and tested against the
            session workspace root with <code className="inline">isPathContained()</code>. Escaping the workspace
            is not blocked outright, but it is escalated to a prompt with reason{" "}
            <code className="inline">outside_workspace</code>.
          </p>
          <p>
            <b>Gate 2 — risk assessment.</b> The call is matched against{" "}
            <code className="inline">DEFAULT_RISK_RULES</code>, which classify operations as high, medium, or
            low risk. See <a href="/docs/permissions">Permissions</a> for the full rule table.
          </p>
          <p>
            <b>Gate 3 — permission resolution.</b> Allow and deny rules from all three settings levels are
            applied. If nothing decides it, you get a prompt. Your answer is one of five results:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Result</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {PERMISSION_RESULTS.map(([r, e]) => (
                  <tr key={r}>
                    <td><code className="inline">{r}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Every prompt carries a <code className="inline">reason</code> so you know which gate raised it:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Reason</th><th>Raised when</th></tr>
              </thead>
              <tbody>
                {PERMISSION_REASONS.map(([r, w]) => (
                  <tr key={r}>
                    <td><code className="inline">{r}</code></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            A denial is not a soft failure. It raises <code className="inline">DenyAbortError</code>, which
            unwinds the entire turn rather than feeding an error back to the model. This is deliberate: a
            model that receives "permission denied" as a tool result will often try a creative workaround,
            and that is precisely what you were trying to prevent.
          </p>
          <p>
            <a href="/docs/hooks">Hooks</a> sit alongside the gates. A{" "}
            <code className="inline">PreToolUse</code> hook can return <code className="inline">block</code> to
            veto a call that all three gates approved, and <code className="inline">PostToolUse</code> fires
            after the result is produced.
          </p>
        </section>

        <section id="reasoning">
          <h2><span className="anchor">#</span>Reasoning & thinking blocks</h2>
          <p>
            Reasoning models return their deliberation on a separate{" "}
            <code className="inline">reasoning_content</code> field rather than mixed into the answer. DeepSeek
            Code keeps that field on the message, renders it collapsed, and — importantly — counts it in the
            context breakdown alongside the message content.
          </p>
          <p>
            Some providers instead inline thinking into the text. <code className="inline">extractThinking()</code>{" "}
            pulls those blocks out so both shapes end up rendered the same way. Either way, reasoning tokens
            are billed as completion tokens; a high <code className="inline">/effort</code> setting is visible in
            your <a href="/docs/costs">cost report</a> long before it is visible in the transcript.
          </p>
        </section>

        <section id="turn">
          <h2><span className="anchor">#</span>What happens at end of turn</h2>
          <p>
            When the model replies without tool calls, the loop exits and five things run before control
            returns to you:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Step</th><th style={{ width: "26%" }}>Hook point</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {END_OF_TURN.map(([s, h, w]) => (
                  <tr key={s}>
                    <td><b style={{ color: "var(--text-strong)" }}>{s}</b></td>
                    <td><code className="inline">{h}</code></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The turn also tracks <code className="inline">turnWriteCount</code> and{" "}
            <code className="inline">turnModifiedFiles</code> separately from the session-wide{" "}
            <code className="inline">filesModified</code> set. That distinction is what lets diff review show
            you "what changed in this turn" instead of replaying every edit since the session began.
          </p>
          <p>
            Auto memory is the subtle one. The model can emit a fact tagged either{" "}
            <code className="inline">user_preference</code> or <code className="inline">project_fact</code>;{" "}
            <code className="inline">parseAutoMemoryFact()</code> validates the shape and only then persists it.
            Anything that does not parse into exactly those two kinds is discarded rather than stored.
          </p>
        </section>

        <section id="budget">
          <h2><span className="anchor">#</span>The token budget</h2>
          <p>
            Three counters accumulate across the session and drive both{" "}
            <code className="inline">/cost</code> and the auto-compact decision:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Counter</th><th>Covers</th></tr>
              </thead>
              <tbody>
                {BUDGET.map(([c, m]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">cachedTokens</code> is useful telemetry when a provider reports it.
            DeepSeek Code neither creates a provider cache nor controls its prefix, invalidation or billing;
            consult the selected provider&apos;s documentation before treating a request change as a cache miss.
          </p>
        </section>

        <section id="retry">
          <h2><span className="anchor">#</span>Retries & failure handling</h2>
          <p>
            Provider calls go through <code className="inline">withRetry()</code>, which handles transient
            transport and rate-limit failures. Compaction, for example, runs under a hard 60-second timeout
            (<code className="inline">AbortSignal.timeout(60_000)</code>) and is retried on failure.
          </p>
          <p>
            Auto-compaction has a circuit breaker. After{" "}
            <code className="inline">maxConsecutiveFailures</code> (default 3) failed attempts,{" "}
            <code className="inline">shouldAutoCompact()</code> returns <code className="inline">false</code>{" "}
            permanently for that session. The reasoning is that a compaction failing repeatedly usually means
            the provider is rejecting the request, and retrying forever would turn one broken feature into a
            session that cannot make progress at all.
          </p>
          <p>
            Everything else surfaces as a typed error. See the <a href="/docs/errors">error reference</a> for
            the catalog.
          </p>
        </section>

        <section id="state">
          <h2><span className="anchor">#</span>What survives the loop</h2>
          <p>
            Some state is durable and some evaporates when you exit. Knowing which is which saves a lot of
            confusion about "why did it forget":
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>State</th><th style={{ width: "34%" }}>Where</th><th>Lifetime</th></tr>
              </thead>
              <tbody>
                {SURVIVES.map(([s, w, l]) => (
                  <tr key={s}>
                    <td><b style={{ color: "var(--text-strong)" }}>{s}</b></td>
                    <td><code className="inline">{w}</code></td>
                    <td>{l}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The full on-disk layout is documented in{" "}
            <a href="/docs/deepseek-directory">The .deepseek directory</a>.
          </p>
        </section>

        <section id="next">
          <h2><span className="anchor">#</span>Where to go next</h2>
          <p>
            <a href="/docs/context-window">Context window</a> explains how to read the budget the loop spends.{" "}
            <a href="/docs/compaction">Compaction</a> covers what happens when it runs out.{" "}
            <a href="/docs/permissions">Permissions</a> details gate 3.{" "}
            <a href="/docs/agent-teams">Agent teams</a> covers what happens when one loop spawns others.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
