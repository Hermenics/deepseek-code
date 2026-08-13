import { CodeBlock, Note, Toc, Icon } from "../Layout";

const TOC = [
  { id: "prereqs", label: "Prerequisites" },
  { id: "global", label: "Global install" },
  { id: "which", label: "npm or Bun?" },
  { id: "updating", label: "Updating" },
  { id: "notifier", label: "How the update check works" },
  { id: "uninstall", label: "Uninstalling" },
  { id: "source", label: "Run from source" },
  { id: "dev-commands", label: "Development commands" },
  { id: "structure", label: "Project structure" },
  { id: "verify", label: "Verify the install" },
  { id: "next", label: "Next steps" },
];

const DEV_COMMANDS = [
  ["bun run dev", "Start in dev mode with watch"],
  ["bun run start", "Run from source"],
  ["bun run build", "Production build"],
  ["bun run typecheck", "Type check (tsc --noEmit)"],
  ["bun test", "Run the test suite"],
  ["bun run test:coverage", "Run tests with an LCOV coverage report"],
  ["bun run test:ink", "Run the terminal-renderer suite only"],
  ["bun run test:plugins", "Run the plugin suite only"],
  ["bun run pack:check", "Verify the npm package before publishing"],
];

const NOTIFIER = [
  ["COOLDOWN_MS", "1 hour", "Minimum gap between successful checks."],
  ["RETRY_AFTER_FAILURE_MS", "10 minutes", "Shorter backoff when the registry is unreachable."],
  ["FETCH_TIMEOUT_MS", "5 seconds", "Hard abort on the registry request."],
  ["update-cooldown", "~/.deepseek/", "Stores the deadline for the next allowed check."],
  ["dismissed-update-version", "~/.deepseek/", "The version you dismissed, so it stops being offered."],
];

const VERIFY = [
  ["deepseek --version", "Prints the installed version."],
  ["which deepseek", "Confirms which install is on your PATH."],
  ["/doctor", "Inside a session: runtime, workspace, git, ripgrep, credentials, settings, MCP."],
];

