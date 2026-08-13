import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "two-layers", label: "Two layers of undo" },
  { id: "conversation", label: "Conversation checkpoints" },
  { id: "pruning", label: "Retention & pruning" },
  { id: "file", label: "File checkpoints" },
  { id: "manifest", label: "The manifest" },
  { id: "empty", label: "The empty-backup convention" },
  { id: "undo", label: "Using /undo" },
  { id: "layout", label: "On-disk layout" },
  { id: "git", label: "Checkpoints vs git" },
  { id: "limits", label: "Limits & caveats" },
];

const LAYERS = [
  ["Conversation checkpoint", "/checkpoint", "Manual", "Message history + list of modified files", "20 most recent"],
  ["File checkpoint", "Automatic on write", "Automatic", "Byte-for-byte copy of the file before the edit", "Per session"],
];

const CP_FIELDS = [
  ["id", "Date.now() + 3 random bytes (hex)", "Time-ordered and collision-resistant. Sorting ids sorts chronologically."],
  ["timestamp", "ISO 8601 string", "Human- and machine-readable creation time."],
  ["label", "Your label, or the local date-time", "What /checkpoint list shows you."],
  ["messages", "MessageOrBoundary[]", "The full array, including compact boundary markers."],
  ["filesModified", "string[]", "Paths touched up to that point. Restoring does not revert them."],
];

const ENTRY_FIELDS = [
  ["id", "timestamp + 3 random bytes (hex)", "Unique entry identifier."],
  ["timestamp", "number (ms)", "When the backup was taken."],
  ["path", "string", "Absolute path of the file that was about to change."],
  ["backupFile", "sha256(path:timestamp).slice(0,8) + '.bak'", "Flat filename in files/, so no directory tree is recreated."],
  ["toolName", "string", "Which tool triggered the write — useful when auditing a rollback."],
];

const UNDO_CMDS = [
  ["/undo", "rollbackLast", "Pops the newest entry and restores that one file."],
  ["/undo all", "rollbackAll", "Walks every entry newest-first and restores all of them."],
  ["/undo list", "listFileCheckpoints", "Shows entries newest-first without changing anything."],
];

const CAVEATS = [
  ["Restoring a conversation does not restore files", "Checkpoints store filesModified as a record, not as content. Use /undo for files."],
  ["File checkpoints are per session", "They live under the session id. A new session starts with an empty manifest."],
  ["Backups are plain copies", "A very large file is copied in full. Binary files are read as UTF-8 and may not round-trip."],
  ["Rollback is destructive to newer edits", "Restoring overwrites whatever is on disk now, including your manual changes."],
  ["Deleting the backup is part of restore", "Once an entry is rolled back, its .bak is removed. There is no redo."],
];

