import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "binary", label: "The deepseek binary" },
  { id: "flags", label: "Flags" },
  { id: "pipe", label: "Pipe mode" },
  { id: "exit", label: "Exit & sessions" },
];

export default function CliReference() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">CLI reference</span>
        </nav>

        <div className="hero">
          <h1>CLI reference</h1>
          <p className="tagline">
            The <code className="inline">deepseek</code> binary, its flags, and headless usage.
          </p>
        </div>

        <section id="binary">
          <h2><span className="anchor">#</span>The deepseek binary</h2>
          <p>
            After a global install, <code className="inline">deepseek</code> is on your PATH:
          </p>
          <CodeBlock lang="bash">$ deepseek</CodeBlock>
          <p>
            Running it inside a project starts an interactive session in the TUI. From source,
            use the equivalent scripts:
          </p>
          <CodeBlock lang="bash">{`$ bun run dev      # dev mode with watch
$ bun run start    # run from source`}</CodeBlock>
        </section>

        <section id="flags">
          <h2><span className="anchor">#</span>Flags</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Flag</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><code className="inline">--pipe</code></td><td>Run headless — read the prompt from stdin</td></tr>
                <tr><td><code className="inline">--json</code></td><td>Emit the result as JSON (used with --pipe)</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="pipe">
          <h2><span className="anchor">#</span>Pipe mode</h2>
          <p>
            Pipe mode lets you script the assistant without the TUI. The prompt is read from
            stdin:
          </p>
          <CodeBlock lang="bash">{`echo "explain this project" | deepseek --pipe
cat src/index.tsx | deepseek --pipe --json "summarize"`}</CodeBlock>
          <Note>
            Combine <code className="inline">--pipe --json</code> to get a structured result you
            can consume in scripts and CI.
          </Note>
        </section>

        <section id="exit">
          <h2><span className="anchor">#</span>Exit &amp; sessions</h2>
          <p>
            End a session with <code className="inline">/quit</code> or the standard exit
            shortcut. Session transcripts can be exported with{" "}
            <code className="inline">/sessions export &lt;id&gt; [json|md]</code> — the output is
            sanitized before export.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
