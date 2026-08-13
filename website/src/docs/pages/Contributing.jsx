import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "start", label: "Start here" },
  { id: "choose", label: "Choose the right path" },
  { id: "workflow", label: "Contribution workflow" },
  { id: "standards", label: "Engineering standards" },
  { id: "change-map", label: "Change map" },
  { id: "tests", label: "Validation" },
  { id: "commits", label: "Commits & pull requests" },
  { id: "security", label: "Security reports" },
  { id: "review", label: "Review-ready checklist" },
];

const PATHS = [
  ["Bug with a reproducible failure", "Open an issue with exact steps, version, environment, expected behavior, and sanitized output."],
  ["Small, well-understood fix", "Open a focused pull request with a failing regression test, the root-cause fix, and relevant docs."],
  ["New behavior or broad design", "Open an issue or discussion first so scope, UX, compatibility, and security can be agreed before a large implementation."],
  ["Security vulnerability", "Use GitHub's private vulnerability-reporting flow. Never disclose exploit details or secrets in a public issue."],
  ["Question about using the CLI", "Check the docs, /help, /doctor, and troubleshooting pages before filing a product bug."],
];

const CHANGE_MAP = [
  ["Slash command", "Command parser/registry, command union, UI dispatch, help text, behavior tests, slash-command docs."],
  ["Built-in tool", "Input schema, path or argument validation, permission and mode policy, execution, audit/undo behavior, tests, tool docs."],
  ["Setting", "Type/default, scope merge, validation, settings UI, migration compatibility, tests, settings reference."],
  ["Provider", "Configuration and readiness, client adapter, streaming and errors, model metadata, setup UI, mocked tests, provider docs."],
  ["Terminal UI", "UI component/state, local renderer contracts where relevant, keyboard/accessibility behavior, narrow layouts, tests, screenshots."],
  ["Renderer", "src/ink contracts, focus/screen/terminal tests, manual terminal cleanup checks, code-owner review."],
  ["Agent or orchestration", "Lifecycle, permissions, cancellation, persistence, event/audit semantics, recovery, focused and end-to-end tests, architecture docs."],
  ["Plugin, skill, MCP, or workflow", "Discovery and schema boundary, installation/trust behavior, runtime execution, failures, tests, authoring docs."],
  ["Documentation site", "Page content, route, sidebar placement, internal links, accessibility, lint, Jest, production build."],
];

const STANDARDS = [
  ["Read before editing", "Trace the complete behavior and inspect neighboring implementations, tests, docs, and call sites."],
  ["Fix the owning boundary", "Solve the root cause once at the shared parser, repository, policy, runtime, or renderer layer instead of patching callers independently."],
  ["Validate untrusted input", "Model arguments, JSON files, paths, shell input, provider responses, MCP data, plugin content, and process output all cross trust boundaries."],
  ["Preserve safety", "Do not weaken permission checks, path confinement, secret redaction, atomic persistence, abort handling, or terminal cleanup to make a test pass."],
  ["Keep files focused", "Every source and documentation file stays below 500 lines; split by real responsibility, not speculative abstraction."],
  ["Keep tests out of src", "CLI tests belong under tests/ and should prove observable behavior."],
  ["Protect compatibility", "Account for settings scopes, legacy migrations, resumed sessions, provider differences, headless mode, and non-interactive environments where relevant."],
  ["Document user-visible change", "Update the website docs, command help, README, or changelog wherever users would otherwise see stale behavior."],
];

