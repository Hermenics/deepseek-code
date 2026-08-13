import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "purpose", label: "What it records" },
  { id: "target", label: "Exact file and load timing" },
  { id: "candidates", label: "What belongs there" },
  { id: "behavior", label: "Create, append, replace" },
  { id: "headings", label: "Heading rules" },
  { id: "authorization", label: "Modes and authorization" },
  { id: "limits", label: "Important limits" },
  { id: "review", label: "Review and recovery" },
  { id: "compare", label: "Knowledge vs memory" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const CANDIDATES = [
  ["Architecture decision", "A boundary or dependency direction future work must preserve, plus why it exists."],
  ["Repository convention", "A non-obvious rule such as where generated files live or which package owns a contract."],
  ["Operational fact", "The canonical verification command, release constraint, or recovery step that repeatedly matters."],
  ["Known sharp edge", "A stable trap whose symptoms are misleading and whose safe response is verified."],
];

const NOT_CANDIDATES = [
  ["Current task progress", "Use the visible todo or final handoff. Progress becomes stale immediately."],
  ["A fact obvious from source", "Future agents can read it; duplication creates another value that can drift."],
  ["Personal preference", "Use user memory, not a repository instruction file."],
  ["Secrets or private tokens", "Never place credentials in a project file or model context."],
  ["Speculation", "Verify first. Persistent uncertainty is worse than a missing note."],
];

const MODES = [
  ["Build", "Available, subject to the effective permission configuration."],
  ["Auto", "Available, subject to the same safety and permission checks."],
  ["Plan", "Unavailable. Planning may write only its designated plan artifact."],
  ["Review", "Unavailable because it changes repository state."],
];

export default function UpdateKnowledge() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Tools</span><span className="sep">/</span><span className="current">Update knowledge</span>
        </nav>

        <div className="hero">
          <h1>Update project knowledge</h1>
          <p className="tagline">
            Record one verified, durable project fact under a named section in the root
            <code className="inline">DEEPSEEK.md</code>—without turning it into a task log.
          </p>
        </div>

        <section id="purpose">
          <h2><span className="anchor">#</span>What it records</h2>
          <p>
            <code className="inline">update_knowledge</code> is a repository-writing tool for information that
            should help future DeepSeek Code sessions work correctly. It accepts a section name and section
            body, then creates, appends, or replaces that level-two section in the project-root
            <code className="inline">DEEPSEEK.md</code>.
          </p>
          <p>
            Its value is not merely surviving the current conversation. The fact is loaded as project guidance
            before later work begins and is refreshed after full compaction.
          </p>
          <CodeBlock lang="text">{`After verifying the release flow, record this durable project fact:
section: Release verification
content: Run bun run typecheck before bun test. The generated provider manifest is checked by typecheck and must not be edited by hand.`}</CodeBlock>
          <Note>
            Use the tool only when the active request authorizes a repository write. Discovering a useful fact
            is not independent permission to change project guidance.
          </Note>
        </section>

        <section id="target">
          <h2><span className="anchor">#</span>Exact file and load timing</h2>
          <p>
            The destination is always <code className="inline">&lt;active workspace&gt;/DEEPSEEK.md</code>.
            The tool does <b>not</b> update <code className="inline">.deepseek/DEEPSEEK.md</code>. If both files
            exist, startup loads the root file first and the nested file second, but this tool owns only the
            root document.
          </p>
          <p>
            A successful write does not rebuild the already-running system prompt. The current agent knows what
            it just wrote through the tool result, but other running workers are not notified. The updated
            document is loaded by a new or reinitialized session and is read again after full compaction.
          </p>
          <CodeBlock lang="text">{`Knowledge updated: "Release verification"`}</CodeBlock>
          <p>
            Relative placement follows the active workspace. If <code className="inline">/cwd</code> changes the
            project, a later update targets that new root. Delegated worker profiles do not expose
            <code className="inline">update_knowledge</code>.
          </p>
        </section>

        <section id="candidates">
          <h2><span className="anchor">#</span>What belongs there</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "28%" }}>Good candidate</th><th>Durable value</th></tr></thead>
            <tbody>{CANDIDATES.map(([kind, value]) => <tr key={kind}><td><b>{kind}</b></td><td>{value}</td></tr>)}</tbody>
          </table></div>
          <p>Keep these elsewhere:</p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "28%" }}>Do not record</th><th>Use instead</th></tr></thead>
            <tbody>{NOT_CANDIDATES.map(([kind, value]) => <tr key={kind}><td><b>{kind}</b></td><td>{value}</td></tr>)}</tbody>
          </table></div>
          <p>
            A strong entry states the fact, its scope, and why violating it matters. It does not paste
            implementation, duplicate a README, narrate completed work, or claim evidence that was never checked.
          </p>
        </section>

        <section id="behavior">
          <h2><span className="anchor">#</span>Create, append, replace</h2>
          <p>
            If the file does not exist, DeepSeek Code creates it with a project-knowledge title and the requested
            section. If the file exists and the heading text is not found, the new section is appended after the
            existing content with normalized blank-line spacing.
          </p>
          <p>
            If the heading text is found, everything from that heading through the line before the next
            level-two heading is replaced. Replacement is whole-section replacement, not merging. Omitted bullets,
            examples, or caveats from the new body disappear.
          </p>
          <p>
            Both arguments are trimmed. Supplying content made only of whitespace therefore replaces the section
            with an empty body. That is a destructive section clear, even though the heading remains.
          </p>
          <CodeBlock lang="text">{`Before asking for an update:
- read the complete existing section
- preserve still-valid constraints
- replace stale statements explicitly
- keep the section focused on one durable topic`}</CodeBlock>
          <Note>
            There is no append-to-existing-section mode. To add one sentence safely, include the complete desired
            section body in the request.
          </Note>
        </section>

        <section id="headings">
          <h2><span className="anchor">#</span>Heading rules</h2>
          <p>
            Section names are trimmed and become <code className="inline">## Section name</code>. They may use
            Unicode letters and numbers, spaces, hyphens, slashes, parentheses, periods, commas, and colons.
            Characters such as <code className="inline">#</code>, underscores, ampersands, apostrophes, brackets,
            and emoji are rejected in the section name. The content itself may contain normal Markdown.
          </p>
          <p>
            Heading lookup is case-sensitive literal text, not a Markdown parser. Choose a unique full heading and
            avoid prefix pairs such as <code className="inline">Architecture</code> and
            <code className="inline">Architecture decisions</code>; a short heading string can collide with a
            longer heading. Reuse the exact spelling when updating an established section.
          </p>
          <CodeBlock lang="text">{`Accepted
Architecture decisions
Testing: integration
API contracts (v2)
Build / release

Rejected
CI/CD & deploy
Known_issues
# Architecture`}</CodeBlock>
        </section>

        <section id="authorization">
          <h2><span className="anchor">#</span>Modes and authorization</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "18%" }}>Mode</th><th>Behavior</th></tr></thead>
            <tbody>{MODES.map(([mode, behavior]) => <tr key={mode}><td><code className="inline">{mode}</code></td><td>{behavior}</td></tr>)}</tbody>
          </table></div>
          <p>
            The tool has no built-in risk pattern, but the mode gate, settings deny/allow rules, active-agent
            allowlist, and hooks still apply. A deny rule blocks it; an allow-list configuration that does not
            cover it can produce a prompt. Use the canonical name <code className="inline">update_knowledge</code>
            in permission settings.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Important limits</h2>
          <p>
            Updates are whole-file read/modify/write operations. They do not use the atomic file-writer,
            per-file lease, or line-aware conflict detection used by dedicated edit tools. Two concurrent
            updates can race and the later write can replace the earlier one. Assign one owner for
            <code className="inline">DEEPSEEK.md</code> during parallel work.
          </p>
          <p>
            The tool treats an unreadable existing file like a missing file before attempting the write, and it
            has no section-body size cap of its own. Keep the document small: its contents are injected into model
            context, so every unnecessary paragraph has a recurring token cost.
          </p>
          <p>
            Section matching recognizes the next heading only when it begins on a new line as
            <code className="inline">## </code>. Preserve conventional level-two Markdown headings.
          </p>
        </section>

        <section id="review">
          <h2><span className="anchor">#</span>Review and recovery</h2>
          <p>
            <code className="inline">update_knowledge</code> is not included in the file-edit undo stack,
            automatic file checkpoints, changed-file diff cards, or post-edit verification trigger. A success
            message proves the write completed; it does not prove the resulting section is correct.
          </p>
          <CodeBlock lang="bash">{`git diff -- DEEPSEEK.md
git status --short -- DEEPSEEK.md`}</CodeBlock>
          <p>
            Review that diff immediately. If the replacement was wrong, restore the intended section manually or
            use version control. Do not expect <code className="inline">/undo</code> to restore it. Without
            version history, make a copy before a risky replacement.
          </p>
          <CodeBlock lang="text">{`Read the complete DEEPSEEK.md and verify that the "Release verification" section
contains the new rule without removing unrelated sections. Do not edit anything else.`}</CodeBlock>
        </section>

        <section id="compare">
          <h2><span className="anchor">#</span>Knowledge vs memory</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "22%" }}>Mechanism</th><th style={{ width: "30%" }}>Lifetime and owner</th><th>Use it for</th></tr></thead>
            <tbody>
              <tr><td><code className="inline">update_knowledge</code></td><td>Repository file, reviewable by the team</td><td>Durable project decisions and constraints under named sections.</td></tr>
              <tr><td><code className="inline">memory</code></td><td>User or project memory store, agent-managed</td><td>Compact facts and stable preferences, not instruction-file structure.</td></tr>
              <tr><td>Steering</td><td>Repository files authored by maintainers</td><td>Detailed standards or topic-specific instructions deserving their own document.</td></tr>
              <tr><td>Todo</td><td>Current session</td><td>Progress, dependencies, and unfinished work.</td></tr>
            </tbody>
          </table></div>
          <p>
            See <a href="/docs/memory">Memory</a> and <a href="/docs/steering">Steering</a> for their separate
            trust, scope, and context-cost models.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "32%" }}>Symptom</th><th>Recovery</th></tr></thead>
            <tbody>
              <tr><td>Invalid section-name error</td><td>Remove unsupported punctuation; keep structural Markdown in content, not the heading.</td></tr>
              <tr><td>A second section appeared</td><td>Check capitalization and spacing. Reuse the exact existing heading.</td></tr>
              <tr><td>A neighboring section disappeared</td><td>Restore it from Git or backup, then use unique non-prefix headings.</td></tr>
              <tr><td>The current agent seems unaware</td><td>The live system prompt is not rebuilt. State the fact now or start a new session; full compaction also refreshes it.</td></tr>
              <tr><td><code className="inline">/undo</code> does nothing</td><td>Expected. Recover with Git or a manual copy.</td></tr>
              <tr><td>Parallel updates were lost</td><td>Restore the missing section and assign one writer for the file.</td></tr>
            </tbody>
          </table></div>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
