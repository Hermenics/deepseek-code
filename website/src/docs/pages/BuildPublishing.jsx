import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Build contract" },
  { id: "artifacts", label: "Generated artifacts" },
  { id: "launcher", label: "Launcher behavior" },
  { id: "package", label: "npm package contents" },
  { id: "smoke", label: "Package smoke test" },
  { id: "ci", label: "CI gates" },
  { id: "release", label: "Release checklist" },
  { id: "publish", label: "Publish & verify" },
  { id: "limits", label: "Current limitations" },
];

const ARTIFACTS = [
  ["dist/cli.mjs", "Minified Bun-targeted ESM bundle produced from the CLI entry point.", "Executable"],
  ["dist/deepseek", "Bash launcher exposed as the deepseek npm binary.", "Executable"],
  ["dist/*.wasm", "Parser/runtime assets emitted by dependencies used by the bundled CLI.", "Data"],
  ["dist/*.scm", "Tree-sitter query assets emitted alongside parser modules.", "Data"],
];

const PACKAGE_CONTENTS = [
  ["package.json", "Package identity, version, bin mapping, runtime requirement, dependencies, and public publish configuration."],
  ["README.md", "npm landing page, installation, providers, commands, development summary, and links."],
  ["LICENSE", "Apache License 2.0 terms distributed with the package."],
  ["dist/", "The launcher, bundled CLI, and all runtime assets currently present in the directory."],
];

const RELEASE_GATES = [
  ["Dependencies", "bun install --frozen-lockfile", "Proves the checked-in Bun lock can reproduce installation."],
  ["Types", "bun run typecheck", "Proves strict TypeScript contracts without emitting files."],
  ["Behavior", "bun run test:coverage", "Runs the complete suite and creates the LCOV artifact expected by CI."],
  ["Artifact", "bun run build", "Creates the production bundle, launcher, and emitted runtime assets."],
  ["Package", "bun run pack:check", "Packs, installs, and executes the exact artifact npm would receive."],
  ["Contents", "npm pack --dry-run --ignore-scripts --json", "Makes every tarball path, mode, size, and package summary reviewable."],
];

