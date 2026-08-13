import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "layers", label: "Three review layers" },
  { id: "inline", label: "Inline write diffs" },
  { id: "navigation", label: "Opening and navigating diffs" },
  { id: "summary", label: "Changed-file summary" },
  { id: "word", label: "Word-level highlighting" },
  { id: "display", label: "Display settings" },
  { id: "turn-review", label: "End-of-turn review" },
  { id: "generated", label: "Generated files" },
  { id: "verification", label: "Review and verification order" },
  { id: "git", label: "Comparing with Git" },
  { id: "limits", label: "Limits and edge cases" },
  { id: "workflow", label: "A dependable review workflow" },
];

const LAYERS = [
  ["Inline tool diff", "Immediately after write_file or patch_file", "Fast visual feedback for one file operation."],
  ["End-of-turn review", "Before a mutating turn finishes, when enabled", "A Git-backed summary of files changed during that turn."],
  ["Git review", "Whenever you ask for status or diff", "Authoritative staged, unstaged and repository-level inspection."],
];

const SETTINGS = [
  ["interface.showDiffs", "true", "Show or collapse inline write and patch diffs."],
  ["interface.showToolCalls", "true", "Show individual tool records; the changed-file footer remains available."],
  ["git.reviewDiff", "false", "Pause at the end of a mutating turn with a Git-backed review prompt."],
  ["git.verifyAfterEdit", "true", "Offer the detected project verification command after edits."],
  ["git.generatedPatterns", "[]", "Exclude matching generated paths from mutation tracking and end-of-turn checks."],
];

const LIMITS = [
  ["Inline preview", "First 50 diff lines; the remainder count is shown."],
  ["Terminal width", "Long lines are visually truncated with an ellipsis."],
  ["Detailed large-file diff", "Skipped when either side exceeds 5,000 lines; the write still reports a size summary."],
  ["End-of-turn text", "Git details are capped at 4,000 characters."],
  ["Word pairing", "Only an immediately adjacent removed/added line pair receives word-level comparison."],
  ["Untracked files", "Absent from a normal git diff, but included by end-of-turn review for tracked session writes."],
];

