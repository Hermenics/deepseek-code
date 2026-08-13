import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What headless mode is" },
  { id: "invocation", label: "Three ways to invoke it" },
  { id: "composition", label: "How prompt and stdin combine" },
  { id: "streams", label: "The three streams" },
  { id: "json", label: "JSON output" },
  { id: "safety", label: "The safety default" },
  { id: "exit", label: "Exit codes" },
  { id: "config", label: "Configuration in headless mode" },
  { id: "ci", label: "Recipes" },
  { id: "limits", label: "Limits" },
];

const INVOCATIONS = [
  ["deepseek --pipe \"task\"", "Prompt from arguments only.", "One-off automation with a fixed instruction."],
  ["echo \"task\" | deepseek --pipe", "Prompt from stdin only.", "Piping a generated instruction."],
  ["cat file | deepseek --pipe \"explain\"", "Argument is the instruction, stdin is the data.", "The most useful form."],
];

const STREAMS = [
  ["stdout", "The model's answer — or one JSON object with --json.", "Safe to pipe into another program."],
  ["stderr", "[tool] <name> lines as tools run, and errors in non-JSON mode.", "Progress you can watch without corrupting stdout."],
  ["stdin", "Read to EOF before the run starts.", "Wrapped in a fenced block when combined with an argument prompt."],
];

const JSON_FIELDS = [
  ["ok", "boolean", "Whether the run completed."],
  ["output", "string", "The full accumulated answer."],
  ["tools", "string[]", "Names of tools called, in call order."],
  ["error", "string", "Present instead of output/tools when ok is false."],
];

const RECIPES = [
  ["Review a diff", "git diff main --name-only | deepseek --pipe \"review these files for security issues\""],
  ["Explain a failure", "tail -200 app.log | deepseek --pipe \"what is causing these errors\""],
  ["Summarize a file", "cat CHANGELOG.md | deepseek --pipe \"summarize the last three releases\""],
  ["Machine-readable", "deepseek --pipe --json \"list every TODO in src/\" | jq -r .output"],
];

const LIMITS = [
  ["No interactive approval", "Anything needing confirmation is denied. Design tasks that do not need it."],
  ["No slash commands", "There is no session to run them against."],
  ["stdin is read fully first", "Not a streaming filter. A huge input is buffered before the run begins."],
  ["One turn in, one answer out", "The internal tool loop runs to completion, but you cannot reply to it."],
  ["stdin is fenced, not trusted", "Content arrives as data in a code block. It is still model input — treat untrusted input accordingly."],
];