export default function BuildPublishing() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Contributing</span><span className="sep">/</span><span className="current">Build & publishing</span>
        </nav>

        <div className="hero">
          <h1>Build & publishing</h1>
          <p className="tagline">
            Understand the Bun production bundle, executable launcher, npm allowlist, package smoke test,
            CI gates, and the manual checks required before a public release.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Build contract</h2>
          <p>
            The CLI is authored as TypeScript and React but published as an npm package whose executable
            still runs on Bun. The production build bundles the application from
            <code className="inline">src/index.tsx</code>, targets Bun, minifies the result, emits it into
            <code className="inline">dist/</code>, and creates a small shell launcher.
          </p>
          <CodeBlock lang="bash">{`$ bun install --frozen-lockfile
$ bun run typecheck
$ bun run build
Build concluído com sucesso!`}</CodeBlock>
          <p>
            A successful bundle is necessary but not sufficient. Type checking is separate, tests are
            separate, and npm package verification is separate. Run all three layers before treating the
            output as releasable.
          </p>
          <p>
            The build leaves no dependency explicitly external and substitutes the development-only React
            DevTools integration with the repository&apos;s runtime stub. The published bundle is minified and
            does not emit a source map. Package metadata still declares dependencies, so validate both the
            bundle output and the package-manager installation rather than assuming either one proves the
            other.
          </p>
          <Note>
            <code className="inline">bun run build</code> does not empty
            <code className="inline">dist/</code> first. A release build should start from a reviewed clean
            directory so stale assets cannot enter the tarball through the package&apos;s broad
            <code className="inline">dist/</code> allowlist.
          </Note>
        </section>

        <section id="artifacts">
          <h2><span className="anchor">#</span>Generated artifacts</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "25%" }}>Path</th><th>Role</th><th style={{ width: "15%" }}>Mode</th></tr>
              </thead>
              <tbody>
                {ARTIFACTS.map(([path, role, mode]) => (
                  <tr key={path}>
                    <td><code className="inline">{path}</code></td>
                    <td>{role}</td>
                    <td>{mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Asset filenames can contain generated hashes and can change when parser dependencies or the
            bundler change. Review the actual <code className="inline">npm pack</code> manifest instead of
            maintaining a hand-written filename list. Both fixed executable files are given executable
            permissions by the build.
          </p>
          <CodeBlock lang="bash">{`$ ls -lah dist
$ file dist/deepseek dist/cli.mjs
$ deepseek --version`}</CodeBlock>
          <p>
            The final command above checks the installed binary on PATH. To test the freshly built local
            launcher specifically, use <code className="inline">./dist/deepseek --version</code>.
          </p>
        </section>

        <section id="launcher">
          <h2><span className="anchor">#</span>Launcher behavior</h2>
          <p>
            npm maps the command name <code className="inline">deepseek</code> to
            <code className="inline">dist/deepseek</code>. The launcher resolves symlinks so a globally
            linked package still finds the adjacent bundle, verifies that Bun exists, rejects versions
            older than 1.1, and forwards every CLI argument to the bundle.
          </p>
          <p>
            It also installs an exit trap that disables terminal mouse tracking and restores the cursor
            when the shell can access a TTY. That is a last line of defense around the application&apos;s own
            terminal cleanup. Like every process, it cannot run cleanup after an uncatchable kill or a
            machine crash; use <code className="inline">reset</code> if a terminal is left in a broken mode.
          </p>
          <Note>
            The published launcher is Bash. Linux and macOS are the direct target. On Windows, use an
            environment that provides the required Unix shell and Bun behavior, such as WSL; do not infer
            native Windows support from npm&apos;s generated command shim alone.
          </Note>
        </section>

        <section id="package">
          <h2><span className="anchor">#</span>npm package contents</h2>
          <p>
            The package is public and scoped as
            <code className="inline">@hermenics/deepseek-code</code>. Its explicit file allowlist contains
            <code className="inline">dist/</code>, <code className="inline">README.md</code>, and
            <code className="inline">LICENSE</code>; npm also includes the package manifest.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "25%" }}>Entry</th><th>Why it ships</th></tr>
              </thead>
              <tbody>
                {PACKAGE_CONTENTS.map(([entry, purpose]) => (
                  <tr key={entry}>
                    <td><code className="inline">{entry}</code></td>
                    <td>{purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`$ npm pack --dry-run --ignore-scripts --json`}</CodeBlock>
          <p>
            Read the returned <code className="inline">files</code> array, not just the package name and
            size. Confirm that the two executables have executable mode, required WASM and query assets are
            present, and no credentials, logs, coverage, source checkout state, or unrelated build output
            appears.
          </p>
          <Note>
            <code className="inline">dist/</code> and the generated tarball are release products, not
            source changes. They are ignored by Git and should not be committed.
          </Note>
        </section>

        <section id="smoke">
          <h2><span className="anchor">#</span>Package smoke test</h2>
          <CodeBlock lang="bash">{`$ bun run build
$ bun run pack:check
Package smoke test passed: hermenics-deepseek-code-x.y.z.tgz`}</CodeBlock>
          <p>The smoke script performs a clean consumer-style path:</p>
          <ul className="capabilities">
            <li>Creates an isolated temporary directory and removes it on exit.</li>
            <li>Runs <code className="inline">npm pack</code> with lifecycle scripts disabled.</li>
            <li>Reads the generated filename from npm&apos;s JSON result instead of guessing it.</li>
            <li>Installs that tarball into a temporary prefix without changing the repository lockfile.</li>
            <li>Confirms the installed <code className="inline">deepseek</code> bin exists and is executable.</li>
            <li>Runs <code className="inline">--version</code> and requires an exact match with <code className="inline">package.json</code>.</li>
          </ul>
          <p>
            Because it uses npm to install the packed package, the check may need registry access for
            declared dependencies not already cached. It needs Node and npm in addition to Bun.
          </p>
          <Note>
            The smoke check deliberately does not open the TUI, contact a provider, run the doctor, inspect
            every tarball path, or rebuild. Pair it with the full tests, a fresh build, and the dry-run
            manifest review.
          </Note>
        </section>

        <section id="ci">
          <h2><span className="anchor">#</span>CI gates</h2>
          <p>
            Pushes and pull requests targeting <code className="inline">main</code> run independent CLI
            and website jobs. The CLI job runs on Ubuntu, installs with Bun&apos;s frozen lockfile, typechecks,
            tests with coverage, builds, smoke-tests the package, and uploads
            <code className="inline">coverage/lcov.info</code>.
          </p>
          <CodeBlock lang="bash">{`$ bun install --frozen-lockfile
$ bun run typecheck
$ bun run test:coverage
$ bun run build
$ bun run pack:check`}</CodeBlock>
          <p>
            The website job uses Node 24 and <code className="inline">npm ci</code>, then lint, one-shot
            tests, and production build. CodeQL separately analyzes JavaScript and TypeScript on pushes,
            pull requests, and a weekly schedule; generated dist and tests are excluded from that analysis.
          </p>
          <CodeBlock lang="bash">{`$ cd website
$ npm ci
$ npm run lint
$ npm run test:ci
$ npm run build`}</CodeBlock>
        </section>

        <section id="release">
          <h2><span className="anchor">#</span>Release checklist</h2>
          <p>
            The repository&apos;s CI validates artifacts but does not contain an npm-publish workflow. A
            maintainer therefore owns the final registry action and must not treat a green pull request as
            proof that the local release directory or npm identity is correct.
          </p>
          <ol className="steps">
            <li><b>Choose and record the version.</b> Update the package manifest and the npm lock consistently; confirm the version is not already published.</li>
            <li><b>Update release notes.</b> Add the release heading and user-visible changes to <code className="inline">CHANGELOG.md</code>. Regenerate and inspect the website release data.</li>
            <li><b>Review the diff.</b> Exclude credentials, env files, generated build directories, local settings, sessions, and unrelated edits.</li>
            <li><b>Start from clean artifacts.</b> Remove only the repository&apos;s <code className="inline">dist/</code>, rebuild it, and review every newly emitted file.</li>
            <li><b>Run every gate.</b> Use the exact commands below and stop on the first failure.</li>
            <li><b>Inspect the package.</b> Review npm&apos;s JSON dry-run manifest, executable modes, name, version, size, and required parser assets.</li>
            <li><b>Confirm registry identity.</b> Verify the active npm account, organization access, authentication policy, and intended distribution tag.</li>
            <li><b>Publish once.</b> Publish the already-reviewed artifact from the reviewed commit; do not edit between pack verification and publish.</li>
            <li><b>Verify as a consumer.</b> Read registry metadata and install in a clean temporary environment before announcing the release.</li>
          </ol>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Gate</th><th style={{ width: "35%" }}>Command</th><th>Evidence</th></tr>
              </thead>
              <tbody>
                {RELEASE_GATES.map(([gate, command, evidence]) => (
                  <tr key={gate}>
                    <td>{gate}</td>
                    <td><code className="inline">{command}</code></td>
                    <td>{evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="publish">
          <h2><span className="anchor">#</span>Publish & verify</h2>
          <CodeBlock lang="bash">{`$ npm whoami
$ npm view @hermenics/deepseek-code version
$ npm pack --dry-run --ignore-scripts --json
$ npm publish
$ npm view @hermenics/deepseek-code version`}</CodeBlock>
          <p>
            The package manifest sets public access, so ordinary stable publication does not need an
            additional access flag. Prereleases should use an intentional non-latest distribution tag;
            never let a prerelease replace the stable install path accidentally.
          </p>
          <p>
            After the registry reports the new version, install it in a disposable environment and run
            <code className="inline">deepseek --version</code>,
            <code className="inline">deepseek help</code>, and
            <code className="inline">deepseek doctor</code>. Confirm that required assets resolve when the
            package is outside the source checkout.
          </p>
          <Note>
            npm versions are immutable. If a published release is wrong, do not try to overwrite the same
            version. Assess impact, deprecate the bad version when appropriate, fix forward with a new
            version, and use the private security-reporting process if credentials or a vulnerability are
            involved.
          </Note>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Current limitations</h2>
          <ul className="capabilities">
            <li><b>No automated npm release:</b> CI builds and validates, but registry publication, tags, and release announcement remain maintainer actions.</li>
            <li><b>No clean-dist step:</b> the build writes into the existing directory, so release hygiene must remove stale artifacts first.</li>
            <li><b>No tarball allowlist assertion:</b> <code className="inline">pack:check</code> verifies installation and version, not the exact set of files.</li>
            <li><b>No minimum-Bun matrix:</b> CI pins one Bun version even though the published contract supports Bun 1.1+.</li>
            <li><b>No native Windows launcher:</b> the shipped bin is a Bash script.</li>
            <li><b>No provider smoke in packaging:</b> the release check is deliberately credential-free and does not prove external model access.</li>
          </ul>
          <p>
            These are boundaries of the current pipeline, not reasons to skip a release. Use explicit
            manual evidence where automation stops, and expand automation only when it removes a recurring
            release risk.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
