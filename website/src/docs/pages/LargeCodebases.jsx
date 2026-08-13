import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "root", label: "Choose the right project root" },
  { id: "map", label: "Build a map before editing" },
  { id: "search", label: "Choose the right search tool" },
  { id: "mentions", label: "File mentions with @" },
  { id: "grep", label: "Content search" },
  { id: "glob", label: "Path discovery" },
  { id: "folders", label: "Directory orientation" },
  { id: "reading", label: "Reading large files" },
  { id: "lsp", label: "Semantic navigation with LSP" },
  { id: "monorepo", label: "Monorepos and /cwd" },
  { id: "instructions", label: "Repository instructions" },
  { id: "agents", label: "Focused agent context" },
  { id: "context", label: "Protect the context window" },
  { id: "verification", label: "Verification at scale" },
  { id: "limits", label: "Built-in limits" },
  { id: "playbook", label: "Large-repository playbook" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const SEARCH_TOOLS = [
  ["@file", "You know part of a path", "Insert one relative path into the prompt."],
  ["grep", "You know text, an error, symbol or pattern", "Search file contents with a regular expression."],
  ["glob", "You know a filename or extension pattern", "Find candidate paths without reading their contents."],
  ["read_folder", "You need local structure", "List one directory, optionally recursively."],
  ["read_file", "You know the exact file", "Read numbered lines, preferably a bounded range."],
  ["lsp", "You need definitions or references", "Ask a configured language server for semantic results."],
  ["git", "You need change history or ownership clues", "Inspect status, diffs and recent commits."],
];

const LIMITS = [
  ["@ suggestions", "8 files", "Interactive completion only; shortest matching paths come first."],
  ["grep results", "200 lines", "The result reports when additional matches were omitted."],
  ["glob results", "500 files", "Narrow the pattern when the result is truncated."],
  ["recursive folder list", "1,000 entries / depth 5", "Unreadable directories are marked and skipped."],
  ["default file read", "200 lines", "Continue with explicit start and end line numbers."],
  ["shell output", "50,000 characters", "Prefer a narrow command instead of relying on truncation."],
  ["custom-agent file context", "50,000 characters total", "Patterns share one budget across all injected files."],
];

const TROUBLE = [
  ["A search is truncated", "Restrict its directory, include glob, filename pattern or symbol. Do not repeat the same broad search."],
  ["@ cannot find a dotfile", "The interactive picker omits dotfiles. Name the path directly or use a targeted tool search when permitted."],
  ["A dependency directory is absent", "Heavy and protected directories are intentionally excluded. Work from manifests, lockfiles and public types instead."],
  ["The wrong AGENTS.md loaded", "Only the selected project root is checked. Start or /cwd into the directory whose instructions should govern."],
  ["LSP returns unavailable", "Configure a matching server and extension, or fall back to grep plus targeted reads."],
  ["/verify chose a broad command", "Ask for the package-specific command explicitly, then run the root command only when its coverage is needed."],
];

export default function LargeCodebases() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Large codebases</span>
        </nav>

        <div className="hero">
          <h1>Working in large codebases</h1>
          <p className="tagline">Navigate monorepos and mature systems without turning the context window into a filesystem dump.</p>
        </div>

        <section id="root">
          <h2><span className="anchor">#</span>Choose the right project root</h2>
          <p>
            DeepSeek Code treats its working directory as a security and configuration boundary. Project and
            local settings, instructions, MCP configuration, agents, skills, workflows, memory, session grouping,
            verification detection and file-tool paths are all resolved from that directory.
          </p>
          <CodeBlock lang="bash">{"# Whole-repository work\ncd ~/work/platform\ndeepseek\n\n# One package as the boundary\ncd ~/work/platform/services/billing\ndeepseek"}</CodeBlock>
          <p>
            Use the repository root when a change crosses packages or needs root Git/worktree behavior. Use a
            package root when the task is truly local and the package has its own commands and instructions.
            Starting in a nested directory does not automatically inherit instruction files from ancestors.
          </p>
          <Note>
            Git can discover an ancestor repository from a nested directory, but DeepSeek Code does not treat
            that ancestor as the project root automatically.
          </Note>
        </section>

        <section id="map">
          <h2><span className="anchor">#</span>Build a map before editing</h2>
          <p>
            Start with a bounded reconnaissance pass: top-level directories, language manifests, instruction
            files, entry points, relevant tests and the current Git state. Then follow the specific execution
            path behind the task. A complete repository inventory is rarely necessary.
          </p>
          <CodeBlock lang="text">{"Map this repository before editing.\nIdentify its packages, runtime entry points, test boundaries, generated directories,\nroot instructions and the files involved in request authentication.\nUse targeted searches; do not recursively dump dependencies or build output.\nReturn a short map and the evidence for the likely change path."}</CodeBlock>
          <p>
            Ask for callers, state transitions and tests rather than “read the whole codebase.” The former has a
            stopping condition. The latter spends tokens on files that will never influence the decision.
          </p>
        </section>

        <section id="search">
          <h2><span className="anchor">#</span>Choose the right search tool</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "18%" }}>Tool</th><th style={{ width: "31%" }}>Use it when</th><th>Result</th></tr></thead>
            <tbody>{SEARCH_TOOLS.map(([tool, when, result]) => (
              <tr key={tool}><td><code className="inline">{tool}</code></td><td>{when}</td><td>{result}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            Use the cheapest tool that can answer the question. Path discovery before content search, content
            search before file reads, and line ranges before whole-file reads keep both latency and context use
            predictable.
          </p>
        </section>

        <section id="mentions">
          <h2><span className="anchor">#</span>File mentions with @</h2>
          <p>
            Type <code className="inline">@</code> followed by part of a path to open file suggestions. Matching
            is case-insensitive and fuzzy by default: the query characters only need to appear in order. Results
            are sorted by path length and capped at eight. Tab or Enter accepts the selected path.
          </p>
          <CodeBlock lang="text">{"Explain how @src/auth/session.ts handles refresh failure.\nCompare it with @tests/auth/session.test.ts and identify uncovered branches."}</CodeBlock>
          <p>
            The mention inserts a relative path into the prompt; it does not blindly paste the file contents.
            This gives the agent an exact target while leaving it free to read only the lines it needs.
          </p>
          <p>
            Suggestions exclude dependency, Git, build, coverage, framework-output and DeepSeek state
            directories, as well as lockfiles and dotfiles. Disable fuzzy matching with
            <code className="inline">/features fuzzyFileSearch off</code> when substring matching is more
            predictable in a repository with many similarly named files.
          </p>
        </section>

        <section id="grep">
          <h2><span className="anchor">#</span>Content search</h2>
          <p>
            Grep accepts a regular expression, an optional directory and an optional file glob. It searches
            recursively, reports file and line numbers, stops after 15 seconds and returns at most 200 result
            lines. A no-match result is explicit rather than an error.
          </p>
          <CodeBlock lang="text">{"Search services/billing for the exact error text \"invoice already finalized\".\nRestrict the search to *.ts. Then read only the matching function and its direct callers."}</CodeBlock>
          <p>
            Heavy caches, dependency folders, generated output, editor metadata and protected configuration
            directories are excluded. If a broad query truncates, add a package path or file glob. Repeating it
            unchanged produces the same incomplete evidence.
          </p>
          <Note>
            Text matches are not semantic references. A symbol name can appear in comments, tests, generated
            code or an unrelated language. Confirm the actual definition and call path before editing.
          </Note>
        </section>

        <section id="glob">
          <h2><span className="anchor">#</span>Path discovery</h2>
          <p>
            Glob finds paths by pattern and returns up to 500 files. It includes ordinary dot entries when the
            pattern asks for them, but excludes protected state, dependency trees, caches, build products,
            source maps, minified files, lockfiles, logs, common media and archives.
          </p>
          <CodeBlock lang="text">{"Find tests under services/payments whose filename contains webhook.\nThen locate the implementation files with the same basename.\nDo not open every test in the package."}</CodeBlock>
          <p>
            A glob result is a candidate set. Combine it with grep or a semantic query to find the behavior you
            need. In a large monorepo, <code className="inline">services/payments/**/webhook*.test.ts</code> is
            materially better than <code className="inline">**/*test*</code>.
          </p>
        </section>

        <section id="folders">
          <h2><span className="anchor">#</span>Directory orientation</h2>
          <p>
            Directory listing is for structure, not content. Start non-recursively at the project or package
            root. Recursive mode descends at most five levels and stops at 1,000 entries. Permission-denied
            directories are marked instead of aborting the entire listing.
          </p>
          <CodeBlock lang="text">{"List services/payments non-recursively.\nExplain the role of each immediate directory using manifests and nearby README files.\nRecurse only into the directory that owns settlement."}</CodeBlock>
        </section>

        <section id="reading">
          <h2><span className="anchor">#</span>Reading large files</h2>
          <p>
            A default file read returns the first 200 numbered lines and reports the total. Continue with
            explicit one-based, inclusive ranges. Search for a symbol first when you do not know which range
            matters.
          </p>
          <CodeBlock lang="text">{"Read src/router.ts around lines 420–520.\nIf the handler delegates elsewhere, follow only those calls.\nDo not reread the first 200 lines unless they contain required shared state."}</CodeBlock>
          <p>
            Numbered output makes a later edit or reference stable within the current snapshot. If another tool
            changes the file, search again before relying on old line numbers.
          </p>
        </section>

        <section id="lsp">
          <h2><span className="anchor">#</span>Semantic navigation with LSP</h2>
          <p>
            A configured language server can return definitions, references, hover text, document symbols and
            workspace symbols. Use it when text search produces too many homonyms or when imports and aliases
            obscure the call graph.
          </p>
          <p>
            LSP access is read-only and opt-in. The file extension must match a configured user-level server.
            If no server matches or it fails, DeepSeek Code can fall back to grep and targeted reads; it does not
            install a language server automatically. See <a href="/docs/lsp">Language servers</a>.
          </p>
        </section>

        <section id="monorepo">
          <h2><span className="anchor">#</span>Monorepos and /cwd</h2>
          <p>
            Use <code className="inline">/cwd &lt;path&gt;</code> to rebase the active workspace without restarting
            the terminal. The target must exist and be a directory. DeepSeek Code reloads settings, project
            instructions, MCP tools, workflow storage and project-scoped memory for the new root.
          </p>
          <p>
            Directory changes are refused while workflows or delegated tasks are active, or while task workspaces
            remain anchored to the old project. Finish or clean them up first. Treat <code className="inline">/cwd</code>
            as a context boundary: the visible UI can remain, but the agent runtime is initialized for the new root.
          </p>
          <CodeBlock lang="bash">{"> /cwd services/billing\ncwd: /home/you/platform/services/billing\n\n> /cwd\ncwd: /home/you/platform/services/billing"}</CodeBlock>
          <Note>
            Sessions are grouped by exact resolved working-directory path. Resume from the same root if you want
            the project-specific picker to find the conversation.
          </Note>
        </section>

        <section id="instructions">
          <h2><span className="anchor">#</span>Repository instructions</h2>
          <p>
            Large repositories benefit from a short routing map in root <code className="inline">AGENTS.md</code>:
            package ownership, canonical commands, generated paths, cross-package constraints and where tests live.
            DeepSeek Code also loads root and <code className="inline">.deepseek/DEEPSEEK.md</code>, plus every
            Markdown file directly inside <code className="inline">.deepseek/steering/</code>.
          </p>
          <CodeBlock lang="text">{"# Repository map\n- services/billing owns invoice lifecycle; tests are in services/billing/test\n- packages/contracts is generated from schema/; never edit it directly\n- cross-service changes require: bun test:contracts\n- package-local commands run from that package directory\n- root verification is: bun test"}</CodeBlock>
          <p>
            These files load from the selected root, not recursively from every ancestor or descendant. Keep
            durable instructions concise because they join the system context on every model call. Point to source
            or a package README instead of copying entire references into steering.
          </p>
        </section>

        <section id="agents">
          <h2><span className="anchor">#</span>Focused agent context</h2>
          <p>
            A custom agent can preload a bounded set of project-relative files with its
            <code className="inline">files</code> patterns. This is useful for a stable package contract or domain
            glossary, not for injecting a whole monorepo.
          </p>
          <CodeBlock lang="json">{"{\n  \"name\": \"billing-reviewer\",\n  \"usage\": \"subagent\",\n  \"role\": \"reader\",\n  \"permissionProfile\": \"researcher-readonly\",\n  \"systemPrompt\": \"Review billing behavior and report evidence with file paths.\",\n  \"files\": [\n    \"services/billing/README.md\",\n    \"services/billing/src/**/*.ts\",\n    \"packages/contracts/src/invoice.ts\"\n  ]\n}"}</CodeBlock>
          <p>
            Patterns must remain inside the workspace: no absolute paths or parent traversal. Dependency, Git
            and DeepSeek state directories are excluded, symbolic links are not followed, and all selected files
            share a 50,000-character budget. Put discovery in the task when the relevant files change often.
          </p>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Protect the context window</h2>
          <p>
            Search output, file reads and command logs compete with the conversation, tool schemas, instructions
            and memory. Use <code className="inline">/context</code> to see what is consuming the live window.
            DeepSeek Code micro-compacts old read-only tool results, but good search boundaries prevent wasted
            work before compaction is needed.
          </p>
          <p>
            Delegate independent repository archaeology to read-only sub-agents and ask them for bounded findings
            with paths and evidence. Keep dependent edits in one chain. Parallelizing a single call graph across
            many agents duplicates reads and makes synthesis harder.
          </p>
        </section>

        <section id="verification">
          <h2><span className="anchor">#</span>Verification at scale</h2>
          <p>
            Test from narrow to broad: the regression test, the owning package, affected dependents, then the root
            suite when the change justifies it. <code className="inline">/verify</code> detects one existing root
            command from a package script and lockfile, Cargo manifest or Go module. It does not infer every
            monorepo package's dependency graph.
          </p>
          <CodeBlock lang="text">{"Run the new billing regression test first.\nThen run the billing package's typecheck.\nUse the repository dependency graph to name affected packages.\nRun the root suite only if the contract package changed."}</CodeBlock>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Built-in limits</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "29%" }}>Surface</th><th style={{ width: "23%" }}>Limit</th><th>Response</th></tr></thead>
            <tbody>{LIMITS.map(([surface, limit, response]) => (
              <tr key={surface}><td><b>{surface}</b></td><td>{limit}</td><td>{response}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            These are guardrails against accidental context explosions, not targets to fill. A result at the
            limit is a signal to narrow the question.
          </p>
        </section>

        <section id="playbook">
          <h2><span className="anchor">#</span>Large-repository playbook</h2>
          <CodeBlock lang="text">{"1. Launch from the root that should own settings, instructions and sessions.\n2. Read root guidance, manifests and Git status.\n3. Map only the package and execution path relevant to the task.\n4. Search symbols and error text before reading files.\n5. Follow definitions, callers and tests with narrow ranges.\n6. State file ownership before parallel writes.\n7. Review the final Git diff and untracked files.\n8. Verify from the smallest test outward."}</CodeBlock>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "30%" }}>Symptom</th><th>Next move</th></tr></thead>
            <tbody>{TROUBLE.map(([symptom, move]) => <tr key={symptom}><td><b>{symptom}</b></td><td>{move}</td></tr>)}</tbody>
          </table></div>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
