import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "purpose", label: "Purpose" },
  { id: "commands", label: "Browse by kind" },
  { id: "entries", label: "Built-in catalog" },
  { id: "install", label: "Catalog is not installation" },
  { id: "trust", label: "Trust and review" },
];

const ENTRIES = [
  ["MCP", "GitHub", "github/github-mcp-server", "Repository, issue, and pull-request context."],
  ["MCP", "Playwright", "microsoft/playwright-mcp", "Browser automation and UI verification."],
  ["MCP", "Context7", "upstash/context7", "Current library documentation for implementation work."],
  ["Skill", "OpenAI docs", "openai/openai-docs", "Official OpenAI product and API research workflow."],
];

export default function CatalogGuide() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Extending</span><span className="sep">/</span><span className="current">Integration catalog</span>
        </nav>
        <div className="hero">
          <h1>Integration catalog</h1>
          <p className="tagline">Browse a small, reviewable set of MCP servers and skills without turning discovery into automatic installation.</p>
        </div>

        <section id="purpose">
          <h2><span className="anchor">#</span>Purpose</h2>
          <p>
            The catalog is a curated list shipped with the CLI. It provides names, repository identifiers,
            and one-line descriptions for integrations that are commonly useful in coding sessions. It is
            intentionally static: results are deterministic, available offline, and can be reviewed as part
            of a DeepSeek Code release.
          </p>
          <p>
            Use <code className="inline">/catalog</code> or its alias <code className="inline">/marketplace</code>.
          </p>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>Browse by kind</h2>
          <CodeBlock lang="bash">{`/catalog          # everything
/catalog mcp      # MCP servers only
/catalog plugin   # plugins only
/catalog skill    # skills only
/marketplace mcp  # alias`}</CodeBlock>
          <p>
            Kind matching is case-insensitive. Any value other than MCP, plugin, or skill produces a usage
            error. An empty filtered result is valid; the current built-in catalog has no Plugin entries.
          </p>
        </section>

        <section id="entries">
          <h2><span className="anchor">#</span>Built-in catalog</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th>Kind</th><th>Name</th><th>Source</th><th>Purpose</th></tr></thead>
            <tbody>{ENTRIES.map((row) => <tr key={row[2]}>{row.map((cell, index) => <td key={cell}>{index === 2 ? <code className="inline">{cell}</code> : cell}</td>)}</tr>)}</tbody>
          </table></div>
          <Note>
            This table describes the catalog bundled with this source tree. Entries can change between CLI
            releases; run <code className="inline">/catalog</code> for the installed version's list.
          </Note>
        </section>

        <section id="install">
          <h2><span className="anchor">#</span>Catalog is not installation</h2>
          <p>
            Listing an entry has no side effect. MCP servers must be configured in
            <code className="inline">.deepseek/mcp.json</code> and enabled at User scope. Skills and plugins
            use their own management commands. The catalog does not clone repositories, add packages, edit
            settings, or approve capabilities.
          </p>
          <p>
            Continue with <a href="/docs/mcp">MCP</a>, <a href="/docs/plugins-skills">Plugins and skills</a>,
            or the relevant authoring guide after selecting an entry.
          </p>
        </section>

        <section id="trust">
          <h2><span className="anchor">#</span>Trust and review</h2>
          <p>
            Curated means recommended for discovery, not implicitly trusted. Review the exact repository,
            requested permissions, executable commands, network destinations, and data the integration can
            receive. Pin versions or commits where reproducibility matters.
          </p>
          <p>
            A repository name displayed by the catalog cannot grant MCP, plugin, skill, shell, filesystem,
            or credential access. Normal configuration, mode, permission, and approval boundaries still
            apply.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