export default function DiffReview() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Diff review</span>
        </nav>

        <div className="hero">
          <h1>Reviewing diffs</h1>
          <p className="tagline">Read what changed while it is fresh, then verify the repository state before calling the task done.</p>
        </div>

        <section id="layers">
          <h2><span className="anchor">#</span>Three review layers</h2>
          <p>
            DeepSeek Code has three complementary diff surfaces. The inline view explains a single editing
            operation, the optional end-of-turn prompt gathers the current turn, and the Git tool answers what
            is actually staged or unstaged in the active checkout.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "22%" }}>Layer</th><th style={{ width: "31%" }}>When it appears</th><th>Best use</th></tr></thead>
            <tbody>{LAYERS.map(([layer, when, use]) => <tr key={layer}><td><b>{layer}</b></td><td>{when}</td><td>{use}</td></tr>)}</tbody>
          </table></div>
          <Note>
            A rendered diff is evidence, not an approval boundary. It does not stage, commit, revert or accept
            a change. Use Git, <code className="inline">/undo</code>, checkpoints or worktrees for those actions.
          </Note>
        </section>

        <section id="inline">
          <h2><span className="anchor">#</span>Inline write diffs</h2>
          <p>
            A full-file write and an exact-text patch return a structured before/after diff. The terminal
            renders the path, added and removed counts, first changed line, line-number gutter and colored
            content. Added lines use their new line numbers; context lines also use the new file's numbering.
          </p>
          <CodeBlock lang="text">{"  Write src/auth/session.ts\n    4 added / 2 removed at L83 in session.ts\n\n  83 + const token = await refreshOnce(accountId)\n       - const token = await refresh(accountId)"}</CodeBlock>
          <p>
            A surgical line edit is still tracked as a modification, but its tool result is a compact list of
            affected lines rather than the same full inline diff. Ask for a Git diff when you want a uniform
            view across every editing method.
          </p>
        </section>

        <section id="navigation">
          <h2><span className="anchor">#</span>Opening and navigating diffs</h2>
          <p>
            The conversation keeps the structured diff record. Press <code className="inline">Ctrl+D</code> to
            open the latest write or patch diff. Although the renderer has click primitives, application mouse
            clicks are currently disabled, so the keyboard shortcut is the supported path. The dialog
            uses the full recorded line list rather than the 50-line inline preview. Press Enter or Escape to
            close it.
          </p>
          <p>
            Both inline and dialog views adapt to the terminal width. A long source line is clipped for display;
            the file itself is not changed. Resize the terminal or use the Git diff when exact long-line content
            matters.
          </p>
        </section>

        <section id="summary">
          <h2><span className="anchor">#</span>Changed-file summary</h2>
          <p>
            At the bottom of the conversation, DeepSeek Code aggregates every recorded write and patch diff by
            path. It shows cumulative added and removed counts and reminds you that Ctrl+D opens the latest diff.
            Paths are shortened from the left when the terminal is narrow so the filename remains visible.
          </p>
          <p>
            These counts describe <b>editing operations in the visible session</b>, not the final net Git diff.
            Editing the same line twice can count it twice, and undoing a change does not rewrite old tool
            records. Use a Git stat or ask the Git tool for the final state.
          </p>
        </section>

        <section id="word">
          <h2><span className="anchor">#</span>Word-level highlighting</h2>
          <p>
            The <code className="inline">wordDiff</code> feature is on by default. When a removed line is
            immediately followed by an added line, unchanged words retain the normal diff color while changed
            words become brighter and bold. Whitespace is preserved as its own token, so spacing changes remain
            visible.
          </p>
          <CodeBlock lang="bash">{"> /features wordDiff off\n✓ Word Diff disabled"}</CodeBlock>
          <p>
            Turn it off when line colors are clearer, when a terminal theme has limited contrast, or when a
            replacement contains very long token sequences. The line-level diff remains available; only the
            extra intra-line emphasis changes.
          </p>
        </section>

        <section id="display">
          <h2><span className="anchor">#</span>Display settings</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "30%" }}>Setting</th><th style={{ width: "14%" }}>Default</th><th>Effect</th></tr></thead>
            <tbody>{SETTINGS.map(([name, value, effect]) => (
              <tr key={name}><td><code className="inline">{name}</code></td><td><code className="inline">{value}</code></td><td>{effect}</td></tr>
            ))}</tbody>
          </table></div>
          <CodeBlock lang="json">{"{\n  \"interface\": {\n    \"showDiffs\": true,\n    \"showToolCalls\": true\n  },\n  \"git\": {\n    \"reviewDiff\": true,\n    \"verifyAfterEdit\": true\n  }\n}"}</CodeBlock>
          <p>
            With <code className="inline">showDiffs</code> off, a write or patch becomes a one-line path and
            count summary marked “diff hidden.” With <code className="inline">showToolCalls</code> off, individual
            tool rows disappear, but the changed-file footer can still summarize recorded diffs.
          </p>
        </section>

        <section id="turn-review">
          <h2><span className="anchor">#</span>End-of-turn review</h2>
          <p>
            Enable <code className="inline">git.reviewDiff</code> when you want every mutating turn to pause
            before completion. If that turn changed at least one tracked path, the prompt contains the file list,
            a Git diff stat, a one-line-context diff, and content for new untracked files when available.
          </p>
          <CodeBlock lang="text">{"Review changes before completing this turn:\n\nFiles changed this turn:\n• src/auth/session.ts\n• tests/session.test.ts\n\n src/auth/session.ts | 6 ++++--\n tests/session.test.ts | 12 ++++++++++++\n\nContinue?\n\n[y] confirm  [n/Esc] cancel"}</CodeBlock>
          <p>
            This is an <b>acknowledgement pause</b>. Closing it does not roll back files, stage them or alter the
            captured patch. If the review exposes a problem, use a follow-up prompt, <code className="inline">/undo</code>,
            a checkpoint restore or discard an isolated worktree.
          </p>
          <Note>
            The review falls back to the tracked file list when the workspace is not a Git repository or Git
            cannot produce details. It remains useful, but it is not equivalent to a repository diff.
          </Note>
        </section>

        <section id="generated">
          <h2><span className="anchor">#</span>Generated files</h2>
          <p>
            Add path patterns to <code className="inline">git.generatedPatterns</code> when generated artifacts
            dominate reviews. Matching is case-insensitive glob-style matching against the resolved edited path,
            so project-directory patterns normally begin with a wildcard.
          </p>
          <CodeBlock lang="json">{"{\n  \"git\": {\n    \"generatedPatterns\": [\n      \"*dist/*\",\n      \"*src/generated/*\",\n      \"*.snap\"\n    ]\n  }\n}"}</CodeBlock>
          <p>
            A matching edit is omitted from the session's modified-file tracking, the end-of-turn review list,
            automatic post-edit verification and automatic file checkpoint. Its editing tool may still show an
            inline result, and the file still exists in Git. Keep patterns narrow: this setting reduces review
            noise by intentionally removing safety signals.
          </p>
        </section>

        <section id="verification">
          <h2><span className="anchor">#</span>Review and verification order</h2>
          <p>
            When both settings are enabled, end-of-turn review comes first. DeepSeek Code then offers the
            repository's detected test command. Detection uses an existing package test script and lockfile, or
            a Cargo or Go project marker; it does not invent a test framework.
          </p>
          <CodeBlock lang="text">{"Files changed this turn:\n  src/auth/session.ts\n  tests/session.test.ts\n\nRun verification?\n\nbun test"}</CodeBlock>
          <p>
            A green command proves only what that command covers. Review catches scope errors, accidental files
            and suspicious code; verification catches executable regressions. Use both for changes where either
            class of failure matters.
          </p>
        </section>

        <section id="git">
          <h2><span className="anchor">#</span>Comparing with Git</h2>
          <p>
            Inline diffs are operation-local. Git is the final authority for the active checkout. Ask for status,
            unstaged diff and staged diff separately, especially after staging, hooks, formatters, generated
            output or multiple edits to the same file.
          </p>
          <CodeBlock lang="text">{"Before declaring completion:\n1. Show the repository status.\n2. Review the complete unstaged diff for owned files.\n3. Review the staged diff separately.\n4. Identify untracked files and pre-existing changes.\n5. Run the smallest relevant verification command."}</CodeBlock>
          <p>
            In Review and Plan modes, Git status, diff and log remain available while Git mutations are blocked.
            That makes either mode a good last pass when you want inspection without staging or committing by
            accident.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and edge cases</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "28%" }}>Boundary</th><th>Behavior</th></tr></thead>
            <tbody>{LIMITS.map(([boundary, behavior]) => <tr key={boundary}><td><b>{boundary}</b></td><td>{behavior}</td></tr>)}</tbody>
          </table></div>
          <p>
            Binary changes, renames, file modes and submodule pointers are best inspected through Git. Inline
            write diffs model text lines and do not replace Git's richer repository semantics. The inline counter
            for a newly created text file also includes its complete line representation, including trailing
            empty-line state.
          </p>
        </section>

        <section id="workflow">
          <h2><span className="anchor">#</span>A dependable review workflow</h2>
          <CodeBlock lang="text">{"1. Start with git status and name which dirty files belong to the task.\n2. Keep inline diffs visible while the agent edits.\n3. Enable git.reviewDiff for changes that need an end-of-turn pause.\n4. Inspect the final Git diff, including staged and untracked state.\n5. Run focused tests, then the repository-level check if warranted.\n6. Stage explicit paths and inspect the staged diff again.\n7. Commit only when requested; push only under separate authorization."}</CodeBlock>
          <p>
            For a risky or experimental change, add worktree isolation. Review then answers two separate
            questions: whether the patch is correct, and whether it is safe to integrate into the parent checkout.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
