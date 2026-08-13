import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "synopsis", label: "Synopsis" },
  { id: "parsing", label: "How arguments are parsed" },
  { id: "interactive", label: "Starting a session" },
  { id: "agent", label: "Loading an agent" },
  { id: "resume", label: "Resuming a session" },
  { id: "subcommands", label: "Subcommands" },
  { id: "pipe", label: "Pipe mode" },
  { id: "json", label: "JSON output" },
  { id: "safety", label: "The pipe-mode safety default" },
  { id: "exit", label: "Exit codes" },
  { id: "env", label: "Environment" },
  { id: "devlog", label: "Development logging" },
];

const FORMS = [
  ["deepseek", "Start an interactive session in the current directory."],
  ["deepseek \"fix the bug in app.ts\"", "Start with an initial message."],
  ["deepseek agent <name>", "Load a custom agent."],
  ["deepseek agent <name> \"message\"", "Load an agent with an initial message."],
  ["deepseek --resume <session-id>", "Resume a specific session."],
  ["deepseek --resume", "Open the session picker."],
  ["deepseek doctor", "Diagnose local setup and exit."],
  ["deepseek update", "Update to the latest version."],
  ["deepseek logout", "Remove saved credentials."],
  ["deepseek help", "Show usage and exit."],
  ["deepseek version", "Print the version and exit."],
];

const ALIASES = [
  ["help", "--help, -h", "Usage summary."],
  ["version", "v, --version, -v", "Installed version."],
  ["doctor", "—", "Runs the same checks as the /doctor command."],
  ["update", "—", "Update to the latest published version."],
  ["logout", "—", "Clear all stored credentials and API keys."],
];

const PIPE_FORMS = [
  ["echo \"task\" | deepseek --pipe", "Prompt from stdin."],
  ["deepseek --pipe \"task\"", "Prompt from arguments."],
  ["cat file.ts | deepseek --pipe \"explain\"", "Argument is the instruction, stdin is the data."],
  ["echo \"task\" | deepseek --pipe --json", "One JSON object on stdout."],
];

const JSON_FIELDS = [
  ["ok", "boolean", "Whether the run completed."],
  ["output", "string", "The full accumulated answer."],
  ["tools", "string[]", "Tool names in call order."],
  ["error", "string", "Present instead of output/tools when ok is false."],
];

const ENV = [
  ["DEEPSEEK_API_KEY", "Provider key. Used when there is no saved configuration."],
  ["DEEPSEEK_BASE_URL", "Override the API base URL — gateways, proxies, local models."],
  ["DEEPSEEK_DISABLE_WORKFLOWS", "Set to 1 to disable dynamic workflows entirely."],
  ["NODE_ENV", "development enables the dev log described below."],
];

