import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "strategy", label: "Search strategy" },
  { id: "glob", label: "Find paths with glob" },
  { id: "grep", label: "Search content with grep" },
  { id: "folder", label: "Map directories" },
  { id: "limits", label: "Limits and exclusions" },
  { id: "large", label: "Large repositories" },
  { id: "fallback", label: "When search is not enough" },
];

const LIMITS = [
  ["glob", "500 files", "Returns a truncation summary after the first 500 matches."],
  ["grep", "200 matching lines", "Reports total matches when output is truncated."],
  ["read_folder", "1,000 entries", "Recursive traversal stops after five directory levels."],
  ["read_file", "200 lines by default", "Explicit line ranges page through the rest."],
];

export default function SearchTools() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Tools</span><span className="sep">/</span><span className="current">Search and discovery</span>
        </nav>
        <div className="hero">
          <h1>Search and discover repository code</h1>
          <p className="tagline">Combine path discovery, content search, bounded directory maps, file ranges, and semantic navigation without dumping the repository into context.</p>
        </div>

        <section id="strategy">
          <h2><span className="anchor">#</span>Search strategy</h2>
          <p>
            Start with the narrowest evidence source that can answer the question. Use glob when you know a
            path pattern, grep when you know an identifier or error string, read a folder for local shape,
            then open only the matching ranges. Use LSP when the question is semantic—definition, references,
            or symbols—and a server is configured.
          </p>
          <CodeBlock lang="text">{`Find the exact error text first, inspect its callers and focused tests,
then read only the surrounding ranges needed to explain the real flow.`}</CodeBlock>
        </section>

        <section id="glob">
          <h2><span className="anchor">#</span>Find paths with glob</h2>
          <p>
            Glob matches path patterns relative to a safe working directory and includes dotfiles unless
            excluded. It is best for questions such as “where are provider tests?” or “which files define
            migrations?” A result is only a filename candidate; read it before making behavioral claims.
          </p>
          <p>
            Dependency/build directories, editor metadata, caches, lockfiles, source maps, minified assets,
            logs, environment files, archives, common media, and PDFs are excluded. This keeps broad patterns
            from consuming the entire context window.
          </p>
        </section>

        <section id="grep">
          <h2><span className="anchor">#</span>Search content with grep</h2>
          <p>
            Grep performs recursive regular-expression search and can restrict results with a file include
            glob. It treats a no-match exit as a normal <code className="inline">No matches</code> result and
            distinguishes actual search failures.
          </p>
          <p>
            Results include path and line number. They are textual evidence, not a complete call graph:
            generated names, re-exports, aliases, dynamic access, and type-level relationships can require
            LSP or surrounding source reads.
          </p>
        </section>

        <section id="folder">
          <h2><span className="anchor">#</span>Map directories</h2>
          <p>
            Folder listing shows files and directories beneath a known path. Use shallow listing to orient
            first; request recursion only for a small subtree. Heavy and protected directories are skipped,
            and permission-denied children are labeled without failing the entire traversal.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and exclusions</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th>Operation</th><th>Bound</th><th>Behavior at the bound</th></tr></thead>
            <tbody>{LIMITS.map(([op, bound, behavior]) => <tr key={op}><td><code className="inline">{op}</code></td><td>{bound}</td><td>{behavior}</td></tr>)}</tbody>
          </table></div>
          <p>
            Search and listing use the same workspace and sensitive-path boundaries as file operations. They
            cannot be redirected into protected runtime state or secrets by choosing a broader pattern.
          </p>
        </section>

        <section id="large">
          <h2><span className="anchor">#</span>Large repositories</h2>
          <p>
            Narrow by top-level module, file extension, and identifier before reading. When a result is
            truncated, refine the query instead of asking for the next enormous batch. Delegate independent
            subtrees to read-only agents when their conclusions can be summarized and compared without
            overlapping edits.
          </p>
          <p>
            See <a href="/docs/large-codebases">Large codebases</a> for context budgeting, repository maps,
            and staged investigation patterns.
          </p>
        </section>

        <section id="fallback">
          <h2><span className="anchor">#</span>When search is not enough</h2>
          <p>
            Use <a href="/docs/lsp">LSP navigation</a> for language-aware references, Git history for why a
            line changed, tests for observable contracts, and runtime commands for facts that static text
            cannot prove. A good investigation combines these evidence types rather than treating the first
            text match as the answer.
          </p>
          <Note>
            If a file is excluded because it is sensitive or protected, do not ask the agent to bypass the
            restriction with shell. Review it yourself and provide only the minimal non-secret fact needed.
          </Note>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
