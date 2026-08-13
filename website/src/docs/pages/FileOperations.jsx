import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "choose", label: "Choose the right file operation" },
  { id: "read", label: "Reading files and folders" },
  { id: "edit", label: "Editing safely" },
  { id: "atomic", label: "Atomic writes and leases" },
  { id: "paths", label: "Path boundaries" },
  { id: "sensitive", label: "Sensitive and blocked paths" },
  { id: "diffs", label: "Diff results and large files" },
  { id: "recovery", label: "Recovery" },
];

const OPERATIONS = [
  ["read_file", "Inspect a known file", "First 200 numbered lines by default; request ranges for more."],
  ["read_folder", "Orient within a directory", "Optional recursion, five levels deep, at most 1,000 entries."],
  ["edit_file", "Change exact substrings on known lines", "Smallest payload; all requested edits validate before the write."],
  ["patch_file", "Replace one unique multi-line block", "Fails when the old block is missing or appears more than once."],
  ["write_file", "Create a file or replace it completely", "Creates parent directories; best for new files or intentional rewrites."],
];

export default function FileOperations() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Tools</span><span className="sep">/</span><span className="current">File operations</span>
        </nav>
        <div className="hero">
          <h1>File operations</h1>
          <p className="tagline">How DeepSeek Code reads, changes, validates, publishes, and recovers workspace files.</p>
        </div>

        <section id="choose">
          <h2><span className="anchor">#</span>Choose the right file operation</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th>Operation</th><th>Use it for</th><th>Behavior</th></tr></thead>
            <tbody>{OPERATIONS.map(([name, use, behavior]) => <tr key={name}><td><code className="inline">{name}</code></td><td>{use}</td><td>{behavior}</td></tr>)}</tbody>
          </table></div>
          <p>
            You normally describe the desired change and let the agent choose. When precision matters, tell
            it to reread current context and make the smallest exact edit rather than rewriting a dirty file.
          </p>
          <CodeBlock lang="text">{`Read the current function and change only the timeout branch.
Preserve unrelated working-tree edits, then show and verify the resulting diff.`}</CodeBlock>
        </section>

        <section id="read">
          <h2><span className="anchor">#</span>Reading files and folders</h2>
          <p>
            File reads are UTF-8 and always return 1-indexed line numbers. Without a range, the first 200
            lines are returned with the total line count and the next suggested start line. Explicit start
            and end lines are inclusive and let the agent inspect a large file in bounded chunks.
          </p>
          <p>
            Folder listing can be shallow or recursive. Recursive traversal stops after five nested levels
            and 1,000 results. Unreadable child directories are labeled and skipped instead of hiding the
            rest of the listing.
          </p>
        </section>

        <section id="edit">
          <h2><span className="anchor">#</span>Editing safely</h2>
          <p>
            A line edit names a 1-indexed line plus exact old and new substrings. Multiple replacements on
            one line are applied left to right. Multiple lines can be changed in one call, but duplicate
            targets are rejected. Every line number and old substring is validated before any content is
            published, so a stale edit fails as a unit.
          </p>
          <p>
            A block patch requires the old content to occur exactly once. Zero matches means the file has
            changed or the context is wrong; multiple matches mean the requested target is ambiguous. The
            safe response is to reread and add context, not widen the replacement blindly.
          </p>
          <p>
            A full write reads the previous contents for diffing, creates missing parents, then replaces the
            file. It should not be used for a small change when unrelated content could be lost.
          </p>
        </section>

        <section id="atomic">
          <h2><span className="anchor">#</span>Atomic writes and leases</h2>
          <p>
            All three write operations publish through the same safe path. The new contents are written to
            a temporary sibling, the target is revalidated, and a rename atomically replaces the destination.
            Existing permission bits are preserved; a new file starts owner-readable and owner-writable.
          </p>
          <p>
            A cross-process file lease serializes writers targeting the same path. This prevents two agents
            from publishing over each other between validation and rename. Cancellation is checked before
            and during publication, and abandoned temporary files are cleaned up best-effort.
          </p>
        </section>

        <section id="paths">
          <h2><span className="anchor">#</span>Path boundaries</h2>
          <p>
            Relative paths resolve from the active workspace, including an entered worktree. Absolute paths
            inside the original project are translated to the equivalent worktree path for an isolated
            writer. A path outside approved roots triggers an interactive directory approval in the main
            session and fails closed when no approval UI is available.
          </p>
          <p>
            Existing path components are canonicalized. A symlink cannot carry an apparently safe path out
            of its approved directory, and a target is checked again immediately before publication.
          </p>
        </section>

        <section id="sensitive">
          <h2><span className="anchor">#</span>Sensitive and blocked paths</h2>
          <p>
            Native file tools reject runtime/configuration directories such as <code className="inline">.git</code>,
            <code className="inline">.deepseek</code>, <code className="inline">.github</code>, dependency
            trees, and build output. A narrowly scoped exception permits validated JavaScript workflow files
            below <code className="inline">.deepseek/workflows/</code>.
          </p>
          <p>
            Common secret-bearing names are also rejected: environment files, private keys and certificates,
            credential/secret files, npm and Python registry credentials, SSH identity material, AWS
            credential files, and service-account JSON. These checks apply after canonicalization, not just
            to the user-supplied spelling.
          </p>
          <Note>
            Path blocking is defense in depth, not a secret scanner. Never put credentials into ordinary
            source files or prompts just because their filename is not on the list.
          </Note>
        </section>

        <section id="diffs">
          <h2><span className="anchor">#</span>Diff results and large files</h2>
          <p>
            Full writes and block patches return structured line changes used by the transcript and diff
            viewer. For files above 5,000 lines on either side, detailed in-memory diff construction is
            skipped to avoid excessive memory use; the write succeeds and returns only a size summary.
            Targeted line edits report affected line numbers instead.
          </p>
        </section>

        <section id="recovery">
          <h2><span className="anchor">#</span>Recovery</h2>
          <p>
            Before a foreground write, the agent records undo state and a durable file checkpoint. Use
            <code className="inline">/undo</code> for recent agent edits and Git for lasting history. See
            <a href="/docs/checkpointing"> Checkpointing and undo</a> for retention and empty-file caveats.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
