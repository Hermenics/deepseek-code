import { CodeBlock, Note, Toc, Icon } from "../Layout";

const TOC = [
  { id: "prereqs", label: "Prerequisites" },
  { id: "global", label: "Global install" },
  { id: "source", label: "Run from source" },
  { id: "dev-commands", label: "Development commands" },
  { id: "structure", label: "Project structure" },
  { id: "next", label: "Next steps" },
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
            Install DeepSeek Code globally, or run it straight from the source repository.
          </p>
        </div>

        <section id="prereqs">
          <h2><span className="anchor">#</span>Prerequisites</h2>
          <ul className="capabilities">
            <li><b>Bun</b> 1.1 or newer — <code className="inline">bun</code> is the runtime and package manager</li>
            <li><b>Node.js 18+</b> — required only for npm publishing, not for daily use</li>
            <li>A supported LLM provider (see <a href="/docs/providers">Providers</a>)</li>
          </ul>
        </section>

        <section id="global">
          <h2><span className="anchor">#</span>Global install</h2>
          <p>Install the CLI once, then use it in any project:</p>
          <CodeBlock lang="bash">{`# npm
$ npm install -g @hermenics/deepseek-code

# or with bun
$ bun add -g @hermenics/deepseek-code`}</CodeBlock>
          <p>
            After install, <code className="inline">deepseek</code> is available on your PATH. Run it
            inside any project to start a session.
          </p>
          <Note>
            Secrets are stored only in <code className="inline">~/.deepseek/config.json</code> — never
            in the project.
          </Note>
        </section>

        <section id="source">
          <h2><span className="anchor">#</span>Run from source</h2>
          <p className="lead">Clone the repo and install dependencies:</p>
          <CodeBlock lang="bash">{`$ git clone https://github.com/Hermenics/deepseek-code.git
$ cd deepseek-code
$ bun install`}</CodeBlock>
        </section>

        <section id="dev-commands">
          <h2><span className="anchor">#</span>Development commands</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Command</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><code className="inline">bun run dev</code></td><td>Start in dev mode with watch</td></tr>
                <tr><td><code className="inline">bun run start</code></td><td>Run from source</td></tr>
                <tr><td><code className="inline">bun run build</code></td><td>Production build</td></tr>
                <tr><td><code className="inline">bun run typecheck</code></td><td>Type check (<code className="inline">tsc --noEmit</code>)</td></tr>
                <tr><td><code className="inline">bun test</code></td><td>Run the test suite</td></tr>
                <tr><td><code className="inline">bun run test:coverage</code></td><td>Run tests with an LCOV coverage report</td></tr>
                <tr><td><code className="inline">bun run test:plugins</code></td><td>Run the plugin test suite only</td></tr>
                <tr><td><code className="inline">bun run pack:check</code></td><td>Verify the npm package before publishing</td></tr>
              </tbody>
            </table>
          </div>
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
├── kernel/          # Dormant reference subsystem — not wired into the runtime
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
            <code className="inline">src/kernel/</code> is a dormant reference subsystem kept for
            architectural study — nothing imports it at runtime.
          </Note>
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
          </div>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
