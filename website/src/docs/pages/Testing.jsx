import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "strategy", label: "Test strategy" },
  { id: "commands", label: "Test commands" },
  { id: "focused", label: "Run focused tests" },
  { id: "write", label: "Write a regression test" },
  { id: "isolation", label: "Isolation & cleanup" },
  { id: "terminal", label: "Terminal UI tests" },
  { id: "providers", label: "Providers & live smoke tests" },
  { id: "coverage", label: "Coverage & CI" },
  { id: "website", label: "Website tests" },
  { id: "debug", label: "Debug failures" },
];

const COMMANDS = [
  ["bun test", "All automatically discovered CLI tests under tests/."],
  ["bun test tests/agent.test.ts", "One test file."],
  ["bun test tests/workflows", "One subsystem directory."],
  ["bun run test:ink", "The terminal renderer contract suite under tests/ink/."],
  ["bun run test:plugins", "Plugin discovery, validation, registry, install, and command tests."],
  ["bun run test:coverage", "Full suite with LCOV output in coverage/lcov.info."],
  ["bun run typecheck", "Static contract check; not a substitute for runtime tests."],
];

const TEST_LAYERS = [
  ["Pure contracts", "Parsers, schemas, merge rules, risk classification, text measurement, formatting, and state transitions."],
  ["Filesystem", "Settings, sessions, memory, checkpoints, worktrees, plugins, skills, workflows, and path-safety behavior in temporary directories."],
  ["Agent runtime", "Streaming, tool calls, aborts, compaction, queues, permissions, goals, reasoning, provider adapters, and context persistence."],
  ["Terminal UI", "Input editing, history, paste handling, status and activity rendering, focus, alternate screen, and terminal event contracts."],
  ["Orchestration", "Task dependencies, mailboxes, workspaces, leases, snapshots, review, authorization, and end-to-end coordinator behavior."],
  ["Package", "A clean npm pack/install smoke test that executes the installed deepseek binary and checks its version."],
];

const REGRESSION_CHECKLIST = [
  ["Reproduce", "Make the test fail for the reported behavior before relying on the fix."],
  ["Use the public boundary", "Exercise the parser, repository, tool, command, hook, provider adapter, renderer, or agent API that owns the contract."],
  ["Assert behavior", "Prefer outputs, state, files, events, exit status, and user-visible text over private implementation details."],
  ["Cover the sibling case", "Include the nearest success, denial, empty, abort, or malformed-input path when it guards the same bug class."],
  ["Clean up", "Restore every process-global mutation and remove every temporary artifact."],
  ["Run broad enough", "After the focused test passes, run the subsystem and then the complete gates appropriate to the change."],
];

