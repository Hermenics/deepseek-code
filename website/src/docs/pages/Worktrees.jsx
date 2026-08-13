import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "why", label: "Why worktrees" },
  { id: "commands", label: "Commands" },
  { id: "naming", label: "How names are generated" },
  { id: "branches", label: "Branch naming" },
  { id: "state", label: "Worktree state" },
  { id: "safety", label: "Four safety rails" },
  { id: "nofallback", label: "No copied-workspace fallback" },
  { id: "orchestrator", label: "Worktrees in the orchestrator" },
  { id: "workflow", label: "A typical session" },
  { id: "cleanup", label: "Cleanup & recovery" },
];

const COMMANDS = [
  ["/worktree or /worktree create", "Create a worktree with a generated name and a fresh branch, then enter it."],
  ["/worktree list", "List every directory under .deepseek/worktrees/."],
  ["/worktree enter <name>", "Switch into an existing worktree."],
  ["/worktree exit", "Leave and remove the worktree (refuses if dirty)."],
  ["/worktree exit keep", "Leave but preserve the worktree on disk."],
  ["/worktree status", "Show the tracked active worktree, if any."],
  ["/wt", "Alias for /worktree."],
];

const INFO_FIELDS = [
  ["name", "Generated adjective-noun slug, e.g. swift-fox."],
  ["path", "Absolute path under .deepseek/worktrees/<name>."],
  ["originalCwd", "The project root you came from — how exit knows where to return."],
  ["createdAt", "ISO timestamp. For listed worktrees this is the directory birthtime."],
  ["isGitWorktree", "Whether a .git entry exists inside. Always true for worktrees created here."],
  ["branch", "The branch created with -b, when applicable."],
  ["sessionId", "The session that created it, so the orchestrator can reclaim its own."],
];

const RAILS = [
  [
    "Path containment",
    "validatePathUnderWorktrees()",
    "Every name resolves under .deepseek/worktrees/ before it is used. A name like ../../etc is rejected outright.",
  ],
  [
    "Dirty-tree refusal",
    "git status --porcelain=v1",
    "Removal aborts if the worktree has uncommitted changes. The worktree is preserved and the error says so.",
  ],
  [
    "Unique-name retry",
    "10 attempts",
    "Names are regenerated until one is free. Ten collisions in a row raises rather than overwriting an existing directory.",
  ],
  [
    "Secure name seed",
    "randomUUID()",
    "Both name indices come from a crypto UUID rather than Math.random, so names are unpredictable as well as unique.",
  ],
];

const RECOVERY = [
  ["Worktree has uncommitted changes", "Commit or stash inside it, then /worktree exit. Or use exit keep and deal with it later."],
  ["Directory exists but git does not know it", "Run git worktree prune from the project root, then remove the directory."],
  ["Removed the directory by hand", "git worktree prune cleans the dangling administrative entry."],
  ["State file points at a missing worktree", "Delete .deepseek/worktree-state.json; it is rebuilt from an empty state."],
  ["Legacy copied worktree", "Removal is refused by design. Inspect it and delete manually."],
];

