import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what-they-are", label: "What feature flags are" },
  { id: "the-flags", label: "The flags" },
  { id: "features-command", label: "The /features command" },
  { id: "parsing", label: "How arguments are parsed" },
  { id: "worddiff", label: "wordDiff in detail" },
  { id: "microcompact", label: "microCompact in detail" },
  { id: "fuzzy", label: "fuzzyFileSearch in detail" },
  { id: "file", label: "The features.json file" },
  { id: "filtering", label: "Why unknown keys are dropped" },
  { id: "vs-settings", label: "Flags vs settings" },
];

const FLAGS = [
  ["wordDiff", "Word Diff", "true", "Show word-level diffs instead of line-level"],
  ["microCompact", "Micro Compact", "true", "Aggressively compact short tool outputs"],
  ["fuzzyFileSearch", "Fuzzy File Search", "true", "Use fuzzy matching when searching for files"],
];

const USAGE = [
  ["/features", "List every flag with ✓ (on) or ○ (off) and its description."],
  ["/features <flag>", "Toggle it — on becomes off and vice versa."],
  ["/features <flag> on|true|1", "Set it enabled."],
  ["/features <flag> off|false|0", "Set it disabled."],
  ["/experimental", "Alias for /features."],
];

const VS = [
  ["Feature flags", "~/.deepseek/features.json", "User, global", "Experimental behavior, on by default"],
  ["Settings", "user / project / local settings.json", "Three layers", "Configuration meant to be shared and versioned"],
  ["Environment variables", "The shell", "Process", "Secrets and kill-switches"],
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
            Three experimental behaviors you can toggle per user — all on by default, each one opt-out,
            all global across projects.
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
            That default direction is a deliberate choice. Opt-in experimental features are experimental
            forever, because almost nobody discovers them; opt-out features get real usage and either mature
            or get removed. The cost is that a bad flag affects everyone until they turn it off — which is
            why there are only three, and why each one degrades to the previous behavior rather than failing.
          </p>
          <p>
            State is persisted in <code className="inline">~/.deepseek/features.json</code>, created on the
            first change. Flags are <b>per user</b> — the file lives in your home directory — and{" "}
            <b>global across projects</b>: flipping one affects every project you run, not just the current
            one.
          </p>
          <Note>
            There is no project-level override. If you need a setting a team can share and version, it is a{" "}
            <a href="/docs/settings">setting</a>, not a feature flag. See{" "}
            <a href="#vs-settings">the comparison</a> below.
          </Note>
        </section>

        <section id="the-flags">
          <h2><span className="anchor">#</span>The flags</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Flag</th>
                  <th style={{ width: "22%" }}>Label</th>
                  <th style={{ width: "12%" }}>Default</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {FLAGS.map(([name, label, def, desc]) => (
                  <tr key={name}>
                    <td><code className="inline">{name}</code></td>
                    <td>{label}</td>
                    <td><code className="inline">{def}</code></td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            That is the complete list. The flag registry is a single object in the source, and both the
            command and the persistence layer derive their behavior from it — so there is no way for a flag
            to exist in one place and not the other.
          </p>
        </section>

        <section id="features-command">
          <h2><span className="anchor">#</span>The /features command</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "35%" }}>Usage</th><th>Behavior</th></tr>
              </thead>
              <tbody>
                {USAGE.map(([u, b]) => (
                  <tr key={u}>
                    <td><code className="inline">{u}</code></td>
                    <td>{b}</td>
                  </tr>
                ))}
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
            A successful change replies{" "}
            <code className="inline">Feature &lt;flag&gt; enabled/disabled.</code> and persists immediately —
            there is no separate save step and no restart required.
          </p>
        </section>

        <section id="parsing">
          <h2><span className="anchor">#</span>How arguments are parsed</h2>
          <p>
            The parser is small enough to describe completely, and two of its decisions are worth knowing:
          </p>
          <p>
            <b>Flag names are matched case-insensitively.</b>{" "}
            <code className="inline">/features WORDDIFF</code>,{" "}
            <code className="inline">/features worddiff</code> and{" "}
            <code className="inline">/features wordDiff</code> all work. The canonical camelCase name is what
            gets written to disk regardless of how you typed it.
          </p>
          <p>
            <b>Values are matched exactly.</b> Only <code className="inline">on</code>,{" "}
            <code className="inline">true</code>, <code className="inline">1</code> and{" "}
            <code className="inline">off</code>, <code className="inline">false</code>,{" "}
            <code className="inline">0</code> are accepted. Anything else is an error rather than a guess:
          </p>
          <CodeBlock lang="text">{`> /features wordDiff yes
Invalid value: yes. Use on/off

> /features wordDif
Unknown flag: wordDif. Available: wordDiff, microCompact, fuzzyFileSearch`}</CodeBlock>
          <p>
            The unknown-flag error lists every valid name. That is a small thing that removes a
            documentation lookup from the loop — you typo a flag, and the error tells you what you meant.
          </p>
          <p>
            Omitting the value toggles rather than defaulting to on, which makes{" "}
            <code className="inline">/features microCompact</code> a single keystroke sequence for "flip
            this and see".
          </p>
        </section>

        <section id="worddiff">
          <h2><span className="anchor">#</span>wordDiff in detail</h2>
          <p>
            With <code className="inline">wordDiff</code> on, diffs highlight the <b>words</b> that changed
            within a line rather than marking the whole line as replaced.
          </p>
          <CodeBlock lang="text">{`# line-level (flag off)
- Request timeout: 30 seconds
+ Request timeout: 60 seconds

# word-level (flag on)
  Request timeout: [30 → 60] seconds`}</CodeBlock>
          <p>
            The difference matters most in the case that occurs most: a long line where one token changed.
            Line-level rendering shows you two nearly identical lines and leaves you to spot the difference;
            word-level points at it.
          </p>
          <p>
            Turn it off if your terminal renders the inline highlighting poorly, or if you are copying diffs
            out of the transcript into somewhere that expects standard unified-diff formatting.
          </p>
        </section>

        <section id="microcompact">
          <h2><span className="anchor">#</span>microCompact in detail</h2>
          <p>
            <code className="inline">microCompact</code> gates the <b>enhanced micro-compaction</b> pass, which
            runs at the start of each agent turn — <b>before</b> a model-based compaction is even considered.
            It reduces context usage without calling a model:
          </p>
          <ul className="capabilities">
            <li><b>Read-only tools only</b> — results from <code className="inline">read_file</code>, <code className="inline">grep</code>, <code className="inline">glob</code>, <code className="inline">list_files</code>, <code className="inline">web_search</code>, <code className="inline">web_fetch</code>, <code className="inline">file_search</code> and <code className="inline">directory_tree</code> are candidates.</li>
            <li><b>Only long results</b> — content over 200 characters; short results are preserved untouched.</li>
            <li><b>Keeps the last 8</b> — recent results stay intact; older ones are replaced with a note recording the original tool and size.</li>
          </ul>
          <p>
            The read-only restriction is the important part. The result of an edit or a shell command is{" "}
            <b>never</b> cleared, because that output cannot be recovered by re-running the tool without
            causing side effects. A cleared <code className="inline">read_file</code> can simply be read again.
          </p>
          <p>
            This is the flag most worth leaving on. It is the cheapest context reduction available — no
            model call, no latency, no tokens — and it targets the category that dominates long sessions.
            See <a href="/docs/compaction">Compaction</a>.
          </p>
        </section>

        <section id="fuzzy">
          <h2><span className="anchor">#</span>fuzzyFileSearch in detail</h2>
          <p>
            <code className="inline">fuzzyFileSearch</code> makes file lookup tolerant of approximate names:{" "}
            <code className="inline">agntsess</code> finds <code className="inline">agent/session.ts</code>.
          </p>
          <p>
            The tradeoff is precision. Fuzzy matching returns ranked candidates rather than exact matches, so
            a query that would have returned nothing now returns something — which is helpful when you half
            remember a filename and unhelpful when you wanted to know a file does not exist.
          </p>
          <p>
            In a very large repository, fuzzy ranking over thousands of paths also costs more than a literal
            comparison. If file search feels slow in a monorepo, this is the first flag to try turning off.
          </p>
        </section>

        <section id="file">
          <h2><span className="anchor">#</span>The features.json file</h2>
          <CodeBlock lang="json">{`// ~/.deepseek/features.json
{
  "wordDiff": true,
  "microCompact": true,
  "fuzzyFileSearch": false
}`}</CodeBlock>
          <p>
            The file is written whole on every change and read at startup, merged over the defaults. Editing
            it by hand works, but the change is picked up on next launch rather than live —{" "}
            <code className="inline">/features</code> is the path that takes effect immediately.
          </p>
          <p>
            A missing file is normal, not an error: it means you have never changed a flag, so every default
            applies. Deleting the file resets everything to defaults.
          </p>
        </section>

        <section id="filtering">
          <h2><span className="anchor">#</span>Why unknown keys are dropped</h2>
          <p>
            Loading does not trust the file. It keeps only keys that exist in the flag registry and whose
            values are actual booleans.
          </p>
          <p>
            Two failure modes disappear as a result. A flag that was removed in a newer version leaves a
            stale key in your file that is simply ignored, rather than crashing a load or resurrecting dead
            behavior. And a hand-edited file containing{" "}
            <code className="inline">"wordDiff": "true"</code> — a string, not a boolean — falls back to the
            default rather than being coerced into something surprising.
          </p>
          <p>
            The whole read is also wrapped in a catch: a corrupt or unparseable{" "}
            <code className="inline">features.json</code> returns the defaults. Feature flags are a
            convenience, and no configuration convenience should be able to prevent the tool from starting.
          </p>
        </section>

        <section id="vs-settings">
          <h2><span className="anchor">#</span>Flags vs settings</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Mechanism</th>
                  <th style={{ width: "30%" }}>Stored in</th>
                  <th style={{ width: "18%" }}>Scope</th>
                  <th>For</th>
                </tr>
              </thead>
              <tbody>
                {VS.map(([m, s, sc, f]) => (
                  <tr key={m}>
                    <td><b style={{ color: "var(--text-strong)" }}>{m}</b></td>
                    <td><code className="inline">{s}</code></td>
                    <td>{sc}</td>
                    <td>{f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The distinction is durability of intent. A feature flag answers "is this experiment working for
            me right now" and is expected to disappear once the experiment settles. A{" "}
            <a href="/docs/settings">setting</a> answers "how should this project behave" and belongs in
            version control.
          </p>
          <p>
            If you find yourself wanting to commit a feature flag, what you actually want is a setting — and
            that is a signal the flag has outgrown being experimental.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
