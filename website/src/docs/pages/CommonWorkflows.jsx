import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "explore", label: "Understand an unfamiliar codebase" },
  { id: "bug", label: "Fix a bug from a stack trace" },
  { id: "refactor", label: "Refactor safely" },
  { id: "tests", label: "Write tests for untested code" },
  { id: "review", label: "Review a branch before opening a PR" },
  { id: "parallel", label: "Run independent work in parallel" },
  { id: "decision", label: "Make a hard technical decision" },
  { id: "onboard", label: "Onboard a repository" },
  { id: "ci", label: "Automate a check in CI" },
  { id: "longsession", label: "Survive a long session" },
  { id: "habits", label: "The habits underneath" },
];

const HABITS = [
  ["Name the finished condition", "\"Tests pass and no file exceeds 500 lines\" beats \"clean this up\"."],
  ["Point at a pattern to follow", "\"Like src/tools/Grep/\" is worth a paragraph of description."],
  ["Delegate anything that reads widely", "A sub-agent burns its own context and returns a summary."],
  ["Isolate anything you might discard", "A worktree turns \"undo everything\" into \"delete the directory\"."],
  ["Let it verify", "An agent that runs the suite catches its own mistakes before you read them."],
];

export default function CommonWorkflows() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Common workflows</span>
        </nav>

        <div className="hero">
          <h1>Common workflows</h1>
          <p className="tagline">
            Ten recipes, end to end. Each one names the commands, the reasoning behind them, and the mistake
            that makes it go wrong.
          </p>
        </div>

        <section id="explore">
          <h2><span className="anchor">#</span>Understand an unfamiliar codebase</h2>
          <CodeBlock lang="text">{`> map this repository: entry points, main modules, and how they depend on
  each other. do not read every file — sample enough to be confident, and
  say what you did not look at.`}</CodeBlock>
          <p>
            The second sentence is what makes this work. Without a budget, exploration expands to fill the
            context window, and you end up compacting before you have asked a real question.
          </p>
          <p>
            For a large repository, delegate instead. A{" "}
            <a href="/docs/subagents">sub-agent</a> reads in its own window and returns a summary, so your
            session pays for the conclusion rather than the evidence:
          </p>
          <CodeBlock lang="text">{`> spawn one background sub-agent per top-level directory in src/. each one
  should return: what lives there, its public surface, and what it depends on.`}</CodeBlock>
          <p>
            Then write what you learned into{" "}
            <a href="/docs/steering">steering</a> so the next session starts knowing it. Exploration you do
            not record is exploration you pay for again.
          </p>
          <Note>
            Watch <code className="inline">/context</code> during exploration. If <b>Tool Results</b> passes 40%,
            you are accumulating file contents you will not use — that is the moment to delegate.
          </Note>
        </section>

        <section id="bug">
          <h2><span className="anchor">#</span>Fix a bug from a stack trace</h2>
          <CodeBlock lang="bash">{`> TypeError: Cannot read properties of undefined (reading 'id')
      at resolveOwner (src/orchestration/workspace.ts:142:31)
      at integrate (src/orchestration/workspace.ts:88:12)

  find the root cause. check every caller before you change anything.`}</CodeBlock>
          <p>
            "Check every caller" is the instruction that separates a fix from a patch. A guard added at the
            reported line satisfies the trace and leaves every sibling caller broken; a guard in the shared
            function fixes all of them with a smaller diff.
          </p>
          <p>
            Then close the loop. <a href="/docs/verification">Verification</a> runs your project's own test
            command, and a bug worth fixing is worth a test:
          </p>
          <CodeBlock lang="text">{`> add a test that fails before your fix and passes after it, then run /verify`}</CodeBlock>
          <p>
            If the fix goes wrong, <code className="inline">/undo</code> restores the previous bytes — see{" "}
            <a href="/docs/checkpointing">Checkpointing</a>.
          </p>
        </section>

        <section id="refactor">
          <h2><span className="anchor">#</span>Refactor safely</h2>
          <CodeBlock lang="bash">{`> /worktree create
Created worktree "keen-hawk" on branch deepseek/keen-hawk-2b7e04

> extract the token refresh logic from src/auth/client.ts into its own
  module. behavior must not change. run the suite after each step.`}</CodeBlock>
          <p>
            Isolating first is the whole technique. A refactor is the archetypal operation you might abandon,
            and inside a <a href="/docs/worktrees">worktree</a> abandoning it is deleting a directory rather
            than reverting a dozen edits.
          </p>
          <CodeBlock lang="bash">{`# it worked
> /worktree exit keep
$ git merge deepseek/keen-hawk-2b7e04

# it did not
> /worktree exit`}</CodeBlock>
          <p>
            "Run the suite after each step" matters more than it reads. A refactor verified only at the end
            gives you one failure and twenty candidate causes.
          </p>
        </section>

        <section id="tests">
          <h2><span className="anchor">#</span>Write tests for untested code</h2>
          <CodeBlock lang="text">{`> src/permissions/matcher.ts has no tests. write them in tests/, following
  the style of tests/permissions/risk.test.ts. cover the edge cases the
  implementation actually has — do not invent behavior it does not implement.`}</CodeBlock>
          <p>
            Two constraints do the work. Pointing at an existing test file transfers conventions — framework,
            naming, assertion style — that would otherwise take a paragraph and still be approximated. And
            "do not invent behavior" prevents the most common failure: tests asserting what the code{" "}
            <em>should</em> do, which fail immediately and get weakened until they pass.
          </p>
          <p>
            Grade the result by asking for a mutation:
          </p>
          <CodeBlock lang="text">{`> now change one boundary condition in matcher.ts and confirm a test fails.
  then revert the change.`}</CodeBlock>
          <p>
            A test suite that passes against broken code is worse than no suite, because it is trusted.
          </p>
        </section>

        <section id="review">
          <h2><span className="anchor">#</span>Review a branch before opening a PR</h2>
          <CodeBlock lang="bash">{`/review src/auth`}</CodeBlock>
          <p>
            <a href="/docs/code-review">Multi-agent review</a> runs nine perspectives in parallel and verifies
            every finding adversarially. Read the output in this order:
          </p>
          <p>
            <b>reviewerFailures</b> first — a review where the security reviewer timed out is not a review
            with security coverage, and an empty findings list from reviewers that never ran is the most
            dangerous output there is.
          </p>
          <p>
            Then <b>CONFIRMED</b> findings, then <b>PLAUSIBLE</b> ones raised by multiple perspectives —
            independent convergence is real signal.
          </p>
          <p>
            Scope it. Nine reviewers over a large diff produce a list where the important findings compete
            with trivia; nine reviewers over one module produce a list you finish reading.
          </p>
        </section>

        <section id="parallel">
          <h2><span className="anchor">#</span>Run independent work in parallel</h2>
          <CodeBlock lang="text">{`> spawn three background tasks:
  1. inventory every public export in src/tools/
  2. list every TODO and FIXME with file and line
  3. find every place we call the provider API directly

  report back separately. do not edit anything.`}</CodeBlock>
          <CodeBlock lang="bash">{`/tasks                  # watch them
/task <id> result       # collect one`}</CodeBlock>
          <p>
            Read-only fan-out is the cheapest parallelism available: readers share the project safely, so
            there is no worktree to create and nothing to integrate.
          </p>
          <p>
            Parallel <em>writers</em> are a different proposition — each needs its own worktree and an
            integration step. Worth it for genuinely independent features, wasteful for three edits to the
            same module. Add a dependency only when B genuinely needs A's output:
          </p>
          <CodeBlock lang="text">{`> after task 1 finishes, spawn a task that writes the migration guide
  using its inventory`}</CodeBlock>
          <p>
            See <a href="/docs/parallel-tasks">Parallel tasks</a>.
          </p>
        </section>

        <section id="decision">
          <h2><span className="anchor">#</span>Make a hard technical decision</h2>
          <CodeBlock lang="json">{`{
  "name": "moa",
  "arguments": {
    "prompt": "We need idempotent webhook processing. Compare a Redis dedup
               key against a unique constraint in Postgres. Cover failure
               modes, operational cost, and what breaks under partition."
  }
}`}</CodeBlock>
          <p>
            <a href="/docs/moa">MoA</a> asks several models independently and synthesizes the answers. The
            value is the disagreement — one model surfaces a constraint another missed.
          </p>
          <p>
            Prompt design decides whether it works. Asking for a <em>comparison with failure modes</em> gives
            models room to diverge usefully; asking a yes/no question collapses them into near-identical
            answers that deduplicate into one candidate, wasting the entire mechanism.
          </p>
          <p>
            Do not reach for this on anything a test can settle. If the suite can answer it, the suite is
            cheaper and definite.
          </p>
        </section>

        <section id="onboard">
          <h2><span className="anchor">#</span>Onboard a repository</h2>
          <p>
            One-time setup that pays back every session afterwards:
          </p>
          <CodeBlock lang="bash">{`mkdir -p .deepseek/steering`}</CodeBlock>
          <CodeBlock lang="text">{`# .deepseek/steering/conventions.md
- Tests live in tests/, never beside the source
- Files stay under 500 lines
- No new dependency without checking the stdlib first

# .deepseek/steering/review-checklist.md
Before reporting a task complete:
1. Run the suite; do not report success on a failing suite
2. Confirm no file exceeded 500 lines
3. Call out any new dependency explicitly`}</CodeBlock>
          <CodeBlock lang="json">{`// .deepseek/settings.json
{
  "model": { "default": "deepseek-v4-pro" },
  "agents": { "subagentModel": "deepseek-v4-flash" },
  "hooks": {
    "PostToolUse": [
      { "matcher": { "tools": ["edit_file", "write_file"] },
        "command": "bunx tsc --noEmit" }
    ]
  }
}`}</CodeBlock>
          <p>
            Commit all of it. The checklist is the most under-used piece — agents self-check well against an
            explicit list and poorly against an implied standard.
          </p>
          <p>
            See <a href="/docs/steering">Steering</a>, <a href="/docs/hooks">Hooks</a> and{" "}
            <a href="/docs/model-config">Model configuration</a>.
          </p>
        </section>

        <section id="ci">
          <h2><span className="anchor">#</span>Automate a check in CI</h2>
          <CodeBlock lang="yaml">{`- name: Security review of changed files
  env:
    DEEPSEEK_API_KEY: \${{ secrets.DEEPSEEK_API_KEY }}
  run: |
    git diff origin/main --name-only \\
      | deepseek --pipe --json "review these files for security issues" \\
      | jq -r .output >> "$GITHUB_STEP_SUMMARY"`}</CodeBlock>
          <p>
            Two things to internalize about <a href="/docs/headless">headless mode</a>. Commands needing
            interactive confirmation are <b>denied</b>, so design tasks that read and report rather than act.
            And the exit code reflects whether the agent <em>ran</em>, not whether it <em>approved</em> — a
            review finding twelve bugs exits 0.
          </p>
          <p>
            To gate on the finding itself, ask for a machine-checkable answer:
          </p>
          <CodeBlock lang="bash">{`result=$(deepseek --pipe --json "any hardcoded secrets in src/? answer only YES or NO")
echo "$result" | jq -e '.output | test("^NO")' > /dev/null || exit 1`}</CodeBlock>
        </section>

        <section id="longsession">
          <h2><span className="anchor">#</span>Survive a long session</h2>
          <p>
            Sessions degrade in a predictable order, and each stage has a different fix.
          </p>
          <p>
            <b>Tool Results climbing past 40%.</b> You have accumulated file contents. Micro-compaction is
            already clearing old read-only results; the real fix is to delegate wide reading to sub-agents
            from here on.
          </p>
          <p>
            <b>Messages past 60%.</b> The conversation itself is long. Only{" "}
            <code className="inline">/compact</code> compresses this — and if you are moving to unrelated work,{" "}
            <code className="inline">/clear</code> is better, since summarizing work you are abandoning is pure
            waste.
          </p>
          <p>
            <b>Above 85% after a streamed response.</b> The current fixed post-stream check can trigger
            auto-compaction and preserve task state through the nine-section summary. A separate configurable
            pre-turn check defaults to 90%. Usually you do nothing.
          </p>
          <p>
            <b>The fixed floor is already large.</b> Neither compaction nor clearing helps — steering,
            memory and tool schemas are rebuilt on every call. The fix is editorial: shorter steering, a
            smaller memory store, and disabling MCP servers whose dynamic tool schemas you do not need.
          </p>
          <p>
            Before anything risky, <code className="inline">/checkpoint</code>. Before anything long, consider
            whether it belongs in a background task instead. See{" "}
            <a href="/docs/context-window">Context window</a> and{" "}
            <a href="/docs/compaction">Compaction</a>.
          </p>
        </section>

        <section id="habits">
          <h2><span className="anchor">#</span>The habits underneath</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Habit</th><th>Why</th></tr>
              </thead>
              <tbody>
                {HABITS.map(([h, w]) => (
                  <tr key={h}>
                    <td><b style={{ color: "var(--text-strong)" }}>{h}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Every recipe above is one of these five applied to a situation. The first is the one that changes
            the most outcomes: an agent with no completion criterion decides for itself when it is done, and
            it will decide earlier than you would.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
