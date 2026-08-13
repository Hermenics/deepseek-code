import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "explore", label: "Explore a codebase" },
  { id: "bug", label: "Fix a bug" },
  { id: "feature", label: "Build a feature" },
  { id: "refactor", label: "Refactor safely" },
  { id: "tests", label: "Add tests" },
  { id: "review", label: "Review changes" },
  { id: "security", label: "Security review" },
  { id: "performance", label: "Performance" },
  { id: "docs", label: "Documentation" },
  { id: "agents", label: "Delegation" },
  { id: "automation", label: "Automation" },
];

export default function PromptLibrary() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb"><span>Docs</span><span className="sep">/</span><span>Get Started</span><span className="sep">/</span><span className="current">Prompt library</span></nav>
        <div className="hero"><h1>Prompt library</h1><p className="tagline">Copyable starting points for real engineering tasks. Replace bracketed details and keep the verification clause.</p></div>
        <Note>These are prompts, not hidden modes. Edit them to name your files, constraints and definition of done.</Note>

        <section id="explore"><h2><span className="anchor">#</span>Explore a codebase</h2>
          <CodeBlock lang="text">{"Map how [capability] works from entry point to persistence.\nIdentify the public commands, core modules, state transitions and tests.\nCall out behavior that is implicit or surprising. Do not edit files.\nFinish with the three best starting points for a new contributor."}</CodeBlock>
          <CodeBlock lang="text">{"I need to change [behavior]. Find the shared function all relevant callers use,\nthe tests that define current behavior, and any compatibility constraints.\nReturn a concise change map. Do not implement yet."}</CodeBlock>
        </section>

        <section id="bug"><h2><span className="anchor">#</span>Fix a bug</h2>
          <CodeBlock lang="text">{"Bug: [symptom]\nReproduction: [steps or failing command]\nExpected: [behavior]\n\nReproduce first, trace the root cause across callers, add a regression test,\nfix it at the shared boundary, and run [focused check] plus [broader check]."}</CodeBlock>
        </section>

        <section id="feature"><h2><span className="anchor">#</span>Build a feature</h2>
          <CodeBlock lang="text">{"Implement [feature] for [user/use case].\nAcceptance criteria:\n- [observable behavior]\n- [edge case]\n- [compatibility requirement]\n\nReuse existing project patterns and dependencies. Keep the diff scoped.\nAdd user-visible tests and run [commands]."}</CodeBlock>
        </section>

        <section id="refactor"><h2><span className="anchor">#</span>Refactor safely</h2>
          <CodeBlock lang="text">{"Refactor [module] to [goal] without changing externally observable behavior.\nFirst identify its callers and current behavioral tests.\nMake the smallest coherent change, preserve public types and persisted formats,\nthen run the focused suite and compare the final diff for accidental behavior changes."}</CodeBlock>
        </section>

        <section id="tests"><h2><span className="anchor">#</span>Add tests</h2>
          <CodeBlock lang="text">{"Find the highest-risk untested branches in [area].\nUse the existing test style and avoid implementation-detail assertions.\nAdd the smallest cases that would catch real regressions, run only those tests,\nand explain which failure each case protects against."}</CodeBlock>
        </section>

        <section id="review"><h2><span className="anchor">#</span>Review changes</h2>
          <CodeBlock lang="text">{"Review [diff/branch/files] for defects introduced by the change.\nCheck correctness, error paths, async ordering, compatibility and missing tests.\nVerify every finding against surrounding code. Report only actionable issues,\nordered by severity, with path:line and a concrete failure scenario."}</CodeBlock>
          <CodeBlock lang="text">{"Try to refute this implementation. Focus on inputs the happy-path tests omit,\nstate that survives between calls, partial failures and concurrent execution.\nDo not comment on style unless it causes a defect."}</CodeBlock>
        </section>

        <section id="security"><h2><span className="anchor">#</span>Security review</h2>
          <CodeBlock lang="text">{"Threat-model [boundary] using the actual trust flow in this repository.\nInspect validation, authorization, secrets, path containment and command execution.\nReport confirmed weaknesses, affected boundary, impact, existing mitigation\nand the smallest safe remediation."}</CodeBlock>
        </section>

        <section id="performance"><h2><span className="anchor">#</span>Performance</h2>
          <CodeBlock lang="text">{"Investigate [slow path] without changing behavior.\nFind evidence of where time or memory is spent; do not optimize by intuition alone.\nPropose the smallest measurable improvement and a benchmark or check that can\nshow before/after results. Implement only after the bottleneck is demonstrated."}</CodeBlock>
        </section>

        <section id="docs"><h2><span className="anchor">#</span>Documentation</h2>
          <CodeBlock lang="text">{"Document [feature] from the user's perspective.\nVerify every command, default, path and limit against implementation and tests.\nCover setup, mental model, workflows, edge cases, security and troubleshooting.\nUse runnable user examples; do not paste source-code excerpts."}</CodeBlock>
        </section>

        <section id="agents"><h2><span className="anchor">#</span>Delegation</h2>
          <CodeBlock lang="text">{"Delegate these independent read-only investigations in parallel:\n1. [question and paths]\n2. [question and paths]\n3. [question and paths]\n\nRequire evidence and concise results. Synthesize disagreements in the main session.\nDo not let workers edit files."}</CodeBlock>
          <CodeBlock lang="text">{"Use one worktree-isolated writer for [owned paths].\nIts result must include changed files and verification output.\nReview the patch before integrating it into the main workspace."}</CodeBlock>
        </section>

        <section id="automation"><h2><span className="anchor">#</span>Automation</h2>
          <CodeBlock lang="bash">{"git diff --name-only origin/main \\\n  | deepseek --pipe --json \"Review only these changed files. Return PASS or FAIL, then confirmed findings.\""}</CodeBlock>
          <CodeBlock lang="bash">{"tail -200 service.log \\\n  | deepseek --pipe \"Group the failures by root cause and list the first diagnostic command for each.\""}</CodeBlock>
          <p>In CI, test the JSON envelope and exit status separately from the semantic verdict in the answer.</p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
