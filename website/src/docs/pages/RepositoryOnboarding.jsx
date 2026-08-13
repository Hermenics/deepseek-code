import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "start", label: "Start in the intended root" },
  { id: "preflight", label: "Preflight checks" },
  { id: "instructions", label: "Instruction files" },
  { id: "settings", label: "Project settings and state" },
  { id: "first-prompt", label: "Your first prompt" },
  { id: "explore", label: "Read-only repository tour" },
  { id: "dirty", label: "Existing and uncommitted work" },
  { id: "scope", label: "File scope and outside paths" },
  { id: "git", label: "Git and worktree policy" },
  { id: "verification", label: "Teach the finish line" },
  { id: "generated", label: "Generated and sensitive paths" },
  { id: "monorepo", label: "Monorepo onboarding" },
  { id: "cwd", label: "Changing repositories with /cwd" },
  { id: "session", label: "Sessions and resume" },
  { id: "checklist", label: "Onboarding checklist" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const ROOT_SURFACES = [
  ["Instructions", "AGENTS.md, DEEPSEEK.md and .deepseek/steering/*.md"],
  ["Settings", ".deepseek/settings.json and .deepseek/settings.local.json"],
  ["Extensions", ".deepseek/agents, skills, workflows and mcp.json"],
  ["Durable project context", "Project-scoped memory and DeepSeek knowledge"],
  ["Sessions", "Workspace identity and project-specific resume choices"],
  ["Safety", "Default containment boundary for file tools and task workspaces"],
  ["Git automation", "Interactive worktree root and detected verification command"],
];

const INSTRUCTION_FILES = [
  ["AGENTS.md", "Root only", "Interoperable repository rules shared with coding agents."],
  ["DEEPSEEK.md", "Root", "DeepSeek-specific durable knowledge and constraints."],
  [".deepseek/DEEPSEEK.md", "Root state directory", "Additional DeepSeek-specific project knowledge."],
  [".deepseek/steering/*.md", "Direct Markdown children", "Split architecture, conventions and review guidance."],
];

const TROUBLE = [
  ["Project instructions are missing", "Run /cwd and confirm the selected directory. Instruction lookup does not walk upward."],
  ["The agent sees the wrong settings", "Use /config diagnostics to inspect effective values and origins at user, project and local scope."],
  ["A first Build turn asks about a worktree", "git.worktree defaults to ask. Choose isolation, switch policy to off/auto, or start in Review mode."],
  ["The repository is not recognized for worktrees", "Launch from its top-level directory; interactive detection expects the selected root to contain .git."],
  ["A file outside the root is blocked", "Move the project boundary with /cwd or explicitly approve the narrow external directory when prompted."],
  ["Resume picker is empty", "Run it from the exact saved project root; project session identity includes the resolved path."],
  ["Verification is not detected", "Expose an existing test script, Cargo.toml or go.mod at the selected root, or ask for the real command explicitly."],
];

export default function RepositoryOnboarding() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Get Started</span><span className="sep">/</span><span className="current">Repository onboarding</span>
        </nav>

        <div className="hero">
          <h1>Onboard a repository</h1>
          <p className="tagline">Give DeepSeek Code the right boundary, trustworthy project rules and a verifiable first task.</p>
        </div>

        <section id="start">
          <h2><span className="anchor">#</span>Start in the intended root</h2>
          <p>
            DeepSeek Code uses the current working directory as the project root. Change into the repository
            before launching; there is no separate startup flag that replaces this boundary.
          </p>
          <CodeBlock lang="bash">{"$ cd ~/work/acme-api\n$ git status --short --branch\n## feature/token-refresh\n$ deepseek"}</CodeBlock>
          <p>Starting at the root affects much more than relative paths:</p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "28%" }}>Surface</th><th>Resolved from the selected root</th></tr></thead>
            <tbody>{ROOT_SURFACES.map(([surface, resolved]) => <tr key={surface}><td><b>{surface}</b></td><td>{resolved}</td></tr>)}</tbody>
          </table></div>
          <Note>
            Git commands can often discover a repository from a nested directory. DeepSeek Code's configuration,
            instruction and safety boundary does not automatically expand to Git's top level.
          </Note>
        </section>

        <section id="preflight">
          <h2><span className="anchor">#</span>Preflight checks</h2>
          <p>
            Run <code className="inline">deepseek doctor</code> when onboarding a new machine or when repository
            operations fail unexpectedly. It checks Bun, the workspace, Git, search support, credentials, settings
            and MCP configuration without contacting an AI provider.
          </p>
          <CodeBlock lang="bash">{"$ deepseek doctor\nDeepSeek Code doctor · /home/you/work/acme-api\n\n✓ Runtime: Bun 1.x\n✓ Workspace: /home/you/work/acme-api\n✓ Git: available\n✓ ripgrep: available\n✓ Credentials: configured\n✓ Settings: provider: deepseek\n✓ MCP config: none configured\n\nEverything looks ready."}</CodeBlock>
          <p>
            Before the first edit, inspect the repository's own prerequisites: runtime version, package manager,
            bootstrap command, required services and current branch. DeepSeek Code does not install dependencies
            merely because a test command needs them.
          </p>
        </section>

        <section id="instructions">
          <h2><span className="anchor">#</span>Instruction files</h2>
          <p>
            Read the repository's checked-in instruction files yourself before trusting an autonomous Build or
            Auto turn. They become persistent model context and can constrain commands, file ownership and the
            definition of done.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "28%" }}>File</th><th style={{ width: "23%" }}>Lookup</th><th>Purpose</th></tr></thead>
            <tbody>{INSTRUCTION_FILES.map(([file, lookup, purpose]) => (
              <tr key={file}><td><code className="inline">{file}</code></td><td>{lookup}</td><td>{purpose}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            Put commands, architecture boundaries, generated paths, test location and non-obvious constraints in
            these files. Avoid copying source code or broad README material into permanent context. A path to the
            canonical reference is cheaper and less likely to become stale.
          </p>
          <CodeBlock lang="text">{"# AGENTS.md\n\n## Commands\n- bun test tests/auth.test.ts — focused auth tests\n- bun run typecheck — repository typecheck\n\n## Boundaries\n- Tests live in tests/, never src/\n- src/generated/ is produced by bun run generate; do not edit it\n- Preserve any pre-existing dirty changes"}</CodeBlock>
          <p>
            Instruction files load when the agent runtime initializes. Starting a new session is the clearest way
            to apply edits. <code className="inline">/cwd</code> also initializes the runtime for its new root.
          </p>
        </section>

        <section id="settings">
          <h2><span className="anchor">#</span>Project settings and state</h2>
          <p>
            Settings merge from user, project and local scopes. Use
            <code className="inline">.deepseek/settings.json</code> for team-visible behavior and
            <code className="inline">.deepseek/settings.local.json</code> for machine-specific overrides that
            should stay uncommitted. User settings live under <code className="inline">~/.deepseek/</code>.
          </p>
          <CodeBlock lang="json">{"{\n  \"interaction\": { \"defaultMode\": \"build\" },\n  \"git\": {\n    \"worktree\": \"ask\",\n    \"reviewDiff\": true,\n    \"verifyAfterEdit\": true,\n    \"generatedPatterns\": [\"*src/generated/*\"]\n  },\n  \"sessions\": { \"autoResume\": \"off\", \"retention\": 50 }\n}"}</CodeBlock>
          <p>
            Run <code className="inline">/config</code> for the Settings center and its diagnostics view. It shows
            effective values, their origin, validation problems and unknown keys. Never put provider credentials
            or private tokens in project settings.
          </p>
          <Note>
            Not every <code className="inline">.deepseek/</code> artifact should be committed. Decide explicitly
            which team configuration belongs in version control and ignore sessions, exports, local settings,
            worktrees and other runtime state.
          </Note>
        </section>

        <section id="first-prompt">
          <h2><span className="anchor">#</span>Your first prompt</h2>
          <p>
            A strong first prompt names the desired result, likely area, constraints, non-goals and evidence that
            proves completion. It should also make clear whether the first turn is exploratory or allowed to edit.
          </p>
          <CodeBlock lang="text">{"First, inspect this repository without editing.\nMap the authentication request path, its tests and the commands that verify it.\nPreserve all existing changes. The eventual task is to stop duplicate refresh requests,\nbut do not implement until you can explain the root cause with file and line evidence.\nNon-goals: no dependency upgrades and no public API redesign."}</CodeBlock>
          <p>
            Add exact error output, a failing test name or a known path when available. Label your theory as a
            hypothesis; otherwise it can anchor discovery on the wrong module.
          </p>
        </section>

        <section id="explore">
          <h2><span className="anchor">#</span>Read-only repository tour</h2>
          <p>
            Review mode is the safest onboarding pass. It permits file search and reads, LSP, web fetch, status,
            diff and log, while blocking file edits and mutating Git actions. Plan mode adds a dedicated plan file
            and approval flow when the task needs an implementation proposal.
          </p>
          <CodeBlock lang="text">{"In Review mode:\n- summarize top-level architecture\n- identify runtime entry points and package boundaries\n- locate the closest tests for the target behavior\n- inspect status, current diff and recent relevant history\n- list unknowns that require evidence\nDo not propose broad cleanup."}</CodeBlock>
          <p>
            Ask for a bounded map, not a full repository dump. In a large project, combine directory orientation,
            path patterns, content search, semantic references and numbered file ranges.
          </p>
        </section>

        <section id="dirty">
          <h2><span className="anchor">#</span>Existing and uncommitted work</h2>
          <p>
            A repository can be dirty before DeepSeek Code starts. Those changes belong to you unless explicitly
            assigned otherwise. The agent should inspect them, preserve unrelated hunks and avoid reset, restore,
            checkout or cleanup operations that discard work.
          </p>
          <CodeBlock lang="text">{"The checkout already contains work in src/payments/ and bun.lock.\nThose changes are mine and out of scope. Do not modify, stage, stash, revert or format them.\nYou own src/auth/ and tests/auth/ only. Report any required overlap before editing."}</CodeBlock>
          <p>
            Repeat ownership when delegating parallel writers. Worktree isolation prevents filesystem collision,
            but integration can still conflict with parent changes in the same path.
          </p>
        </section>

        <section id="scope">
          <h2><span className="anchor">#</span>File scope and outside paths</h2>
          <p>
            Relative file operations resolve inside the active workspace. Existing absolute paths beneath the
            project root are translated into a task's isolated worktree when needed. Paths outside the workspace
            require a narrow interactive approval; approving one directory does not approve its siblings.
          </p>
          <p>
            Canonical paths are checked so symlinks cannot silently escape the approved boundary. Protected state,
            source-control internals, dependency directories and recognized secret files remain inaccessible even
            through an approved external directory.
          </p>
          <Note>
            If a task genuinely spans two repositories, changing the project root or running separate sessions is
            clearer than repeatedly approving broad external paths.
          </Note>
        </section>

        <section id="git">
          <h2><span className="anchor">#</span>Git and worktree policy</h2>
          <p>
            <code className="inline">git.worktree</code> defaults to <code className="inline">ask</code>. Before
            the first mutating Build or Auto turn in a Git repository, DeepSeek Code can ask whether to create an
            isolated worktree. Use <code className="inline">auto</code> for routine isolation or
            <code className="inline">off</code> when you intentionally want the active checkout.
          </p>
          <CodeBlock lang="json">{"{\n  \"git\": {\n    \"worktree\": \"ask\",\n    \"branchPattern\": \"deepseek/{slug}-{shortId}\"\n  }\n}"}</CodeBlock>
          <p>
            Interactive worktree detection expects the selected root itself to be a Git repository. Launching from
            an arbitrary nested directory can still make normal Git commands work, but it weakens automatic
            isolation. See <a href="/docs/git-integration">Git integration</a> and{" "}
            <a href="/docs/worktrees">Worktrees</a>.
          </p>
        </section>

        <section id="verification">
          <h2><span className="anchor">#</span>Teach the finish line</h2>
          <p>
            DeepSeek Code can detect one existing verification command: a package test script using the lockfile's
            package manager, <code className="inline">cargo test</code>, or <code className="inline">go test ./...</code>.
            It never guesses a test framework for an unconfigured repository.
          </p>
          <p>
            Put canonical commands in instructions and name the proportional check in each prompt. Separate fast
            feedback from full-suite confidence.
          </p>
          <CodeBlock lang="text">{"Definition of done:\n- add one regression test that fails before the fix\n- run: bun test tests/auth/session.test.ts\n- run: bun run typecheck\n- review the final diff and list any check not run\nDo not install packages or weaken assertions to get green."}</CodeBlock>
          <p>
            With <code className="inline">git.verifyAfterEdit</code> enabled, the CLI offers its detected command
            after a mutating turn. The prompt is still the place to specify a more focused or domain-specific check.
          </p>
        </section>

        <section id="generated">
          <h2><span className="anchor">#</span>Generated and sensitive paths</h2>
          <p>
            Tell DeepSeek Code which source files generate artifacts and which command owns regeneration. Add
            generated patterns only when you deliberately want those edits excluded from modified-file tracking,
            automatic file checkpoints, end-of-turn diff review and post-edit verification.
          </p>
          <p>
            Recognized secrets such as environment files, private keys, credential files and service-account
            material are blocked from agent file tools. Keep secrets in the credential store or provider-native
            mechanism, never in instructions, prompts or tracked source.
          </p>
        </section>

        <section id="monorepo">
          <h2><span className="anchor">#</span>Monorepo onboarding</h2>
          <p>
            Root onboarding should explain package ownership, dependency direction, shared contracts, generated
            packages and which commands run from which directory. Do not preload every package's details into root
            instructions; provide a routing map and let the agent read the owning package on demand.
          </p>
          <CodeBlock lang="text">{"Repository map:\n- apps/web depends on packages/ui and packages/contracts\n- services/api owns schema generation\n- packages/contracts is generated; edit schema/ instead\n- package tests run from each package\n- root bun test is the cross-package release gate"}</CodeBlock>
          <p>
            For a local task, start at the package root only if it has all needed instructions, settings and
            verification markers. For a cross-package change, use the monorepo root and narrow searches by path.
            See <a href="/docs/large-codebases">Large codebases</a>.
          </p>
        </section>

        <section id="cwd">
          <h2><span className="anchor">#</span>Changing repositories with /cwd</h2>
          <p>
            <code className="inline">/cwd</code> shows or changes the active working directory. It expands a
            leading tilde, resolves the path, confirms it is an accessible directory, rebases the orchestrator and
            reloads project context.
          </p>
          <CodeBlock lang="bash">{"> /cwd ~/work/another-repo\ncwd: /home/you/work/another-repo"}</CodeBlock>
          <p>
            The change is refused while a workflow or delegated task is active, or while an isolated task workspace
            remains tied to the old root. Finish, cancel and clean up that work first. After a successful change,
            custom agents are re-evaluated for the new project and an unavailable active agent is not carried over.
          </p>
          <Note>
            For unrelated repositories, a new terminal session creates a cleaner transcript and resume history.
            Use <code className="inline">/cwd</code> when continuity is genuinely useful.
          </Note>
        </section>

        <section id="session">
          <h2><span className="anchor">#</span>Sessions and resume</h2>
          <p>
            Sessions are partitioned by a readable project name plus a short hash of the exact resolved path. Run
            <code className="inline">deepseek --resume</code> from the same root to open its picker, or resume a
            known project session directly with its 12-character ID.
          </p>
          <CodeBlock lang="bash">{"$ cd ~/work/acme-api\n$ deepseek --resume\n\n# or\n$ deepseek --resume a1b2c3d4e5f6"}</CodeBlock>
          <p>
            Set <code className="inline">sessions.autoResume</code> to
            <code className="inline">project-last</code> only when automatically reopening the latest conversation
            is desirable. Keep it off when separate tasks should start with clean context.
          </p>
        </section>

        <section id="checklist">
          <h2><span className="anchor">#</span>Onboarding checklist</h2>
          <CodeBlock lang="text">{"1. Select the intended repository or package root.\n2. Run deepseek doctor and inspect git status.\n3. Review AGENTS.md, DEEPSEEK.md and steering files.\n4. Inspect effective project and local settings.\n5. Identify generated, secret and user-owned dirty paths.\n6. Map entry points, package boundaries and the target tests in Review mode.\n7. State file ownership, non-goals and the verification command.\n8. Choose worktree policy before the first mutation.\n9. Review the final Git diff before any commit or push."}</CodeBlock>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "33%" }}>Symptom</th><th>Resolution</th></tr></thead>
            <tbody>{TROUBLE.map(([symptom, resolution]) => <tr key={symptom}><td><b>{symptom}</b></td><td>{resolution}</td></tr>)}</tbody>
          </table></div>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