export default function Contributing() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Contributing</span><span className="sep">/</span><span className="current">Contribution guide</span>
        </nav>

        <div className="hero">
          <h1>Contributing</h1>
          <p className="tagline">
            Turn a bug report, feature idea, documentation improvement, or code change into a focused,
            tested, secure, and reviewable contribution.
          </p>
        </div>

        <section id="start">
          <h2><span className="anchor">#</span>Start here</h2>
          <p>
            DeepSeek Code is open source under Apache 2.0. Contributions can touch the Bun CLI, providers,
            agent runtime, local terminal renderer, tools, permissions, persistence, extensions, workflows,
            tests, or the separate React documentation site.
          </p>
          <CodeBlock lang="bash">{`$ git clone https://github.com/Hermenics/deepseek-code.git
$ cd deepseek-code
$ bun install --frozen-lockfile
$ bun run typecheck
$ bun test`}</CodeBlock>
          <p>
            Run the unchanged baseline before editing. If it fails, capture the failure and environment so
            your eventual pull request does not accidentally claim responsibility for a pre-existing or
            machine-specific problem.
          </p>
          <Note>
            By contributing, you agree that your contribution is licensed under the repository&apos;s Apache
            License 2.0. Do not submit code, assets, tests, or documentation you do not have the right to
            license.
          </Note>
        </section>

        <section id="choose">
          <h2><span className="anchor">#</span>Choose the right path</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>You have</th><th>Best next step</th></tr>
              </thead>
              <tbody>
                {PATHS.map(([situation, next]) => (
                  <tr key={situation}>
                    <td>{situation}</td>
                    <td>{next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Search existing issues and pull requests before starting. If an issue exists, add new
            reproducible information rather than opening a duplicate. A proposal should explain the user
            problem and desired outcome before prescribing architecture.
          </p>
        </section>

        <section id="workflow">
          <h2><span className="anchor">#</span>Contribution workflow</h2>
          <ol className="steps">
            <li><b>Fork and branch from current main.</b> Keep the branch dedicated to one concern.</li>
            <li><b>Reproduce or specify the behavior.</b> Identify the authoritative boundary and the evidence that will prove the change.</li>
            <li><b>Add a focused test.</b> For bugs, make the regression fail before the fix whenever practical.</li>
            <li><b>Implement the smallest complete change.</b> Reuse existing patterns and preserve validation, errors, cancellation, and cleanup.</li>
            <li><b>Exercise the real user path.</b> Automated checks do not replace a terminal, package, provider, or browser pass when those surfaces changed.</li>
            <li><b>Update documentation.</b> Keep command help, docs, README, changelog, examples, and screenshots consistent with behavior.</li>
            <li><b>Run all relevant gates.</b> Start focused, finish with the CI-equivalent checks for every touched application.</li>
            <li><b>Review your own diff.</b> Remove debug output, unrelated formatting, generated artifacts, secrets, and accidental local state.</li>
            <li><b>Open the pull request.</b> Explain the problem, solution, behavior changes, risks, and exact validation performed.</li>
          </ol>
          <CodeBlock lang="bash">{`$ git switch -c fix/short-description
# make one focused change
$ git diff --check
$ git status --short`}</CodeBlock>
        </section>

        <section id="standards">
          <h2><span className="anchor">#</span>Engineering standards</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Standard</th><th>Expectation</th></tr>
              </thead>
              <tbody>
                {STANDARDS.map(([standard, expectation]) => (
                  <tr key={standard}>
                    <td>{standard}</td>
                    <td>{expectation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            CLI source is strict TypeScript and ESM. The UI is React rendered through the local
            Ink-compatible runtime. The website uses JavaScript/JSX, two-space indentation, double quotes,
            semicolons, functional components, existing Tailwind utilities, accessible HTML, and zero lint
            warnings.
          </p>
        </section>

        <section id="change-map">
          <h2><span className="anchor">#</span>Change map</h2>
          <p>
            Use this map to avoid the common failure mode where implementation changes but discovery,
            policy, persistence, help, tests, or documentation still describes the old contract.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "25%" }}>Change</th><th>Inspect together</th></tr>
              </thead>
              <tbody>
                {CHANGE_MAP.map(([change, areas]) => (
                  <tr key={change}>
                    <td>{change}</td>
                    <td>{areas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            This is an inspection map, not a requirement to edit every listed file. Change only what the
            real behavior crosses, but verify every adjacent contract before deciding it is unaffected.
          </Note>
        </section>

        <section id="tests">
          <h2><span className="anchor">#</span>Validation</h2>
          <p>For CLI changes, the pull-request template expects these gates:</p>
          <CodeBlock lang="bash">{`$ bun run typecheck
$ bun run test:coverage
$ bun run build
$ bun run pack:check`}</CodeBlock>
          <p>
            Run a focused test during development, then the complete sequence before review. Build must
            precede <code className="inline">pack:check</code> because package verification consumes the
            existing <code className="inline">dist/</code> and does not rebuild it.
          </p>
          <p>For website changes, run the separate npm toolchain:</p>
          <CodeBlock lang="bash">{`$ cd website
$ npm run lint
$ npm run test:ci
$ npm run build`}</CodeBlock>
          <p>
            If a gate is intentionally not run, say which one and why in the pull request. Do not mark it
            complete or imply a passing result. See <a href="/docs/testing">Testing</a> for isolation,
            provider mocks, renderer checks, and CI details.
          </p>
        </section>

        <section id="commits">
          <h2><span className="anchor">#</span>Commits & pull requests</h2>
          <p>
            Use an imperative, concise Conventional Commit-style subject. Common types are
            <code className="inline">feat</code>, <code className="inline">fix</code>,
            <code className="inline">refactor</code>, <code className="inline">test</code>,
            <code className="inline">docs</code>, and <code className="inline">chore</code>. Add a scope
            when it makes the affected subsystem clearer.
          </p>
          <CodeBlock lang="text">{`fix(workflows): preserve agent phase during discovery
test(settings): cover invalid local timeout
docs(cli): explain doctor exit status`}</CodeBlock>
          <p>A useful pull request description answers:</p>
          <ul className="capabilities">
            <li><b>Problem:</b> what user-visible or maintainer-visible behavior was wrong or missing?</li>
            <li><b>Cause:</b> which owning boundary produced it?</li>
            <li><b>Change:</b> what contract is different now, including compatibility or migration effects?</li>
            <li><b>Risk:</b> what permissions, persistence, provider, terminal, concurrency, or package behavior deserves extra review?</li>
            <li><b>Validation:</b> which exact commands and manual paths passed?</li>
          </ul>
          <p>
            Keep titles under 70 characters, keep one concern per pull request, link relevant issues, and
            include before/after screenshots or a short recording for visual changes. Do not mix generated
            formatting or unrelated cleanup into a behavioral fix.
          </p>
        </section>

        <section id="security">
          <h2><span className="anchor">#</span>Security reports</h2>
          <p>
            Do not open a public issue for a vulnerability. Use the repository&apos;s
            <a href="https://github.com/Hermenics/deepseek-code/security"> private GitHub Security
            Advisory flow</a>. Include the affected version, minimal reproduction, impact, and a suggested
            fix when available, but do not include real third-party credentials or customer data.
          </p>
          <p>
            The project supports security fixes on the latest stable release. If you run from
            <code className="inline">main</code>, pull frequently. Report any secret that appears in logs,
            exports, snapshots, errors, or UI output even if the original feature appears to work.
          </p>
          <Note>
            The agent can execute shell commands and change files. A contribution that expands execution,
            path access, network access, external processes, plugins, hooks, MCP, or persistence needs an
            explicit trust-boundary review, not just a happy-path test.
          </Note>
        </section>

        <section id="review">
          <h2><span className="anchor">#</span>Review-ready checklist</h2>
          <ul className="capabilities">
            <li>The branch contains one logical change and is current enough with <code className="inline">main</code> to validate meaningfully.</li>
            <li>A regression or feature test proves the user-facing contract and fails for the old behavior when practical.</li>
            <li>Input validation, permissions, errors, abort, cleanup, redaction, and persistence were reviewed where applicable.</li>
            <li>CLI typecheck, coverage tests, build, and package smoke pass for CLI changes.</li>
            <li>Website lint, one-shot tests, and production build pass for website changes.</li>
            <li>Documentation, help, README, changelog, examples, and screenshots match the new behavior.</li>
            <li>The diff contains no secrets, env files, generated dist/build/coverage output, local state, debug logging, or unrelated edits.</li>
            <li>The pull request lists exact validation and clearly identifies anything not run.</li>
          </ul>
          <p>
            Continue with <a href="/docs/development">Development environment</a>,
            <a href="/docs/testing">Testing</a>, and
            <a href="/docs/build-publishing">Build & publishing</a> for the complete commands and release
            boundaries.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