export default function Worktrees() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Worktrees</span>
        </nav>

        <div className="hero">
          <h1>Worktrees</h1>
          <p className="tagline">
            Isolated checkouts for risky or parallel work. A failed experiment is deleted, not reverted.
          </p>
        </div>

        <section id="why">
          <h2><span className="anchor">#</span>Why worktrees</h2>
          <p>
            A git worktree is a second working directory attached to the same repository, on its own branch.
            Files are separate; history is shared. Nothing you do inside one is visible from the main
            checkout until you merge.
          </p>
          <p>
            That property is what makes agentic work safe to parallelize. Two agents editing the same tree
            will collide on the same files; two agents in separate worktrees cannot. And when an attempt goes
            badly, you do not roll back edit by edit — you remove the worktree. Its branch remains in Git until
            you deliberately delete it.
          </p>
          <p>
            Reach for one when the work is <b>exploratory</b> (a refactor you may abandon),{" "}
            <b>parallel</b> (two independent features at once), or <b>delegated</b> (a sub-agent that writes
            files). The <a href="/docs/agent-teams">orchestrator</a> creates task-owned detached Git worktrees
            for writer workers when isolation is available; that lifecycle is separate from this interactive command.
          </p>
          <Note>
            Compare with <a href="/docs/checkpointing">checkpointing</a>: checkpoints undo an edit after the
            fact; worktrees prevent the edit from touching your working tree in the first place.
          </Note>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>Commands</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Command</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {COMMANDS.map(([c, e]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`> /worktree create
Created worktree "swift-fox" on branch deepseek/swift-fox-a91c3f
  .deepseek/worktrees/swift-fox

> /worktree list
swift-fox    .deepseek/worktrees/swift-fox    git
bold-owl     .deepseek/worktrees/bold-owl     git

> /worktree exit
Worktree "swift-fox" removed.`}</CodeBlock>
        </section>

        <section id="naming">
          <h2><span className="anchor">#</span>How names are generated</h2>
          <p>
            Worktrees get readable two-word names — <code className="inline">swift-fox</code>,{" "}
            <code className="inline">bold-owl</code>, <code className="inline">jade-lynx</code> — drawn from a fixed
            list of 30 adjectives and 30 nouns.
          </p>
          <p>
            DeepSeek Code chooses each half from cryptographically random bytes rather than a predictable
            pseudo-random sequence. The friendly name is therefore convenient to type without turning the
            worktree path into something another process can reliably guess in advance.
          </p>
          <p>
            Readability is not cosmetic either. You will type these names into{" "}
            <code className="inline">/worktree enter</code>, read them in{" "}
            <code className="inline">git branch</code>, and see them in orchestrator task lists. A UUID would be
            unambiguous and unusable.
          </p>
          <p>
            With 900 combinations, collisions happen. Creation retries up to <b>10 times</b>, checking whether
            the directory already exists, and raises rather than silently reusing an occupied path.
          </p>
        </section>

        <section id="branches">
          <h2><span className="anchor">#</span>Branch naming</h2>
          <p>
            Each worktree is created with <code className="inline">git worktree add -b &lt;branch&gt;</code>, so it
            always starts on a fresh branch. The branch name comes from a configurable pattern:
          </p>
          <CodeBlock lang="json">{`// .deepseek/settings.json
{
  "git": {
    "branchPattern": "deepseek/{slug}-{shortId}"
  }
}`}</CodeBlock>
          <p>
            <code className="inline">{"{slug}"}</code> is the worktree name and{" "}
            <code className="inline">{"{shortId}"}</code> is three random bytes in hex. After substitution the
            result is sanitized — anything outside{" "}
            <code className="inline">[a-zA-Z0-9/_-]</code> becomes a hyphen — so a pattern containing spaces or
            shell metacharacters cannot produce an invalid or dangerous ref.
          </p>
          <p>
            The default namespaces every generated branch under{" "}
            <code className="inline">deepseek/</code>, which keeps <code className="inline">git branch</code> readable
            and makes bulk cleanup a single glob. Teams that require ticket prefixes can set something like{" "}
            <code className="inline">"feature/{"{slug}"}"</code> instead.
          </p>
        </section>

        <section id="state">
          <h2><span className="anchor">#</span>Worktree state</h2>
          <p>
            <code className="inline">.deepseek/worktree-state.json</code> tracks one active worktree and a
            history of previous ones:
          </p>
          <CodeBlock lang="json">{`{
  "active": {
    "name": "swift-fox",
    "path": "/home/you/proj/.deepseek/worktrees/swift-fox",
    "originalCwd": "/home/you/proj",
    "createdAt": "2026-08-11T14:02:11.000Z",
    "isGitWorktree": true,
    "branch": "deepseek/swift-fox-a91c3f",
    "sessionId": "9f2a1c4b"
  },
  "history": [ /* previously active worktrees */ ]
}`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Field</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {INFO_FIELDS.map(([f, m]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Entering a new worktree pushes the current one onto <code className="inline">history</code> rather
            than discarding it. The state is <b>bookkeeping, not truth</b> — a missing or corrupt file falls
            back to an empty state, and <code className="inline">/worktree list</code> reads the actual
            directory rather than the file. Delete it if it gets out of sync.
          </p>
          <Note>
            This file is runtime state. Add it to <code className="inline">.gitignore</code> along with{" "}
            <code className="inline">.deepseek/worktrees/</code>.
          </Note>
        </section>

        <section id="safety">
          <h2><span className="anchor">#</span>Four safety rails</h2>
          <p>
            Worktree operations create and delete directories, so every entry point is guarded:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Rail</th><th style={{ width: "24%" }}>Mechanism</th><th>What it prevents</th></tr>
              </thead>
              <tbody>
                {RAILS.map(([r, m, p]) => (
                  <tr key={r}>
                    <td><b style={{ color: "var(--text-strong)" }}>{r}</b></td>
                    <td><code className="inline">{m}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Path containment is checked <b>twice</b> on removal: once on the recorded path, and once on its{" "}
            <code className="inline">realpath</code>. That second check exists because a symlink placed inside
            the worktrees directory could otherwise point anywhere on disk, and the removal would follow it.
          </p>
          <CodeBlock lang="text">{`> /worktree exit
Error: Worktree "swift-fox" has uncommitted changes and was preserved.`}</CodeBlock>
          <p>
            The dirty-tree refusal is the rail you will meet most often, and it is not overridable by a flag.
            Commit, stash, or exit with <code className="inline">keep</code> — but the tool will not delete
            work you have not saved anywhere.
          </p>
        </section>

        <section id="nofallback">
          <h2><span className="anchor">#</span>No copied-workspace fallback</h2>
          <p>
            If the project is not a git repository, creation fails immediately:
          </p>
          <CodeBlock lang="text">{`Git worktrees are unavailable. Refusing an unsafe copied-workspace fallback.`}</CodeBlock>
          <p>
            An earlier design copied the workspace when git was unavailable. That was removed, and the
            refusal is deliberate. A copied directory looks like a worktree but has none of its guarantees:
            no branch, no shared history, no <code className="inline">git status</code> to detect uncommitted
            work before deletion, and no way to merge the result back. Silently degrading to a copy would
            mean the safety rails above stop being enforced exactly when someone believes they are.
          </p>
          <p>
            Worktrees created by that old path are still recognized and are explicitly{" "}
            <b>never deleted automatically</b>:
          </p>
          <CodeBlock lang="text">{`Legacy copied worktree "bold-owl" was preserved; remove it manually after inspection.`}</CodeBlock>
          <p>
            When git worktrees are genuinely unavailable, the orchestrator falls back to a{" "}
            <b>filesystem lease</b> keyed on the canonical project root — serialized single-writer access
            rather than parallel isolation. See <a href="/docs/agent-teams">Agent teams</a>.
          </p>
        </section>

        <section id="orchestrator">
          <h2><span className="anchor">#</span>Worktrees in the orchestrator</h2>
          <p>
            The orchestrator uses the same Git mechanism but not the interactive state file or branch naming
            flow above. When isolation is available, a writer worker gets a task-owned detached worktree
            under <code className="inline">.deepseek/worktrees/</code>; otherwise it falls back to a serialized
            writer workspace.
          </p>
          <p>
            The consequence for permissions is concrete: a writer's shell access is writable{" "}
            <b>only inside its worktree</b>. In the serialized lease fallback, shell is denied entirely and
            only path-validated file tools may write. Isolation is not advisory here — it is what the
            permission profile is defined against.
          </p>
          <p>
            Task-worktree cleanup is an orchestration operation, not <code className="inline">/worktree exit</code>.
            It has its own integration and preservation rules, so do not assume interactive worktree state
            describes worker workspaces.
          </p>
        </section>

        <section id="workflow">
          <h2><span className="anchor">#</span>A typical session</h2>
          <CodeBlock lang="bash">{`# 1. isolate before a risky refactor
> /worktree create
Created worktree "keen-hawk" on branch deepseek/keen-hawk-2b7e04

# 2. work normally — every edit lands in the worktree
> refactor the auth module to use the new token store

# 3a. it worked: commit and merge from the project root
> /worktree exit keep
$ git merge deepseek/keen-hawk-2b7e04

# 3b. it did not: discard everything
$ git -C .deepseek/worktrees/keen-hawk reset --hard
> /worktree exit
Worktree "keen-hawk" removed.`}</CodeBlock>
          <p>
            Step 3b is the point of the whole feature. There is no partial state to reason about and no undo
            stack to replay — the experiment simply stops existing.
          </p>
        </section>

        <section id="cleanup">
          <h2><span className="anchor">#</span>Cleanup & recovery</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "38%" }}>Situation</th><th>Fix</th></tr>
              </thead>
              <tbody>
                {RECOVERY.map(([s, f]) => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td>{f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`# what git actually knows about
git worktree list

# clean up administrative entries for directories that are gone
git worktree prune

# remove every generated branch after merging
git branch --list 'deepseek/*' | xargs -r git branch -D`}</CodeBlock>
          <Note>
            Never remove a worktree with <code className="inline">rm -rf</code>. Git keeps administrative files
            in <code className="inline">.git/worktrees/</code> that survive the directory, and{" "}
            <code className="inline">git worktree prune</code> is the only thing that cleans them up.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
