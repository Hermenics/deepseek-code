import { CodeBlock, Note, Toc, Icon } from "../Layout";

const TOC = [
  { id: "install", label: "Install" },
  { id: "first-run", label: "First run" },
  { id: "provider", label: "Configure a provider" },
  { id: "screen", label: "Reading the screen" },
  { id: "first-task", label: "Your first task" },
  { id: "permissions", label: "Answering permission prompts" },
  { id: "verify", label: "Verify and undo" },
  { id: "essentials", label: "The eight commands that matter" },
  { id: "headless", label: "Headless mode" },
  { id: "errors", label: "Common first-run errors" },
  { id: "requirements", label: "Requirements" },
  { id: "next", label: "Next steps" },
];

const ESSENTIALS = [
  ["/help", "Every command, with its description."],
  ["/model", "Switch model. Lists what your provider actually offers."],
  ["/context", "Where your context budget is going, by category."],
  ["/cost", "Tokens and spend for this session."],
  ["/undo", "Restore the last file the agent modified."],
  ["/verify", "Run the project's own test command."],
  ["/doctor", "Check runtime, workspace, credentials and MCP setup."],
  ["/clear", "Drop the conversation and start fresh."],
];

const ERRORS = [
  [
    "DEEPSEEK_API_KEY not set and no saved config found",
    "Headless mode with no provider configured.",
    "Run deepseek interactively once to save a provider, or export the key.",
  ],
  [
    "✗ Credentials: not found",
    "From /doctor — no provider has been configured.",
    "Launch interactively and complete the setup prompt.",
  ],
  [
    "✗ Git: not found on PATH",
    "Git is missing.",
    "Install git. Worktrees and the Git tool need it; everything else works.",
  ],
  [
    "✗ ripgrep: not found on PATH",
    "Optional dependency missing.",
    "Install ripgrep for faster search. Not fatal.",
  ],
  [
    "Chat error … /models may work …",
    "Bedrock or Vertex: listing works, chat does not.",
    "The two use different credential paths. See the error reference.",
  ],
];

