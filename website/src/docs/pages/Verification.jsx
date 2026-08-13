import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "why", label: "Why verification exists" },
  { id: "detection", label: "How the command is detected" },
  { id: "order", label: "The detection order" },
  { id: "running", label: "Running verification" },
  { id: "result", label: "Reading the result" },
  { id: "endofturn", label: "Verification at end of turn" },
  { id: "hooks", label: "Verification with hooks" },
  { id: "subagents", label: "Sub-agent verification" },
  { id: "notdetected", label: "When nothing is detected" },
  { id: "practices", label: "Practices that work" },
];

const DETECTION = [
  ["package.json + bun.lock / bun.lockb", "bun test", "Bun lockfile wins over every other JS package manager."],
  ["package.json + pnpm-lock.yaml", "pnpm test", "Checked after bun."],
  ["package.json + yarn.lock", "yarn test", "Checked after pnpm."],
  ["package.json (no lockfile match)", "npm test", "The fallback for any JS project with a test script."],
  ["Cargo.toml", "cargo test", "Only checked if no package.json test script was found."],
  ["go.mod", "go test ./...", "Last in the order."],
  ["none of the above", "null", "No command. Verification is skipped rather than guessed."],
];

const RESULT = [
  ["command", "VerificationCommand", "Exactly what ran, including the display string."],
  ["ok", "boolean", "True only when the process exited 0."],
  ["output", "string", "stdout and stderr joined, trimmed. '(no output)' when both are empty."],
];

const PRACTICES = [
  ["Keep the test script honest", "Detection runs whatever npm test does. If that is a stub, verification is theatre."],
  ["Make it fast", "A 120-second cap is a ceiling, not a budget. Slow suites make agents skip the loop."],
  ["Fail loudly", "A suite that exits 0 on failure tells the agent the change is fine."],
  ["Put lint and types in it", "Detection finds one command. If types matter, the test script should run them."],
  ["Use hooks for per-edit checks", "PostToolUse can format or typecheck a single file far faster than a whole suite."],
];

