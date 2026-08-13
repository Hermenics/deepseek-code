import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "surfaces", label: "Repository surfaces" },
  { id: "setup", label: "Local setup" },
  { id: "commands", label: "Command reference" },
  { id: "loop", label: "Development loop" },
  { id: "architecture", label: "Source map" },
  { id: "runtime", label: "Runtime conventions" },
  { id: "website", label: "Website development" },
  { id: "state", label: "Local state & secrets" },
  { id: "done", label: "Definition of done" },
];

const ROOT_COMMANDS = [
  ["bun run start", "Run the TypeScript entry point once with NODE_ENV=development."],
  ["bun run dev", "Run the same entry point under Bun watch mode and restart after source changes."],
  ["bun run build", "Bundle the production CLI and create the executable launcher under dist/."],
  ["bun run typecheck", "Run strict TypeScript checking without emitting JavaScript."],
  ["bun test", "Run the Bun test suite under tests/."],
  ["bun run test:coverage", "Run the suite and write an LCOV report under coverage/."],
  ["bun run test:ink", "Run only the local terminal-renderer contract tests."],
  ["bun run test:plugins", "Run only plugin loader, registry, installer, and command tests."],
  ["bun run pack:check", "Pack and install the current npm artifact, then verify its executable and version."],
];

const SOURCE_MAP = [
  ["src/entrypoints/", "Interactive CLI argument handling and headless pipe-mode entry points."],
  ["src/agent/", "Agent loop, provider clients, sessions, context, verification, and agent configuration."],
  ["src/commands/", "Slash-command parsers and command metadata."],
  ["src/ui/", "React terminal UI, input, setup, settings, activity, messages, and workflows."],
  ["src/ink/", "The project-owned Ink-compatible terminal renderer and terminal event system."],
  ["src/tools/", "Built-in tools and their system-boundary validation."],
  ["src/permissions/", "Modes, allow/deny policy, risk evaluation, and authorization decisions."],
  ["src/settings/", "Defaults, three-scope loading, validation, migration, and atomic writes."],
  ["src/orchestration/", "Task graph, mailboxes, agents, workspaces, snapshots, events, and review."],
  ["src/workflows/", "Workflow discovery, parsing, execution, storage, and monitoring."],
  ["src/plugins/ and src/skills/", "Extension discovery, validation, installation, and registries."],
  ["src/hooks/", "Pre-tool, post-tool, and session-start hook execution."],
  ["src/services/", "Cross-cutting services such as context compaction."],
  ["src/kernel/", "Reference persistence subsystem with its own contracts and tests."],
  ["tests/", "All CLI and runtime tests; tests never live under src/."],
  ["website/", "Independent CRACO/React application for the landing page and documentation."],
];

const WEBSITE_COMMANDS = [
  ["npm ci", "Install exactly the website dependency lock used by CI."],
  ["npm run dev", "Generate release data, then start the CRACO development server."],
  ["npm run lint", "Lint JavaScript and JSX under website/src with zero warnings allowed."],
  ["npm run test:ci", "Run the website Jest suite once with CI behavior."],
  ["npm run build", "Regenerate release data and create the optimized website/build output."],
];

