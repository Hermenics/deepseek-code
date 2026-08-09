import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what-they-are", label: "What feature flags are" },
  { id: "the-flags", label: "The flags" },
  { id: "features-command", label: "The /features command" },
  { id: "microcompact", label: "Micro Compact in detail" },
];

const FLAGS = [
  ["wordDiff", "Word Diff", "Show word-level diffs instead of line-level"],
  ["microCompact", "Micro Compact", "Aggressively compact short tool outputs"],
  ["fuzzyFileSearch", "Fuzzy File Search", "Use fuzzy matching when searching for files"],
];

export default function Features() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Feature flags</span>
        </nav>

        <div className="hero">
          <h1>Feature flags</h1>
          <p className="tagline">
            Experimental features you can toggle per user — all on by default, each one opt-out.
          </p>
        </div>

        <section id="what-they-are">
          <h2><span className="anchor">#</span>What feature flags are</h2>
          <p>
            Feature flags gate <b>experimental behaviors</b> that are still maturing. They are{" "}
            <b>opt-out</b>: every flag defaults to <b>on</b>, and you turn one off if it misbehaves for your
            workflow.
          </p>
          <p>
            State is persisted in <code className="inline">~/.deepseek/features.json</code>, which is created on
            the first change. Flags are <b>per user</b> — the file lives in your home directory — and{" "}
            <b>global across projects</b>: flipping a flag affects every project you run, not just the current one.
          </p>
        </section>

        <section id="the-flags">
          <h2><span className="anchor">#</span>The flags</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "25%" }}>Flag</th><th style={{ width: "30%" }}>Label</th><th>Description</th></tr>
              </thead>
              <tbody>
                {FLAGS.map(([name, label, desc]) => (
                  <tr key={name}>
                    <td><code className="inline">{name}</code></td>
                    <td>{label}</td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            A missing or invalid <code className="inline">features.json</code> is harmless — flags simply fall
            back to their defaults, and non-boolean entries are ignored on load.
          </p>
        </section>

        <section id="features-command">
          <h2><span className="anchor">#</span>The /features command</h2>
          <p>
            <code className="inline">/features</code> (alias <code className="inline">/experimental</code>)
            manages the flags:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "35%" }}>Usage</th><th>Behavior</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><code className="inline">/features</code></td>
                  <td>List every flag with <code className="inline">✓</code> (on) or <code className="inline">○</code> (off) and its description.</td>
                </tr>
                <tr>
                  <td><code className="inline">/features &lt;flag&gt;</code></td>
                  <td>Toggle the flag — on becomes off and vice versa.</td>
                </tr>
                <tr>
                  <td><code className="inline">/features &lt;flag&gt; on|true|1</code></td>
                  <td>Set the flag to enabled.</td>
                </tr>
                <tr>
                  <td><code className="inline">/features &lt;flag&gt; off|false|0</code></td>
                  <td>Set the flag to disabled.</td>
                </tr>
                <tr>
                  <td><code className="inline">/features &lt;unknown&gt;</code></td>
                  <td>Error listing the available flags, e.g. <code className="inline">wordDiff, microCompact, fuzzyFileSearch</code>.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <CodeBlock lang="text">{`> /features
Experimental features:
  ✓ wordDiff — Show word-level diffs instead of line-level
  ✓ microCompact — Aggressively compact short tool outputs
  ✓ fuzzyFileSearch — Use fuzzy matching when searching for files

Use /features <flag> on|off.`}</CodeBlock>
          <p>
            A successful change replies with{" "}
            <code className="inline">Feature &lt;flag&gt; enabled/disabled.</code> and persists immediately to{" "}
            <code className="inline">~/.deepseek/features.json</code>.
          </p>
        </section>

        <section id="microcompact">
          <h2><span className="anchor">#</span>Micro Compact in detail</h2>
          <p>
            The <code className="inline">microCompact</code> flag gates the <b>enhanced micro-compaction</b> pass,
            which runs at the start of each agent turn, <b>before</b> an LLM-based compaction is even considered.
            It reduces context usage without calling a model:
          </p>
          <ul className="capabilities">
            <li><b>Read-only tools only</b> — results from <code className="inline">read_file</code>, <code className="inline">grep</code>, <code className="inline">glob</code>, <code className="inline">list_files</code>, <code className="inline">web_search</code>, <code className="inline">web_fetch</code>, <code className="inline">file_search</code>, and <code className="inline">directory_tree</code> are candidates.</li>
            <li><b>Only long results</b> — content over 200 characters; short results are preserved untouched.</li>
            <li><b>Keeps the last 8</b> — the most recent results stay intact, older ones are truncated and replaced with a note like <code className="inline">[content cleared by micro-compaction to reduce context usage]</code>.</li>
          </ul>
          <Note>
            Because flags are global and persisted in <code className="inline">~/.deepseek/features.json</code>,
            changes survive restarts and apply everywhere — no per-project file is involved.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
