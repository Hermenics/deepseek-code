import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "contract", label: "The JSON contract" },
  { id: "success", label: "Success envelope" },
  { id: "failure", label: "Failure envelope" },
  { id: "tools", label: "What tools means" },
  { id: "streams", label: "stdout and stderr" },
  { id: "escaping", label: "Encoding and escaping" },
  { id: "consumers", label: "Robust consumers" },
  { id: "non-guarantees", label: "Important non-guarantees" },
];

const SUCCESS_FIELDS = [
  ["ok", "boolean", "Always true in the normal completion envelope."],
  ["output", "string", "Assistant text accumulated across every token callback in the turn."],
  ["tools", "string[]", "Tool names in callback order; duplicates are preserved."],
];

const FAILURE_FIELDS = [
  ["ok", "boolean", "False for a handled pipe-mode preflight failure."],
  ["error", "string", "A human-readable setup or usage message."],
];

const STATES = [
  ["Normal final answer", "One success object followed by a newline", "0"],
  ["Missing provider credentials", "One failure object followed by a newline", "1"],
  ["No prompt after stdin trim", "One failure object followed by a newline", "1"],
  ["Confirmation denied or tool blocked", "Usually a success object; the model receives the block result", "Usually 0"],
  ["Proxy error delivered as a stream chunk", "Success object whose output contains the warning", "0"],
  ["Thrown runtime/provider error", "No guaranteed JSON envelope", "Runtime-defined nonzero"],
];

