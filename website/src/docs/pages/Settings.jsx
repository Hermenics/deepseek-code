import { CodeBlock, Note, Toc, Icon } from "../Layout";

const TOC = [
  { id: "scopes", label: "Config scopes" },
  { id: "precedence", label: "Precedence" },
  { id: "secrets", label: "Secrets" },
  { id: "reference", label: "Settings reference" },
  { id: "merge", label: "Merge behavior" },
  { id: "legacy", label: "Legacy compatibility" },
  { id: "validation", label: "Validation" },
  { id: "settings-center", label: "Settings center" },
  { id: "mcp", label: "MCP servers" },
  { id: "next", label: "Next steps" },
];

// Full schema grouped by section. Defaults come from DEFAULT_SETTINGS in
// src/settings/repository.ts; "—" means no default (inherits or unset).
const SETTINGS = [
  { group: true, label: "provider — backend & connection" },
  { key: "provider.name", def: "deepseek", notes: "deepseek · bedrock · vertex · local" },
  { key: "provider.timeoutMs", def: "30000", notes: "Must be at least 100 ms" },
  { key: "provider.endpoint", def: "—", notes: "Optional API base URL override" },
  { key: "provider.region", def: "—", notes: "AWS region (Bedrock)" },
  { key: "provider.profile", def: "—", notes: "Named AWS credentials profile" },
  { key: "provider.projectId", def: "—", notes: "Google Cloud project (Vertex)" },
  { key: "provider.location", def: "—", notes: "Vertex location, e.g. us-central1" },

  { group: true, label: "model — primary & subagent models" },
  { key: "model.default", def: "—", notes: "Primary agent model; per-provider default when unset" },
  { key: "model.subagent", def: "—", notes: "Model used for delegated work" },

  { group: true, label: "interaction" },
  { key: "interaction.defaultMode", def: "build", notes: "build · plan · review · auto — auto may only be set at User scope" },

  { group: true, label: "compaction — automatic context compaction" },
  { key: "compaction.enabled", def: "true", notes: "Summarize context near the threshold; /compact stays manual" },
  { key: "compaction.threshold", def: "0.9", notes: "Context utilization ratio, valid 0.70–0.95" },

  { group: true, label: "promptRefiner — prompt refinement before execution" },
  { key: "promptRefiner.enabled", def: "true", notes: "Refine sufficiently long coding requests first" },
  { key: "promptRefiner.model", def: "—", notes: "Optional override; empty inherits the primary model" },
  { key: "promptRefiner.minimumLength", def: "30", notes: "Messages shorter than this are never refined" },
  { key: "promptRefiner.excludeTypes", def: "['command']", notes: "Message types that are never refined" },

  { group: true, label: "permissions — allow/deny rules" },
  { key: "permissions.allow", def: "[]", notes: "Rules like Shell(git *) or ReadFile; concatenated and deduped across scopes" },
  { key: "permissions.deny", def: "[]", notes: "Mandatory deny rules — higher scopes cannot suppress them" },
  { key: "permissions.suppress", def: "[]", notes: "Exact inherited allow rules to hide at this scope" },
  { key: "permissions.autoApproveLowRisk", def: "false", notes: "Allow low-risk operations without a prompt; deny and high-risk checks stay mandatory" },

  { group: true, label: "risk — built-in risk checks" },
  { key: "risk.enabled", def: "true", notes: "Evaluate built-in and custom risk rules before tool execution" },
  { key: "risk.thresholds.largeFileLines", def: "100", notes: "Line count marking an overwrite as high risk" },
  { key: "risk.thresholds.burstCount", def: "3", notes: "Write count that activates edit-burst risk" },
  { key: "risk.rules", def: "[]", notes: "Custom rules (id, level, tool, pattern, condition); HIGH rules cannot be disabled" },

  { group: true, label: "agents — delegation policy" },
  { key: "agents.default", def: "—", notes: "Primary agent for the next session" },
  { key: "agents.additionalDirectories", def: "[]", notes: "Extra agent library paths" },
  { key: "agents.basePrompt", def: "—", notes: "Editable prompt composed before each specialization" },
  { key: "agents.subagentModel", def: "—", notes: "Default model for delegated work" },
  { key: "agents.concurrency", def: "5", notes: "Maximum concurrent subagents, integer 1–16" },
  { key: "agents.permissionPolicy", def: "inherit", notes: "inherit · isolated — parent deny and risk rules always remain" },
  { key: "agents.disabledBuiltins", def: "[]", notes: "Built-ins disabled by name; concatenated and deduped across scopes" },
  { key: "agents.maxTasks / maxDepth / maxFanOut / maxRetries", def: "—", notes: "Limits for subagent fan-out" },
  { key: "agents.timeoutMs / retryBackoffMs", def: "—", notes: "Timing controls for subagent retries" },
  { key: "agents.maxTokens / maxCostUsd", def: "—", notes: "Budget ceilings per delegated task" },

  { group: true, label: "memory — durable memory" },
  { key: "memory.enabled", def: "true", notes: "Enable durable agent and user memory" },
  { key: "memory.scope", def: "user", notes: "user · project — where memory is stored" },

  { group: true, label: "sessions" },
  { key: "sessions.retention", def: "50", notes: "Maximum saved sessions, positive integer" },
  { key: "sessions.autoResume", def: "off", notes: "off · project-last — explicit CLI flags always win" },

  { group: true, label: "git" },
  { key: "git.checkpoint", def: "true", notes: "Create git checkpoints before risky changes" },
  { key: "git.worktree", def: "ask", notes: "off · ask · auto — worktree usage for isolation" },
  { key: "git.branchPattern", def: "deepseek/{slug}-{shortId}", notes: "Must include {shortId} to keep branch names unique" },
  { key: "git.reviewDiff", def: "false", notes: "Show the diff before committing" },
  { key: "git.verifyAfterEdit", def: "true", notes: "Re-verify files after edits" },
  { key: "git.generatedPatterns", def: "[]", notes: "Patterns excluded from checkpoints, tracking and review" },

  { group: true, label: "lsp — language servers (User scope only)" },
  { key: "lsp.servers", def: "[]", notes: "JSON array of trusted LSP commands and file extensions" },
  { key: "lsp.timeoutMs", def: "10000", notes: "LSP request timeout, 100–60000 ms" },

  { group: true, label: "mcp — project MCP servers (User scope only)" },
  { key: "mcp.enabled", def: "false", notes: "Consent to load project .deepseek/mcp.json servers; restart required" },

  { group: true, label: "interface" },
  { key: "interface.theme", def: "dark", notes: "Color theme" },
  { key: "interface.language", def: "—", notes: "Preferred language instruction" },
  { key: "interface.vim", def: "false", notes: "Vim keybindings" },
  { key: "interface.density", def: "comfortable", notes: "compact · comfortable" },
  { key: "interface.reducedMotion", def: "false", notes: "Disable animations" },
  { key: "interface.alternateScreen", def: "false", notes: "Fullscreen alternate-screen buffer" },
  { key: "interface.showThoughts", def: "true", notes: "Show streamed thinking" },
  { key: "interface.showToolCalls", def: "true", notes: "Show tool call details in the transcript" },
  { key: "interface.showDiffs", def: "true", notes: "Show diffs inline" },
  { key: "interface.statusBar", def: "[mode, model, tokens, branch, context]", notes: "Status bar items and order" },
  { key: "interface.narrowPriority", def: "[mode, context, model, branch, tokens]", notes: "Items kept on narrow terminals" },

  { group: true, label: "hooks — executable lifecycle hooks (User scope only)" },
  { key: "hooks.PreToolUse / PostToolUse / SessionStart", def: "—", notes: "See the Hooks page; ignored outside User scope" },

  { group: true, label: "goal" },
  { key: "goal.maxContinuations", def: "3", notes: "Maximum auto-continuation turns for /goal" },

  { group: true, label: "workflows" },
  { key: "workflows.enabled", def: "true", notes: "Enable Dynamic Workflows" },
];