export default function Installation() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Get Started</span><span className="sep">/</span><span className="current">Installation</span>
        </nav>

        <div className="hero">
          <h1>Installation</h1>
          <p className="tagline">
            Install globally with npm or Bun, keep it updated, or run it straight from the source
            repository.
          </p>
        </div>

        <section id="prereqs">
          <h2><span className="anchor">#</span>Prerequisites</h2>
          <ul className="capabilities">
            <li><b>Bun</b> 1.1 or newer — declared in <code className="inline">engines</code>, and the runtime the binary executes under</li>
            <li><b>git</b> — required for <a href="/docs/worktrees">worktrees</a> and the Git tool</li>
            <li><b>ripgrep</b> — optional, makes search noticeably faster</li>
            <li><b>Node.js 18+</b> — only for npm publishing or building from source</li>
            <li>A supported LLM provider (see <a href="/docs/providers">Providers</a>)</li>
          </ul>
          <p>
            Everything except Bun and a provider is optional. <code className="inline">/doctor</code> reports
            each one and distinguishes a missing requirement from a missing convenience — a{" "}
            <code className="inline">✗</code> on ripgrep is advisory, a <code className="inline">✗</code> on
            credentials is not.
          </p>
        </section>

        <section id="global">
          <h2><span className="anchor">#</span>Global install</h2>
          <p>Install the CLI once, then use it in any project:</p>
          <CodeBlock lang="bash">{`# npm
$ npm install -g @hermenics/deepseek-code

# or with bun
$ bun add -g @hermenics/deepseek-code`}</CodeBlock>
          <p>
            After install, <code className="inline">deepseek</code> is on your PATH. Run it inside any project
            to start a session.
          </p>
          <Note>
            API keys are never written to the project. Credentials live in the owner-only file{" "}
            <code className="inline">~/.deepseek/config.json</code>; non-secret user settings live in{" "}
            <code className="inline">~/.deepseek/settings.json</code>. See{" "}
            <a href="/docs/deepseek-directory">The .deepseek directory</a>.
          </Note>
        </section>

        <section id="which">
          <h2><span className="anchor">#</span>npm or Bun?</h2>
          <p>
            Both work, and the tool detects which you used rather than assuming. It checks Bun's global
            package directory directly and asks npm for its global package root.
          </p>
          <p>
            They run in parallel and <b>both</b> can be true. That is not a hypothetical: installing with npm
            and later with Bun leaves two copies, and which one answers depends on PATH order. Detecting both
            is what lets the update notice tell you to upgrade <em>each</em> rather than upgrading one and
            leaving a stale binary shadowing it.
          </p>
          <p>
            The Bun check is a file existence test — cheap and offline. The npm check has to shell out to{" "}
            <code className="inline">npm root -g</code> because the global root varies by installation, and it
            is wrapped in a catch so a missing npm returns false instead of throwing.
          </p>
          <p>
            When neither is detected, the fallback is <code className="inline">npm</code>. That is a display
            decision: an unrecognized install still needs an upgrade command to show, and npm is the more
            common one to get right by default.
          </p>
        </section>

        <section id="updating">
          <h2><span className="anchor">#</span>Updating</h2>
          <CodeBlock lang="bash">{`# whichever you installed with
$ npm install -g @hermenics/deepseek-code@latest
$ bun add -g @hermenics/deepseek-code@latest`}</CodeBlock>
          <p>
            If you have both, run both. The one earlier in your PATH is the one you are actually running:
          </p>
          <CodeBlock lang="bash">{`$ which deepseek
$ deepseek --version`}</CodeBlock>
          <p>
            There is no self-update. The tool tells you a newer version exists and leaves the upgrade to
            your package manager — a CLI that rewrites its own binary is a CLI that can break itself mid-run,
            and it takes the decision away from whoever owns the machine.
          </p>
        </section>

        <section id="notifier">
          <h2><span className="anchor">#</span>How the update check works</h2>
          <p>
            The check queries the npm registry for the published latest version, and is bounded on every
            axis:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Constant / file</th><th style={{ width: "20%" }}>Value</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {NOTIFIER.map(([c, v, p]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td><code className="inline">{v}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Two details are worth calling out because they are the difference between a helpful notice and
            an annoyance.
          </p>
          <p>
            <b>Failure backs off shorter than success.</b> A successful check waits an hour; a failed one
            retries after ten minutes. The reasoning is that a failure is usually transient — you were
            offline, the registry blipped — while a success genuinely means there is nothing to learn for a
            while.
          </p>
          <p>
            <b>The cooldown file stores a deadline, not a timestamp.</b> It records{" "}
            <code className="inline">now + delay</code> rather than "when I last checked". Reading it is then a
            single comparison against the current time, with no arithmetic that could get the direction
            wrong, and the same file expresses both backoff durations without needing to know which one
            produced it.
          </p>
          <p>
            Version comparison is its own small function rather than a semver dependency, and it encodes one
            rule most naive comparisons get wrong: at equal numeric versions, a{" "}
            <b>stable release beats a prerelease</b>. <code className="inline">1.2.3</code> is newer than{" "}
            <code className="inline">1.2.3-beta.1</code>, so a beta user is correctly offered the final
            release.
          </p>
          <p>
            Dismissing a notice writes the version to{" "}
            <code className="inline">~/.deepseek/dismissed-update-version</code>. You stop hearing about that
            version specifically, not about updates in general — the next release notifies again.
          </p>
          <Note>
            The whole path is wrapped so a network failure is silent. An update check that produces an error
            on startup would be worse than one that occasionally misses a release.
          </Note>
        </section>

        <section id="uninstall">
          <h2><span className="anchor">#</span>Uninstalling</h2>
          <CodeBlock lang="bash">{`$ npm uninstall -g @hermenics/deepseek-code
$ bun remove -g @hermenics/deepseek-code`}</CodeBlock>
          <p>
            Removing the package does not remove your data. Sessions, memory, skills, plugins, checkpoints
            and audit logs live in your home directory and survive uninstall — which is what you want when
            reinstalling, and what to clean up when you are actually done:
          </p>
          <CodeBlock lang="bash">{`# review before deleting — this is your sessions, memory and audit trail
$ ls ~/.deepseek
$ rm -rf ~/.deepseek ~/.deepseek-code`}</CodeBlock>
          <p>
            Per-project state lives in <code className="inline">.deepseek/</code> inside each repository.
            Deleting that removes steering, project settings and worktree bookkeeping for that project only —
            and if you committed those files, git still has them.
          </p>
          <p>
            See <a href="/docs/deepseek-directory">The .deepseek directory</a> for what each path holds and
            what deleting it costs.
          </p>
        </section>

        <section id="source">
          <h2><span className="anchor">#</span>Run from source</h2>
          <p className="lead">Clone the repo and install dependencies:</p>
          <CodeBlock lang="bash">{`$ git clone https://github.com/Hermenics/deepseek-code.git
$ cd deepseek-code
$ bun install
$ bun run start`}</CodeBlock>
          <p>
            Running from source uses the same configuration as a global install — the same{" "}
            <code className="inline">~/.deepseek/</code>, the same credentials, the same sessions. There is no
            separate development profile, so a source checkout is a drop-in replacement for the installed
            binary rather than a parallel universe.
          </p>
        </section>

        <section id="dev-commands">
          <h2><span className="anchor">#</span>Development commands</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Command</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {DEV_COMMANDS.map(([c, d]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">bun run dev</code> and <code className="inline">bun run start</code> both set{" "}
            <code className="inline">NODE_ENV=development</code>; <code className="inline">dev</code> adds{" "}
            <code className="inline">--watch</code> for reload on save.
          </p>
        </section>

        <section id="structure">
          <h2><span className="anchor">#</span>Project structure</h2>
          <CodeBlock lang="text">{`src/
├── agent/           # Core agent loop, LLM clients and providers
├── bootstrap/       # Startup state
├── commands/        # Slash command definitions
├── constants/       # Shared constants
├── entrypoints/     # CLI entry points (cli.tsx, pipe.ts)
├── hooks/           # Pre/post tool execution hooks
├── index.tsx        # Entry point
├── ink/             # Local Ink-compatible terminal renderer
├── kernel/          # Reference subsystem — not wired into the runtime
├── native-ts/       # Native TypeScript implementations (yoga-layout)
├── orchestration/   # Multi-agent task registry, mailboxes, workspaces
├── permissions/     # Allow/deny rules and risk checks
├── plugins/         # Plugin registry and installer
├── services/        # Cross-cutting services such as compaction
├── settings/        # Settings schema, merge and repository
├── skills/          # Skill registry and installer
├── stubs/           # Vendor stubs (e.g. react-devtools-core)
├── tools/           # Agent tools (file ops, shell, git, search, etc.)
├── types/           # Shared types
├── ui/              # React TUI components and app state
├── utils/           # Utilities
└── workflows/       # Workflow engine and monitors
tests/               # Test suite
website/             # Docs website (React + CRA)`}</CodeBlock>
          <Note>
            <code className="inline">src/kernel/</code> is a designed-and-implemented reference subsystem that
            nothing currently imports at runtime. See{" "}
            <a href="/docs/kernel-persistence">Kernel & persistence</a> for what it contains and why it
            exists.
          </Note>
          <p>
            Two directories are unusual enough to explain. <code className="inline">src/ink/</code> is a local
            terminal renderer rather than a dependency, which is why the TUI can be changed without waiting
            on an upstream release. <code className="inline">src/native-ts/</code> holds TypeScript
            reimplementations of native modules — currently the Yoga layout engine — removing a native build
            step from installation.
          </p>
        </section>

        <section id="verify">
          <h2><span className="anchor">#</span>Verify the install</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Command</th><th>Confirms</th></tr>
              </thead>
              <tbody>
                {VERIFY.map(([c, d]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            If <code className="inline">deepseek --version</code> reports something older than you just
            installed, you have two copies and PATH is choosing the other one. Run{" "}
            <code className="inline">which deepseek</code> to find out which.
          </p>
        </section>

        <section id="next">
          <h2><span className="anchor">#</span>Next steps</h2>
          <div className="next-links">
            <a className="next-card" href="/docs/quickstart">
              <div className="nc-title">Quickstart <Icon.Arrow /></div>
              <div className="nc-desc">Run your first session end to end.</div>
            </a>
            <a className="next-card" href="/docs/providers">
              <div className="nc-title">Providers <Icon.Arrow /></div>
              <div className="nc-desc">Connect DeepSeek API, Bedrock, Vertex, or a local model.</div>
            </a>
            <a className="next-card" href="/docs/deepseek-directory">
              <div className="nc-title">The .deepseek directory <Icon.Arrow /></div>
              <div className="nc-desc">What gets written where, and what is safe to delete.</div>
            </a>
          </div>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