const PERMISSION_ANSWERS = [
  ["once", "Just this call. The next identical call asks again."],
  ["session", "This tool, for the rest of this session."],
  ["directory", "This tool, within the current directory tree."],
  ["always", "Persist an allow rule to settings — future sessions inherit it."],
  ["deny", "Refuse. The turn unwinds rather than continuing."],
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
            Install, configure a provider, and complete one real task end to end — explore, edit, verify,
            and undo if it goes wrong.
          </p>
        </div>

        <section id="install">
          <h2><span className="anchor">#</span>Install</h2>
          <p>Install the CLI globally with npm or Bun:</p>
          <CodeBlock lang="bash">{`# npm
$ npm install -g @hermenics/deepseek-code

# or with bun
$ bun add -g @hermenics/deepseek-code`}</CodeBlock>
          <p>
            Either works. The update notifier detects which one you used and tells you the right upgrade
            command later — see <a href="/docs/installation">Installation</a> for the details and for
            uninstalling.
          </p>
        </section>

        <section id="first-run">
          <h2><span className="anchor">#</span>First run</h2>
          <p>
            Start it <b>inside the project you want to work on</b>. The working directory becomes the session
            workspace, which determines what the agent reads by default and what counts as "outside the
            workspace" for permissions:
          </p>
          <CodeBlock lang="bash">$ <span className="k">cd</span> my-project
$ <span className="f">deepseek</span></CodeBlock>
          <p>
            On first launch you pick a <b>provider</b> and configure authentication. Everything after that
            is saved, so subsequent runs start straight into the session.
          </p>
          <Note>
            Launching from your home directory technically works, but every file operation then looks
            unscoped and you will answer far more permission prompts. Start in the repository.
          </Note>
        </section>

        <section id="provider">
          <h2><span className="anchor">#</span>Configure a provider</h2>
          <p>
            The setup flow asks for a provider and its credentials. The fastest path is the DeepSeek API:
          </p>
          <CodeBlock lang="text">{`Provider   DeepSeek
API key    sk-…
Base URL   (optional — leave empty for api.deepseek.com)`}</CodeBlock>
          <p>
            The base URL field is what makes this flow work for more than one setup. Leave it empty for the
            hosted API; point it at <code className="inline">http://localhost:11434/v1</code> for Ollama or LM
            Studio; point it at your gateway if you route through one.
          </p>
          <p>
            Bedrock and Vertex are also supported and authenticate differently — an AWS profile and a GCP
            service account respectively. See <a href="/docs/providers">Providers</a>.
          </p>
          <p>
            Configuration is split deliberately: credentials go to the owner-only file{" "}
            <code className="inline">~/.deepseek/config.json</code>, while non-secret user preferences go to{" "}
            <code className="inline">~/.deepseek/settings.json</code>. Never publish or commit the credentials
            file.
          </p>
          <CodeBlock lang="bash">{`# skip the prompt entirely — useful in containers and CI
export DEEPSEEK_API_KEY="sk-…"`}</CodeBlock>
        </section>

        <section id="screen">
          <h2><span className="anchor">#</span>Reading the screen</h2>
          <p>
            The interface is a prompt, a transcript, and a status bar. Three things on it are worth knowing
            immediately:
          </p>
          <p>
            <b>Tool calls appear inline.</b> When the agent reads a file or runs a command, you see it
            happen. That is the transcript being honest about what it did, not decoration.
          </p>
          <p>
            <b>The status bar carries the model, token usage and branch.</b> Which items it shows is
            configurable through <code className="inline">interface.statusBar</code>.
          </p>
          <p>
            <b>Reasoning is collapsed by default.</b> Reasoning models return their deliberation separately;
            it is stored and counted, just not shown expanded.
          </p>
          <p>
            See <a href="/docs/interface">Interface</a> and <a href="/docs/themes">Themes</a> to change any
            of it.
          </p>
        </section>

        <section id="first-task">
          <h2><span className="anchor">#</span>Your first task</h2>
          <p>
            Do not start by asking it to build something. Start by asking it to <b>explain something you can
            check</b> — that is how you calibrate whether it is reading your code correctly:
          </p>
          <CodeBlock lang="text">{`> what does this project do? read enough to be confident, and tell me
  what you did not look at.`}</CodeBlock>
          <p>
            The second clause matters. Without a budget, exploration expands to fill the context window. With
            it, you get a scoped answer and an explicit statement of coverage.
          </p>
          <p>
            Now a real change. Be specific about the finished condition:
          </p>
          <CodeBlock lang="text">{`> the README install section only mentions npm. add the bun command too,
  matching the existing formatting. do not touch anything else.`}</CodeBlock>
          <p>
            Three habits are visible in that prompt, and they are the ones that make agentic editing
            predictable: name the file or area, name the finished condition, and bound the blast radius.
          </p>
          <Note>
            The agent may call several tools before answering — read, grep, edit. That is one turn, not
            several. A turn ends when it replies without asking for a tool.
          </Note>
        </section>

        <section id="permissions">
          <h2><span className="anchor">#</span>Answering permission prompts</h2>
          <p>
            The first time the agent wants to do something consequential, you get a prompt. Your answer is
            one of five:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Answer</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {PERMISSION_ANSWERS.map(([a, e]) => (
                  <tr key={a}>
                    <td><code className="inline">{a}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Every prompt tells you <b>why</b> it appeared — the path was outside the workspace, a risk rule
            matched, no allow rule covered it, and so on. Read the reason before answering; a{" "}
            <code className="inline">risk</code> prompt on <code className="inline">rm -rf</code> deserves more
            thought than one on reading a file two directories up.
          </p>
          <p>
            Reach for <code className="inline">always</code> sparingly at first. It writes a rule to your
            settings that applies to every future session, and undoing that means editing a file rather than
            answering a prompt. See <a href="/docs/permissions">Permissions</a>.
          </p>
        </section>

        <section id="verify">
          <h2><span className="anchor">#</span>Verify and undo</h2>
          <p>
            Two commands close the loop on any edit:
          </p>
          <CodeBlock lang="bash">{`> /verify     # runs your project's own test command
> /undo       # restores the last file the agent modified`}</CodeBlock>
          <p>
            <code className="inline">/verify</code> detects the command from your project rather than inventing
            one — <code className="inline">bun test</code>, <code className="inline">npm test</code>,{" "}
            <code className="inline">cargo test</code>, <code className="inline">go test ./...</code>, depending on
            what is actually there. If your project has no test command, it says so and stops.
          </p>
          <p>
            <code className="inline">/undo</code> restores the previous bytes of the last edited file, and{" "}
            <code className="inline">/undo all</code> reverts every available file checkpoint from this
            session. With the default <code className="inline">git.checkpoint: true</code>, built-in mutating
            file tools take those backups before changing non-generated files.
          </p>
          <p>
            For anything genuinely risky, isolate first with <a href="/docs/worktrees">/worktree create</a> —
            then discarding the attempt is deleting a directory rather than replaying an undo stack.
          </p>
        </section>

        <section id="essentials">
          <h2><span className="anchor">#</span>The eight commands that matter</h2>
          <p>
            There are around forty slash commands. These eight cover the first week:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Command</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {ESSENTIALS.map(([c, d]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The full set is in <a href="/docs/slash-commands">Slash commands</a>.
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
          <p>
            One rule to know before using it in CI: commands that would need an interactive confirmation are{" "}
            <b>denied automatically</b>, because there is nobody to ask. Design headless tasks to read and
            report. See <a href="/docs/headless">Headless mode</a>.
          </p>
        </section>

        <section id="errors">
          <h2><span className="anchor">#</span>Common first-run errors</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>You see</th><th style={{ width: "28%" }}>Cause</th><th>Fix</th></tr>
              </thead>
              <tbody>
                {ERRORS.map(([e, c, f]) => (
                  <tr key={e}>
                    <td><code className="inline">{e}</code></td>
                    <td>{c}</td>
                    <td>{f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            When anything looks wrong, <code className="inline">/doctor</code> first. It checks runtime,
            workspace, git, ripgrep, credentials, settings and MCP config, and prints a summary line telling
            you how many need attention. Several of its checks are advisory — a report with one{" "}
            <code className="inline">✗</code> can describe a perfectly working setup.
          </p>
          <p>
            Fuller lists: <a href="/docs/errors">Error reference</a> and{" "}
            <a href="/docs/troubleshooting">Troubleshooting</a>.
          </p>
        </section>

        <section id="requirements">
          <h2><span className="anchor">#</span>Requirements</h2>
          <ul className="capabilities">
            <li><b>Bun 1.1+</b> — the runtime and package manager</li>
            <li>A supported LLM provider (DeepSeek API, Bedrock, Vertex, or local)</li>
            <li><b>git</b> — required for worktrees and the Git tool</li>
            <li><b>ripgrep</b> — optional, makes search noticeably faster</li>
            <li>Node.js 18+ only if you're publishing or building from source</li>
          </ul>
        </section>

        <section id="next">
          <h2><span className="anchor">#</span>Next steps</h2>
          <div className="next-links">
            <a className="next-card" href="/docs/common-workflows">
              <div className="nc-title">Common workflows <Icon.Arrow /></div>
              <div className="nc-desc">Ten recipes end to end: bugs, refactors, reviews, CI.</div>
            </a>
            <a className="next-card" href="/docs/how-it-works">
              <div className="nc-title">How it works <Icon.Arrow /></div>
              <div className="nc-desc">The loop, the three gates, and what the model actually sees.</div>
            </a>
            <a className="next-card" href="/docs/steering">
              <div className="nc-title">Steering <Icon.Arrow /></div>
              <div className="nc-desc">Teach the agent your project's rules once, for every session.</div>
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
