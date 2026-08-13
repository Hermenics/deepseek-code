import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "verify", label: "Give it a finish line" },
  { id: "scope", label: "Scope the task" },
  { id: "explore", label: "Explore before editing" },
  { id: "context", label: "Protect context" },
  { id: "steering", label: "Write useful instructions" },
  { id: "permissions", label: "Tune permissions" },
  { id: "delegation", label: "Delegate intentionally" },
  { id: "git", label: "Use Git as a boundary" },
  { id: "recover", label: "Recover early" },
  { id: "patterns", label: "Failure patterns" },
];

const FAILURE_PATTERNS = [
  ["Vague task, no evidence", "The agent chooses its own scope and stops when the result merely looks plausible.", "Name the area, constraints and command that proves completion."],
  ["One huge session", "Old tool output competes with the current problem for context.", "Clear between unrelated tasks; compact only when continuity matters."],
  ["Parallel writers on shared files", "Correct changes collide during integration.", "Assign file ownership or use worktree-isolated writers."],
  ["Instructions used as enforcement", "A model can misunderstand advisory prose.", "Use permissions or hooks for rules that must never be skipped."],
  ["Retrying the same failed path", "More tokens reinforce a bad assumption.", "Stop, inspect the error, narrow the hypothesis and rerun the smallest check."],
];

