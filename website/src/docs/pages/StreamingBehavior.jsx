import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "two-layers", label: "Two layers of streaming" },
  { id: "providers", label: "Provider behavior" },
  { id: "text", label: "Assistant text" },
  { id: "thinking", label: "Reasoning content" },
  { id: "tools", label: "Tool-call assembly" },
  { id: "usage", label: "Usage-only events" },
  { id: "completion", label: "Completion conditions" },
  { id: "errors", label: "Retries, aborts and errors" },
  { id: "backpressure", label: "Backpressure and consumers" },
  { id: "timeline", label: "End-to-end timeline" },
];
const PROVIDERS = [
  ["DeepSeek", "Streaming", "Text deltas, reasoning deltas, tool-call fragments and a usage event may arrive separately."],
  ["Local", "Streaming", "Uses the OpenAI-compatible streaming path; actual chunk behavior depends on the endpoint."],
  ["Bedrock V3.x without R1 in the model ID", "Streaming", "Uses the Chat Completions path with native tool calls."],
  ["Bedrock R1 and other non-V3 IDs", "Streaming", "The binary AWS event stream is bridged to SSE internally; prompt-encoded tool calls are parsed at end of stream, and <think> markup is filtered into reasoning callbacks."],
  ["Vertex", "Streaming", "Uses the OpenAI-compatible SSE endpoint."],
];
const EVENTS = [
  ["Assistant content delta", "Appended to the response and sent immediately to the text callback."],
  ["Reasoning delta", "Appended separately and sent only to the optional thinking callback."],
  ["Tool-call fragment", "Merged by tool index until the provider stream ends."],
  ["Usage object", "Added to session counters even when the event has no choices."],
  ["Empty or metadata-only event", "Ignored after any usage object is recorded."],
];
const COMPLETION = [
  ["Final response with no tools", "History is saved; end-of-turn work runs; completion fires."],
  ["Response with tools", "Tools run, results enter model context, and another provider request begins."],
  ["Empty first choice", "Completion fires without adding assistant text."],
  ["Abort", "Partial streamed text is saved when present; completion fires."],
  ["Proxy error event", "A visible warning becomes assistant output; completion fires."],
  ["Iteration 101", "The run throws after recording a maximum-iteration error."],
];
export default function StreamingBehavior() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Headless</span><span className="sep">/</span><span className="current">Streaming behavior</span>
        </nav>

        <div className="hero">
          <h1>Streaming behavior</h1>
          <p className="tagline">
            How provider events become assistant text, reasoning, tool activity, usage counters and final
            headless output.
          </p>
        </div>

        <section id="two-layers">
          <h2><span className="anchor">#</span>Two layers of streaming</h2>
          <p>
            Provider streaming and CLI output streaming are separate decisions. All providers stream by default, and
            <code className="inline">DEEPSEEK_NO_STREAM=1</code> selects the aggregated response path instead. Pipe mode
            then either writes each assistant-text callback to stdout immediately, or buffers all callbacks until
            completion when <code className="inline">--json</code> is active.
          </p>
          <CodeBlock lang="bash">{"# All providers stream by default\ndeepseek --pipe \"explain the build graph\"\n\n# DEEPSEEK_NO_STREAM=1 selects the aggregated provider path\nDEEPSEEK_NO_STREAM=1 deepseek --pipe \"explain the build graph\""}</CodeBlock>
          <Note>
            JSON mode does not make the provider non-streaming. It only changes how pipe mode exposes the
            assistant-text callbacks on stdout.
          </Note>
        </section>

        <section id="providers">
          <h2><span className="anchor">#</span>Provider behavior</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "32%" }}>Provider / model</th><th style={{ width: "18%" }}>Agent path</th><th>Observable consequence</th></tr></thead>
              <tbody>{PROVIDERS.map(([provider, path, consequence]) => <tr key={provider}><td>{provider}</td><td>{path}</td><td>{consequence}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            All providers now stream by default. Bedrock model selection still matters for <em>how</em> they
            stream: identifiers containing <code className="inline">v3</code> but not
            <code className="inline">r1</code> use the Chat Completions endpoint with native tool calls, while
            Bedrock R1 and every other Bedrock identifier without <code className="inline">v3</code> use native
            InvokeModel with an internal event-stream-to-SSE bridge and prompt-encoded tool calls.
          </p>
          <p>
            Setting <code className="inline">DEEPSEEK_NO_STREAM=1</code> switches every provider back to the
            aggregated (one response at a time) path. The same callbacks fire either way; the aggregated path
            simply delivers larger chunks with longer time-to-first-text.
          </p>
        </section>

        <section id="text">
          <h2><span className="anchor">#</span>Assistant text</h2>
          <p>
            On the streaming path, every non-empty content delta is appended to the current assistant response
            and emitted as-is. Empty and null content do not trigger a callback. Pipe mode adds no separator,
            timestamp, Markdown transformation or terminal escape sequence.
          </p>
          <CodeBlock lang="text">{"Provider events:  \"The build\"  →  \" has three\"  →  \" stages.\"\nPlain stdout:    The build has three stages."}</CodeBlock>
          <p>
            Text emitted before a tool call is not withdrawn. After tools finish, a later model request may add
            more text, and plain stdout is the direct concatenation of all emitted content across iterations.
            Any visual boundary must come from the model's own text.
          </p>
          <CodeBlock lang="text">{"I will inspect the manifest.\nThe package exposes two entry points."}</CodeBlock>
          <Note>
            A consumer that needs exactly one complete value should use
            <code className="inline">--json</code> and parse <code className="inline">output</code>, not try to
            infer response boundaries from chunks.
          </Note>
        </section>

        <section id="thinking">
          <h2><span className="anchor">#</span>Reasoning content</h2>
          <p>
            Reasoning is collected separately from assistant content. Streaming providers can deliver it as
            reasoning deltas; non-streaming providers can return a complete reasoning field, and Bedrock's
            prompt-based path can also extract supported thinking tags.
          </p>
          <p>
            The interactive UI supplies a thinking callback and can render that channel according to interface
            settings. Pipe mode does not supply one. Consequently, reasoning is not written to stdout, stderr or
            the JSON <code className="inline">output</code> field. It may still be preserved in conversation
            history for provider continuity.
          </p>
          <Note>
            <code className="inline">--json</code> is not a raw provider-event dump. There is no reasoning field
            in its current envelope.
          </Note>
        </section>

        <section id="tools">
          <h2><span className="anchor">#</span>Tool-call assembly</h2>
          <p>
            Streaming tool calls can arrive in pieces: identifier and name in one event, then argument text in
            later events. The agent groups fragments by the provider's tool index, concatenates argument text,
            and waits for the response stream to end before parsing and executing calls.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "29%" }}>Event</th><th>Agent behavior</th></tr></thead>
              <tbody>{EVENTS.map(([event, behavior]) => <tr key={event}><td>{event}</td><td>{behavior}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Invalid tool-argument JSON falls back to an empty argument object and then proceeds through normal
            validation and execution checks. Read-only or isolated calls can run concurrently when every call
            in the batch is parallel-safe; a mixed batch runs sequentially.
          </p>
          <CodeBlock lang="text">{"[tool] read_file\n[tool] grep"}</CodeBlock>
          <p>
            In pipe mode, those progress lines appear when tool-call callbacks fire, not while argument fragments
            are arriving. Concurrent batches can make callback order an execution-time observation rather than
            a durable model-order guarantee.
          </p>
        </section>

        <section id="usage">
          <h2><span className="anchor">#</span>Usage-only events</h2>
          <p>
            Streaming requests ask the provider to include usage. Providers commonly send the final usage object
            in an event whose choices array is empty. The agent records usage before looking for a content delta,
            so this event updates totals without producing text or crashing the stream.
          </p>
          <CodeBlock lang="text">{"Assistant output: Repository scan complete.\n/cost\nModel: deepseek-v4-flash\nTokens: 18,420 total\n  prompt: 17,900 (12,100 cached)\n  completion: 520\nEstimated cost: $0.0010"}</CodeBlock>
          <p>
            Each response's prompt, completion and cache-hit counts are accumulated. The most recent prompt
            count also becomes current context usage. If the provider omits usage, the response still completes
            but these counters do not advance.
          </p>
        </section>

        <section id="completion">
          <h2><span className="anchor">#</span>Completion conditions</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "34%" }}>Condition</th><th>What happens</th></tr></thead>
              <tbody>{COMPLETION.map(([condition, behavior]) => <tr key={condition}><td>{condition}</td><td>{behavior}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            A response containing tool calls is an iteration boundary, not a turn boundary. Tool results are
            appended to model context and the loop starts another request. Only a no-tool response, an explicit
            soft-stop path or an abort reaches completion.
          </p>
          <p>
            Once the provider reports context usage at or above the compaction threshold, the streaming path may
            compact immediately before continuing. Pipe mode does not render the compaction callback, but the
            additional model request and changed context can affect latency and cost.
          </p>
        </section>

        <section id="errors">
          <h2><span className="anchor">#</span>Retries, aborts and errors</h2>
          <p>
            Request creation retries HTTP-style status 429 and 503 with delays of 1, 2 and 4 seconds. An abort is
            never retried. A failure thrown later while consuming an already-created stream is not wrapped by
            that retry loop and propagates unless it is recognized as an abort.
          </p>
          <p>
            On a streaming abort, already collected assistant or reasoning content is saved, then completion
            fires. On a non-streaming abort during the request, completion fires without a response. In JSON
            pipe mode these paths can therefore produce <code className="inline">ok: true</code> with partial or
            empty output.
          </p>
          <p>
            A provider proxy can also return an error as a normal stream event instead of throwing. That event
            becomes visible assistant text prefixed with a warning, history is saved, and completion fires. It
            is a soft completion rather than a process failure.
          </p>
          <CodeBlock lang="json">{"{\"ok\":true,\"output\":\"⚠ Proxy error: upstream overloaded\",\"tools\":[]}"}</CodeBlock>
          <Note>
            Automation should not equate a completed JSON envelope with a complete model answer. Apply a
            semantic check when partial output or a visible warning is unacceptable.
          </Note>
        </section>

        <section id="backpressure">
          <h2><span className="anchor">#</span>Backpressure and consumers</h2>
          <p>
            Plain-mode token writes, tool-progress writes and the final success envelope use direct stream
            writes. Their boolean backpressure result is not awaited. Only early handled error output goes
            through an explicit drain-aware write.
          </p>
          <p>
            Normal local pipes usually buffer successfully, but the implementation does not promise producer
            throttling for a permanently slow consumer. JSON mode reduces the number of stdout writes to one at
            completion, at the cost of retaining the full assistant output in memory.
          </p>
          <CodeBlock lang="bash">{"# Keep stderr out of a slow structured consumer\ndeepseek --pipe --json \"analyze the repository\" \\\n  2> progress.log \\\n  | jq -r .output > report.md"}</CodeBlock>
        </section>

        <section id="timeline">
          <h2><span className="anchor">#</span>End-to-end timeline</h2>
          <CodeBlock lang="text">{"1. Read stdin to EOF and build one user message\n2. Optionally refine the prompt\n3. Start provider request\n4. Record reasoning, assistant text, tool fragments and usage\n5. If tools exist: execute them, append results, return to step 3\n6. Save the final response and run end-of-turn work\n7. Emit newline or JSON from the completion callback\n8. Shut down the agent and exit"}</CodeBlock>
          <p>
            This ordering explains the observable contract: no tool begins before its response finishes,
            stderr can continue between assistant-text segments, JSON waits for all iterations, and a single
            user turn can contain many provider calls.
          </p>
          <Note>
            Continue with <a href="/docs/cost-accounting">Cost accounting</a> for the usage counters updated by
            these responses and their current blind spots.
          </Note>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