export default function Checkpointing() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Checkpointing</span>
        </nav>

        <div className="hero">
          <h1>Checkpointing & undo</h1>
          <p className="tagline">
            Two independent safety nets: one for the conversation, one for your files. Knowing which is
            which is the difference between recovering and losing work.
          </p>
        </div>

        <section id="two-layers">
          <h2><span className="anchor">#</span>Two layers of undo</h2>
          <p>
            DeepSeek Code keeps two entirely separate rollback systems. They do not know about each other,
            they are stored in different places, and they answer different questions.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Layer</th>
                  <th style={{ width: "16%" }}>Created by</th>
                  <th style={{ width: "12%" }}>Trigger</th>
                  <th style={{ width: "28%" }}>Stores</th>
                  <th>Retention</th>
                </tr>
              </thead>
              <tbody>
                {LAYERS.map(([l, c, t, s, r]) => (
                  <tr key={l}>
                    <td><b style={{ color: "var(--text-strong)" }}>{l}</b></td>
                    <td><code className="inline">{c}</code></td>
                    <td>{t}</td>
                    <td>{s}</td>
                    <td>{r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The rule to remember: <b>a conversation checkpoint restores what the agent knew; a file
            checkpoint restores what the agent wrote.</b> Restoring a conversation to an earlier point does
            not un-edit a single line of code.
          </p>
        </section>

        <section id="conversation">
          <h2><span className="anchor">#</span>Conversation checkpoints</h2>
          <p>
            A conversation checkpoint is a complete snapshot of the message array, saved as one JSON file:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Field</th><th style={{ width: "34%" }}>Shape</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {CP_FIELDS.map(([f, s, n]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{s}</code></td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`/checkpoint                    # save with an auto label (local date-time)
/checkpoint save before refactor # save with your own label
/checkpoint list               # newest first
/checkpoint restore <id>       # replace the live history with the snapshot`}</CodeBlock>
          <p>
            The id encodes creation time as a millisecond prefix followed by three random bytes. That is not
            decoration: listing sorts filenames and reverses them, so a time-ordered id makes "newest first"
            a string sort rather than a parse-and-compare.
          </p>
          <p>
            Snapshots include <a href="/docs/compaction#boundary">compact boundary markers</a>. Restoring a
            checkpoint taken after a compaction restores the post-compaction state, boundary included — you
            do not get the pre-compaction history back by restoring.
          </p>
          <Note>
            Reading is fault-tolerant by design: a checkpoint file that fails to parse is skipped rather than
            failing the whole listing. One corrupt file cannot hide the other nineteen.
          </Note>
        </section>

        <section id="pruning">
          <h2><span className="anchor">#</span>Retention & pruning</h2>
          <p>
            Every save runs a prune pass afterwards. Files are sorted ascending — oldest first, thanks to the
            timestamp-prefixed ids — and everything beyond{" "}
            <code className="inline">CHECKPOINT_MAX</code> (20) is deleted from the front.
          </p>
          <p>
            The cap is global, not per project. Twenty checkpoints across all your work is the budget, so a
            checkpoint you care about for more than a few days is better represented as a git commit.
          </p>
          <p>
            Note the failure handling: <code className="inline">unlink</code> errors are swallowed and the whole
            prune is wrapped in a catch. Pruning is housekeeping — if it fails, the <em>save</em> that
            triggered it must still succeed. Losing the ability to delete an old checkpoint is a nuisance;
            losing the new one is data loss.
          </p>
        </section>

        <section id="file">
          <h2><span className="anchor">#</span>File checkpoints</h2>
          <p>
            File checkpoints are automatic. Before any tool writes to a file, the current contents are copied
            to a backup and an entry is appended to the session manifest. You never invoke this — it is the
            machinery behind <code className="inline">/undo</code>.
          </p>
          <p>
            Backups are written with mode <code className="inline">0o600</code> — owner read/write only. Your
            source may be world-readable in the repository, but its backup copy under your home directory is
            not.
          </p>
          <p>
            The backup filename is an eight-character digest derived from the absolute path and backup
            timestamp, followed by <code className="inline">.bak</code>. It deliberately does not preserve
            the original basename.
          </p>
          <p>
            Hashing solves three problems at once. All backups live in a single flat{" "}
            <code className="inline">files/</code> directory with no path structure to recreate. Two files with
            the same basename in different directories cannot collide. And the same file backed up twice at
            different times produces different names, so successive edits each keep their own restore point.
          </p>
        </section>

        <section id="manifest">
          <h2><span className="anchor">#</span>The manifest</h2>
          <p>
            <code className="inline">manifest.json</code> is the index. It holds a session id and an ordered
            array of entries — oldest first, appended as edits happen:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Field</th><th style={{ width: "38%" }}>Shape</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {ENTRY_FIELDS.map(([f, s, p]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{s}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`{
  "sessionId": "1754923000000-9f2a1c",
  "entries": [
    { "id": "1754923010000-4b1e77", "timestamp": 1754923010000,
      "path": "/home/you/proj/src/auth.ts",
      "backupFile": "a3f91b2c.bak", "toolName": "edit_file" },
    { "id": "1754923044000-c07d13", "timestamp": 1754923044000,
      "path": "/home/you/proj/src/auth.test.ts",
      "backupFile": "7e10bb45.bak", "toolName": "write_file" }
  ]
}`}</CodeBlock>
          <p>
            The array is a <b>stack</b>. <code className="inline">rollbackLast</code> pops from the end,{" "}
            <code className="inline">rollbackAll</code> walks a reversed copy, and listing reverses it so you see
            newest first. A missing manifest is not an error — it returns an empty one, so the first edit of a
            session works exactly like the hundredth.
          </p>
        </section>

        <section id="empty">
          <h2><span className="anchor">#</span>The empty-backup convention</h2>
          <p>
            One design decision is worth calling out because it looks like a bug until you see the intent.
          </p>
          <p>
            When a backup is taken of a file that <b>does not exist yet</b> — because the tool is about to{" "}
            <em>create</em> it — the read fails, and an <b>empty file</b> is written as the backup instead.
          </p>
          <p>
            During rollback, an empty backup means “remove the current file”; any non-empty backup is written
            back to the original path. So undoing a file creation <b>deletes the file</b>, which is the
            correct inverse.
          </p>
          <p>
            The tradeoff is explicit: a file that was genuinely empty before an edit is deleted rather than restored to
            empty. Empty-file-to-content is a far rarer case than create-a-new-file, and the convention buys
            correct undo for the common one without a separate existence flag.
          </p>
          <Note>
            After a successful restore the <code className="inline">.bak</code> is deleted. Rollback is a
            one-way move — there is no redo.
          </Note>
        </section>

        <section id="undo">
          <h2><span className="anchor">#</span>Using /undo</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Command</th><th style={{ width: "24%" }}>Implementation</th><th>Behavior</th></tr>
              </thead>
              <tbody>
                {UNDO_CMDS.map(([c, i, b]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td><code className="inline">{i}</code></td>
                    <td>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="text">{`> /undo
Restored: /home/you/proj/src/auth.ts

> /undo all
Restored 3 file(s).

> /undo
Nothing to rollback.`}</CodeBlock>
          <p>
            <code className="inline">/undo all</code> is resilient: it collects per-file errors instead of
            aborting, restores everything it can, and reports failures at the end. A single unwritable file
            does not block the rollback of the other nine. The manifest is cleared either way, so a partially
            failed rollback cannot be retried — check the reported errors before moving on.
          </p>
          <p>
            The in-memory undo stack used during a live turn is separately capped at{" "}
            <code className="inline">UNDO_STACK_MAX</code> (10). File checkpoints are the durable layer; the
            in-memory stack is a convenience that dies with the process.
          </p>
        </section>

        <section id="layout">
          <h2><span className="anchor">#</span>On-disk layout</h2>
          <CodeBlock lang="text">{`~/.deepseek/checkpoints/
├── 1754923000000-9f2a1c.json    conversation checkpoint
├── 1754919400000-3ab7de.json
└── …                            (max 20, oldest pruned)

~/.deepseek-code/checkpoints/<sessionId>/
├── manifest.json                ordered entry stack
└── files/
    ├── a3f91b2c.bak             pre-edit copy, mode 0600
    └── 7e10bb45.bak`}</CodeBlock>
          <Note>
            The two layers live under different top-level directories —{" "}
            <code className="inline">~/.deepseek/</code> for conversation checkpoints and{" "}
            <code className="inline">~/.deepseek-code/</code> for file checkpoints. If you are cleaning up disk
            space by hand, check both.
          </Note>
          <p>
            See <a href="/docs/deepseek-directory">The .deepseek directory</a> for the complete map.
          </p>
        </section>

        <section id="git">
          <h2><span className="anchor">#</span>Checkpoints vs git</h2>
          <p>
            Checkpoints are not a version control system and are not trying to be one. They are a{" "}
            <b>short-horizon safety net</b> for the minutes between "let it try something" and "that was
            wrong".
          </p>
          <p>
            Use <code className="inline">/undo</code> when an edit just went wrong and you want the previous
            bytes back immediately. Use <b>git</b> for anything you want to keep, share, or return to
            tomorrow — checkpoints are capped, session-scoped, and consumed on restore.
          </p>
          <p>
            For genuinely risky work, the stronger pattern is a{" "}
            <a href="/docs/worktrees">worktree</a>: an isolated branch and directory where a failed attempt is
            discarded by removing the worktree, with no rollback needed at all.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits & caveats</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "38%" }}>Caveat</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {CAVEATS.map(([c, d]) => (
                  <tr key={c}>
                    <td><b style={{ color: "var(--text-strong)" }}>{c}</b></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The binary caveat deserves emphasis. Backups are read and written as UTF-8 text. A binary asset
            edited by a tool will be backed up, but the restored bytes are not guaranteed to be identical.
            Keep binaries in git.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