export default function CliReference() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">CLI reference</span>
        </nav>

        <div className="hero">
          <h1>CLI reference</h1>
          <p className="tagline">
            Every invocation form, subcommand and flag — plus what each one does before the TUI even
            renders.
          </p>
        </div>

        <section id="synopsis">
          <h2><span className="anchor">#</span>Synopsis</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "44%" }}>Form</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {FORMS.map(([f, e]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The surface is deliberately small. Configuration lives in{" "}
            <a href="/docs/settings">settings files</a> and{" "}
            <a href="/docs/env-vars">environment variables</a>, not in a long list of flags — which keeps the
            same behavior available to interactive, headless and CI use without three ways to express it.
          </p>
        </section>

        <section id="parsing">
          <h2><span className="anchor">#</span>How arguments are parsed</h2>
          <p>
            Parsing has a shape worth knowing, because it explains several behaviors that would otherwise
            look arbitrary.
          </p>
          <p>
            <b><code className="inline">--pipe</code> is checked first, before anything else loads.</b> It is
            tested directly against <code className="inline">process.argv</code> at the top of the entry point,
            and if present the headless path is imported and the process exits without ever touching the TUI
            machinery. That is why pipe mode starts fast and why it cannot be combined with interactive
            forms.
          </p>
          <p>
            <b><code className="inline">--pipe</code> and <code className="inline">--json</code> are stripped
            before the rest is parsed.</b> Everything else sees an argument list with those removed, so their
            position on the command line does not matter.
          </p>
          <p>
            <b>Subcommands are matched on the first argument only.</b>{" "}
            <code className="inline">deepseek doctor</code> runs diagnostics;{" "}
            <code className="inline">deepseek "run doctor"</code> is an initial message. The dispatch checks{" "}
            <code className="inline">args[0]</code> against a fixed list and otherwise treats the first argument
            as your prompt.
          </p>
          <p>
            <b><code className="inline">--resume</code> is found by index, not position.</b> It is located with{" "}
            <code className="inline">indexOf</code> and the following argument is taken as the session id — so
            it can appear anywhere, and an absent following argument is meaningful rather than an error.
          </p>
        </section>

        <section id="interactive">
          <h2><span className="anchor">#</span>Starting a session</h2>
          <CodeBlock lang="bash">{`$ cd my-project
$ deepseek

# or start with the first message already typed
$ deepseek "why is the auth test failing?"`}</CodeBlock>
          <p>
            The working directory becomes the session workspace. That determines what the agent reads by
            default and what counts as <code className="inline">outside_workspace</code> for{" "}
            <a href="/docs/permissions">permissions</a>, which is why launching from your home directory
            produces many more prompts than launching from the repository.
          </p>
          <p>
            Plain <code className="inline">deepseek</code> starts a fresh conversation unless
            <code className="inline">sessions.autoResume</code> is set to
            <code className="inline">project-last</code>. It does not open the picker by default; the explicit
            picker form is <code className="inline">deepseek --resume</code> without an ID.
          </p>
          <p>
            Inside the TUI, <code className="inline">/cwd</code> or <code className="inline">/cd</code> can
            rebase the agent workspace without changing the operating-system process directory. Consequently,
            a relative path passed to a later <code className="inline">/cwd</code> is resolved against the
            directory from which DeepSeek Code was launched, not against the workspace currently displayed.
            Prefer an absolute path after the first move.
          </p>
        </section>

        <section id="agent">
          <h2><span className="anchor">#</span>Loading an agent</h2>
          <CodeBlock lang="bash">{`$ deepseek agent reviewer
$ deepseek agent reviewer "check src/auth for injection risks"`}</CodeBlock>
          <p>
            The <code className="inline">agent</code> subcommand takes a name and an optional initial message —{" "}
            <code className="inline">args[1]</code> and <code className="inline">args[2]</code>. The name resolves
            through the layered agent registry: built-ins, then{" "}
            <code className="inline">~/.deepseek/agents</code>, then <code className="inline">.deepseek/agents</code>,
            then <code className="inline">.deepseek/agents.local</code>.
          </p>
          <p>
            A missing name is not an error at parse time — it resolves to{" "}
            <code className="inline">null</code> and the failure surfaces where it is meaningful, when the
            registry cannot find it. See <a href="/docs/agents">Agents</a>.
          </p>
        </section>

        <section id="resume">
          <h2><span className="anchor">#</span>Resuming a session</h2>
          <CodeBlock lang="bash">{`$ deepseek --resume a1b2c3d4e5f6   # one 12-character hexadecimal ID
$ deepseek --resume               # project-scoped interactive picker`}</CodeBlock>
          <p>
            Omitting the id is a distinct, supported mode rather than a mistake. The parser sets a{" "}
            <code className="inline">resumePicker</code> flag when the argument after{" "}
            <code className="inline">--resume</code> is undefined, and you get a list of sessions for the current
            project to choose from.
          </p>
          <p>
            That design accounts for how the feature is actually used: you rarely remember a session id, and
            requiring one would mean listing sessions first, copying an id, and re-running the command.
          </p>
          <p>
            Picker and exact-ID lookup both require the saved session&apos;s absolute workspace to equal the shell&apos;s
            current absolute directory. An ID saved under another repository is treated as missing until you
            launch from that repository. Current interactive IDs contain exactly twelve hexadecimal characters.
          </p>
          <p>
            Resume hydrates the saved model-facing messages, visible transcript and optional goal into a
            <b> new process with a new session ID</b>. It does not force the saved provider, model or active-agent
            metadata onto the live runtime; current credentials, CLI agent selection and effective settings win.
            It also does not restore process counters, the live modified-file tracker or the raw last prompt used
            by <code className="inline">/retry</code>.
          </p>
          <p>
            Because the new ID selects a new orchestration snapshot, ordinary conversation resume does not
            automatically reattach the prior session&apos;s task graph. Running and queued workers from the old
            process should not be assumed to continue.
          </p>
          <p>
            If an ID or picker selection cannot be resolved, the current UI displays “Session not found.
            Starting a new session.” but does not transition to the normal input view. Restart without the bad
            ID to begin a usable fresh conversation.
          </p>
          <Note>
            A handled SIGINT or SIGTERM prints the current process&apos;s resume command. The in-app
            <code className="inline">/quit</code> path exits directly and does not print that hint; use the picker
            or retain the ID when you need to return to it.
          </Note>
        </section>

        <section id="subcommands">
          <h2><span className="anchor">#</span>Subcommands</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "18%" }}>Subcommand</th>
                  <th style={{ width: "26%" }}>Also accepts</th>
                  <th>Effect</th>
                </tr>
              </thead>
              <tbody>
                {ALIASES.map(([s, a, e]) => (
                  <tr key={s}>
                    <td><code className="inline">{s}</code></td>
                    <td><code className="inline">{a}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">help</code> and <code className="inline">version</code> each accept three
            spellings — the bare word, the long flag and the short flag. Accepting{" "}
            <code className="inline">deepseek help</code>, <code className="inline">deepseek --help</code> and{" "}
            <code className="inline">deepseek -h</code> costs one line of parsing and removes a category of "the
            tool did not understand me".
          </p>
          <CodeBlock lang="bash">{`$ deepseek doctor
✓ Runtime: Bun 1.1.38
✓ Workspace: /home/you/proj
✓ Git: available
✗ ripgrep: not found on PATH; search may be slower
✓ Credentials: configured

1 check needs attention.`}</CodeBlock>
          <p>
            <code className="inline">deepseek doctor</code> runs the same checks as the in-session{" "}
            <code className="inline">/doctor</code> command, so it works before you have a session at all — which
            is exactly when a credentials problem needs diagnosing. See{" "}
            <a href="/docs/debug-config">Debug your config</a>.
          </p>
        </section>

        <section id="pipe">
          <h2><span className="anchor">#</span>Pipe mode</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "46%" }}>Form</th><th>Behavior</th></tr>
              </thead>
              <tbody>
                {PIPE_FORMS.map(([f, b]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            When both a prompt argument and stdin are present, they are composed rather than concatenated —
            the argument becomes the instruction and stdin arrives beneath it inside a fenced block:
          </p>
          <CodeBlock lang="text">{`<argument prompt>

\`\`\`
<stdin content>
\`\`\``}</CodeBlock>
          <p>
            The fence is a delimiter, not formatting: it marks where content the agent should <em>read</em>{" "}
            begins, separate from the instruction it should <em>follow</em>. With neither argument nor stdin
            you get usage and exit 1.
          </p>
          <p>
            Progress goes to <b>stderr</b> as <code className="inline">[tool] &lt;name&gt;</code> lines, so you
            can watch a long run without polluting the stdout you are parsing. Full detail in{" "}
            <a href="/docs/headless">Headless mode</a>.
          </p>
        </section>

        <section id="json">
          <h2><span className="anchor">#</span>JSON output</h2>
          <p>
            <code className="inline">--json</code> replaces streaming text with exactly one JSON object printed
            at the end:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Field</th><th style={{ width: "18%" }}>Type</th><th>Contents</th></tr>
              </thead>
              <tbody>
                {JSON_FIELDS.map(([f, t, c]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`$ deepseek --pipe --json "list every TODO in src/" | jq -r .output`}</CodeBlock>
          <p>
            Missing provider configuration and an empty prompt are handled as{" "}
            <code className="inline">ok: false</code> objects on stdout. Other runtime or provider failures
            are not guaranteed to emit JSON, so a consumer must check the exit code and tolerate empty or
            non-JSON stdout on failure.
          </p>
        </section>

        <section id="safety">
          <h2><span className="anchor">#</span>The pipe-mode safety default</h2>
          <p>
            Before loading configuration or reading input, headless mode installs a shell confirmation
            policy that <b>always refuses</b> operations requiring an interactive decision.
          </p>
          <p>
            Every shell command that would require a confirmation is denied. Not queued, not auto-approved.
            The interactive gate is a real control, and the correct behavior when it cannot be presented is
            to fail closed — auto-approving in CI would mean an{" "}
            <code className="inline">rm -rf</code> a human would have stopped runs unattended instead.
          </p>
          <p>
            All other <a href="/docs/permissions">permission rules</a> still apply. A settings allow rule can
            satisfy ordinary permission matching, but it cannot bypass a mandatory high-risk confirmation;
            those operations remain blocked when no interactive handler exists.
          </p>
        </section>

        <section id="exit">
          <h2><span className="anchor">#</span>Exit codes</h2>
          <CodeBlock lang="text">{`0    the run completed
1    no provider configured, no prompt supplied, or the run failed`}</CodeBlock>
          <p>
            The code reflects whether the <b>agent ran</b>, not whether it <b>approved of what it found</b>. A
            review that surfaces twelve critical bugs exits 0 — it did its job. To gate a pipeline on the
            finding, ask for a machine-checkable answer and test it:
          </p>
          <CodeBlock lang="bash">{`result=$(deepseek --pipe --json "any hardcoded secrets in src/? answer only YES or NO")
echo "$result" | jq -e '.output | test("^NO")' > /dev/null || exit 1`}</CodeBlock>
          <p>
            The pipe runner calls the agent shutdown path from a <code className="inline">finally</code> block.
            Treat process exit as the lifecycle boundary; the current shutdown method does not separately
            promise an explicit flush or close operation for every persistence and MCP subsystem.
          </p>
        </section>

        <section id="env">
          <h2><span className="anchor">#</span>Environment</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Variable</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {ENV.map(([v, e]) => (
                  <tr key={v}>
                    <td><code className="inline">{v}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Credentials resolve from saved configuration first and the environment second; endpoints resolve
            the other way round, with an explicit setting beating the variable. The full list is in{" "}
            <a href="/docs/env-vars">Environment variables</a>.
          </p>
        </section>

        <section id="devlog">
          <h2><span className="anchor">#</span>Development logging</h2>
          <p>
            With <code className="inline">NODE_ENV=development</code>, stderr and uncaught errors are mirrored
            to <code className="inline">~/.deepseek/logs/dev.log</code>, timestamped per line. The file is opened
            with <code className="inline">flags: 'w'</code>, so each run starts a clean log rather than appending
            to a growing one.
          </p>
          <p>
            The reason this exists is specific to a TUI: the terminal is the application's canvas, so
            anything written to stderr corrupts the rendering. Redirecting to a file is the only way to have
            both a usable interface and readable diagnostics.
          </p>
          <p>
            A related detail you would otherwise find confusing — three React reconciler warnings are
            suppressed from the terminal but still written to the log:
          </p>
          <CodeBlock lang="text">{`Encountered two children with the same key
Each child in a list should have a unique
Raw mode is not supported`}</CodeBlock>
          <p>
            They fire during reconciler initialization, they are not actionable, and left unfiltered they
            scribble over the interface on every launch. Suppressed on screen, preserved on disk.
          </p>
          <p>
            <code className="inline">uncaughtException</code> and{" "}
            <code className="inline">unhandledRejection</code> handlers write full stacks to the same file, which
            is the first place to look when a session dies without a visible message.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
