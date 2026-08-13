import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "anatomy", label: "Anatomy of a prompt" },
  { id: "context", label: "Supply evidence" },
  { id: "constraints", label: "State constraints" },
  { id: "output", label: "Shape the output" },
  { id: "iteration", label: "Work in stages" },
  { id: "inputs", label: "Files, paste & stdin" },
  { id: "autonomy", label: "Control autonomy" },
  { id: "debugging", label: "Debugging prompts" },
  { id: "review", label: "Review prompts" },
];

export default function Prompting() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb"><span>Docs</span><span className="sep">/</span><span>Get Started</span><span className="sep">/</span><span className="current">Prompting</span></nav>
        <div className="hero"><h1>Prompting DeepSeek Code</h1><p className="tagline">Describe engineering work so the agent can discover, act and verify without guessing your boundaries.</p></div>

        <section id="anatomy">
          <h2><span className="anchor">#</span>Anatomy of a strong prompt</h2>
          <p>A practical coding prompt usually carries five things: outcome, evidence, scope, constraints and proof.</p>
          <CodeBlock lang="text">{"Outcome: make cancelled background tasks disappear from the active footer.\nEvidence: cancelling works, but the row remains until restart.\nScope: activity footer and sub-agent state hook.\nConstraints: preserve resumable failed tasks; no visual redesign.\nProof: add a regression test and run the focused UI tests."}</CodeBlock>
          <p>You do not need labels in normal use. They are shown here to make the information boundaries visible.</p>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Supply evidence, not a diagnosis</h2>
          <p>
            Paste the exact error, reproduction steps and expected behavior. Point to a likely directory or
            analogous implementation when you know one. Avoid presenting an unverified root cause as fact;
            ask the agent to confirm it by tracing callers and state transitions.
          </p>
          <CodeBlock lang="text">{"Running /sessions export 12ab34cd56ef md returns “session not found”.\nThe same id appears in /sessions. Reproduce it, trace project-scoped lookup,\nfix the root cause, and verify both JSON and Markdown export."}</CodeBlock>
        </section>

        <section id="constraints">
          <h2><span className="anchor">#</span>State constraints that change the solution</h2>
          <p>
            Useful constraints select between valid implementations: supported runtime, compatibility,
            security boundary, latency budget, files that cannot change, dependency policy and test scope.
            Generic requests such as “write clean code” add little because they do not alter a decision.
          </p>
          <CodeBlock lang="text">{"Use Bun APIs and dependencies already installed in the project.\nDo not change the persisted schema.\nThe command must remain safe in a dirty worktree."}</CodeBlock>
        </section>

        <section id="output">
          <h2><span className="anchor">#</span>Shape the output when another step consumes it</h2>
          <p>
            In an interactive session, natural language is usually enough. In automation, define the answer
            shape and use <code className="inline">--json</code> for the transport envelope. For delegated
            tasks, request evidence fields or configure an output schema on the agent definition.
          </p>
          <CodeBlock lang="text">{"Inspect changed files only. Return:\n- verdict: PASS or FAIL\n- confirmed findings with severity, path and line\n- verification command and exit status\nDo not include speculative findings."}</CodeBlock>
          <Note>A prose instruction is not a parser. Use a validated agent output schema when malformed output must fail closed.</Note>
        </section>

        <section id="iteration">
          <h2><span className="anchor">#</span>Work in stages when uncertainty is high</h2>
          <p>
            Separate discovery, decision and implementation for migrations, unfamiliar subsystems and broad
            refactors. Review mode answers “what exists?” Plan mode creates an approval boundary. Build mode
            executes the approved direction. A typo or obvious one-line fix should go straight to Build.
          </p>
          <CodeBlock lang="text">{"First map how provider configuration is resolved and list any ambiguity.\nDo not edit. After the map, propose the smallest compatible change."}</CodeBlock>
        </section>

        <section id="inputs">
          <h2><span className="anchor">#</span>Files, paste and stdin</h2>
          <p>
            Type <code className="inline">@</code> to search project files and insert a reference. Long terminal
            pastes become compact placeholders in the editor and expand when submitted, keeping the input
            usable. In scripts, pipe data through stdin and keep the instruction in the argument prompt.
          </p>
          <CodeBlock lang="bash">{"git diff --stat | deepseek --pipe \"identify risky areas and explain why\""}</CodeBlock>
          <p>
            Treat pasted logs, fetched pages and tool results as untrusted data. They can contain text that
            resembles instructions; permissions and explicit scope remain the authority.
          </p>
        </section>

        <section id="autonomy">
          <h2><span className="anchor">#</span>Control autonomy with product controls</h2>
          <p>
            “Do not edit” is useful, but Review mode enforces it. “Ask before destructive commands” is useful,
            but risk rules enforce it. “Always run formatting” is useful, but a hook makes it deterministic.
            Use prompts for intent and judgment; use modes, permissions, hooks and workspaces for boundaries.
          </p>
        </section>

        <section id="debugging">
          <h2><span className="anchor">#</span>Debugging prompts</h2>
          <CodeBlock lang="text">{"Reproduce the failure before editing.\nTrace every caller of the function implicated by the stack trace.\nExplain the root cause in two sentences, add the smallest regression test,\napply the shared fix, and rerun the focused test plus typecheck."}</CodeBlock>
          <p>
            Asking for reproduction prevents a plausible but unrelated change. Asking for callers pushes the
            fix toward the shared boundary instead of patching one visible symptom.
          </p>
        </section>

        <section id="review">
          <h2><span className="anchor">#</span>Review prompts</h2>
          <CodeBlock lang="text">{"Review the diff against main for correctness and regressions.\nRead enough surrounding code to verify each claim.\nReport only actionable findings caused by this change.\nFor each: severity, path:line, failure scenario and why existing tests miss it."}</CodeBlock>
          <p>
            Use <code className="inline">/review</code> for one read-only pass, a reviewer agent for isolated
            context, or <a href="/docs/code-review">multi-agent review</a> when independent perspectives and a
            verification phase justify the extra cost.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