export default function BestPractices() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Get Started</span><span className="sep">/</span><span className="current">Best practices</span>
        </nav>
        <div className="hero">
          <h1>Best practices</h1>
          <p className="tagline">Patterns that make DeepSeek Code faster, easier to supervise and more likely to finish with evidence.</p>
        </div>

        <section id="verify">
          <h2><span className="anchor">#</span>Give it a finish line</h2>
          <p>
            The most useful prompt contains a result and a check. A test, typecheck, build, lint command,
            generated artifact or exact observable behavior gives the agent a closed loop: change, run,
            inspect, correct. Without a check, the only stopping signal is that the change looks complete.
          </p>
          <CodeBlock lang="text">{"Fix the session-expiry bug in src/auth.\nAdd the smallest regression test that fails before the fix.\nRun that test and the typecheck. Do not suppress the error."}</CodeBlock>
          <p>
            Use <code className="inline">/verify</code> when the repository already exposes a test command.
            Use a <a href="/docs/goals">goal</a> when completion must survive several turns, and a hook when
            the same deterministic check must run after every relevant tool call.
          </p>
        </section>

        <section id="scope">
          <h2><span className="anchor">#</span>Scope the task</h2>
          <p>
            Name the symptom, likely area, constraints and non-goals. This keeps discovery proportional to
            the work and prevents an unrelated cleanup from becoming part of the patch.
          </p>
          <CodeBlock lang="text">{"The settings dialog loses the selected scope after search.\nStart in src/ui/setup/ConfigMenu.tsx and its tests.\nPreserve keyboard behavior and do not redesign the dialog.\nAdd a regression test and run only the relevant test file first."}</CodeBlock>
          <p>
            File paths and error output are high-value context. A theory such as “this is probably a race” is
            useful only when labeled as a hypothesis; otherwise it can anchor the investigation on the wrong cause.
          </p>
        </section>

        <section id="explore">
          <h2><span className="anchor">#</span>Explore before editing</h2>
          <p>
            For an unfamiliar flow, ask DeepSeek Code to trace the entry point, callers, state changes and
            tests before it writes. Use Review mode for a read-only investigation or Plan mode when the result
            should become an approval gate. Small, obvious edits do not need ceremony.
          </p>
          <CodeBlock lang="text">{"Trace how a slash command travels from parsing to UI handling.\nList the files and state transitions involved. Do not edit anything."}</CodeBlock>
          <p>
            After exploration, start implementation with the discovered facts rather than the entire raw
            transcript. A fresh sub-agent can investigate a wide surface and return a bounded summary without
            filling the main context window.
          </p>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Protect context</h2>
          <p>
            Context is shared by the system prompt, tool schemas, steering, memory, conversation, file reads
            and command output. Keep it focused: use targeted searches, line ranges and narrow test commands;
            move independent research to sub-agents; ask side questions with <code className="inline">/btw</code>;
            clear between unrelated jobs.
          </p>
          <p>
            Run <code className="inline">/context</code> before guessing what is expensive. Micro-compaction
            trims stale read-only results automatically, while full compaction summarizes the live history.
            A new session is better than compaction when the next task has no dependency on the old one.
          </p>
          <Note>Compaction preserves continuity, not every detail. Keep durable decisions in project files, steering or a checked-in plan.</Note>
        </section>

        <section id="steering">
          <h2><span className="anchor">#</span>Write useful instructions</h2>
          <p>
            Put stable project facts in <code className="inline">AGENTS.md</code> or{" "}
            <code className="inline">DEEPSEEK.md</code>: commands, architecture boundaries, generated files,
            review expectations and repository-specific traps. Leave facts discoverable from the code out of
            the prompt; they consume context on every model call without adding new information.
          </p>
          <p>
            Steering is advisory. If a command must be blocked, use a deny rule. If formatting must happen
            after every write, use a hook. If a procedure is relevant only sometimes, package it as a skill.
          </p>
        </section>

        <section id="permissions">
          <h2><span className="anchor">#</span>Tune permissions, do not bypass them</h2>
          <p>
            Start with Build mode and approve narrowly. Turn repeated, predictable operations into exact
            allow rules such as a test command or read-only Git query. Keep destructive patterns denied at
            project scope. Auto mode broadens tool availability but still respects risk checks, hooks, path
            containment and explicit authorization boundaries.
          </p>
          <p>
            When a tool is refused, run <code className="inline">/permissions</code>. It reports the mode gate,
            agent allowlist, settings rules, risk status and session approvals. Retrying through a different
            tool hides the policy problem instead of solving it.
          </p>
        </section>

        <section id="delegation">
          <h2><span className="anchor">#</span>Delegate intentionally</h2>
          <p>
            A good delegated task is independent and bounded. State the question, owned paths, expected
            output and validation. Parallelize independent reads freely; parallelize writes only when file
            ownership or isolated worktrees make conflicts impossible.
          </p>
          <CodeBlock lang="text">{"Use a read-only reviewer to inspect src/permissions/.\nReturn only confirmed defects with file and line evidence.\nDo not propose unrelated refactors."}</CodeBlock>
          <p>
            More agents are not automatically better. Every worker adds its own context, model calls and
            integration cost. Use one capable worker when the task has one coherent dependency chain; fan out
            when branches are genuinely independent or benefit from adversarial review.
          </p>
        </section>

        <section id="git">
          <h2><span className="anchor">#</span>Use Git as a boundary</h2>
          <p>
            Begin from a state you understand. Inspect existing changes and tell the agent which belong to
            you. Use worktrees for experiments or concurrent writers, checkpoints for conversational recovery,
            and normal commits for durable milestones. None of these replaces the others.
          </p>
          <p>
            Review the end-of-turn diff and verification output before committing. Generated files should be
            identified in settings so diff review emphasizes source changes instead of noise.
          </p>
        </section>

        <section id="recover">
          <h2><span className="anchor">#</span>Recover early</h2>
          <p>
            Press Escape while a run is going in the wrong direction. Use <code className="inline">/undo</code>
            for file edits created through the editing tools, or restore a named checkpoint when conversation
            state also matters. If two corrections have accumulated around the same false assumption, clear
            the session and restart with the evidence learned so far.
          </p>
        </section>

        <section id="patterns">
          <h2><span className="anchor">#</span>Common failure patterns</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "25%" }}>Pattern</th><th>Why it fails</th><th>Better move</th></tr></thead>
            <tbody>{FAILURE_PATTERNS.map(([p, w, b]) => <tr key={p}><td><b>{p}</b></td><td>{w}</td><td>{b}</td></tr>)}</tbody>
          </table></div>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
