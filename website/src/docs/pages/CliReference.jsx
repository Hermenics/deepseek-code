import { CodeBlock, Note, Toc } from "../Layout";

const FLAGS = [
  ["deepseek", "Start an interactive session in the TUI"],
  ["deepseek \"message\"", "Start a session with an initial message"],
  ["deepseek agent <name> [message]", "Load a custom agent (from .deepseek/agents/ in the project or ~/.deepseek/agents/), optionally with an initial message"],
  ["deepseek --resume <session-id>", "Resume a previous session; bare --resume opens the resume picker"],
  ["deepseek doctor", "Run diagnostics — runtime, workspace, credentials, settings, MCP. Exits 1 if any check fails"],
  ["deepseek update", "Force an update check and run npm install -g with the latest version"],
  ["deepseek logout", "Remove saved credentials and API keys"],
  ["deepseek help · -h · --help", "Print usage and exit"],
  ["deepseek version · v · -v · --version", "Print the installed version and exit"],
  ["deepseek --pipe [--json] [prompt]", "Headless pipe mode — see below"],
];

const TOC = [
  { id: "binary", label: "The deepseek binary" },
  { id: "usage", label: "Usage" },
  { id: "flags", label: "Flags & subcommands" },
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

        <section id="usage">
          <h2><span className="anchor">#</span>Usage</h2>
          <CodeBlock lang="bash">{`Usage:
  deepseek                          Start interactive session
  deepseek "fix the bug in app.ts"  Start with an initial message
  deepseek agent <name>             Load a custom agent
  deepseek agent <name> "message"   Load agent with initial message
  deepseek --resume <session-id>    Resume a previous session
  deepseek doctor                   Diagnose local setup
  deepseek update                   Update to latest version
  deepseek logout                   Remove saved credentials
  deepseek help                     Show this help`}</CodeBlock>
        </section>

        <section id="flags">
          <h2><span className="anchor">#</span>Flags &amp; subcommands</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "38%" }}>Invocation</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {FLAGS.map(([flag, desc]) => (
                  <tr key={flag}>
                    <td><code className="inline">{flag}</code></td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            On startup the binary also checks the npm registry for updates and prompts you
            interactively when a new version exists.
          </Note>
        </section>

        <section id="pipe">
          <h2><span className="anchor">#</span>Pipe mode</h2>
          <p>
            Pipe mode lets you script the assistant without the TUI. The prompt can come from
            the arguments and/or stdin:
          </p>
          <CodeBlock lang="bash">{`echo "explain this project" | deepseek --pipe
deepseek --pipe "summarize" < README.md
cat src/index.tsx | deepseek --pipe --json "summarize"`}</CodeBlock>
          <ul>
            <li><b>Prompt source</b> — when both an argument prompt and stdin are given, the stdin content becomes fenced context under the argument prompt.</li>
            <li><b>Safety</b> — destructive shell commands are auto-denied, since no one can confirm them interactively.</li>
            <li><b>--json</b> — emits a single <code className="inline">{"{ok, output, tools}"}</code> object on success, or <code className="inline">{"{ok: false, error}"}</code> with exit code 1 on failure.</li>
            <li><b>Plain mode</b> — tokens stream to stdout as they are generated; <code className="inline">[tool] &lt;name&gt;</code> lines go to stderr.</li>
          </ul>
          <Note>
            Combine <code className="inline">--pipe --json</code> to get a structured result you
            can consume in scripts and CI.
          </Note>
        </section>

        <section id="exit">
          <h2><span className="anchor">#</span>Exit &amp; sessions</h2>
          <p>
            End a session with <code className="inline">/quit</code> or the standard exit
            shortcut. On <code className="inline">SIGINT</code> or <code className="inline">SIGTERM</code> the process
            exits cleanly: it restores the terminal cursor, disables mouse tracking, and prints
            a resume hint:
          </p>
          <CodeBlock lang="bash">{`Resume this session:
  deepseek --resume <SESSION_ID>`}</CodeBlock>
          <p>
            Session transcripts can be exported with{" "}
            <code className="inline">/sessions export &lt;id&gt; [json|md]</code> — the output is
            sanitized before export.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