export default function JsonOutput() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Headless</span><span className="sep">/</span><span className="current">JSON output</span>
        </nav>

        <div className="hero">
          <h1>JSON output</h1>
          <p className="tagline">
            A compact end-of-turn envelope for pipe-mode consumers, with the precise boundaries automation
            must handle today.
          </p>
        </div>

        <section id="contract">
          <h2><span className="anchor">#</span>The JSON contract</h2>
          <p>
            Add <code className="inline">--json</code> to an invocation that already contains
            <code className="inline">--pipe</code>. Assistant text is accumulated in memory instead of being
            written incrementally, and a normal completion writes one compact JSON object plus a trailing
            newline to stdout.
          </p>
          <CodeBlock lang="bash">{"deepseek --pipe --json \"name the top-level packages\" | jq ."}</CodeBlock>
          <CodeBlock lang="json">{"{\n  \"ok\": true,\n  \"output\": \"The top-level packages are…\",\n  \"tools\": [\"read_folder\", \"read_file\"]\n}"}</CodeBlock>
          <Note>
            <code className="inline">--json</code> is an output modifier, not a mode selector. Without
            <code className="inline">--pipe</code>, it does not produce this envelope.
          </Note>
        </section>

        <section id="success">
          <h2><span className="anchor">#</span>Success envelope</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "17%" }}>Field</th><th style={{ width: "18%" }}>Type</th><th>Meaning</th></tr></thead>
              <tbody>{SUCCESS_FIELDS.map(([field, type, meaning]) => <tr key={field}><td><code className="inline">{field}</code></td><td><code className="inline">{type}</code></td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            The envelope has no schema version, token counts, costs, timing, model, provider, tool arguments,
            tool results or structured assistant payload. The <code className="inline">output</code> field is
            always plain accumulated text, even when the model happened to format that text as JSON.
          </p>
          <CodeBlock lang="bash">{"result=$(deepseek --pipe --json \"return a concise dependency summary\")\nprintf '%s\\n' \"$result\" | jq -e '.ok == true and (.output | type == \"string\")'"}</CodeBlock>
          <p>
            Empty output is valid. An empty provider choice or a content-free final response can reach the
            normal completion callback with an empty string.
          </p>
        </section>

        <section id="failure">
          <h2><span className="anchor">#</span>Failure envelope</h2>
          <p>
            The current pipe entry point creates a failure envelope for exactly two handled preflight cases:
            no saved provider and no <code className="inline">DEEPSEEK_API_KEY</code>, or no prompt after both
            argument parsing and stdin trimming.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "17%" }}>Field</th><th style={{ width: "18%" }}>Type</th><th>Meaning</th></tr></thead>
              <tbody>{FAILURE_FIELDS.map(([field, type, meaning]) => <tr key={field}><td><code className="inline">{field}</code></td><td><code className="inline">{type}</code></td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
          <CodeBlock lang="json">{"{\"ok\":false,\"error\":\"DEEPSEEK_API_KEY not set and no saved config found\"}"}</CodeBlock>
          <CodeBlock lang="json">{"{\"ok\":false,\"error\":\"Usage: echo \\\"task\\\" | deepseek --pipe OR deepseek --pipe \\\"task\\\"\"}"}</CodeBlock>
          <Note>
            This is not a universal exception envelope. Errors thrown while creating the agent, contacting the
            provider, running initialization, executing the loop or shutting down are not caught and converted
            to <code className="inline">{"{ ok: false, error }"}</code> by pipe mode.
          </Note>
        </section>

        <section id="tools">
          <h2><span className="anchor">#</span>What <code className="inline">tools</code> means</h2>
          <p>
            Each agent tool-call callback appends its name. Order and duplicates are preserved, so two reads
            appear twice. The array is useful as an activity trace, but it is not an execution audit.
          </p>
          <CodeBlock lang="json">{"{\n  \"ok\": true,\n  \"output\": \"I inspected both manifests. The second path was unavailable.\",\n  \"tools\": [\"read_file\", \"read_file\"]\n}"}</CodeBlock>
          <p>
            The callback can fire for calls blocked by interaction mode, hooks, permission rules, risk checks,
            agent allowlists or missing confirmation. A tool that throws after its call is observed also remains
            in the array. Conversely, arguments, results, success state, duration and parallelism are absent.
          </p>
          <Note>
            Do not use <code className="inline">tools.length &gt; 0</code> as proof that the repository was read,
            written or validated. Ask for evidence in <code className="inline">output</code> and verify the
            relevant files or commands independently when the distinction matters.
          </Note>
        </section>

        <section id="streams">
          <h2><span className="anchor">#</span>stdout and stderr</h2>
          <p>
            JSON mode suppresses assistant token writes until completion; it does not suppress tool progress.
            Every observed tool callback still writes a line to stderr. Shell pipelines connect stdout only by
            default, which keeps <code className="inline">jq</code> input clean while progress stays visible.
          </p>
          <CodeBlock lang="text">{"$ deepseek --pipe --json \"inspect the test layout\" | jq -r .output\n[tool] read_folder\n[tool] read_file\nThe tests are grouped by…"}</CodeBlock>
          <p>
            In the display above, the bracketed lines came from stderr and the final line came through
            <code className="inline">jq</code>. Redirect explicitly when running under systems that merge the
            two streams.
          </p>
          <CodeBlock lang="bash">{"deepseek --pipe --json \"inspect the test layout\" \\\n  > result.json 2> progress.log\n\ndeepseek --pipe --json \"inspect the test layout\" \\\n  2>/dev/null | jq -e '.ok'"}</CodeBlock>
        </section>

        <section id="escaping">
          <h2><span className="anchor">#</span>Encoding and escaping</h2>
          <p>
            The object is serialized as standard compact JSON. Quotes, backslashes, control characters and
            newlines inside assistant text are escaped by the serializer; Unicode text is valid UTF-8. Parse
            the object rather than stripping quotes or splitting on punctuation.
          </p>
          <CodeBlock lang="json">{"{\"ok\":true,\"output\":\"First line\\nSecond line: \\\"quoted\\\"\",\"tools\":[]}"}</CodeBlock>
          <CodeBlock lang="bash">{"deepseek --pipe --json \"give a two-line answer\" \\\n  | jq -r '.output'"}</CodeBlock>
          <p>
            A trailing newline follows the outer object. The newline inside
            <code className="inline">output</code> remains escaped on the wire and is restored by a JSON parser.
          </p>
        </section>

        <section id="consumers">
          <h2><span className="anchor">#</span>Robust consumers</h2>
          <p>
            Treat process status, JSON syntax, envelope shape and your semantic acceptance rule as separate
            checks. This avoids accepting truncated output, a non-JSON stack trace, an error envelope or a
            perfectly successful review that found a release blocker.
          </p>
          <CodeBlock lang="bash">{"result_file=$(mktemp)\nif deepseek --pipe --json \"review the staged diff\" >\"$result_file\"; then\n  jq -e '.ok == true and (.output | type == \"string\") and (.tools | type == \"array\")' \\\n    \"$result_file\" >/dev/null || exit 1\n  jq -r '.output' \"$result_file\"\nelse\n  status=$?\n  jq -r '.error? // \"headless run failed before a JSON envelope was produced\"' \\\n    \"$result_file\" >&2\n  exit \"$status\"\nfi"}</CodeBlock>
          <p>
            If stdout may be empty on failure, let the parser fail normally or use the optional-field fallback
            shown above. Never replace the process status with the status of a later
            <code className="inline">jq</code>, <code className="inline">printf</code> or logging command.
          </p>
        </section>

        <section id="non-guarantees">
          <h2><span className="anchor">#</span>Important non-guarantees</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "31%" }}>Observed outcome</th><th style={{ width: "45%" }}>stdout contract</th><th>Status</th></tr></thead>
              <tbody>{STATES.map(([state, stdout, status]) => <tr key={state}><td>{state}</td><td>{stdout}</td><td><code className="inline">{status}</code></td></tr>)}</tbody>
            </table>
          </div>
          <p>
            <code className="inline">ok</code> means the completion callback selected a success envelope. It
            does not mean every tool executed, every requested edit happened, the answer met your policy, or
            the provider reported complete usage metadata.
          </p>
          <Note>
            Pin consumers to the fields documented here and tolerate additional fields if they appear in a
            future version. Because the current envelope has no schema version, strict rejection of unknown
            keys would make compatible evolution needlessly brittle.
          </Note>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
