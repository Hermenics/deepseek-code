import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "format", label: "File format" },
  { id: "scope", label: "What it covers" },
  { id: "defaults", label: "Built-in defaults" },
  { id: "setup", label: "The setup prompt" },
  { id: "editor", label: "Editor icon & highlighting" },
  { id: "errors", label: "What the model sees" },
  { id: "safety", label: "Safety core" },
  { id: "limits", label: "Limits" },
];

const SCOPE_ROWS = [
  ["read_file / write_file / patch_file / edit", "Blocked with an explicit error before any file system access."],
  ["read_folder", "Ignored entries are omitted from listings."],
  ["grep / glob", "Ignored directories are excluded from the search and results are post-filtered."],
  ["shell", "Best-effort guard: a command naming an existing ignored path is refused before it runs."],
  ["Subagents", "Inherit the same enforcement — every tool call goes through the same path checks."],
];

export default function DeepseekIgnore() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Tools</span><span className="sep">/</span><span className="current">.deepseekignore</span>
        </nav>

        <div className="hero">
          <h1>.deepseekignore</h1>
          <p className="tagline">
            One gitignore-style file at the project root controls which paths every DeepSeek Code tool can touch.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Overview</h2>
          <p>
            Place a <code className="inline">.deepseekignore</code> file at the root of your project to exclude files and
            directories from the agent. The exclusion is enforced centrally, so it applies to reading, writing, editing,
            listing, searching, shell commands and subagents alike. When the file does not exist, a built-in default list
            (node_modules, build outputs, caches) applies in memory, so a fresh project is protected without setup.
          </p>
        </section>

        <section id="format">
          <h2><span className="anchor">#</span>File format</h2>
          <p>
            The syntax is the same as <code className="inline">.gitignore</code>: one pattern per line, comments with
            <code className="inline">#</code>, directory patterns with a trailing slash, negation with
            <code className="inline">!</code>.
          </p>
          <CodeBlock lang="text">{"# Secrets and data the agent must not touch\nprivate/\ndatasets/*.csv\n\n# Re-include one file from an excluded set\nlogs/*\n!logs/README.md"}</CodeBlock>
          <Note>
            Standard gitignore rule: a file inside an excluded <em>directory</em> (<code className="inline">logs/</code>)
            cannot be re-included. To use negation, exclude the contents (<code className="inline">logs/*</code>) instead.
          </Note>
        </section>

        <section id="scope">
          <h2><span className="anchor">#</span>What it covers</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "36%" }}>Tool</th><th>Behavior</th></tr></thead>
              <tbody>
                {SCOPE_ROWS.map(([tool, behavior]) => <tr key={tool}><td><b>{tool}</b></td><td>{behavior}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>

        <section id="defaults">
          <h2><span className="anchor">#</span>Built-in defaults</h2>
          <p>
            The directories DeepSeek Code used to hard-code inside its tools (node_modules, dist, build, coverage,
            framework caches, editor state, virtualenvs) now live in the default ignore list. The defaults apply
            <em> only while no <code className="inline">.deepseekignore</code> exists</em>. Once the file is present, it
            is the single source of truth — remove a line and the agent can access that path again.
          </p>
        </section>

        <section id="setup">
          <h2><span className="anchor">#</span>The setup prompt</h2>
          <p>
            On startup in a project whose <code className="inline">.deepseekignore</code> is missing or lacks the default
            entries, DeepSeek Code shows a confirmation prompt offering to create the file (or append the missing
            entries). Declining changes nothing: the defaults keep applying in memory and the prompt returns on the next
            session.
          </p>
        </section>

        <section id="editor">
          <h2><span className="anchor">#</span>Editor icon &amp; highlighting</h2>
          <p>
            A file icon in VS Code comes from the active file icon theme, which only an extension can contribute — no
            npm package can reach it. DeepSeek Code offers to add a global User Settings association for the file to
            the built-in
            <code className="inline">ignore</code> language, so it inherits the ignore-file icon your theme already
            ships and gets syntax highlighting for comments and patterns.
          </p>
          <CodeBlock lang="json">{"// Global User Settings (settings.json)\n{\n  \"files.associations\": {\n    \".deepseekignore\": \"ignore\"\n  }\n}"}</CodeBlock>
          <CodeBlock lang="text">{"Linux:   ~/.config/Code/User/settings.json\nmacOS:   ~/Library/Application Support/Code/User/settings.json\nWindows: %APPDATA%\\Code\\User\\settings.json"}</CodeBlock>
          <p>
            This is a separate confirmation from the file-creation prompt, because it writes to your global editor
            configuration. Existing settings are preserved, JSONC comments and trailing commas are handled, and a
            <code className="inline">settings.json</code> that cannot be parsed is reported rather than overwritten.
          </p>
          <p>
            This automatic setup is intentionally limited to VS Code and compatible forks. Other editors still get
            the full <code className="inline">.deepseekignore</code> behavior in DeepSeek Code, but file icons and
            syntax highlighting are editor-specific and must be configured through that editor's own settings or
            extension system; there is no universal project file for them.
          </p>
        </section>

        <section id="errors">
          <h2><span className="anchor">#</span>What the model sees</h2>
          <p>
            A blocked access returns an explicit error to the model naming <code className="inline">.deepseekignore</code>
            as the cause, so the agent reports the block instead of hallucinating about missing files:
          </p>
          <CodeBlock lang="text">{"Path 'private/data.txt' is excluded by .deepseekignore at the project root.\nThis is intentional: the user controls access via .deepseekignore.\nDo not guess its contents; if access is genuinely needed, ask the user to edit .deepseekignore."}</CodeBlock>
        </section>

        <section id="safety">
          <h2><span className="anchor">#</span>Safety core</h2>
          <p>
            Two protections do not come from the file and cannot be lifted by editing it:
            <code className="inline">.git/</code> and <code className="inline">.deepseek/</code> are always blocked, and
            sensitive files (<code className="inline">.env</code>, keys, credentials) are refused by an independent check.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits</h2>
          <p>
            The shell guard is a heuristic: it refuses commands whose arguments name an existing ignored path, but a
            command that constructs paths dynamically (subshells, variables, pipes) can slip past it. Treat
            <code className="inline">.deepseekignore</code> as workflow hygiene and noise reduction, not as a security
            boundary — real secrets belong outside the workspace or in the sensitive-file patterns.
          </p>
        </section>

        <div className="pager">
          <a href="/docs/search" className="prev">Search tools</a>
          <a href="/docs/shell" className="next">Shell commands</a>
        </div>
      </main>
      <Toc items={TOC} />
    </>
  );
}
