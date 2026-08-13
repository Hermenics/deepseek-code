import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "contract", label: "The pipe-mode contract" },
  { id: "activation", label: "Activation and arguments" },
  { id: "input", label: "Prompt and stdin" },
  { id: "startup", label: "Startup and configuration" },
  { id: "execution", label: "What the agent runs" },
  { id: "streams", label: "stdin, stdout and stderr" },
  { id: "permissions", label: "Non-interactive permissions" },
  { id: "lifecycle", label: "Completion and cleanup" },
  { id: "recipes", label: "Reliable shell recipes" },
  { id: "limits", label: "Current limits" },
];

const INPUT_FORMS = [
  ["deepseek --pipe \"inspect src/auth\"", "Arguments", "All remaining arguments become one prompt."],
  ["printf '%s\\n' 'inspect src/auth' | deepseek --pipe", "stdin", "stdin becomes the prompt after trimming."],
  ["git diff | deepseek --pipe \"review this diff\"", "Both", "Arguments are the instruction; stdin is fenced beneath it."],
];

const STREAMS = [
  ["stdin", "Prompt or supporting data", "Read completely to EOF before the agent turn starts."],
  ["stdout", "Assistant text, or the final JSON object", "The stream intended for the next program in a pipeline."],
  ["stderr", "One [tool] line per observed tool callback", "Progress remains separate from the assistant result."],
];

const STARTUP = [
  ["Credential migration", "Legacy saved configuration is migrated before provider resolution."],
  ["Provider", "A saved provider wins; without one, DEEPSEEK_API_KEY enables the DeepSeek provider."],
  ["Project context", "Merged settings, steering, AGENTS.md, DEEPSEEK.md, memory and enabled MCP tools are initialized."],
  ["Preferences", "The saved response language is applied; a disabled enchant preference disables prompt refinement."],
];

const LIMITS = [
  ["One user turn", "There is no prompt for a follow-up answer, approval or clarification."],
  ["Buffered stdin", "This is not a byte-for-byte streaming filter; large stdin is held in memory."],
  ["No normal option parser", "Unknown flags, --, and extra words are prompt text after --pipe and --json are removed."],
  ["No agent selector", "The pipe parser does not implement the interactive agent <name> form."],
  ["No resume form", "--resume is prompt text in pipe mode, not session selection."],
  ["No cost envelope", "Pipe output does not expose primary-agent token or cost counters."],
];

