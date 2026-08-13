import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "surfaces", label: "Where editors are used" },
  { id: "variables", label: "VISUAL and EDITOR" },
  { id: "raw", label: "Raw settings and agent JSON" },
  { id: "prompt", label: "Prompt Markdown editor" },
  { id: "terminal", label: "How the TUI yields control" },
  { id: "temporary", label: "Temporary files" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const SURFACES = [
  ["Open scope file", "Selected settings JSON", "VISUAL, then EDITOR", "No fallback"],
  ["Open credentials", "~/.deepseek/config.json", "VISUAL, then EDITOR", "No fallback"],
  ["Agent library · e", "Scoped agent JSON", "VISUAL, then EDITOR", "No fallback"],
  ["Agent library · p", "Specialization prompt Markdown", "VISUAL, EDITOR, nano, platform fallback", "Yes"],
  ["Subagent base prompt", "Temporary Markdown", "VISUAL, EDITOR, nano, platform fallback", "Yes"],
];

export default function ExternalEditor() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">External editor</span>
        </nav>

        <div className="hero">
          <h1>External editor integration</h1>
          <p className="tagline">
            Edit long prompts and raw configuration without fighting a one-line terminal field, while keeping
            raw mode, stdin and screen repaint state intact.
          </p>
        </div>

        <section id="surfaces">
          <h2><span className="anchor">#</span>Where editors are used</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th>Entry point</th><th>What opens</th><th>Selection order</th><th>Built-in fallback?</th></tr></thead>
              <tbody>{SURFACES.map(([entry, target, order, fallback]) => (
                <tr key={entry}><td>{entry}</td><td><code className="inline">{target}</code></td><td>{order}</td><td>{fallback}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p>
            The two integration paths are deliberately different. Raw-file actions open a persistent file
            directly and require an explicitly configured editor. Prompt editing creates a temporary Markdown
            file and can discover a blocking terminal editor when no environment variable is set.
          </p>
        </section>

        <section id="variables">
          <h2><span className="anchor">#</span>VISUAL and EDITOR</h2>
          <p>
            DeepSeek Code checks <code className="inline">VISUAL</code> first, then{" "}
            <code className="inline">EDITOR</code>. Set one before launching the CLI:
          </p>
          <CodeBlock lang="bash">{"export VISUAL=vim\n# or\nexport EDITOR=nano\ndeepseek"}</CodeBlock>
          <p>
            Blocking matters. The TUI resumes as soon as the editor process exits. Terminal editors naturally
            block; a graphical editor needs its own wait option when the invocation path supports arguments.
          </p>
        </section>

        <section id="raw">
          <h2><span className="anchor">#</span>Raw settings and agent JSON</h2>
          <p>
            Settings-center actions and the Agent library's JSON editor launch the environment variable as one
            executable and pass the target path as one argument. In the current implementation, a multiword
            value such as <code className="inline">code --wait</code> is treated as the executable name rather
            than split into a command plus option.
          </p>
          <CodeBlock lang="bash">{"# Reliable for raw JSON actions\nexport VISUAL=vim\n\n# Currently unreliable on this path: the whole value is treated as one binary name\nexport VISUAL=\"code --wait\""}</CodeBlock>
          <p>
            Closing a raw settings file triggers a reload even when the editor fails. Invalid JSON is reported
            and blocks further saves at that scope until corrected. Editing an inherited agent first creates a
            scoped extending definition, then opens that scoped file.
          </p>
          <Note>
            Raw credentials editing exposes the contents of a private file to your chosen editor and any
            extensions it runs. Use an editor you trust, and never copy that file into the project.
          </Note>
        </section>

        <section id="prompt">
          <h2><span className="anchor">#</span>Prompt Markdown editor</h2>
          <p>
            Long specialization prompts use a command-aware launcher, so a configured value may contain
            arguments. Without a configured editor, the resolver tries <code className="inline">nano</code>,
            then uses Notepad on Windows, <code className="inline">open -W -t</code> on macOS, or tries{" "}
            <code className="inline">vi</code> on Linux.
          </p>
          <CodeBlock lang="bash">{"export VISUAL=\"code --wait\"\ndeepseek\n# /config → Agents → select an agent → p"}</CodeBlock>
          <p>
            If none of those choices is available, editing stops with{" "}
            <code className="inline">No blocking prompt editor found. Set $VISUAL or $EDITOR.</code>. The old
            prompt remains unchanged.
          </p>
        </section>

        <section id="terminal">
          <h2><span className="anchor">#</span>How the TUI yields control</h2>
          <p>
            Before launching an interactive editor, DeepSeek Code pauses rendering, removes its stdin readable
            listeners and disables raw mode. This prevents the TUI from consuming keystrokes meant for the
            editor. The child inherits stdin, stdout and stderr, so a terminal editor owns the same terminal.
          </p>
          <p>
            A finally path reattaches stdin listeners, restores raw mode, invalidates the terminal frame,
            resumes rendering and restores cursor visibility. That recovery also runs when the editor exits
            with an error.
          </p>
        </section>

        <section id="temporary">
          <h2><span className="anchor">#</span>Temporary files</h2>
          <p>
            Prompt editing writes the initial value to a uniquely named Markdown file in the operating system's
            temporary directory. After the editor exits successfully, the file is read and the returned text is
            saved to the chosen setting or agent definition.
          </p>
          <p>
            The temporary file is removed in a finally block after success or failure. It is not a durable draft:
            if the editor crashes before returning, recover unsaved text through the editor's own recovery system.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <h3>Set VISUAL or EDITOR first</h3>
          <p>
            Raw settings and raw agent JSON do not try nano or platform defaults. Export a single executable
            name and reopen the settings center.
          </p>
          <h3>The GUI opens but DeepSeek Code resumes immediately</h3>
          <p>
            Use a blocking wait flag on the prompt-Markdown path. For raw JSON actions, use a terminal editor
            until multiword editor commands are supported there.
          </p>
          <h3>The terminal looks damaged after an editor exits</h3>
          <p>
            Resize once to force a full repaint. If raw mode remains active after a hard crash, run{" "}
            <code className="inline">reset</code> or <code className="inline">stty sane</code> in the shell.
            See <a href="/docs/terminal-setup">Terminal setup</a> for recovery details.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
