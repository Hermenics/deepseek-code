import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What a plugin is" },
  { id: "anatomy", label: "Anatomy of a plugin" },
  { id: "manifest", label: "The manifest" },
  { id: "naming", label: "Naming rules" },
  { id: "variables", label: "PLUGIN_ROOT substitution" },
  { id: "registry", label: "The registry" },
  { id: "install", label: "Installing & updating" },
  { id: "components", label: "Component types" },
  { id: "tutorial", label: "Your first plugin" },
  { id: "vs-skills", label: "Plugins vs skills" },
  { id: "checklist", label: "Publishing checklist" },
];

const MANIFEST = [
  ["name", "string, required", "Kebab-case identifier. Must match PLUGIN_NAME_PATTERN."],
  ["version", "string, optional", "Your version string. Recorded in the registry entry."],
  ["description", "string, optional", "Shown in listings. Write it for someone deciding whether to install."],
  ["author", "{ name, email?, url? }", "Attribution."],
  ["commands", "string | string[]", "Component directory; current discovery uses only the first array item."],
  ["agents", "string | string[]", "Component directory; .md files are inventoried non-recursively."],
  ["skills", "string | string[]", "Component directory; child folders containing SKILL.md are inventoried."],
  ["hooks", "string", "Path whose existence marks the plugin as containing hooks."],
];

const ENTRY = [
  ["name", "Resolved plugin name."],
  ["repo", "owner/name it came from."],
  ["version", "Version from the manifest."],
  ["installedAt / updatedAt", "ISO timestamps."],
  ["commitHash", "The exact commit installed. This is what makes an install reproducible."],
  ["description", "Copied from the manifest."],
  ["components", "The discovered inventory: command names, agent names, skill names, and hasHooks."],
];

const COMPONENTS = [
  ["commands", "Detected .md names", "Listed as metadata; not added to the live slash-command registry."],
  ["agents", "Detected .md names", "Listed as metadata; not added to the live agent registry."],
  ["skills", "Detected skill folders", "Listed as metadata; their SKILL.md bodies are not loaded."],
  ["hooks", "Path-presence flag", "Reported by /plugin list; handlers are not executed."],
];

const CHECKLIST = [
  ["Name is kebab-case", "Anything else is rejected at install time, not at runtime."],
  ["Description says what, not how", "It is the only thing a user reads before installing."],
  ["No absolute paths", "Keep paths relative to the plugin root; runtime substitution is not wired yet."],
  ["Declare only what exists", "A manifest pointing at a missing file produces a plugin that half-loads."],
  ["Hooks are conservative", "They are not executed yet, but should be safe before runtime wiring lands."],
  ["Tag your releases", "Installs record the cloned HEAD commit; tags make releases easier to audit."],
];