export default function Headless() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Headless mode</span>
        </nav>

        <div className="hero">
          <h1>Headless mode</h1>
          <p className="tagline">
            DeepSeek Code as a Unix filter: read stdin, run the agent, write stdout. No TUI, no prompts, no
            interactivity.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What headless mode is</h2>
          <p>
            <code className="inline">--pipe</code> runs the full agent — tools, permissions, hooks, steering,
            MCP servers — without a terminal interface. It reads a task, runs it to completion, prints the
            answer, and exits.
          </p>
          <p>
            This is the mode for CI jobs, git hooks, cron, and shell one-liners. The agent is the same one
            you use interactively; what changes is that nobody is there to answer questions, which drives
            every design decision on this page.
          </p>
          <CodeBlock lang="bash">{`git diff main --name-only | deepseek --pipe "review these changed files for security issues"`}</CodeBlock>
        </section>

        <section id="invocation">
          <h2><span className="anchor">#</span>Three ways to invoke it</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "36%" }}>Form</th><th style={{ width: "28%" }}>Behavior</th><th>Use for</th></tr>
              </thead>
              <tbody>
                {INVOCATIONS.map(([f, b, u]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{b}</td>
                    <td>{u}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            With neither an argument nor stdin, you get usage and exit code 1:
          </p>
          <CodeBlock lang="text">{`Usage: echo "task" | deepseek --pipe OR deepseek --pipe "task"`}</CodeBlock>
          <p>
            Argument parsing is minimal: <code className="inline">--pipe</code> and{" "}
            <code className="inline">--json</code> are removed, and <b>everything else is joined with spaces</b>{" "}
            into the prompt. So <code className="inline">deepseek --pipe fix the failing test</code> works
            without quotes — though quoting is safer once your prompt contains shell metacharacters.
          </p>
        </section>

        <section id="composition">
          <h2><span className="anchor">#</span>How prompt and stdin combine</h2>
          <p>
            When both are present, they are composed rather than concatenated:
          </p>
          <CodeBlock lang="text">{`<argument prompt>

\`\`\`
<stdin content>
\`\`\``}</CodeBlock>
          <p>
            The argument becomes the <b>instruction</b> and stdin becomes <b>fenced data</b> beneath it. That
            separation is why the third invocation form is the most useful one — the model can tell what it
            was asked from what it was given, even when the data itself contains something that looks like
            an instruction.
          </p>
          <p>
            It is the same principle as{" "}
            <a href="/docs/agent-messaging#security">messages being data, not instructions</a>, applied at
            the shell boundary. Fencing is not formatting; it is a delimiter that marks where untrusted
            content begins.
          </p>
          <Note>
            Fencing reduces confusion, it is not a security guarantee. Content from a genuinely untrusted
            source is still model input — scope permissions accordingly.
          </Note>
        </section>

        <section id="streams">
          <h2><span className="anchor">#</span>The three streams</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "14%" }}>Stream</th><th style={{ width: "44%" }}>Carries</th><th>Consequence</th></tr>
              </thead>
              <tbody>
                {STREAMS.map(([s, c, x]) => (
                  <tr key={s}>
                    <td><code className="inline">{s}</code></td>
                    <td>{c}</td>
                    <td>{x}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The split matters in practice. Tool progress goes to stderr <b>always</b> — including in JSON
            mode — so you can watch a long run without polluting the output you are parsing:
          </p>
          <CodeBlock lang="bash">{`deepseek --pipe --json "audit src/auth" > result.json    # progress still visible
deepseek --pipe --json "audit src/auth" 2>/dev/null      # completely silent`}</CodeBlock>
          <p>
            Tool <em>results</em> never reach any stream. They go into the agent's context, which is where
            they belong — the answer is the product, not the intermediate reads.
          </p>
          <p>
            The two handled preflight errors use a drain-aware writer. Streaming tokens, tool progress and
            the success object currently write directly, so consumers should keep stdout and stderr open
            until the process exits rather than assuming every write is individually awaited.
          </p>
        </section>

        <section id="json">
          <h2><span className="anchor">#</span>JSON output</h2>
          <p>
            <code className="inline">--json</code> replaces streaming text with exactly <b>one JSON object</b> on
            stdout at the end of the run:
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
          <CodeBlock lang="json">{`{"ok":true,"output":"Three issues found…","tools":["grep","read_file","read_file"]}`}</CodeBlock>
          <CodeBlock lang="json">{`{"ok":false,"error":"DEEPSEEK_API_KEY not set and no saved config found"}`}</CodeBlock>
          <p>
            The current JSON entry point emits <code className="inline">ok: false</code> for exactly two
            handled preflight failures: missing provider configuration and an empty prompt. Other runtime or
            provider failures are not guaranteed to produce a JSON envelope, so consumers must also check the
            exit code and tolerate empty or non-JSON stdout on failure.
          </p>
          <p>
            The <code className="inline">tools</code> array records tool-call callbacks in order. It is useful
            telemetry, but a name can represent a blocked or failed call; it is not proof that the operation
            completed successfully.
          </p>
        </section>

        <section id="safety">
          <h2><span className="anchor">#</span>The safety default</h2>
          <p>
            Before loading configuration or reading input, headless mode installs a shell confirmation
            policy that always refuses operations requiring an interactive decision.
          </p>
          <p>
            Every shell command that would require a confirmation is <b>denied</b>. Not queued, not
            auto-approved — denied.
          </p>
          <p>
            The reasoning is that the interactive gate is a real control, and the correct behavior when it
            cannot be presented is to fail closed. Auto-approving in CI would mean an{" "}
            <code className="inline">rm -rf</code> that a human would have stopped runs unattended instead. This
            is the same fail-closed rule the rest of the system applies to{" "}
            <a href="/docs/agent-teams#profiles">worker permissions</a> and{" "}
            <a href="/docs/parallel-tasks#envelope">invalid results</a>.
          </p>
          <p>
            Consequence for design: a headless task should not need confirmation. Read, analyze, summarize
            and report are natural fits. A declarative allow rule can satisfy the ordinary permission layer,
            but it does not bypass mandatory high-risk confirmation; such operations remain blocked without
            an interactive handler.
          </p>
          <Note>
            All other <a href="/docs/permissions">permission rules</a> still apply. Deny rules deny, allow
            rules allow, and the risk model is unchanged.
          </Note>
        </section>

        <section id="exit">
          <h2><span className="anchor">#</span>Exit codes</h2>
          <CodeBlock lang="text">{`0    the run completed
1    no provider configured, no prompt supplied, or the run failed`}</CodeBlock>
          <p>
            Exit code 1 is set for a missing{" "}
            <code className="inline">DEEPSEEK_API_KEY</code> with no saved config, for the usage error, and for a
            failed run.
          </p>
          <p>
            Note carefully: the exit code reflects whether the <b>agent ran</b>, not whether it{" "}
            <b>liked what it found</b>. A code review that finds twelve critical bugs exits 0 — it did its
            job. If you need the finding itself to gate a pipeline, ask for a machine-checkable answer and
            test it:
          </p>
          <CodeBlock lang="bash">{`result=$(deepseek --pipe --json "any hardcoded secrets in src/? answer only YES or NO")
echo "$result" | jq -e '.output | test("^NO")' > /dev/null || exit 1`}</CodeBlock>
          <p>
            The agent shuts down cleanly in a <code className="inline">finally</code> block, so sessions, audit
            logs and MCP connections are closed even when the run throws.
          </p>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Configuration in headless mode</h2>
          <p>
            Startup does the same work as an interactive session. Legacy config is migrated, saved provider
            configuration is loaded, and the agent waits on its readiness promise before running — so MCP
            tools, steering files, <code className="inline">AGENTS.md</code> and{" "}
            <code className="inline">DEEPSEEK.md</code> are all in place before the first model call.
          </p>
          <p>
            Provider resolution is: saved configuration first, then{" "}
            <code className="inline">DEEPSEEK_API_KEY</code> from the environment. In CI, the environment
            variable is usually the whole story — see <a href="/docs/env-vars">Environment variables</a>.
          </p>
          <p>
            Two saved preferences are honored: language, and whether the{" "}
            <a href="/docs/settings">prompt refiner</a> is enabled. If you disabled the refiner
            interactively, it stays disabled here — a headless prompt is usually already precise, and an
            extra rewrite call is latency you did not ask for.
          </p>
        </section>

        <section id="ci">
          <h2><span className="anchor">#</span>Recipes</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Goal</th><th>Command</th></tr>
              </thead>
              <tbody>
                {RECIPES.map(([g, c]) => (
                  <tr key={g}>
                    <td><b style={{ color: "var(--text-strong)" }}>{g}</b></td>
                    <td><code className="inline">{c}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="yaml">{`# GitHub Actions
- name: Review changed files
  env:
    DEEPSEEK_API_KEY: \${{ secrets.DEEPSEEK_API_KEY }}
  run: |
    git diff origin/main --name-only \\
      | deepseek --pipe --json "review these files for security issues" \\
      | jq -r .output >> "$GITHUB_STEP_SUMMARY"`}</CodeBlock>
          <CodeBlock lang="bash">{`# pre-commit hook
#!/usr/bin/env bash
git diff --cached --name-only \\
  | deepseek --pipe "any debugging leftovers in these files? answer NONE or list them"`}</CodeBlock>
          <p>
            Two habits pay off in CI. Prefer <code className="inline">--json</code> plus{" "}
            <code className="inline">jq</code> over parsing prose, and phrase prompts so the answer has a shape
            you can test.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Limit</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([l, d]) => (
                  <tr key={l}>
                    <td><b style={{ color: "var(--text-strong)" }}>{l}</b></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            "One turn in, one answer out" is the one to internalize. Headless mode is not a limited agent —
            the internal loop runs to completion, calling as many tools as it needs. What you cannot do is
            have a conversation. Everything the agent needs must be in the prompt and in the project.
          </p>
          <p>
            Related: <a href="/docs/cli-reference">CLI reference</a> for the full flag set, and{" "}
            <a href="/docs/permissions">Permissions</a> for granting specific operations in automation.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
