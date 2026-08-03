import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "skills", label: "Skills (/skill)" },
  { id: "plugins", label: "Plugins (/plugin)" },
  { id: "wiring", label: "Component wiring status" },
  { id: "catalog", label: "Curated catalog" },
];

const SKILL_SUBCOMMANDS = [
  ["install <owner/repo>", "Clone a skill repo into .deepseek/skills"],
  ["list", "Show installed skills (.deepseek/skills + legacy .claude/skills)"],
  ["remove <name>", "Remove from .deepseek/skills or .claude/skills"],
  ["update <name>", "Update to latest; auto-migrates legacy .claude/skills"],
];

export default function PluginsSkills() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Plugins &amp; skills</span>
        </nav>

        <div className="hero">
          <h1>Plugins &amp; skills</h1>
          <p className="tagline">
            Extend DeepSeek Code from GitHub repositories — with an honest wiring status.
          </p>
        </div>

        <section id="skills">
          <h2><span className="anchor">#</span>Skills (/skill)</h2>
          <p>
            Install a skill by pointing at a GitHub repo:
          </p>
          <CodeBlock lang="bash">/skill <span className="k">install</span> <span className="s">openai/openai-docs</span></CodeBlock>
          <p>
            The repo is cloned into <code className="inline">&lt;project&gt;/.deepseek/skills</code> — the
            directory the runtime actually loads skills from. <code className="inline">/skill list</code> reads
            that directory and also scans the legacy <code className="inline">.claude/skills</code> for
            compatibility. Remove and update operate against either location; when you update a skill
            that still lives in <code className="inline">.claude/skills</code>, it is migrated to{" "}
            <code className="inline">.deepseek/skills</code> first, then updated.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "40%" }}>Subcommand</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {SKILL_SUBCOMMANDS.map(([s, d]) => (
                  <tr key={s}>
                    <td><code className="inline">{s}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Each install is recorded in a per-directory <code className="inline">.registry.json</code> holding the
            name, source repo, commit hash, and installed/updated timestamps:
          </p>
          <CodeBlock lang="text">{`{ "version": 1, "skills": {
  "my-skill": { "name": "my-skill", "repo": "owner/repo",
    "commitHash": "a1b2c3d", "installedAt": "…", "updatedAt": "…" } } }`}</CodeBlock>
          <Note>
            <code className="inline">.deepseek/skills</code> is the runtime skill directory — what lands
            there is what runs.
          </Note>
        </section>

        <section id="plugins">
          <h2><span className="anchor">#</span>Plugins (/plugin)</h2>
          <p>
            Plugins install into a global directory rather than the project:
          </p>
          <CodeBlock lang="bash">/plugin <span className="k">install</span> <span className="s">owner/repo</span></CodeBlock>
          <p>
            Repos are cloned into <code className="inline">~/.deepseek-code/plugins</code> (override with{" "}
            <code className="inline">DEEPSEEK_PLUGINS_DIR</code>). A valid plugin carries a{" "}
            <code className="inline">plugin.json</code> — or <code className="inline">.claude-plugin/plugin.json</code> —
            declaring optional <code className="inline">commands</code>, <code className="inline">agents</code>,{" "}
            <code className="inline">skills</code>, and <code className="inline">hooks</code>:
          </p>
          <CodeBlock lang="json">{`{ "name": "my-plugin", "version": "0.1.0",
  "commands": "commands", "hooks": "hooks/hooks.json" }`}</CodeBlock>
          <p>
            Path fields may use <code className="inline">${'{PLUGIN_ROOT}'}</code>, resolved to the plugin's
            install directory. <code className="inline">/plugin list</code> reports what each plugin contributes
            (for example, <code className="inline">3 cmd, 1 agent, hooks</code>). Installs validate that the name
            is kebab-case and cannot escape the plugins directory, and give git a 60-second clone
            timeout. Update is safer than a blind reinstall: it clones the new version, backs up the
            existing install, swaps it into place, and restores the backup if anything fails.
          </p>
        </section>

        <section id="wiring">
          <h2><span className="anchor">#</span>Component wiring status</h2>
          <p>
            One honest caveat: the two systems are not wired up equally. Skills in{" "}
            <code className="inline">.deepseek/skills</code> are live at runtime and work immediately. Plugin
            components are discovered and reported by <code className="inline">/plugin list</code>, but they
            are <b>not yet registered</b> into the live command, agent, or hook registries — only the
            plugin's metadata is loaded. Manage and update plugins today; expect component wiring in a
            future release.
          </p>
          <Note>
            Plugin hooks are detected (<code className="inline">hooks</code> shows in{" "}
            <code className="inline">/plugin list</code>) but not executed yet.
          </Note>
        </section>

        <section id="catalog">
          <h2><span className="anchor">#</span>Curated catalog</h2>
          <p>
            <code className="inline">/catalog</code> (alias <code className="inline">/marketplace</code>) lists curated
            integrations, filterable by kind:
          </p>
          <CodeBlock lang="bash">{`/catalog mcp
/catalog plugin
/catalog skill`}</CodeBlock>
          <p>
            It is a recommendation list, not an installer — nothing is fetched automatically. Today the
            curated list is mostly MCP servers plus one research skill. MCP entries belong in{" "}
            <code className="inline">.deepseek/mcp.json</code>; see the{" "}
            <a href="/docs/mcp">MCP page</a> for server configuration. Skills and plugins from the catalog
            install with <code className="inline">/skill</code> and <code className="inline">/plugin</code>.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
