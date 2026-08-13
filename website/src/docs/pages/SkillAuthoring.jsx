import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What a skill is" },
  { id: "skillmd", label: "SKILL.md" },
  { id: "frontmatter", label: "Frontmatter rules" },
  { id: "parsing", label: "How parsing works" },
  { id: "description", label: "Writing the description" },
  { id: "body", label: "Writing the body" },
  { id: "registry", label: "The registry & commit pinning" },
  { id: "commands", label: "Installing & managing" },
  { id: "tutorial", label: "Your first skill" },
  { id: "errors", label: "Validation errors" },
];

const MANIFEST = [
  ["name", "required", "Kebab-case. Becomes the invocation name."],
  ["description", "required", "One line explaining when to use it. This is what triggers the skill."],
  ["metadata.author", "optional", "Attribution."],
  ["metadata.version", "optional", "Your version string."],
  ["metadata.license", "optional", "License identifier."],
];

const ERRORS = [
  ["Empty file: no frontmatter found", "The file is empty or whitespace only."],
  ["No frontmatter found: file must start with ---", "Something precedes the opening delimiter — even a blank line."],
  ["No frontmatter found: missing closing ---", "There is no closing --- on its own line."],
  ["Empty frontmatter", "The delimiters are there but nothing is between them."],
  ["SKILL.md missing required 'name' field", "name is absent."],
  ["SKILL.md missing required 'description' field", "description is absent, or is an empty quoted string."],
  ["Invalid skill name '<x>': must be kebab-case", "The name failed /^[a-z0-9]+(-[a-z0-9]+)*$/."],
];

const ENTRY = [
  ["name", "Skill name from the frontmatter."],
  ["repo", "owner/name it came from."],
  ["installedAt / updatedAt", "ISO timestamps."],
  ["commitHash", "The exact commit installed."],
  ["description", "Copied from the frontmatter."],
];

const BODY_RULES = [
  ["Write procedure, not prose", "A skill is instructions to follow. Numbered steps beat paragraphs."],
  ["State the inputs", "What the skill needs from the user before it can start."],
  ["State the finished condition", "How the agent knows the job is done, not merely attempted."],
  ["Name the failure modes", "What to do when a step fails is usually where a skill earns its value."],
  ["Point at files, do not embed them", "A path stays correct; an embedded copy goes stale."],
];