export default function PluginAuthoring() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Plugin authoring</span>
        </nav>

        <div className="hero">
          <h1>Plugin authoring</h1>
          <p className="tagline">
            Package commands, agents, skills and hooks into one installable unit — pinned to an exact commit
            so an install is reproducible.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What a plugin is</h2>
          <p>
            A plugin is a git repository containing a manifest and one or more <b>components</b>: slash
            commands, agent definitions, skills, or hook configuration. Installing it validates and records
            the package and lets <code className="inline">/plugin list</code> inventory those components.
          </p>
          <p>
            The distinction from a skill is worth getting right early. A <a href="/docs/skill-authoring">skill</a>{" "}
            is one packaged capability. A plugin is a <b>bundle</b> — it can ship several commands, a couple
            of agents, and hooks that tie them together. If you are shipping one thing, ship a skill; if you
            are shipping a coherent set, ship a plugin.
          </p>
          <p>
            Installs are pinned to a <code className="inline">commitHash</code>. A plugin installed today
            behaves the same next month regardless of what the upstream repository does — updating is an
            explicit action, not something that happens to you. Component execution is a separate concern:
            the current runtime does not register installed plugin components into live sessions.
          </p>
        </section>

        <section id="anatomy">
          <h2><span className="anchor">#</span>Anatomy of a plugin</h2>
          <CodeBlock lang="text">{`my-plugin/
├── plugin.json           the manifest
├── commands/
│   ├── deploy.md         a slash command
│   └── rollback.md
├── agents/
│   └── release-checker.md
├── skills/
│   └── changelog/
│       └── SKILL.md
└── hooks/
    └── hooks.json`}</CodeBlock>
          <p>
            Those directory names are defaults. A manifest can point each component kind at another relative
            directory, but discovery is shallow: command and agent files must be direct <code className="inline">.md</code>
            children, while each skill must be a direct child folder containing <code className="inline">SKILL.md</code>.
          </p>
        </section>

        <section id="manifest">
          <h2><span className="anchor">#</span>The manifest</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Field</th><th style={{ width: "24%" }}>Type</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {MANIFEST.map(([f, t, p]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`{
  "name": "release-tools",
  "version": "1.2.0",
  "description": "Deploy, rollback and changelog commands for our release process",
  "author": { "name": "Platform Team", "url": "https://github.com/acme" },
  "commands": "commands",
  "agents": "agents",
  "skills": "skills",
  "hooks": "hooks/hooks.json"
}`}</CodeBlock>
          <p>
            The manifest type accepts a string or array for commands, agents, and skills. Current discovery
            treats the value as a <b>directory</b> and only considers the first array item, so use one directory
            per component kind today. Files inside that directory are what determine the reported inventory.
          </p>
          <p>
            Only <code className="inline">name</code> is genuinely required. A plugin that declares nothing else
            installs successfully and contributes nothing — useful as a scaffold, harmless as a mistake.
          </p>
        </section>

        <section id="naming">
          <h2><span className="anchor">#</span>Naming rules</h2>
          <p>
            Repository identifiers use the form <code className="inline">owner/repo</code>, with one slash
            and only letters, digits, underscores, periods and hyphens on either side. Plugin names use
            strict kebab-case.
          </p>
          <p>
            A valid plugin name contains lowercase alphanumerics with single hyphens between segments, no
            leading or trailing hyphen, and no consecutive hyphens. <code className="inline">release-tools</code> passes;{" "}
            <code className="inline">Release_Tools</code>, <code className="inline">release--tools</code> and{" "}
            <code className="inline">-release</code> do not.
          </p>
          <p>
            The repository format is deliberately narrow because it becomes part of a GitHub clone URL.
            Spaces, extra slashes and shell metacharacters are rejected. The installed plugin name receives
            a second path-safety check before any directory is created.
          </p>
          <Note>
            The command parser rejects malformed input early, and the installer repeats validation at the
            filesystem boundary. A manifest cannot bypass the naming rules just because the repository slug
            was valid.
          </Note>
        </section>

        <section id="variables">
          <h2><span className="anchor">#</span>PLUGIN_ROOT substitution status</h2>
          <p>
            The codebase defines a resolver for <code className="inline">{"$"}{"{PLUGIN_ROOT}"}</code>, intended to
            replace that token with the plugin's installation directory. No current runtime call site invokes
            the resolver, because installed components are not registered yet.
          </p>
          <CodeBlock lang="json">{`{
  "hooks": {
    "PostToolUse": [
      { "matcher": { "tools": ["edit_file"] },
        "command": "node /absolute/path/to/plugin/scripts/format.js" }
    ]
  }
}`}</CodeBlock>
          <p>
            Treat the token as reserved for future component wiring, not as a working expansion today.
          </p>
          <p>
            Keep distributable paths relative. An absolute path may work on the author's machine and fail on
            every other one, while the reserved token is not yet a runtime escape hatch.
          </p>
        </section>

        <section id="registry">
          <h2><span className="anchor">#</span>The registry</h2>
          <p>
            Installed plugins are recorded in a versioned registry keyed by name:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Entry field</th><th>Contents</th></tr>
              </thead>
              <tbody>
                {ENTRY.map(([f, c]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">commitHash</code> is the important one. Recording a version string would
            only record what the author <em>claimed</em>; recording the commit records what was actually
            installed. Two machines with the same hash are running identical code, and an update is a
            visible change from one hash to another.
          </p>
          <p>
            <code className="inline">components</code> is computed at install time by inspecting what the
            manifest resolved to. That means listing plugins shows what each one really contributes, not
            what it advertises.
          </p>
        </section>

        <section id="install">
          <h2><span className="anchor">#</span>Installing & updating</h2>
          <CodeBlock lang="bash">{`/plugin install owner/repo     # clone, validate, pin to HEAD commit