export default function PipeMode() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Headless</span><span className="sep">/</span><span className="current">Pipe mode</span>
        </nav>

        <div className="hero">
          <h1>Pipe mode</h1>
          <p className="tagline">
            Run one complete agent turn without rendering the terminal UI: input arrives through arguments
            and stdin, progress uses stderr, and the assistant result uses stdout.
          </p>
        </div>

        <section id="contract">
          <h2><span className="anchor">#</span>The pipe-mode contract</h2>
          <p>
            The explicit <code className="inline">--pipe</code> flag selects a dedicated entry path before the
            interactive application loads. Pipe mode still creates the normal agent, initializes project
            context, permits tool loops and shuts down orchestration resources. What it removes is the TUI and
            every opportunity to ask the terminal user a question during the turn.
          </p>
          <CodeBlock lang="bash">{`$ deepseek --pipe "summarize the repository architecture"
The repository is organized around an agent loop, terminal UI, tools…`}</CodeBlock>
          <Note>
            Piping stdin into plain <code className="inline">deepseek</code> does not select this mode. The
            <code className="inline">--pipe</code> flag is mandatory even when stdin is not a TTY.
          </Note>
        </section>

        <section id="activation">
          <h2><span className="anchor">#</span>Activation and arguments</h2>
          <p>
            The flag may appear anywhere. Pipe parsing removes every exact occurrence of
            <code className="inline">--pipe</code> and <code className="inline">--json</code>; it joins every
            other argument with a single space. There is no second pass for subcommands or interactive flags.
          </p>
          <CodeBlock lang="bash">{`deepseek audit --pipe src --json
# prompt seen by the agent: audit src
# output mode: JSON`}</CodeBlock>
          <p>
            Shell quoting happens before DeepSeek Code sees the arguments. Quote prompts containing
            substitutions, redirects, globs or other shell syntax. A conventional
            <code className="inline">--</code> separator has no special meaning here and becomes part of the
            prompt.
          </p>
          <Note>
            <code className="inline">--json</code> alone does not activate headless mode. Outside pipe mode it
            is removed from the interactive argument list and produces no JSON output.
          </Note>
        </section>

        <section id="input">
          <h2><span className="anchor">#</span>Prompt and stdin</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "43%" }}>Invocation</th><th style={{ width: "13%" }}>Source</th><th>Result</th></tr></thead>
              <tbody>
                {INPUT_FORMS.map(([form, source, result]) => (
                  <tr key={form}><td><code className="inline">{form}</code></td><td>{source}</td><td>{result}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            stdin is decoded as UTF-8, read to EOF, and trimmed. Leading and trailing whitespace is therefore
            not preserved. If arguments and stdin are both non-empty, the exact user-facing composition is:
          </p>
          <CodeBlock lang="text">{"review this patch\n\n```\n<trimmed stdin>\n```"}</CodeBlock>
          <p>
            The fence separates the instruction from supporting data for the model, but it is not an escaping
            or trust boundary. stdin containing its own triple-backtick fence is inserted unchanged, and all
            supplied content remains model input.
          </p>
          <p>
            If both sources are empty after trimming, plain mode writes the usage line to stderr; JSON mode
            writes an error object to stdout. Both set exit status 1.
          </p>
          <CodeBlock lang="text">{`Usage: echo "task" | deepseek --pipe OR deepseek --pipe "task"`}</CodeBlock>
        </section>

        <section id="startup">
          <h2><span className="anchor">#</span>Startup and configuration</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "27%" }}>Stage</th><th>Behavior</th></tr></thead>
              <tbody>{STARTUP.map(([stage, behavior]) => <tr key={stage}><td>{stage}</td><td>{behavior}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Provider configuration is resolved before stdin is read. A saved Bedrock, Vertex or local
            provider is valid without <code className="inline">DEEPSEEK_API_KEY</code>. The environment variable
            is only the fallback when no saved provider exists.
          </p>
          <CodeBlock lang="bash">{`DEEPSEEK_API_KEY=… deepseek --pipe "explain the failing tests"
DEEPSEEK_BASE_URL=http://gateway.internal/v1 deepseek --pipe "list likely regressions"`}</CodeBlock>
          <p>
            Effective project settings still matter in headless execution. For deterministic automation,
            keep prompt refinement explicit and make the permissions needed by the task explicit too.
          </p>
          <CodeBlock lang="json">{`{
  "promptRefiner": { "enabled": false },
  "permissions": {
    "allow": ["read_file", "grep", "glob", "shell(git diff*)"]
  }
}`}</CodeBlock>
        </section>

        <section id="execution">
          <h2><span className="anchor">#</span>What the agent runs</h2>
          <p>
            One pipe invocation supplies one user message, but it may produce many provider requests. Text can
            arrive, tools can run, their results return to the model, and the cycle repeats until a response has
            no tool calls. Read-only tool batches may run concurrently; mixed or mutating batches run in order.
          </p>
          <p>
            The loop has a hard ceiling of 100 iterations. Provider requests retry status 429 and 503 up to
            three times with 1, 2 and 4 second delays. Prompt refinement may add a separate request before the
            main turn when enabled and the prompt meets its threshold.
          </p>
          <Note>
            Slash commands are not interpreted inside the supplied prompt. A prompt such as
            <code className="inline">/cost</code> is sent to the model; it does not invoke the interactive
            command dispatcher.
          </Note>
        </section>

        <section id="streams">
          <h2><span className="anchor">#</span>stdin, stdout and stderr</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "14%" }}>Stream</th><th style={{ width: "38%" }}>Carries</th><th>Operational consequence</th></tr></thead>
              <tbody>{STREAMS.map(([stream, carries, consequence]) => <tr key={stream}><td><code className="inline">{stream}</code></td><td>{carries}</td><td>{consequence}</td></tr>)}</tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`deepseek --pipe "inspect the build" > answer.txt 2> progress.log
deepseek --pipe --json "inspect the build" 2>/dev/null | jq -r .output`}</CodeBlock>
          <p>
            Plain assistant text is written as callbacks arrive. Non-streaming providers still use the same
            stdout contract, but typically deliver a response as one larger write. Tool arguments and results
            are not printed; stderr receives only the tool name.
          </p>
          <Note>
            Normal token, tool-progress and final JSON writes use direct stream writes. Only the two early
            setup-error paths explicitly wait for backpressure, so do not treat pipe mode as a formal
            lossless transport guarantee under an abruptly closing or permanently stalled consumer.
          </Note>
        </section>

        <section id="permissions">
          <h2><span className="anchor">#</span>Non-interactive permissions</h2>
          <p>
            Pipe mode installs no interactive permission handler. Explicit deny rules remain denied. Calls
            that require confirmation are blocked or cancelled and their result is returned to the model so it
            may explain the limitation or choose another route. Ordinary tools allowed by the effective
            settings can still execute, including writes.
          </p>
          <p>
            This is fail-closed for confirmation, not globally read-only. Use a project or local permission
            allowlist when a CI job must be observational only, and run the process with operating-system
            credentials that cannot deploy or mutate external systems.
          </p>
          <CodeBlock lang="json">{`{
  "permissions": {
    "allow": ["read_file", "read_folder", "grep", "glob", "git(status)", "git(diff)"]
  }
}`}</CodeBlock>
          <Note>
            A blocked tool still emits a tool callback. Its name can therefore appear on stderr and in the
            JSON <code className="inline">tools</code> array even though the operation did not execute.
          </Note>
        </section>

        <section id="lifecycle">
          <h2><span className="anchor">#</span>Completion and cleanup</h2>
          <p>
            A normal final response is saved to the shared history file, any end-of-turn work runs, and the
            completion callback writes the final newline or JSON object. The process then shuts down workflow
            and orchestration resources and exits with the current process status.
          </p>
          <p>
            Pipe mode does not create a resumable interactive session contract. It is a one-shot process, even
            though the agent may persist ordinary history, memory, checkpoints or files as their respective
            tools and settings permit.
          </p>
        </section>

        <section id="recipes">
          <h2><span className="anchor">#</span>Reliable shell recipes</h2>
          <CodeBlock lang="bash">{`# Keep result and progress separately
git diff --cached | deepseek --pipe "review this staged diff" \
  > review.md 2> review.progress

# Parse only a completed success envelope
result=$(deepseek --pipe --json "summarize package boundaries") || exit $?
printf '%s\\n' "$result" | jq -e '.ok == true' >/dev/null || exit 1
printf '%s\\n' "$result" | jq -r '.output'

# Put an exact file payload on stdin
deepseek --pipe "explain the supplied configuration" < .deepseek/settings.json`}</CodeBlock>
          <p>
            Capture the command status before another shell command overwrites it. In JSON mode, validate both
            the process status and the parsed <code className="inline">ok</code> field; a semantic finding in
            assistant text is never converted into a failing status automatically.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Current limits</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "29%" }}>Limit</th><th>What it means</th></tr></thead>
              <tbody>{LIMITS.map(([limit, meaning]) => <tr key={limit}><td>{limit}</td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
          <Note>
            For a machine-readable result contract, continue with <a href="/docs/json-output">JSON output</a>;
            for process control, see <a href="/docs/exit-codes">Exit codes</a>.
          </Note>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