export default function SkillAuthoring() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Skill authoring</span>
        </nav>

        <div className="hero">
          <h1>Skill authoring</h1>
          <p className="tagline">
            One repository-root markdown file with frontmatter, installed into the current project and
            pinned to a commit. The smallest unit of shareable know-how.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What a skill is</h2>
          <p>
            A skill is a packaged procedure — a repeatable piece of know-how that would otherwise live in
            someone's head or in a wiki page nobody reads. It is a single{" "}
            <code className="inline">SKILL.md</code> file: frontmatter that names and describes it, and a body
            that tells the agent what to do.
          </p>
          <p>
            Skills are installed from git repositories and recorded with the exact{" "}
            <code className="inline">commitHash</code>. That pin is the difference between a shared skill and a
            shared document: everyone running the same hash runs the same procedure, and updating is a
            deliberate act.
          </p>
          <p>
            The format is aggressively small on purpose. A skill that takes twenty minutes to write is a
            skill people actually write; a skill that requires a project scaffold is one they postpone.
          </p>
          <Note>
            The current CLI implements skill installation, validation, listing, update, removal, and
            migration. It does not yet load installed <code className="inline">SKILL.md</code> bodies into the
            live agent prompt or expose a skill invocation path. Treat authoring as package preparation until
            runtime wiring lands.
          </Note>
        </section>

        <section id="skillmd">
          <h2><span className="anchor">#</span>SKILL.md</h2>
          <CodeBlock lang="text">{`---
name: release-notes
description: Generate release notes from the commits since the last tag. Use when
  preparing a release or when asked to summarize what changed.
metadata:
  author: Platform Team
  version: 1.0.0
  license: MIT
---

# Release notes

1. Find the last tag with \`git describe --tags --abbrev=0\`.
2. List commits since it: \`git log <tag>..HEAD --oneline --no-merges\`.
3. Group by type: features, fixes, internal. Drop anything internal-only.
4. Write one line per user-visible change in the imperative mood.
5. Save to \`docs/releases/<version>.md\`.

If there is no tag, say so and stop — do not invent a range.`}</CodeBlock>
          <p>
            That is the entire format. Frontmatter between <code className="inline">---</code> delimiters, then
            markdown.
          </p>
        </section>

        <section id="frontmatter">
          <h2><span className="anchor">#</span>Frontmatter rules</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Field</th><th style={{ width: "16%" }}>Required</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {MANIFEST.map(([f, r, p]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{r}</td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">name</code> must use the same strict kebab-case format as plugin names.
          </p>
          <p>
            Lowercase alphanumerics with single hyphens between segments. No underscores, no capitals, no
            leading or trailing hyphen, no doubled hyphens. The constraint exists because the name becomes
            an invocation identifier and part of a filesystem path, and a format with one canonical spelling
            eliminates a whole category of "it works on my machine".
          </p>
        </section>

        <section id="parsing">
          <h2><span className="anchor">#</span>How parsing works</h2>
          <p>
            The parser is strict about structure and specific about failures. Worth understanding, because
            the error messages are precise enough to fix a file without guessing:
          </p>
          <p>
            <b>The file must start with <code className="inline">---</code>.</b> Not "contain" — start. A blank
            line or a comment before the delimiter is rejected. Scanning for frontmatter anywhere in a file
            would mean a code block containing <code className="inline">---</code> could be mistaken for it.
          </p>
          <p>
            <b>The closing delimiter must be on its own line.</b> The parser walks lines from index 1 and
            takes the first whose trimmed content is exactly <code className="inline">---</code>. This is what
            allows a description to contain a hyphenated phrase without terminating the block early.
          </p>
          <p>
            <b>Empty descriptions are caught explicitly.</b> The check rejects a missing description and also{" "}
            <code className="inline">''</code> and <code className="inline">""</code> — the two ways a YAML value
            can be present and useless. A skill with no description is unusable, so an empty quoted string is
            treated as the omission it is.
          </p>
          <Note>
            Validation returns <code className="inline">{"{ error: string }"}</code> rather than throwing. A bad
            skill file produces a clear message about that file, not a crash that takes the session with it.
          </Note>
        </section>

        <section id="description">
          <h2><span className="anchor">#</span>Writing the description</h2>
          <p>
            The description is the highest-leverage line in the file. It is what the agent reads when
            deciding whether this skill applies to what is happening right now — a skill with a vague
            description is a skill that never triggers.
          </p>
          <p>
            Write it as <b>when to use this</b>, not <b>what this is</b>:
          </p>
          <CodeBlock lang="text">{`# weak — describes itself
description: A skill for release notes.

# strong — describes the trigger
description: Generate release notes from commits since the last tag. Use when
  preparing a release, cutting a version, or summarizing what changed.`}</CodeBlock>
          <p>
            Including the words a person would actually use — "cut a release", "what changed", "changelog" —
            is not keyword stuffing. Those phrasings are the signal that this situation is the one the skill
            was written for.
          </p>
          <p>
            It is also worth saying when <em>not</em> to use it, if there is a neighbouring skill it could be
            confused with. Two skills that both claim "handles deployments" will both be considered and
            neither will be chosen confidently.
          </p>
        </section>

        <section id="body">
          <h2><span className="anchor">#</span>Writing the body</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Rule</th><th>Why</th></tr>
              </thead>
              <tbody>
                {BODY_RULES.map(([r, w]) => (
                  <tr key={r}>
                    <td><b style={{ color: "var(--text-strong)" }}>{r}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The finished condition is the most commonly omitted and the most valuable. "Save to{" "}
            <code className="inline">docs/releases/&lt;version&gt;.md</code>" is checkable; "produce release
            notes" is not, and an agent with no completion criterion will decide for itself when it is done.
          </p>
          <p>
            The failure line in the example above —{" "}
            <em>if there is no tag, say so and stop, do not invent a range</em> — is what separates a skill
            from a description of a happy path. Most of the value of encoding a procedure is encoding what
            experienced people do when it goes sideways.
          </p>
        </section>

        <section id="registry">
          <h2><span className="anchor">#</span>The registry & commit pinning</h2>
          <p>
            Installed skills live under <code className="inline">&lt;project&gt;/.deepseek/skills/</code> with a{" "}
            <code className="inline">.registry.json</code> index:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Entry field</th><th>Contents</th></tr>
              </thead>
              <tbody>
                {ENTRY.map(([f, c]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`{
  "version": 1,
  "skills": {
    "release-notes": {
      "name": "release-notes",
      "repo": "acme/agent-skills",
      "installedAt": "2026-08-01T09:12:00.000Z",
      "updatedAt": "2026-08-01T09:12:00.000Z",
      "commitHash": "4f2a91cd7b03e5619a8c2d1f0b7e4a3c9d5e6f70",
      "description": "Generate release notes from commits since the last tag…"
    }
  }
}`}</CodeBlock>
          <p>
            The registry itself is versioned (<code className="inline">version: 1</code>), which is what allows
            its format to change later without silently misreading existing installs.
          </p>
          <p>
            Skills installed by the command are <b>project-scoped</b>: the destination is resolved from the
            CLI's current working directory. That makes installation visible to the checkout rather than to
            every repository on the machine. Legacy <code className="inline">.claude/skills/</code> entries
            can still be listed, removed, and migrated during an update.
          </p>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>Installing & managing</h2>
          <CodeBlock lang="bash">{`/skill install owner/repo      # install every skill in the repo
/skill list                    # installed skills with descriptions
/skill update <name>           # move the pin to a newer commit
/skill remove <name>           # uninstall`}</CodeBlock>
          <p>
            The installer expects <code className="inline">SKILL.md</code> at the repository root and installs
            one registry entry per repository. To distribute several independently managed skills, publish
            each one from its own repository; a plugin is the supported bundle when commands, agents,
            multiple skills, or hooks need to travel together.
          </p>
          <p>
            Updating is explicit for the same reason it is with plugins: a skill installed and reviewed
            should not change under you.
          </p>
        </section>

        <section id="tutorial">
          <h2><span className="anchor">#</span>Your first skill</h2>
          <CodeBlock lang="bash">{`mkdir pr-description-skill
cd pr-description-skill`}</CodeBlock>
          <CodeBlock lang="text">{`---
name: pr-description
description: Write a pull request description from the diff against main. Use when
  opening a PR, or when asked to describe or summarize a branch's changes.
metadata:
  author: Your Name
  version: 1.0.0
---

# PR description

## Inputs
The current branch, and \`main\` as the comparison base.

## Steps
1. \`git diff main...HEAD --stat\` for the shape of the change.
2. \`git log main..HEAD --oneline --no-merges\` for intent.
3. Read the files with the largest diffs — do not describe from the stat alone.
4. Write, in this order:
   - **What changed** — one paragraph, no bullet lists.
   - **Why** — the problem this solves.
   - **How to verify** — the exact commands a reviewer should run.
5. Print the result. Do not open the PR unless asked.

## Done when
The description names every user-visible change and every command needed
to verify it.

## Failure modes
- No commits vs main → say the branch is empty and stop.
- Diff over 2000 lines → summarize by directory and say you did.`}</CodeBlock>
          <CodeBlock lang="bash">{`git init && git add -A
git commit -m "pr-description skill"
git push -u origin main

/skill install youruser/pr-description-skill
/skill list`}</CodeBlock>
          <p>
            Note what makes that body work: explicit inputs, numbered steps with real commands, an
            unambiguous done condition, and named failure modes. Step 3 in particular encodes a piece of
            judgment — <em>do not describe from the stat alone</em> — which is exactly the kind of thing a
            skill is for.
          </p>
        </section>

        <section id="errors">
          <h2><span className="anchor">#</span>Validation errors</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "46%" }}>Message</th><th>Cause</th></tr>
              </thead>
              <tbody>
                {ERRORS.map(([m, c]) => (
                  <tr key={m}>
                    <td><code className="inline">{m}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Each message names the specific structural problem rather than reporting a generic parse
            failure. The two people hit most often are the first — a leading blank line before{" "}
            <code className="inline">---</code>, which is invisible in most editors — and the last, usually an
            underscore or a capital in the name.
          </p>
          <p>
            Related: <a href="/docs/plugin-authoring">Plugin authoring</a> for bundling skills with commands
            and hooks, and <a href="/docs/plugins-skills">Plugins & skills</a> for the user-facing
            overview.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