export default function Development() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Contributing</span><span className="sep">/</span><span className="current">Development</span>
        </nav>

        <div className="hero">
          <h1>Development environment</h1>
          <p className="tagline">
            Set up the CLI and documentation site, understand the repository boundaries, and use the
            shortest reliable feedback loop for each kind of change.
          </p>
        </div>

        <section id="surfaces">
          <h2><span className="anchor">#</span>Repository surfaces</h2>
          <p>
            The repository contains two applications with different toolchains. The root is the Bun,
            TypeScript, and React terminal application published as
            <code className="inline">@hermenics/deepseek-code</code>. The
            <code className="inline">website/</code> directory is a private npm package built with
            CRACO and React Scripts.
          </p>
          <p>
            Work from the repository root for CLI commands. Change into
            <code className="inline">website/</code> before running site commands. Keeping those lockfiles
            and commands separate mirrors CI and avoids accidentally resolving the website with Bun or
            the CLI with npm.
          </p>
          <Note>
            The website is not the CLI package, and <code className="inline">website/build/</code> is not
            part of the npm CLI artifact. A successful build on one surface says nothing about the other.
          </Note>
        </section>

        <section id="setup">
          <h2><span className="anchor">#</span>Local setup</h2>
          <p>
            Bun 1.1 or newer is the declared CLI runtime. CI currently exercises the project with a
            pinned Bun version, while the package keeps the broader 1.1+ compatibility contract. Node and
            npm are required for the website and npm packaging workflow.
          </p>
          <CodeBlock lang="bash">{`$ git clone https://github.com/Hermenics/deepseek-code.git
$ cd deepseek-code
$ bun install --frozen-lockfile
$ bun run typecheck
$ bun test`}</CodeBlock>
          <p>
            For day-to-day local dependency updates, <code className="inline">bun install</code> is fine.
            Use <code className="inline">--frozen-lockfile</code> when you want the same fail-on-lock-drift
            behavior as CI.
          </p>
          <CodeBlock lang="bash">{`$ bun --version
$ node --version
$ npm --version`}</CodeBlock>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>Root command reference</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Command</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {ROOT_COMMANDS.map(([command, purpose]) => (
                  <tr key={command}>
                    <td><code className="inline">{command}</code></td>
                    <td>{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The package scripts are intentionally thin. The source commands execute
            <code className="inline">src/index.tsx</code> directly; the build invokes
            <code className="inline">build.ts</code>; and tests point Bun at the
            <code className="inline">tests/</code> directory. There is no hidden task runner to learn.
          </p>
        </section>

        <section id="loop">
          <h2><span className="anchor">#</span>Choose a development loop</h2>
          <h3>Agent, provider, command, or tool work</h3>
          <CodeBlock lang="bash">{`$ bun test tests/path-to-focused.test.ts
$ bun run typecheck
$ bun run dev`}</CodeBlock>
          <p>
            Start with the narrowest existing test that exercises the contract, then typecheck, then run
            the interactive CLI when terminal behavior matters. Watch mode restarts the source process;
            it does not preserve a live session across restarts.
          </p>

          <h3>Terminal renderer or UI work</h3>
          <CodeBlock lang="bash">{`$ bun run test:ink
$ bun test tests/ui
$ bun run typecheck
$ bun run start`}</CodeBlock>
          <p>
            Automated renderer tests catch layout and terminal-contract regressions, but visual changes
            still need a real terminal at narrow and wide widths. Check keyboard-only operation, cursor
            restoration, alternate-screen behavior, reduced motion, streamed updates, and abort paths.
          </p>

          <h3>Release-facing work</h3>
          <CodeBlock lang="bash">{`$ bun run typecheck
$ bun run test:coverage
$ bun run build
$ bun run pack:check`}</CodeBlock>
          <p>
            That sequence matches the CLI CI job. The package smoke test consumes the existing
            <code className="inline">dist/</code>; it does not build for you, so keep build before pack.
          </p>
        </section>

        <section id="architecture">
          <h2><span className="anchor">#</span>Source map</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Area</th><th>Responsibility</th></tr>
              </thead>
              <tbody>
                {SOURCE_MAP.map(([area, responsibility]) => (
                  <tr key={area}>
                    <td><code className="inline">{area}</code></td>
                    <td>{responsibility}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Trace a user action end to end before editing. A slash command commonly touches its parser,
            the central command union and registry, UI dispatch, product behavior, help text, tests, and
            docs. A tool commonly crosses schema validation, permission and mode policy, execution,
            result formatting, audit, and undo or verification behavior.
          </p>
          <p>
            See <a href="/docs/architecture">Architecture</a> for the runtime flow and
            <a href="/docs/how-it-works">How DeepSeek Code works</a> for the lifecycle of a turn.
          </p>
        </section>

        <section id="runtime">
          <h2><span className="anchor">#</span>Runtime conventions</h2>
          <ul className="capabilities">
            <li><b>ES modules.</b> The package uses ESM and bundler-style TypeScript resolution. Follow nearby import conventions, including runtime-compatible file extensions.</li>
            <li><b>Strict TypeScript.</b> Type checking targets modern JavaScript, uses the React JSX transform, and includes Bun runtime types.</li>
            <li><b>React in a terminal.</b> UI components render through the repository&apos;s local Ink-compatible implementation, not a browser DOM.</li>
            <li><b>System boundaries validate input.</b> Treat model tool arguments, settings JSON, plugin files, workflow files, MCP data, paths, and process output as untrusted.</li>
            <li><b>Tests live in tests/.</b> Keep production source free of colocated test files and keep every source or docs file below 500 lines.</li>
            <li><b>Use existing patterns.</b> Read neighboring commands, tools, settings, and tests before introducing a new shape.</li>
          </ul>
          <Note>
            Changes under <code className="inline">src/ink/</code> affect runtime infrastructure and have
            an explicit code owner. Expect focused renderer tests and owner review for that directory.
          </Note>
        </section>

        <section id="website">
          <h2><span className="anchor">#</span>Website development</h2>
          <CodeBlock lang="bash">{`$ cd website
$ npm ci
$ npm run dev`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Command</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {WEBSITE_COMMANDS.map(([command, purpose]) => (
                  <tr key={command}>
                    <td><code className="inline">{command}</code></td>
                    <td>{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Site code uses JavaScript and JSX with two-space indentation, double quotes, semicolons,
            functional components, and existing Tailwind utilities. Preserve semantic HTML, visible
            focus, keyboard behavior, reduced-motion support, and stable user-facing selectors.
          </p>
          <p>
            Both start and build regenerate <code className="inline">src/docs/data/releases.json</code>{" "}
            from the root <code className="inline">CHANGELOG.md</code>. If that generated file changes,
            inspect it and include it with the changelog update.
          </p>
        </section>

        <section id="state">
          <h2><span className="anchor">#</span>Local state & secrets</h2>
          <p>
            Running from source uses the same user configuration and sessions as the globally installed
            CLI. That is convenient for realistic testing and dangerous if you assume development has an
            isolated profile. Review the active provider and working directory before destructive or
            billable manual tests.
          </p>
          <ul className="capabilities">
            <li>Never commit <code className="inline">.env</code> files, provider keys, service-account JSON, saved config, session exports, or real customer prompts.</li>
            <li>Use synthetic repositories and temporary directories for tests that write, delete, change permissions, or initialize Git.</li>
            <li>Restore environment variables, global mocks, timers, fetch, and temporary directories in test cleanup.</li>
            <li>Keep <code className="inline">dist/</code>, <code className="inline">coverage/</code>, <code className="inline">website/build/</code>, and dependency directories out of commits.</li>
          </ul>
          <p>
            See <a href="/docs/security">Security</a> for trust boundaries and
            <a href="/docs/deepseek-directory">The .deepseek directory</a> before inspecting or removing
            persisted state.
          </p>
        </section>

        <section id="done">
          <h2><span className="anchor">#</span>Definition of done</h2>
          <p>
            A change is ready when the behavior is implemented at the correct boundary, a focused
            regression test proves it, type checking succeeds, relevant suites pass, user-facing docs are
            current, and no generated files or secrets slipped into the diff. Before a pull request, run
            the complete CI-equivalent gates for every surface you touched.
          </p>
          <CodeBlock lang="bash">{`# CLI
$ bun run typecheck
$ bun run test:coverage
$ bun run build
$ bun run pack:check

# Website, when touched
$ cd website
$ npm run lint
$ npm run test:ci
$ npm run build`}</CodeBlock>
          <p>
            Continue with <a href="/docs/testing">Testing</a>,
            <a href="/docs/build-publishing">Build & publishing</a>, and
            <a href="/docs/contributing">Contributing</a> for the detailed contracts behind those gates.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