export default function Settings() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Settings</span>
        </nav>

        <div className="hero">
          <h1>Settings</h1>
          <p className="tagline">
            Configure DeepSeek Code at User, Project, or Local scope — with visible origins.
          </p>
        </div>

        <section id="scopes">
          <h2><span className="anchor">#</span>Config scopes</h2>
          <p>
            Non-secret preferences live in <code className="inline">settings.json</code> and are
            resolved across three scopes:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Scope</th>
                  <th>Where it lives</th>
                  <th>Use for</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><b>User</b></td><td><code className="inline">~/.deepseek/settings.json</code></td><td>Defaults for every project you open</td></tr>
                <tr><td><b>Project</b></td><td><code className="inline">.deepseek/settings.json</code> in the repo</td><td>Settings that travel with the project</td></tr>
                <tr><td><b>Local</b></td><td><code className="inline">.deepseek/settings.local.json</code>, git-ignored</td><td>Machine-specific tweaks (not committed)</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            A few groups are <b>User-scoped only</b>: <code className="inline">hooks</code>,{" "}
            <code className="inline">lsp</code> and <code className="inline">mcp</code> are ignored
            in Project and Local files, because they execute or trust third-party code.
          </p>
        </section>

        <section id="precedence">
          <h2><span className="anchor">#</span>Precedence</h2>
          <p>
            When the same key exists in multiple scopes, the effective value is resolved as:
          </p>
          <CodeBlock lang="text">User &lt; Project &lt; Local</CodeBlock>
          <p>
            So <b>Local wins</b> over Project, which wins over User. The settings center shows the
            <b> origin</b> of every value, so you always know where a setting came from.
          </p>
        </section>

        <section id="secrets">
          <h2><span className="anchor">#</span>Secrets</h2>
          <p>
            Secrets — like provider API keys — are <b>never</b> stored in{" "}
            <code className="inline">settings.json</code>. They're saved only to:
          </p>
          <CodeBlock lang="bash">~/.deepseek/config.json</CodeBlock>
          <p>
            The settings API rejects any key or nested value matching{" "}
            <code className="inline">api key | token | secret | credential | password</code> with:
          </p>
          <CodeBlock lang="text">Secrets must be stored in ~/.deepseek/config.json</CodeBlock>
          <Note>
            Secrets stay out of the repo and out of logs. If you spot a key in a log, report it
            via the security policy.
          </Note>
        </section>

        <section id="reference">
          <h2><span className="anchor">#</span>Settings reference</h2>
          <p className="lead">
            The complete schema with defaults. Every group is optional — missing groups fall back
            to these values.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "34%" }}>Key</th>
                  <th style={{ width: "26%" }}>Default</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {SETTINGS.map((row, i) =>
                  row.group ? (
                    <tr key={i} style={{ background: "var(--bg-subtle)" }}>
                      <td colSpan={3}><b style={{ color: "var(--text-strong)" }}>{row.label}</b></td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td><code className="inline">{row.key}</code></td>
                      <td><code className="inline">{row.def}</code></td>
                      <td>{row.notes}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="merge">
          <h2><span className="anchor">#</span>Merge behavior</h2>
          <p>
            Scopes are combined with a <b>deep merge</b>: nested objects merge key by key, so a
            Project file can override a single field of <code className="inline">git</code> without
            restating the rest.
          </p>
          <p>
            Arrays are <b>replaced</b> as a whole — except on concatenation paths, where values are
            appended and deduplicated across scopes:
          </p>
          <ul className="capabilities">
            <li><code className="inline">permissions.allow</code>, <code className="inline">permissions.deny</code>, <code className="inline">permissions.suppress</code></li>
            <li><code className="inline">risk.rules</code></li>
            <li><code className="inline">hooks.*</code> — <code className="inline">PreToolUse</code>, <code className="inline">PostToolUse</code>, <code className="inline">SessionStart</code></li>
            <li><code className="inline">agents.disabledBuiltins</code></li>
          </ul>
          <p>
            Allow rules and suppressions are also reconciled across scopes: suppressed allow rules
            are removed from the final allow list, while deny rules always survive.
          </p>
        </section>

        <section id="legacy">
          <h2><span className="anchor">#</span>Legacy compatibility</h2>
          <p>
            Old top-level keys stay readable for one compatibility cycle and are migrated
            automatically:
          </p>
          <ul className="capabilities">
            <li><code className="inline">theme</code> / <code className="inline">language</code> → <code className="inline">interface.theme</code> / <code className="inline">interface.language</code></li>
            <li><code className="inline">autoCompact</code> / <code className="inline">autoCompactThreshold</code> → <code className="inline">compaction.enabled</code> / <code className="inline">compaction.threshold</code></li>
            <li>String <code className="inline">model</code> → <code className="inline">model.default</code></li>
          </ul>
          <p>
            Legacy credentials in <code className="inline">~/.deepseek/config.json</code>{" "}
            (<code className="inline">THEME</code>, <code className="inline">LANGUAGE</code>,{" "}
            <code className="inline">ENCHANT</code>, <code className="inline">MODEL</code>,{" "}
            <code className="inline">PROVIDER</code> and the provider env keys) are read as the
            lowest-precedence User layer.
          </p>
        </section>

        <section id="validation">
          <h2><span className="anchor">#</span>Validation</h2>
          <p>
            Every scope file is validated when loaded. Hard constraints fail the save — for
            example <code className="inline">compaction.threshold</code> must be between 0.70 and
            0.95, and <code className="inline">agents.concurrency</code> must be an integer from 1
            to 16. Soft constraints surface as warnings, such as a{" "}
            <code className="inline">git.branchPattern</code> without{" "}
            <code className="inline">{"{shortId}"}</code>.
          </p>
          <p>
            Unknown top-level keys are <b>not</b> rejected — they are tracked as{" "}
            <code className="inline">unknownPaths</code> and listed in the settings center
            diagnostics, so plugins can keep their own configuration in the same file.
          </p>
        </section>

        <section id="settings-center">
          <h2><span className="anchor">#</span>Settings center</h2>
          <p>
            Open the fullscreen settings center with <code className="inline">/config</code> or{" "}
            <code className="inline">/settings</code>. Settings are organized into ten categories:
            <b> Provider &amp; Model</b>, <b>Agent Behavior</b>, <b>Context &amp; Compaction</b>,
            <b> Permissions &amp; Risk</b>, <b>Agents</b>, <b>Memory &amp; Sessions</b>,{" "}
            <b>Git</b>, <b>Interface</b>, <b>Hooks</b>, and <b>Advanced</b>.
          </p>
          <ul className="capabilities">
            <li><b>Tab</b> / <b>Shift+Tab</b> cycle the active scope: user → project → local → user</li>
            <li><b>/</b> starts a full-text search across labels, descriptions and aliases</li>
            <li><b>r</b> removes the scoped override and restores the inherited value</li>
            <li>The detail pane shows <b>Effective</b> value, <b>Origin</b> (default, user, project, local or legacy) and the <b>Chain</b> of overrides</li>
            <li>Settings that need a restart are marked <b>"Applies next session"</b>; the rest apply immediately</li>
          </ul>
          <p>Built-in actions include:</p>
          <ul className="capabilities">
            <li><b>Test connection</b> — latency check and model listing for the active provider</li>
            <li><b>Refiner preview</b> and <b>Permission preview</b> — try values before saving</li>
            <li><b>Clear session approvals</b>, <b>Clear memory</b>, <b>Clear sessions</b> (project or global)</li>
            <li><b>Export</b> — a secret-free JSON bundle of effective settings, memory and sessions</li>
            <li><b>Reset scope</b>, <b>Reload settings</b>, <b>Diagnostics</b>, and opening the raw scope file in <code className="inline">$EDITOR</code></li>
          </ul>
          <p>
            The center adapts its layout to terminal width — from three panes down to a sequential
            flow (categories → items → detail) on narrow terminals.
          </p>
        </section>

        <section id="mcp">
          <h2><span className="anchor">#</span>MCP servers</h2>
          <p>
            Project MCP servers are <b>off by default</b>. Enable them with the User-scoped{" "}
            <b>Enable project MCP servers</b> setting, then restart DeepSeek Code.
          </p>
          <Note>
            Browse integrations with <code className="inline">/catalog</code> or{" "}
            <code className="inline">/marketplace</code>.
          </Note>
        </section>

        <section id="next">
          <h2><span className="anchor">#</span>Next steps</h2>
          <div className="next-links">
            <a className="next-card" href="/docs/providers">
              <div className="nc-title">Providers <Icon.Arrow /></div>
              <div className="nc-desc">Configure authentication for each backend.</div>
            </a>
            <a className="next-card" href="/docs/commands">
              <div className="nc-title">Commands <Icon.Arrow /></div>
              <div className="nc-desc">Open settings from the palette.</div>
            </a>
          </div>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
