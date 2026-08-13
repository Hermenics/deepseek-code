import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What steering is" },
  { id: "mechanics", label: "How loading works" },
  { id: "vs", label: "Steering vs DEEPSEEK.md vs memory" },
  { id: "cost", label: "The cost of a steering file" },
  { id: "writing", label: "Writing steering that works" },
  { id: "files", label: "Files worth having" },
  { id: "antipatterns", label: "Anti-patterns" },
  { id: "team", label: "Steering as a team artifact" },
  { id: "verify", label: "Verifying it is loaded" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const MECHANICS = [
  ["Location", ".deepseek/steering/ in the project root"],
  ["Selection", "Every file matching /\\.md$/ — no index, no frontmatter, no manifest"],
  ["Format", "Each file is wrapped as --- <filename> --- followed by its trimmed contents"],
  ["Failure mode", "An unreadable file is skipped silently; the rest still load"],
  ["Timing", "Read during project initialization or a /cwd rebase and folded into the system prompt"],
  ["Scope", "Project only. There is no user-level steering directory"],
];

const COMPARISON = [
  ["Steering", ".deepseek/steering/*.md", "You", "Every session, all files", "Standards, architecture, conventions"],
  ["DEEPSEEK.md", ".deepseek/DEEPSEEK.md", "You", "Every session + after every compaction", "The project's core instructions"],
  ["Memory", "~/.deepseek/memory/", "The agent", "Every session, as a delimited block", "Facts learned across sessions"],
];

const GOOD_FILES = [
  ["architecture.md", "Module boundaries, what depends on what, where new code belongs."],
  ["conventions.md", "Naming, file size limits, where tests live, error handling style."],
  ["review-checklist.md", "What must be true before the agent claims a task is done."],
  ["stack.md", "Runtime, package manager, build and test commands, version constraints."],
  ["domain.md", "Vocabulary specific to the business — terms whose meaning is not obvious from code."],
];

const ANTIPATTERNS = [
  ["Restating the code", "The agent can read the code. Steering should carry what the code cannot say."],
  ["Dumping the README", "READMEs address humans evaluating the project, not agents changing it."],
  ["Vague virtue", "\"Write clean code\" changes nothing. \"Files under 500 lines\" is checkable."],
  ["Full API references", "Enormous and stale within a sprint. Point at the source file instead."],
  ["Duplicating DEEPSEEK.md", "Both are loaded. Duplication doubles the cost and creates two things to update."],
  ["Long changelogs", "History is git's job. Steering is about the present."],
];

const TROUBLE = [
  ["Rules are being ignored", "Check /context — if System Prompt is very large, the rules are competing with too much other text."],
  ["Nothing seems loaded", "Steering is project-scoped. Run /cwd, then inspect .deepseek/steering/ in that exact directory."],
  ["A file is missing", "Only .md files are read. A .txt or .mdx file is invisible to the loader."],
  ["Edits do not take effect", "Files are not watched. Start a fresh session or deliberately rebase the project with /cwd; /compact does not reread steering files."],
  ["Instructions contradict", "Files are concatenated in filesystem order with no conflict resolution. Remove the contradiction."],
];

export default function Steering() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Concepts</span><span className="sep">/</span><span className="current">Steering</span>
        </nav>

        <div className="hero">
          <h1>Steering</h1>
          <p className="tagline">
            Drop a markdown file in a directory and every session in this project starts knowing your rules.
            The whole API is the filesystem.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What steering is</h2>
          <p>
            Steering files are markdown documents you write that get injected into the system prompt of every
            session in a project. They are how you tell the agent things it cannot infer by reading code:
            which patterns are deliberate, which are legacy, where new code belongs, and what "done" means
            here.
          </p>
          <p>
            There is no registration step, no configuration key, and no schema. Create{" "}
            <code className="inline">.deepseek/steering/</code>, put markdown in it, and the next session reads
            it.
          </p>
          <CodeBlock lang="bash">{`mkdir -p .deepseek/steering
cat > .deepseek/steering/conventions.md <<'EOF'
# Conventions

- Tests live in tests/, never beside the source
- Files stay under 500 lines; split by responsibility, not by size
- No new dependency without checking whether the stdlib covers it
EOF`}</CodeBlock>
          <p>
            That is the entire setup. The simplicity is the feature — a mechanism with configuration is a
            mechanism people postpone adopting.
          </p>
        </section>

        <section id="mechanics">
          <h2><span className="anchor">#</span>How loading works</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Aspect</th><th>Behavior</th></tr>
              </thead>
              <tbody>
                {MECHANICS.map(([a, b]) => (
                  <tr key={a}>
                    <td><b style={{ color: "var(--text-strong)" }}>{a}</b></td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Each file arrives in the prompt under its own delimiter, so the model can tell where one document
            ends and the next begins:
          </p>
          <CodeBlock lang="text">{`--- architecture.md ---
The kernel layer must not import from ui/. …

--- conventions.md ---
Tests live in tests/, never beside the source. …`}</CodeBlock>
          <p>
            Filenames are part of the payload, which makes them part of the message. A file called{" "}
            <code className="inline">review-checklist.md</code> tells the model what its contents are for before
            it reads a word of them; <code className="inline">notes.md</code> tells it nothing.
          </p>
          <Note>
            Unreadable files are skipped rather than raised. A permissions problem on one steering file
            degrades what the agent knows — it does not prevent the session from starting.
          </Note>
        </section>

        <section id="vs">
          <h2><span className="anchor">#</span>Steering vs DEEPSEEK.md vs memory</h2>
          <p>
            Three mechanisms put persistent text in front of the model. They are genuinely different and
            choosing wrong is the most common mistake:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "16%" }}>Mechanism</th>
                  <th style={{ width: "24%" }}>Location</th>
                  <th style={{ width: "12%" }}>Written by</th>
                  <th style={{ width: "22%" }}>Loaded</th>
                  <th>Best for</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([m, l, w, ld, b]) => (
                  <tr key={m}>
                    <td><b style={{ color: "var(--text-strong)" }}>{m}</b></td>
                    <td><code className="inline">{l}</code></td>
                    <td>{w}</td>
                    <td>{ld}</td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <b>Steering vs DEEPSEEK.md</b> is a question of granularity and durability. One{" "}
            <code className="inline">DEEPSEEK.md</code> is the project's front door; steering is a directory you
            can split by concern, review file by file, and delete individually. There is also one behavioral
            difference: <code className="inline">DEEPSEEK.md</code> is explicitly{" "}
            <a href="/docs/compaction#cleanup">re-injected after every compaction</a>, steering is not. Rules
            that must survive a lossy summary belong in <code className="inline">DEEPSEEK.md</code>.
          </p>
          <p>
            <b>Steering vs memory</b> is a question of authorship. You write steering; the agent writes{" "}
            <a href="/docs/memory">memory</a>. If you find yourself hand-editing memory files to make the
            agent behave, that content is steering.
          </p>
        </section>

        <section id="cost">
          <h2><span className="anchor">#</span>The cost of a steering file</h2>
          <p>
            Steering is part of the <b>fixed floor</b> of your context window. It is resent on every call, it
            is never compacted away, and it never shrinks as the conversation grows.
          </p>
          <p>
            The arithmetic is unforgiving. Five thousand tokens of steering is five thousand tokens on turn
            one and on turn eighty. In <code className="inline">/context</code> it shows up inside{" "}
            <b>System Prompt</b> — if that category is unexpectedly large, steering is usually why.
          </p>
          <p>
            This is not an argument for having none. It is an argument for every line earning its place. A
            rule you would not defend in code review does not deserve to be paid for on every model call.
          </p>
          <CodeBlock lang="bash">{`# roughly how much you are spending (≈4 chars per token)
wc -c .deepseek/steering/*.md | tail -1`}</CodeBlock>
          <Note>
            Steering is part of the cached prompt prefix on providers that support caching, so the marginal
            cost is lower than the raw count suggests. Editing a steering file does not change the live prompt
            by itself; a fresh session or project rebase loads the new text, and that changed prefix can no
            longer reuse the prior cached version.
          </Note>
        </section>

        <section id="writing">
          <h2><span className="anchor">#</span>Writing steering that works</h2>
          <p>
            <b>Be specific enough to check.</b> "Follow good practices" is unfalsifiable and therefore
            unfollowable. "Files under 500 lines" and "tests in <code className="inline">tests/</code>, never in{" "}
            <code className="inline">src/</code>" are rules an agent can verify itself against before claiming
            it is done.
          </p>
          <p>
            <b>Say why when the why is not obvious.</b> A rule with a reason survives edge cases the rule
            did not anticipate; a bare prohibition gets worked around the moment it is inconvenient.
          </p>
          <CodeBlock lang="text">{`# weak
Do not import from ui/ in the kernel.

# strong
The kernel must not import from ui/ — it has to stay runnable headless in
CI and in the SDK. If kernel code needs something from ui/, that something
is in the wrong layer.`}</CodeBlock>
          <p>
            <b>Prefer prohibitions to permissions.</b> An agent will find the many correct ways to do
            something on its own. What it cannot infer is the specific thing your team has decided is wrong
            here.
          </p>
          <p>
            <b>Point rather than copy.</b> "Follow the pattern in{" "}
            <code className="inline">src/tools/Grep/</code>" is one line that never goes stale, unlike a
            paragraph describing that pattern which is wrong the moment the file changes.
          </p>
        </section>

        <section id="files">
          <h2><span className="anchor">#</span>Files worth having</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>File</th><th>Contents</th></tr>
              </thead>
              <tbody>
                {GOOD_FILES.map(([f, c]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">review-checklist.md</code> is the one teams under-use. Agents are good at
            self-checking against an explicit list and poor at inventing one. A short checklist converts
            "seems done" into a procedure:
          </p>
          <CodeBlock lang="text">{`# Review checklist

Before reporting a task complete:
1. Run the test suite; do not report success on a failing suite
2. Check no file exceeded 500 lines
3. Confirm no new dependency was added without being called out
4. Confirm public API changes are reflected in docs/`}</CodeBlock>
          <p>
            Five focused files beat one large one. They are individually reviewable, individually deletable,
            and the filename carries meaning that a section heading buried in a long document does not.
          </p>
        </section>

        <section id="antipatterns">
          <h2><span className="anchor">#</span>Anti-patterns</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Anti-pattern</th><th>Why it hurts</th></tr>
              </thead>
              <tbody>
                {ANTIPATTERNS.map(([a, w]) => (
                  <tr key={a}>
                    <td><b style={{ color: "var(--text-strong)" }}>{a}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The worst of these is <b>stale content</b>, which cuts across all of them. A steering file
            describing an architecture you migrated away from is worse than no file: the agent will follow
            it confidently, and you are paying tokens to be actively misled.
          </p>
          <p>
            Treat steering like code. Review it in pull requests, delete it when it stops being true, and be
            suspicious of any file that has not been touched since it was created.
          </p>
        </section>

        <section id="team">
          <h2><span className="anchor">#</span>Steering as a team artifact</h2>
          <p>
            <code className="inline">.deepseek/steering/</code> belongs in version control. Committing it means
            every teammate's agent behaves the same way, and it means changes to project standards go
            through review like any other change.
          </p>
          <p>
            This is one of the few places where a docs-style artifact has a tight feedback loop. If a rule is
            wrong you will see it in the next session's output, which makes steering files far more likely to
            stay accurate than a wiki page nobody reads.
          </p>
          <p>
            For personal preferences that should not apply to the whole team, use{" "}
            <code className="inline">.deepseek/settings.local.json</code> or user-level configuration instead —
            there is no <code className="inline">steering.local/</code>. See{" "}
            <a href="/docs/deepseek-directory">The .deepseek directory</a>.
          </p>
        </section>

        <section id="verify">
          <h2><span className="anchor">#</span>Verifying it is loaded</h2>
          <p>
            <code className="inline">/system</code> cannot verify steering content: it intentionally shows only
            active mode and permission state, never the assembled prompt. Start by confirming the exact project
            root, then inspect the files that initialization is expected to read:
          </p>
          <CodeBlock lang="text">{`> /cwd
cwd: /home/you/projects/acme

> !ls -l .deepseek/steering
total 12
-rw-r--r-- 1 you you 840 Aug 12 10:20 architecture.md
-rw-r--r-- 1 you you 612 Aug 12 10:20 conventions.md`}</CodeBlock>
          <p>
            If a file is missing, the cause is almost always one of three things: the extension is not{" "}
            <code className="inline">.md</code>, the directory is not in the project you actually launched from,
            or the file is unreadable and was skipped.
          </p>
          <p>
            Start a fresh session after adding or editing steering. An explicit project rebase with
            <code className="inline">/cwd &lt;absolute-current-root&gt;</code> also reloads it, but resets the
            model-facing conversation. <code className="inline">/context</code> can then show the aggregate cost
            inside the <b>System Prompt</b> category, but that proportional estimate cannot prove that a
            particular filename or sentence was included. There is currently no slash command that reveals
            the hidden prompt text.
          </p>
          <Note>
            Full compaction preserves the already assembled in-memory system prompt and separately rereads
            <code className="inline">DEEPSEEK.md</code>. It does not reread
            <code className="inline">.deepseek/steering/*.md</code> from disk.
          </Note>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Symptom</th><th>Cause and fix</th></tr>
              </thead>
              <tbody>
                {TROUBLE.map(([s, c]) => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The contradiction case is the subtle one. Files are concatenated with no precedence rules
            whatsoever — if <code className="inline">architecture.md</code> says one thing and{" "}
            <code className="inline">legacy.md</code> says the opposite, the model sees both assertions with equal
            weight and picks one. There is no resolution mechanism to configure; the resolution is that you
            remove the contradiction.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