/plugin list                   # installed plugins and their components
/plugin update <name>          # move the pin to the newer commit
/plugin remove <name>          # uninstall`}</CodeBlock>
          <p>
            Installation validates before it registers: the repo slug against{" "}
            <code className="inline">REPO_PATTERN</code>, the manifest name against{" "}
            <code className="inline">PLUGIN_NAME_PATTERN</code>, then inventories component directories. A
            missing component path produces an empty contribution rather than rejecting the entire plugin.
          </p>
          <p>
            Updating is always explicit. There is no background auto-update. The update path clones a fresh
            copy, validates its identity, swaps it with a backup, and restores the previous directory if the
            replacement or registry write fails.
          </p>
          <Note>
            Install plugins the way you would add a dependency: read what they contain first. Hooks are only
            detected today, not executed; review them anyway so a future runtime-wiring release cannot turn an
            unnoticed package update into an unexpected command.
          </Note>
        </section>

        <section id="components">
          <h2><span className="anchor">#</span>Component types</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Field</th><th style={{ width: "24%" }}>Contributes</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {COMPONENTS.map(([f, c, n]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{c}</td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">hooks</code> is a single string while the other manifest fields accept
            arrays. Detection only checks whether the resolved hooks path exists; it does not parse or register
            that file.
          </p>
          <p>
            Agent files bundled by a plugin are currently identified by filename only. They do not enter the
            project-agent validation or inheritance pipeline. See <a href="/docs/agents">Agents</a> for the
            separate, live project-agent format.
          </p>
        </section>

        <section id="tutorial">
          <h2><span className="anchor">#</span>Your first plugin</h2>
          <p>
            A plugin that packages one command definition and one hook file for discovery:
          </p>
          <CodeBlock lang="bash">{`mkdir -p my-plugin/commands my-plugin/hooks
cd my-plugin
git init`}</CodeBlock>
          <CodeBlock lang="json">{`// plugin.json
{
  "name": "typecheck-tools",
  "version": "0.1.0",
  "description": "Typecheck command plus an automatic check after every edit",
  "commands": "commands/typecheck.md",
  "hooks": "hooks/hooks.json"
}`}</CodeBlock>
          <CodeBlock lang="text">{`<!-- commands/typecheck.md -->
---
name: typecheck
description: Run the TypeScript compiler with no emit
---

Run \`bunx tsc --noEmit\` and report every error with its file and line.
If there are no errors, say so in one line.`}</CodeBlock>
          <CodeBlock lang="json">{`// hooks/hooks.json
{
  "PostToolUse": [
    {
      "matcher": { "tools": ["edit_file", "write_file"] },
      "command": "bunx tsc --noEmit"
    }
  ]
}`}</CodeBlock>
          <CodeBlock lang="bash">{`git add -A && git commit -m "typecheck-tools 0.1.0"
git push -u origin main

# then, from any project
/plugin install youruser/typecheck-tools
/plugin list`}</CodeBlock>
          <p>
            Test locally before publishing by installing from your own repository and running{" "}
            <code className="inline">/plugin list</code> — the <code className="inline">components</code> it
            reports are computed from what actually resolved, so a typo in a manifest path shows up as a
            missing component rather than as silence.
          </p>
          <Note>
            This verifies packaging and discovery, not execution. The sample command and hook will not be
            added to the running CLI in the current release.
          </Note>
        </section>

        <section id="vs-skills">
          <h2><span className="anchor">#</span>Plugins vs skills</h2>
          <p>
            Both are git-installed and commit-pinned, and the overlap confuses people. The differences that
            matter:
          </p>
          <p>
            <b>Scope.</b> A skill is one capability with one <code className="inline">SKILL.md</code>. A plugin
            bundles many components of different kinds.
          </p>
          <p>
            <b>Declared capability.</b> Only a plugin can package hook configuration. The current installer
            records its presence but does not attach it to the live hook executor.
          </p>
          <p>
            <b>Containment.</b> A plugin can contain skills. The reverse is not true.
          </p>
          <p>
            If you are unsure, start with a skill. Promoting a skill into a plugin later is easy; the
            reverse means asking your users to uninstall something.
          </p>
        </section>

        <section id="checklist">
          <h2><span className="anchor">#</span>Publishing checklist</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Check</th><th>Why</th></tr>
              </thead>
              <tbody>
                {CHECKLIST.map(([c, w]) => (
                  <tr key={c}>
                    <td><b style={{ color: "var(--text-strong)" }}>{c}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The description is the one authors under-invest in. It is the entire basis on which someone
            decides to install code that will run hooks in their sessions. "Release tooling" tells them
            nothing; "adds /deploy and /rollback for Kubernetes, plus a typecheck hook after edits" tells
            them whether they want it.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
