import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "scope", label: "Repository and workspace scope" },
  { id: "actions", label: "Supported Git actions" },
  { id: "inspect", label: "Inspecting changes and history" },
  { id: "stage", label: "Staging and committing" },
  { id: "branches", label: "Branches and stashes" },
  { id: "remotes", label: "Pulling and pushing" },
  { id: "modes", label: "Modes, permissions and risk" },
  { id: "worktrees", label: "Git worktrees" },
  { id: "dirty", label: "Working with existing changes" },
  { id: "limits", label: "Boundaries and limitations" },
  { id: "recipes", label: "Prompt recipes" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const ACTIONS = [
  ["status", "Read-only", "Short branch and working-tree status."],
  ["diff", "Read-only", "Unstaged diff, staged diff, or one path."],
  ["log", "Read-only", "Decorated one-line commit history; 20 entries by default."],
  ["add", "Local mutation", "Stage an explicit list of paths, including . when requested."],
  ["commit", "Local mutation", "Create one commit with the supplied message."],
  ["branch", "Local mutation", "List all branches, create and switch, or switch to an existing branch."],
  ["stash", "Local mutation", "Create a normal stash or pop the latest stash."],
  ["pull", "Remote mutation", "Run the repository's configured pull behavior."],
  ["push", "Remote mutation", "Push the current branch and establish its origin upstream when absent."],
];

const MODE_MATRIX = [
  ["Review", "status, diff, log", "Every mutating Git action is blocked."],
  ["Plan", "status, diff, log", "Planning can inspect the repository but cannot change it."],
  ["Build", "All structured actions", "The request, permission rules and risk confirmation still apply."],
  ["Auto", "All structured actions", "Risk rules, hooks and explicit-authority boundaries still apply."],
];

const TROUBLE = [
  ["Not a git repository", "Confirm /cwd points inside a repository. For worktree isolation, launch from the repository root."],
  ["No changes", "The selected diff may be empty: check whether the change is staged, unstaged, untracked, or in another worktree."],
  ["Commit failed", "Read the Git output. Common causes are an empty index, missing identity, or a failing commit hook."],
  ["Push chose origin", "A branch without an upstream is published to origin and linked to that remote branch. Configure or push manually if your remote is named differently."],
  ["Force push was rejected", "DeepSeek Code uses force-with-lease. Fetch and inspect the remote update instead of replacing unseen work."],
  ["Branch name rejected", "Use a valid Git branch name; names are checked before checkout."],
];

export default function GitIntegration() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Git integration</span>
        </nav>

        <div className="hero">
          <h1>Git integration</h1>
          <p className="tagline">Inspect, stage, commit and publish changes without losing sight of the active checkout.</p>
        </div>

        <section id="scope">
          <h2><span className="anchor">#</span>Repository and workspace scope</h2>
          <p>
            Git operations run in DeepSeek Code's <b>active working directory</b>. That may be the directory
            where you launched the CLI, a directory selected with <code className="inline">/cwd</code>, an
            interactive worktree, or a task-specific worktree owned by a delegated writer. The operation never
            silently jumps back to the original checkout.
          </p>
          <CodeBlock lang="bash">{"$ cd ~/projects/acme-api\n$ deepseek\n\n> /cwd\ncwd: /home/you/projects/acme-api"}</CodeBlock>
          <p>
            Launch from the repository root when you want root-scoped settings, instructions, sessions and
            worktree behavior. Git itself can discover an ancestor repository from a subdirectory, but
            DeepSeek Code treats the selected directory as the project boundary for files and configuration.
          </p>
          <Note>
            A repository being accessible does not authorize changing it. DeepSeek Code must still have an
            explicit request before it commits, switches branches, stashes, pulls or pushes.
          </Note>
        </section>

        <section id="actions">
          <h2><span className="anchor">#</span>Supported Git actions</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "17%" }}>Action</th><th style={{ width: "20%" }}>Class</th><th>Behavior</th></tr></thead>
            <tbody>{ACTIONS.map(([action, kind, behavior]) => (
              <tr key={action}><td><code className="inline">{action}</code></td><td>{kind}</td><td>{behavior}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            These are the actions available through the structured Git tool. They cover the routine agent
            workflow while keeping arguments separate from shell syntax. More specialized operations such as
            merge, rebase, tag and cherry-pick are not structured actions.
          </p>
        </section>

        <section id="inspect">
          <h2><span className="anchor">#</span>Inspecting changes and history</h2>
          <p>
            Status is compact but branch-aware. It reports the current branch, upstream relationship and
            porcelain-style path states. Ask for both staged and unstaged diffs when reviewing a mixed index;
            the two are separate views in Git.
          </p>
          <CodeBlock lang="text">{"Inspect the repository without changing it.\nShow branch status, the unstaged diff, the staged diff, and the last 8 commits.\nCall out untracked files separately."}</CodeBlock>
          <p>
            A path-specific diff is useful in a large change because it avoids spending context on unrelated
            files. The path is passed after Git's argument separator, so a filename beginning with a dash is
            treated as a path rather than an option.
          </p>
          <CodeBlock lang="text">{"Review only src/auth/session.ts.\nCompare its unstaged and staged changes and explain the behavioral difference.\nDo not edit, stage, or commit anything."}</CodeBlock>
          <Note>
            A normal diff does not include the contents of untracked files. Ask DeepSeek Code to list and read
            those files explicitly, or enable end-of-turn diff review for mutations created in the session.
          </Note>
        </section>

        <section id="stage">
          <h2><span className="anchor">#</span>Staging and committing</h2>
          <p>
            Staging accepts an explicit path list. Prefer naming the files that belong to the task; staging
            <code className="inline">.</code> also includes unrelated changes below the current directory.
            DeepSeek Code does not infer that every dirty file belongs in the same commit.
          </p>
          <CodeBlock lang="text">{"Stage only src/auth/session.ts and tests/session.test.ts.\nShow me the staged diff. If it contains anything outside the refresh-token fix, stop.\nThen commit with: fix(auth): serialize token refresh"}</CodeBlock>
          <p>
            Commit uses the message you supplied and lets the repository's normal Git configuration and hooks
            run. A hook failure is returned as an error; it is not bypassed. An empty index also stays empty —
            the tool does not manufacture a commit or automatically stage files first.
          </p>
          <Note>
            Ask for a commit only after reviewing the final diff and verification output. Permission to edit
            files is not permission to create a commit, and permission to commit is not permission to push.
          </Note>
        </section>

        <section id="branches">
          <h2><span className="anchor">#</span>Branches and stashes</h2>
          <p>
            With no branch sub-action, DeepSeek Code lists local and remote branches. Creating a branch uses a
            validated Git ref name and switches to it. Switching an existing branch also validates the name
            before checkout, preventing option-like input from being interpreted as a command flag.
          </p>
          <CodeBlock lang="text">{"Create and switch to feature/session-timeout.\nBefore switching, show status and stop if the current changes could be carried accidentally."}</CodeBlock>
          <p>
            Stash uses Git's ordinary stash behavior; it does not automatically include untracked files. Pop
            applies the latest stash and may report conflicts. Treat a stash as a reversible local operation,
            not as storage or a replacement for a named commit.
          </p>
        </section>

        <section id="remotes">
          <h2><span className="anchor">#</span>Pulling and pushing</h2>
          <p>
            Pull delegates reconciliation strategy to the repository's Git configuration. Push uses the
            current branch. If that branch has no upstream, DeepSeek Code publishes it to a branch of the same
            name on <code className="inline">origin</code> and records that upstream.
          </p>
          <p>
            A requested force push is implemented as <code className="inline">--force-with-lease</code>, not
            unconditional <code className="inline">--force</code>. The lease refuses to overwrite remote work
            that your local tracking ref has not seen. It is still destructive and always requires explicit
            confirmation.
          </p>
          <CodeBlock lang="text">{"Push the current branch only.\nFirst show its upstream and commits not yet on the remote.\nDo not force push. Stop if the branch is main or master."}</CodeBlock>
          <Note>
            Pull and push are remote mutations and are classified as high risk. They require confirmation even
            when ordinary low-risk tools have been auto-approved.
          </Note>
        </section>

        <section id="modes">
          <h2><span className="anchor">#</span>Modes, permissions and risk</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "17%" }}>Mode</th><th style={{ width: "30%" }}>Git surface</th><th>Additional boundary</th></tr></thead>
            <tbody>{MODE_MATRIX.map(([mode, surface, boundary]) => (
              <tr key={mode}><td><b>{mode}</b></td><td>{surface}</td><td>{boundary}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            Permission allow and deny rules apply after the mode gate, and deny wins. Pre-tool hooks may also
            block or rewrite an operation before authorization evaluates the final arguments. Use
            <code className="inline">/permissions</code> when a Git action is refused; it explains the active
            mode, matching rules, risk decision and session approvals.
          </p>
          <p>
            Review and Plan modes are ideal for repository archaeology because the runtime permits only
            status, diff and log. A prompt cannot persuade those modes to stage, commit, switch, stash, pull or
            push through the structured Git tool.
          </p>
        </section>

        <section id="worktrees">
          <h2><span className="anchor">#</span>Git worktrees</h2>
          <p>
            The Git tool operates <em>inside</em> whichever checkout is active; it does not itself create the
            isolated worktree used by an interactive turn or delegated writer. Worktree lifecycle belongs to
            <code className="inline">/worktree</code> and the orchestration layer.
          </p>
          <p>
            In an isolated checkout, status, add and commit affect that checkout's branch. A task writer may
            instead produce an uncommitted patch that the coordinator checks and integrates into the parent.
            Confirm the path displayed in the header or run <code className="inline">/cwd</code> before assuming
            which tree a Git result describes.
          </p>
          <p>
            See <a href="/docs/worktrees">Worktrees</a> for interactive lifecycle and{" "}
            <a href="/docs/parallel-tasks">Parallel tasks</a> for isolated writer integration.
          </p>
        </section>

        <section id="dirty">
          <h2><span className="anchor">#</span>Working with existing changes</h2>
          <p>
            A dirty checkout may contain your edits, another tool's output, generated artifacts and changes
            from an earlier session. DeepSeek Code is instructed to preserve them. Give ownership explicitly
            and ask for a path-scoped diff before any edit touches a file that is already modified.
          </p>
          <CodeBlock lang="text">{"There are existing user changes in src/billing/ and package-lock.json.\nPreserve them. You own only src/auth/ and tests/auth/.\nBefore editing an already-dirty owned file, explain how your patch avoids the existing hunks."}</CodeBlock>
          <p>
            Do not use reset, clean, restore or branch switching as cleanup. Use checkpoints for agent-created
            file recovery, worktrees for isolation, and normal commits for durable milestones.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Boundaries and limitations</h2>
          <p>
            The structured tool intentionally has no merge, rebase, reset, restore, clean, tag, cherry-pick,
            remote-management or submodule action. If a task truly needs one, the shell can run normal Git in
            Build or Auto mode, but the same explicit authorization, permission rules and destructive-command
            checks apply.
          </p>
          <p>
            Git output reflects the active filesystem at call time. It is not a transaction across several
            actions: files can change between status, staging and commit. For sensitive changes, request a
            second staged diff immediately before commit and inspect the resulting commit immediately after.
          </p>
        </section>

        <section id="recipes">
          <h2><span className="anchor">#</span>Prompt recipes</h2>
          <CodeBlock lang="text">{"# Read-only repository triage\nInspect status, both diff layers and the last 15 commits.\nSummarize what is mine versus pre-existing. Do not mutate Git state.\n\n# Atomic commit\nVerify the requested tests, stage only the two named paths, review the staged diff,\ncommit with the exact message I supplied, then show the new commit. Do not push.\n\n# Safe publication\nShow the current branch, upstream and outgoing commits. If the branch is protected,\ndetached, behind its upstream or has no clean verification result, stop. Otherwise push normally."}</CodeBlock>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "28%" }}>Symptom</th><th>What to do</th></tr></thead>
            <tbody>{TROUBLE.map(([symptom, action]) => <tr key={symptom}><td><b>{symptom}</b></td><td>{action}</td></tr>)}</tbody>
          </table></div>
          <p>
            Run <code className="inline">deepseek doctor</code> if Git itself is missing. For a permission
            refusal, use <code className="inline">/permissions</code>; for the wrong checkout, use
            <code className="inline">/cwd</code>; for worktree state, use <code className="inline">/worktree</code>.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