export default function Testing() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Contributing</span><span className="sep">/</span><span className="current">Testing</span>
        </nav>

        <div className="hero">
          <h1>Testing</h1>
          <p className="tagline">
            Prove behavior with Bun&apos;s test runner, isolate real system boundaries, exercise the local
            terminal renderer, and match the checks enforced in CI.
          </p>
        </div>

        <section id="strategy">
          <h2><span className="anchor">#</span>Test strategy</h2>
          <p>
            DeepSeek Code is a stateful terminal agent: it reads and writes files, invokes processes,
            streams provider responses, persists sessions, and renders interactive terminal state. The
            suite therefore tests contracts at several levels instead of treating everything as a model
            call or a snapshot.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Layer</th><th>What belongs there</th></tr>
              </thead>
              <tbody>
                {TEST_LAYERS.map(([layer, scope]) => (
                  <tr key={layer}>
                    <td>{layer}</td>
                    <td>{scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            All CLI tests live under <code className="inline">tests/</code>, never under
            <code className="inline">src/</code>. Most use <code className="inline">bun:test</code>{" "}
            directly, so there is no separate Vitest or Jest configuration for the CLI.
          </p>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>Test commands</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Command</th><th>Scope</th></tr>
              </thead>
              <tbody>
                {COMMANDS.map(([command, scope]) => (
                  <tr key={command}>
                    <td><code className="inline">{command}</code></td>
                    <td>{scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            The package&apos;s <code className="inline">test</code> script is
            <code className="inline">bun test tests</code>. Files that are not named as Bun tests, such
            as the real Bedrock smoke script, are not part of the default suite.
          </Note>
        </section>

        <section id="focused">
          <h2><span className="anchor">#</span>Run focused tests</h2>
          <p>
            During implementation, target the smallest file or subsystem that owns the behavior. This
            keeps feedback fast without weakening the final validation.
          </p>
          <CodeBlock lang="bash">{`# One contract
$ bun test tests/settingsRepository.test.ts

# One subsystem
$ bun test tests/workflows

# Terminal input and renderer areas
$ bun test tests/ui/input
$ bun run test:ink

# Final CLI suite
$ bun test`}</CodeBlock>
          <p>
            If your change crosses boundaries, run each relevant area. A settings UI change can require
            repository tests, UI behavior tests, type checking, and a manual interactive pass; passing
            only the parser test would be incomplete evidence.
          </p>
        </section>

        <section id="write">
          <h2><span className="anchor">#</span>Write a regression test</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Step</th><th>Rule</th></tr>
              </thead>
              <tbody>
                {REGRESSION_CHECKLIST.map(([step, rule]) => (
                  <tr key={step}>
                    <td>{step}</td>
                    <td>{rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Name the test after the observable contract. Good descriptions explain what remains true
            under a condition: a denied command does not execute, a malformed snapshot is rejected before
            restore, an abort stops streaming, or a narrow terminal keeps controls reachable.
          </p>
          <p>
            Avoid assertions that merely repeat an implementation choice. A test that only confirms an
            internal helper was called may stay green while the user-visible result is wrong. Assert the
            returned result, rendered lines, persisted data, emitted event, file mode, process arguments,
            or state transition instead.
          </p>
        </section>

        <section id="isolation">
          <h2><span className="anchor">#</span>Isolation & cleanup</h2>
          <p>
            Many runtime APIs derive behavior from the current directory, home directory, PATH, provider
            variables, global fetch, timers, and module imports. Those are shared process state, so an
            isolated assertion can still contaminate the next test unless cleanup is explicit.
          </p>
          <ul className="capabilities">
            <li><b>Filesystem:</b> create a unique directory under the operating system&apos;s temporary directory and remove it recursively in cleanup.</li>
            <li><b>Environment:</b> save the previous value, set only the variable needed by the test, then restore or delete it exactly.</li>
            <li><b>Network:</b> mock the provider, SDK, DNS, or fetch boundary. Unit tests must not depend on live credentials, quota, internet access, or mutable model output.</li>
            <li><b>Processes:</b> control PATH or inject the process boundary when testing discovery. Assert command, arguments, cwd, timeout, and exit handling.</li>
            <li><b>Global functions:</b> restore fetch, timers, spies, and terminal globals after every test that changes them.</li>
            <li><b>Module mocks:</b> use them sparingly because Bun module mocks can outlive one assertion and affect later imports in the same process.</li>
          </ul>
          <Note>
            Never point a destructive filesystem or Git test at the repository checkout, your actual
            home directory, or a real worktree. The cleanup path should be the exact temporary directory
            created by that test.
          </Note>
        </section>

        <section id="terminal">
          <h2><span className="anchor">#</span>Terminal UI tests</h2>
          <p>
            The CLI ships a project-owned Ink-compatible renderer, so renderer contracts have a dedicated
            suite under <code className="inline">tests/ink/</code>. Higher-level UI tests cover input
            buffers, cursor movement, history, Vim mode, bracketed paste, queued messages, message lists,
            status, activity navigation, subagent views, and workflow interaction.
          </p>
          <CodeBlock lang="bash">{`$ bun run test:ink
$ bun test tests/ui
$ bun test tests/InputBox.test.ts tests/StatusBar.test.ts`}</CodeBlock>
          <p>
            Automated tests should assert stable rendered text, dimensions, focus, events, or state. For
            a visual change, also run the real CLI and cover the conditions that static output misses:
            resize while streaming, Unicode and wide characters, narrow terminals, multiline input,
            keyboard-only navigation, abort, and terminal cleanup after exit.
          </p>
          <p>
            Snapshot testing is not the default strategy here. Small behavioral assertions produce more
            useful failures than accepting a large terminal snapshot whose changed line is hard to find.
          </p>
        </section>

        <section id="providers">
          <h2><span className="anchor">#</span>Providers & live smoke tests</h2>
          <p>
            DeepSeek API, Bedrock, Vertex, and local-model unit tests replace external boundaries with
            deterministic doubles. They cover request mapping, streaming events, reasoning fields, tool
            emulation, authentication errors, abort signals, and provider-specific response shapes without
            making billable requests.
          </p>
          <p>
            A separate Bedrock smoke script exists for maintainers who deliberately want to exercise real
            AWS models. It is not discovered by <code className="inline">bun test</code> and requires an
            ignored credentials file:
          </p>
          <CodeBlock lang="bash">{`$ bun run --env-file .env.test.bedrock tests/smoke-bedrock.ts`}</CodeBlock>
          <Note>
            The smoke script sends real requests to configured Bedrock models and can incur cost. Run it
            only in an authorized AWS account, review region and profile first, never commit the env file,
            and never make it a prerequisite for ordinary contributors or CI.
          </Note>
        </section>

        <section id="coverage">
          <h2><span className="anchor">#</span>Coverage & CI</h2>
          <p>
            The coverage command writes <code className="inline">coverage/lcov.info</code>. CI uploads that
            file as the <code className="inline">cli-coverage</code> artifact and fails if it is missing.
            The repository does not declare a numeric coverage threshold; coverage is diagnostic evidence,
            not permission to skip a meaningful regression case.
          </p>
          <p>The CLI CI job runs, in order:</p>
          <CodeBlock lang="bash">{`$ bun install --frozen-lockfile
$ bun run typecheck
$ bun run test:coverage
$ bun run build
$ bun run pack:check`}</CodeBlock>
          <p>
            CI currently pins Bun 1.3.13 while the published runtime contract remains Bun 1.1+. If you
            touch a runtime-sensitive API, test the minimum supported version as well as the CI version
            before claiming broad compatibility.
          </p>
        </section>

        <section id="website">
          <h2><span className="anchor">#</span>Website tests</h2>
          <p>
            The website is tested separately with React Scripts and Jest. Its CI job installs from
            <code className="inline">website/package-lock.json</code>, lints all JS and JSX with zero
            warnings, runs tests once, and builds the production site under Node 24.
          </p>
          <CodeBlock lang="bash">{`$ cd website
$ npm ci
$ npm run lint
$ npm run test:ci
$ npm run build`}</CodeBlock>
          <p>
            Place website tests next to the component as <code className="inline">*.test.js</code> or
            <code className="inline">*.test.jsx</code>. Prefer user-visible behavior and stable selectors.
            New keyboard or interactive behavior needs a regression test and an accessibility pass.
          </p>
        </section>

        <section id="debug">
          <h2><span className="anchor">#</span>Debug failures</h2>
          <ul className="capabilities">
            <li><b>Passes alone, fails in the suite:</b> look for leaked environment variables, module mocks, fetch replacements, timers, cwd changes, or temporary files.</li>
            <li><b>Times out:</b> identify an unclosed process, server, stream, watcher, timer, or promise; do not merely raise the timeout.</li>
            <li><b>Fails only in CI:</b> compare the pinned Bun or Node version, frozen lockfile, Linux paths, case sensitivity, TTY assumptions, locale, and missing local tools.</li>
            <li><b>Flaky async assertion:</b> wait for the actual state transition or event instead of sleeping for an arbitrary duration.</li>
            <li><b>Provider test reaches the network:</b> move the mock to the provider or transport boundary and make the response deterministic.</li>
            <li><b>Package smoke fails:</b> build first, inspect npm pack contents, then confirm the installed bin is executable and prints the package version.</li>
          </ul>
          <p>
            Do not merge by rerunning a flaky test until it passes. A flaky test is evidence of a race,
            leaked state, nondeterministic fixture, or incorrect wait condition, and its root cause belongs
            in the same change that makes the suite reliable.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
