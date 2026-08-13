import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "meaning", label: "What an exit code means" },
  { id: "pipe", label: "Pipe-mode statuses" },
  { id: "commands", label: "Top-level commands" },
  { id: "semantic", label: "Process vs semantic success" },
  { id: "json", label: "Exit codes with JSON" },
  { id: "shell", label: "Shell and pipeline handling" },
  { id: "signals", label: "Signals and interactive exit" },
  { id: "ci", label: "CI patterns" },
];
const PIPE_OUTCOMES = [
  ["Final completion callback", "0", "Includes an ordinary answer and several soft-failure paths."],
  ["No saved provider and no API key", "1", "Handled before the agent is created."],
  ["No argument prompt and empty trimmed stdin", "1", "Handled usage error."],
  ["Thrown provider, initialization, loop or shutdown error", "Nonzero", "No application-level numeric mapping; the runtime terminates the failed entry point."],
  ["Termination by an external signal", "Platform/shell dependent", "Pipe mode installs no signal-to-status normalization."],
];
const COMMANDS = [
  ["deepseek help / --help / -h", "0", "Usage printed."],
  ["deepseek version / v / --version / -v", "0", "Version printed."],
  ["deepseek logout", "0", "Also zero when no saved credentials existed."],
  ["deepseek doctor", "0 or 1", "One when any diagnostic check is not OK."],
  ["deepseek update", "0 or 1", "One on registry or package-manager failure; zero when current or updated."],
  ["interactive /quit", "0", "Immediate normal exit."],
  ["interactive SIGINT or SIGTERM", "0", "The installed handler prints a resume command and exits zero."],
];
const SOFT_FAILURES = [
  ["A permission rule blocks a tool", "The block result is sent back to the model."],
  ["A confirmation-required tool has no handler", "The model receives a blocked or cancelled result."],
  ["A tool implementation throws", "The error is converted into a tool result and the loop continues."],
  ["A proxy error arrives as a response chunk", "A warning is emitted as assistant output, then the turn completes."],
  ["The model reports serious findings", "Content severity never changes the process status."],
];
export default function ExitCodes() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Exit codes</span>
        </nav>

        <div className="hero">
          <h1>Exit codes</h1>
          <p className="tagline">
            Distinguish process completion from agent findings, tool execution and JSON validity before using
            DeepSeek Code as a CI gate.
          </p>
        </div>

        <section id="meaning">
          <h2><span className="anchor">#</span>What an exit code means</h2>
          <p>
            DeepSeek Code uses conventional zero/nonzero process status for explicit top-level command
            outcomes. In pipe mode, zero means the run reached its completion callback. It is not a verdict on
            the assistant answer and it is not proof that every requested tool completed.
          </p>
          <CodeBlock lang="bash">{"deepseek --pipe \"review the staged changes\"\nstatus=$?\nprintf 'deepseek status: %s\\n' \"$status\""}</CodeBlock>
          <Note>
            Capture <code className="inline">$?</code> immediately. Any later command, including
            <code className="inline">printf</code>, <code className="inline">jq</code> or
            <code className="inline">tee</code>, replaces it.
          </Note>
        </section>

        <section id="pipe">
          <h2><span className="anchor">#</span>Pipe-mode statuses</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "33%" }}>Outcome</th><th style={{ width: "17%" }}>Status</th><th>Current behavior</th></tr></thead>
              <tbody>{PIPE_OUTCOMES.map(([outcome, status, behavior]) => <tr key={outcome}><td>{outcome}</td><td><code className="inline">{status}</code></td><td>{behavior}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            After a normal pipe run, the CLI exits with the current
            <code className="inline">process.exitCode</code>, defaulting to zero. The two preflight errors set it
            to one. Uncaught exceptions are not translated into a documented DeepSeek-specific code such as 2,
            64 or 70.
          </p>
          <CodeBlock lang="bash">{"deepseek --pipe \"check src\"\ncase $? in\n  0) echo \"turn completed\" ;;\n  1) echo \"known preflight failure, or runtime failure reported as 1\" >&2 ;;\n  *) echo \"process failed or was terminated\" >&2 ;;\nesac"}</CodeBlock>
          <Note>
            Do not infer a detailed error category from status 1. Inspect stderr in plain mode, and inspect any
            valid failure envelope in JSON mode.
          </Note>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>Top-level commands</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "38%" }}>Invocation</th><th style={{ width: "14%" }}>Status</th><th>Condition</th></tr></thead>
              <tbody>{COMMANDS.map(([command, status, condition]) => <tr key={command}><td><code className="inline">{command}</code></td><td><code className="inline">{status}</code></td><td>{condition}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Top-level dispatch matches the first interactive argument after
            <code className="inline">--pipe</code> and <code className="inline">--json</code> are removed.
            Pipe mode is different: its early dispatch wins whenever the raw argument list contains
            <code className="inline">--pipe</code>, so words such as <code className="inline">doctor</code> or
            <code className="inline">update</code> become prompt text there.
          </p>
          <CodeBlock lang="bash">{"deepseek doctor; echo \"$?\"       # diagnostic status\ndeepseek --pipe doctor; echo \"$?\" # agent-turn status"}</CodeBlock>
        </section>

        <section id="semantic">
          <h2><span className="anchor">#</span>Process vs semantic success</h2>
          <p>
            Several conditions that look like failure to a human are modeled as data inside a completed agent
            turn. They usually retain status zero because the process did what its control flow considers a
            completion.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "38%" }}>Condition</th><th>How it is represented</th></tr></thead>
              <tbody>{SOFT_FAILURES.map(([condition, representation]) => <tr key={condition}><td>{condition}</td><td>{representation}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Build your own acceptance rule around output that is deliberately easy to test. A review command,
            for example, can be instructed to end with one stable verdict line and your script can validate it
            after the process succeeds.
          </p>
          <CodeBlock lang="bash">{"result=$(deepseek --pipe --json \\\n  \"Review the staged diff. End with exactly VERDICT: PASS or VERDICT: FAIL.\") || exit $?\n\nprintf '%s\\n' \"$result\" \\\n  | jq -e '.ok and (.output | endswith(\"VERDICT: PASS\"))' >/dev/null"}</CodeBlock>
        </section>

        <section id="json">
          <h2><span className="anchor">#</span>Exit codes with JSON</h2>
          <p>
            For the two handled preflight failures, JSON mode writes
            <code className="inline">ok: false</code> to stdout and sets status 1. A normal completion writes
            <code className="inline">ok: true</code> and exits zero. Runtime exceptions do not have a guaranteed
            JSON envelope, so status must be checked before trusting stdout.
          </p>
          <CodeBlock lang="bash">{"output_file=$(mktemp)\nif deepseek --pipe --json \"inspect release readiness\" >\"$output_file\"; then\n  jq -e '.ok == true' \"$output_file\" >/dev/null || exit 1\nelse\n  status=$?\n  if jq -e '.ok == false and (.error | type == \"string\")' \"$output_file\" >/dev/null 2>&1; then\n    jq -r '.error' \"$output_file\" >&2\n  else\n    echo \"run failed without a valid JSON error envelope\" >&2\n  fi\n  exit \"$status\"\nfi"}</CodeBlock>
          <Note>
            <code className="inline">ok: true</code> and exit 0 overlap on the normal path, but they answer
            different questions: the field belongs to the output shape; the status belongs to the process.
          </Note>
        </section>

        <section id="shell">
          <h2><span className="anchor">#</span>Shell and pipeline handling</h2>
          <p>
            By default, a POSIX shell reports the status of the last command in a pipeline. That can hide a
            failed DeepSeek process behind a successful parser or file writer. Enable
            <code className="inline">pipefail</code> in shells that support it, or avoid the pipeline while
            capturing the result.
          </p>
          <CodeBlock lang="bash">{"set -o pipefail\ndeepseek --pipe --json \"summarize src\" | jq -r .output\n\n# Portable shape: capture first, parse second\nif result=$(deepseek --pipe --json \"summarize src\"); then\n  printf '%s\\n' \"$result\" | jq -r .output\nelse\n  status=$?\n  exit \"$status\"\nfi"}</CodeBlock>
          <p>
            Redirection does not create another pipeline process and does not replace the command status. This
            makes separate result and progress files the least surprising CI form.
          </p>
          <CodeBlock lang="bash">{"deepseek --pipe --json \"audit dependencies\" \\\n  > deepseek-result.json \\\n  2> deepseek-progress.log\nstatus=$?"}</CodeBlock>
        </section>

        <section id="signals">
          <h2><span className="anchor">#</span>Signals and interactive exit</h2>
          <p>
            The interactive entry point installs handlers for SIGINT and SIGTERM that restore terminal state,
            print a resume command and explicitly exit 0. The in-app
            <code className="inline">/quit</code> command also exits 0, but it does not use that resume-printing
            handler.
          </p>
          <p>
            Pipe mode returns before those interactive signal handlers are installed. If an automation runner
            terminates a pipe process, status and signal reporting follow the runtime and parent shell rather
            than a DeepSeek-specific mapping. Record the runner's signal metadata instead of relying on one
            numeric convention across platforms.
          </p>
        </section>

        <section id="ci">
          <h2><span className="anchor">#</span>CI patterns</h2>
          <CodeBlock lang="bash">{"# Transport gate: process + JSON shape\nresult=$(deepseek --pipe --json \"check the release diff\") || exit $?\nprintf '%s\\n' \"$result\" | jq -e '\n  .ok == true and\n  (.output | type == \"string\") and\n  (.tools | type == \"array\")\n' >/dev/null || exit 1\n\n# Semantic gate owned by your pipeline\nprintf '%s\\n' \"$result\" | jq -e '\n  .output | contains(\"VERDICT: PASS\")\n' >/dev/null || exit 2"}</CodeBlock>
          <p>
            Using a separate status such as 2 for your own semantic gate is a shell-script choice, not a code
            emitted by DeepSeek Code. Keep that distinction visible in CI logs.
          </p>
          <Note>
            If a tool must run for the gate to be valid, verify its external effect or require evidence in the
            answer. The JSON <code className="inline">tools</code> list includes observed blocked calls and
            cannot prove successful execution.
          </Note>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
