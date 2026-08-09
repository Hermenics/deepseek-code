import { CodeBlock, Note, Toc, Icon } from "../Layout";

const TOC = [
  { id: "install", label: "Install" },
  { id: "first-run", label: "First run" },
  { id: "headless", label: "Headless mode" },
  { id: "requirements", label: "Requirements" },
  { id: "next", label: "Next steps" },
];

export default function Quickstart() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Get Started</span><span className="sep">/</span><span className="current">Quickstart</span>
        </nav>

        <div className="hero">
          <h1>Quickstart</h1>
          <p className="tagline">
            Get DeepSeek Code running in your terminal in under a minute.
          </p>
        </div>

        <section id="install">
          <h2><span className="anchor">#</span>Install</h2>
          <p className="lead">Install the CLI globally with Bun:</p>
          <CodeBlock lang="bash">{`# npm
$ npm install -g @hermenics/deepseek-code

# or with bun
$ bun add -g @hermenics/deepseek-code`}</CodeBlock>
        </section>

        <section id="first-run">
          <h2><span className="anchor">#</span>First run</h2>
          <p>
            Navigate to any project and launch the assistant:
          </p>
          <CodeBlock lang="bash">$ <span className="k">cd</span> my-project
$ <span className="f">deepseek</span></CodeBlock>
          <p>
            On first launch you'll pick a <b>provider</b> and configure authentication. DeepSeek
            Code reads your codebase, so starting it inside the project you want to work on gives
            the agent the best context.
          </p>
        </section>

        <section id="headless">
          <h2><span className="anchor">#</span>Headless mode</h2>
          <p>
            For scripting and automation, pipe a prompt straight in — no TUI needed:
          </p>
          <CodeBlock lang="bash">{`# Plain text prompt
echo "explain this project" | deepseek --pipe

# Ask about a file, get JSON back
cat src/index.tsx | deepseek --pipe --json "summarize"`}</CodeBlock>
          <Note>
            Headless mode is ideal for CI, cron jobs, and piping results into other tools.
          </Note>
        </section>

        <section id="requirements">
          <h2><span className="anchor">#</span>Requirements</h2>
          <ul className="capabilities">
            <li><b>Bun 1.1+</b> — the runtime and package manager</li>
            <li>A supported LLM provider (DeepSeek API, Bedrock, Vertex, or local)</li>
            <li>Node.js 18+ only if you're publishing or building from source</li>
          </ul>
        </section>

        <section id="next">
          <h2><span className="anchor">#</span>Next steps</h2>
          <div className="next-links">
            <a className="next-card" href="/docs/installation">
              <div className="nc-title">Installation <Icon.Arrow /></div>
              <div className="nc-desc">Install from source and explore the project structure.</div>
            </a>
            <a className="next-card" href="/docs/commands">
              <div className="nc-title">Commands <Icon.Arrow /></div>
              <div className="nc-desc">Learn every slash command in the palette.</div>
            </a>
            <a className="next-card" href="/docs/providers">
              <div className="nc-title">Providers <Icon.Arrow /></div>
              <div className="nc-desc">Configure DeepSeek, Bedrock, Vertex, or a local model.</div>
            </a>
          </div>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