export default function Verification() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Verification</span>
        </nav>

        <div className="hero">
          <h1>Verification</h1>
          <p className="tagline">
            Closing the loop between "I changed the code" and "the code still works" — using the test
            command your project already has, never one invented for the occasion.
          </p>
        </div>

        <section id="why">
          <h2><span className="anchor">#</span>Why verification exists</h2>
          <p>
            An agent that edits files and stops has done half a job. The other half is proving the edit was
            correct, and the only convincing proof is your project's own test command exiting zero.
          </p>
          <p>
            Verification wires that in as a first-class step. After files change, DeepSeek Code can detect
            the project's test command, run it, and feed the result back into the conversation — so a
            failing suite becomes information the agent acts on rather than a surprise you find later.
          </p>
          <p>
            <b>One</b> command. <b>Existing</b>. <b>Never invented.</b> Detection will not scaffold a test
            framework, will not add a script to your <code className="inline">package.json</code>, and will not
            guess at a runner that is not already configured. If your project has no test command,
            verification reports that and stops.
          </p>
        </section>

        <section id="detection">
          <h2><span className="anchor">#</span>How the command is detected</h2>
          <p>
            Detection is a sequence of filesystem checks against the working directory. The first match wins:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Detected</th><th style={{ width: "20%" }}>Command</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {DETECTION.map(([d, c, n]) => (
                  <tr key={d}>
                    <td><code className="inline">{d}</code></td>
                    <td><code className="inline">{c}</code></td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The JavaScript branch has an extra requirement that is easy to miss: it only proceeds if{" "}
            <code className="inline">package.json</code> actually declares a <code className="inline">scripts.test</code>{" "}
            string. A manifest without a test script falls through to the Rust and Go checks rather than
            producing an <code className="inline">npm test</code> that would fail with "missing script".
          </p>
          <Note>
            An invalid <code className="inline">package.json</code> is swallowed rather than raised — the code
            comment says why: <em>an invalid package manifest is reported by the actual package manager</em>.
            Verification is not a linter for your manifest.
          </Note>
        </section>

        <section id="order">
          <h2><span className="anchor">#</span>The detection order</h2>
          <p>
            Order matters in polyglot repositories. A project containing both{" "}
            <code className="inline">package.json</code> and <code className="inline">Cargo.toml</code> resolves to the
            JavaScript command, because the JS branch is evaluated first and returns as soon as it finds a
            test script.
          </p>
          <p>
            Within JavaScript, lockfile precedence is <b>bun → pnpm → yarn → npm</b>. Both{" "}
            <code className="inline">bun.lock</code> and the older binary{" "}
            <code className="inline">bun.lockb</code> are recognized. Matching on the lockfile rather than on
            installed binaries means detection reflects how the project is <em>meant</em> to be run, not
            what happens to be on your PATH.
          </p>
          <p>
            If the order picks the wrong command for your repository, the fix is at the project level: make
            the root <code className="inline">test</code> script do the right thing. Detection deliberately has
            no override flag — an override would be a second source of truth about how to test your code.
          </p>
        </section>

        <section id="running">
          <h2><span className="anchor">#</span>Running verification</h2>
          <CodeBlock lang="bash">{`> /verify
Running: bun test

  ✓ auth.test.ts (12 tests)
  ✗ token.test.ts (1 failed)

Verification failed (exit 1).`}</CodeBlock>
          <p>
            Execution is deliberately plain. The command runs in the working directory with{" "}
            <code className="inline">reject: false</code>, so a non-zero exit is data rather than an exception,
            and under a hard <b>120-second timeout</b>.
          </p>
          <p>
            That timeout is a design statement. A verification step that can hang indefinitely is worse than
            none, because it blocks the loop while looking like progress. Two minutes is enough for most
            suites; a suite that exceeds it is telling you something about your feedback loop.
          </p>
          <p>
            <code className="inline">stdout</code> and <code className="inline">stderr</code> are joined and
            trimmed. Many runners write results to one stream and failures to the other, and separating them
            would let the agent read a pass while the failure detail sat in the channel it ignored.
          </p>
        </section>

        <section id="result">
          <h2><span className="anchor">#</span>Reading the result</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Field</th><th style={{ width: "26%" }}>Type</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {RESULT.map(([f, t, m]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">ok</code> is exit-code equality with zero and nothing else. No output
            parsing, no scanning for the word "fail", no per-runner heuristics. Exit codes are the one
            contract every test runner honors, and inferring success from text is how a broken pipeline
            reports green.
          </p>
          <p>
            The <code className="inline">'(no output)'</code> placeholder matters more than it looks. An empty
            string in the transcript is ambiguous — did nothing run, or did it run silently? An explicit
            marker distinguishes "ran and said nothing" from "did not run".
          </p>
        </section>

        <section id="endofturn">
          <h2><span className="anchor">#</span>Verification at end of turn</h2>
          <p>
            Verification is also available automatically. The agent tracks{" "}
            <code className="inline">turnModifiedFiles</code> per turn, and at end of turn a{" "}
            <code className="inline">verificationHandler</code> can be invoked with that file set.
          </p>
          <p>
            The pairing with <a href="/docs/how-it-works#turn">diff review</a> is the useful part: you see the
            consolidated diff and the verification outcome together, before the next turn builds on top of
            either. Reviewing a diff you already know is green is a much shorter task than reviewing one of
            unknown status.
          </p>
          <p>
            Because the file set is per turn rather than per session, this stays meaningful in a long
            session — you are told what <em>this</em> turn broke, not that something in the last hour did.
          </p>
        </section>

        <section id="hooks">
          <h2><span className="anchor">#</span>Verification with hooks</h2>
          <p>
            Whole-suite verification is the coarse instrument. For per-edit feedback, a{" "}
            <code className="inline">PostToolUse</code> <a href="/docs/hooks">hook</a> is faster and more
            targeted:
          </p>
          <CodeBlock lang="json">{`// .deepseek/settings.json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": { "tools": ["edit_file", "write_file"] },
        "command": "bunx tsc --noEmit"
      }
    ]
  }
}`}</CodeBlock>
          <p>
            The two layers compose well. Hooks catch type errors within seconds of the edit that caused them;
            end-of-turn verification catches behavioral regressions that no amount of type checking would
            find. Running the full suite after every single edit is the failure mode to avoid — it is slow
            enough that it gets disabled, and a disabled check catches nothing.
          </p>
          <p>
            A <code className="inline">PreToolUse</code> hook can also block a call outright — useful for
            refusing edits to generated files or vendored directories before verification is even relevant.
          </p>
        </section>

        <section id="subagents">
          <h2><span className="anchor">#</span>Sub-agent verification</h2>
          <p>
            "Verification" means a second thing in the orchestrator, and the two are easy to conflate.
          </p>
          <p>
            <b>This page</b> is about running your test command. The <a href="/docs/subagents">sub-agent</a>{" "}
            verifier is about a second agent independently checking a first agent's <em>claim</em> — it sees
            the task and the reported summary, never the working transcript, and returns{" "}
            <code className="inline">CONFIRMED</code>, <code className="inline">PLAUSIBLE</code>, or{" "}
            <code className="inline">REFUTED</code>.
          </p>
          <p>
            They answer different questions. The test command answers <em>does the code work</em>. The
            verifier answers <em>is the agent's account of what it did accurate</em>. A sub-agent can report
            "fixed the bug" with high confidence and still be refuted; a suite can pass while the summary
            describes work that never happened.
          </p>
          <Note>
            Both are worth having on consequential changes, and neither substitutes for the other.
          </Note>
        </section>

        <section id="notdetected">
          <h2><span className="anchor">#</span>When nothing is detected</h2>
          <p>
            <code className="inline">detectVerificationCommand()</code> returning{" "}
            <code className="inline">null</code> is a normal outcome, not an error. Documentation repositories,
            configuration repositories, and early-stage projects legitimately have no test command.
          </p>
          <p>
            The response is to skip verification and say so. The alternative — inventing a command — is worse
            in every direction: it could install packages, write files, or produce a confident green from a
            runner that tested nothing.
          </p>
          <p>
            To opt in, give the project a real test script. For a language outside the detected set, the
            portable route is a thin <code className="inline">package.json</code> whose{" "}
            <code className="inline">test</code> script shells out to your actual runner:
          </p>
          <CodeBlock lang="json">{`{
  "scripts": {
    "test": "pytest -q && ruff check ."
  }
}`}</CodeBlock>
          <p>
            Detection finds <code className="inline">npm test</code>, and the script decides what that means.
          </p>
        </section>

        <section id="practices">
          <h2><span className="anchor">#</span>Practices that work</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Practice</th><th>Why</th></tr>
              </thead>
              <tbody>
                {PRACTICES.map(([p, w]) => (
                  <tr key={p}>
                    <td><b style={{ color: "var(--text-strong)" }}>{p}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The highest-leverage item is the second. Verification quality is bounded by suite speed, because
            a check that takes five minutes stops being run after edits and starts being run before commits —
            at which point it has stopped closing the loop and gone back to being a gate.
          </p>
          <p>
            Related: <a href="/docs/hooks">Hooks</a> for per-edit checks,{" "}
            <a href="/docs/subagents">Sub-agents</a> for independent review, and{" "}
            <a href="/docs/steering">Steering</a> for telling the agent what "done" means in your project.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
