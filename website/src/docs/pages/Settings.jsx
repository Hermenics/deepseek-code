import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "levels", label: "The three levels" },
  { id: "resolution", label: "How a value is resolved" },
  { id: "diagnostics", label: "Validation & unknown paths" },
  { id: "provider", label: "provider" },
  { id: "models", label: "model" },
  { id: "agents", label: "agents" },
  { id: "permissions-risk", label: "permissions & risk" },
  { id: "compaction", label: "compaction & promptRefiner" },
  { id: "git", label: "git" },
  { id: "interface", label: "interface" },
  { id: "rest", label: "memory, sessions, lsp, mcp, goal, workflows" },
  { id: "hooks", label: "hooks" },
  { id: "legacy", label: "Legacy keys" },
  { id: "export", label: "Exporting settings" },
];

const LEVELS = [
  ["local", ".deepseek/settings.local.json", "Highest", "Personal, machine-specific. Do not commit."],
  ["project", ".deepseek/settings.json", "Middle", "Team configuration. Commit this."],
  ["user", "~/.deepseek/settings.json", "Lowest", "Your defaults across every project."],
];

const PROVIDER = [
  ["provider.name", "ProviderName", "deepseek, bedrock, vertex or local."],
  ["provider.endpoint", "string", "Base URL override — gateways, proxies, local runtimes."],
  ["provider.region", "string", "AWS region for Bedrock."],
  ["provider.profile", "string", "AWS profile for Bedrock."],
  ["provider.projectId", "string", "GCP project for Vertex."],
  ["provider.location", "string", "GCP location for Vertex."],
  ["provider.timeoutMs", "number", "Timeout used by the settings screen's connection test; minimum 100 ms."],
];

const MODELS = [
  ["model", "string | ModelSettings", "A bare string is the default model. An object splits it out."],
  ["model.default", "string", "The model for your main session."],
  ["model.subagent", "string", "Compatibility fallback for workers; agents.subagentModel has priority."],
];

const AGENTS = [
  ["agents.default", "string", "—", "Default agent to load."],
  ["agents.additionalDirectories", "string[]", "—", "Extra directories scanned for agent definitions."],
  ["agents.basePrompt", "string", "—", "Prompt prefix applied to every agent."],
  ["agents.subagentModel", "string", "—", "Worker model. Overlaps model.subagent."],
  ["agents.concurrency", "number", "5", "Tasks running at once per session."],
  ["agents.permissionPolicy", "'inherit' | 'isolated'", "—", "Whether workers inherit the parent's permissions."],
  ["agents.disabledBuiltins", "string[]", "—", "Built-in agents to switch off."],
  ["agents.maxTasks", "number", "17", "Total tasks a session may create."],
  ["agents.maxDepth", "number", "2", "How deep delegation may nest."],
  ["agents.maxFanOut", "number", "5", "Children per parent."],
  ["agents.maxRetries", "number", "1", "Bounded retries per task."],
  ["agents.timeoutMs", "number", "120000", "Per-attempt deadline."],
  ["agents.retryBackoffMs", "number", "—", "Base for exponential retry backoff."],
  ["agents.maxTokens", "number", "—", "Token budget for the session's delegated work."],
  ["agents.maxCostUsd", "number", "—", "Cost budget for the session's delegated work."],
];

const PERMS = [
  ["permissions.allow", "string[]", "Rules like Shell(git status). No pattern means every use."],
  ["permissions.deny", "string[]", "Refusals. Cannot be suppressed at a narrower level."],
  ["permissions.suppress", "string[]", "Exact inherited allow rules to disable here."],
  ["permissions.autoApproveLowRisk", "boolean", "Approve anything that matched no risk rule."],
  ["risk.enabled", "boolean", "false keeps high rules and silences medium ones."],
  ["risk.rules", "RiskRule[]", "Override defaults by id, or append new ids."],
  ["risk.thresholds.largeFileLines", "number (100)", "Lines that make an overwrite large."],
  ["risk.thresholds.burstCount", "number (3)", "Writes in succession that count as a burst."],
];

const COMPACT = [
  ["compaction.enabled", "boolean (true)", "Controls the configurable pre-turn auto-compact check."],
  ["compaction.threshold", "number (0.90)", "Pre-turn context ratio; valid range 0.70–0.95."],
  ["promptRefiner.enabled", "boolean", "Rewrite prompts for clarity before sending."],
  ["promptRefiner.model", "string", "Model used for the rewrite."],
  ["promptRefiner.minimumLength", "number (30)", "Messages shorter than this are not refined."],
  ["promptRefiner.excludeTypes", "string[]", "Reserved setting; the current refiner path does not consume it."],
];

const GIT = [
  ["git.checkpoint", "boolean", "Snapshot a file before a built-in mutating file tool changes it."],
  ["git.worktree", "'off' | 'ask' | 'auto'", "Whether risky work is isolated into a worktree."],
  ["git.branchPattern", "string", "Default deepseek/{slug}-{shortId}. Sanitized after substitution."],
  ["git.reviewDiff", "boolean", "Show a consolidated diff at end of turn."],
  ["git.verifyAfterEdit", "boolean", "Offer the detected project test command after changed files."],
  ["git.generatedPatterns", "string[]", "Paths treated as generated output."],
];

const INTERFACE = [
  ["interface.theme", "ThemeName", "Color theme."],
  ["interface.language", "string", "Response language."],
  ["interface.vim", "boolean", "Vim keybindings."],
  ["interface.density", "'compact' | 'comfortable'", "Vertical spacing."],
  ["interface.reducedMotion", "boolean", "Suppress animation."],
  ["interface.alternateScreen", "boolean", "Use the terminal's alternate screen buffer."],
  ["interface.showThoughts", "boolean", "Render reasoning blocks."],
  ["interface.showToolCalls", "boolean", "Render tool calls inline."],
  ["interface.showDiffs", "boolean", "Render diffs for edits."],
  ["interface.statusBar", "StatusBarItem[]", "Items shown: mode, model, tokens, branch, context."],
  ["interface.narrowPriority", "StatusBarItem[]", "Which items survive on a narrow terminal."],
];

const REST = [
  ["memory.enabled", "boolean", "Whether the agent may persist memory."],
  ["memory.scope", "'user' | 'project'", "Where memory is written."],
  ["sessions.retention", "number", "How many sessions to keep."],
  ["sessions.autoResume", "'off' | 'project-last'", "Resume the last session for this project on launch."],
  ["lsp.servers", "LspServerSettings[]", "name, command, args, extensions, languageId."],
  ["lsp.timeoutMs", "number", "Language-server request timeout."],
  ["mcp.enabled", "boolean", "User-scoped permission to load project MCP servers."],
  ["goal.maxContinuations", "number", "Cap on automatic goal continuations."],
  ["workflows.enabled", "boolean", "false disables dynamic workflows."],
];

const LEGACY = [
  ["theme", "interface.theme"],
  ["language", "interface.language"],
  ["autoCompact", "compaction.enabled"],
  ["autoCompactThreshold", "compaction.threshold"],
];

function KeyTable({ rows, cols }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <thead>
          <tr>
            <th style={{ width: "30%" }}>{cols[0]}</th>
            <th style={{ width: cols.length === 4 ? "20%" : "24%" }}>{cols[1]}</th>
            {cols.length === 4 && <th style={{ width: "12%" }}>{cols[2]}</th>}
            <th>{cols[cols.length - 1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              <td><code className="inline">{r[0]}</code></td>
              <td><code className="inline">{r[1]}</code></td>
              {cols.length === 4 && <td><code className="inline">{r[2]}</code></td>}
              <td>{r[r.length - 1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
            Three layered files, one merged result, and a loader that records where every effective value
            came from.
          </p>
        </div>

        <section id="levels">
          <h2><span className="anchor">#</span>The three levels</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "14%" }}>Level</th>
                  <th style={{ width: "32%" }}>File</th>
                  <th style={{ width: "14%" }}>Priority</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map(([l, f, p, u]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{f}</code></td>
                    <td>{p}</td>
                    <td>{u}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Three levels rather than two exists to solve one specific conflict: a team needs shared
            configuration in version control, and an individual needs to deviate without dirtying the
            repository. <code className="inline">project</code> is committed,{" "}
            <code className="inline">local</code> is gitignored, and both sit above your personal defaults.
          </p>
          <Note>
            <code className="inline">settings.local.json</code> being gitignored is also the most common source
            of "why is my project setting ignored" — it is invisible in every diff and review. See{" "}
            <a href="/docs/debug-config#origins">Debug your config</a>.
          </Note>
        </section>

        <section id="resolution">
          <h2><span className="anchor">#</span>How a value is resolved</h2>
          <p>
            The loader does more than merge. It produces a snapshot recording, for every setting path, the{" "}
            <b>effective value</b>, the <b>origin</b> level that supplied it, and every explicitly supplied
            candidate in precedence order:
          </p>
          <CodeBlock lang="text">{`agents.subagentModel
  effective  deepseek-v4-flash
  origin     local
  candidates user    → deepseek-v4-pro
             project → deepseek-v4-pro
             local   → deepseek-v4-flash`}</CodeBlock>
          <p>
            Keeping every candidate—including the winning value—rather than discarding it is what turns
            "this setting is not working" from an investigation into a lookup. Origin can also be{" "}
            <code className="inline">default</code> (nothing set it) or <code className="inline">legacy</code> (it
            came from a deprecated flat key).
          </p>
          <p>
            Each level is loaded into its own <code className="inline">SettingsFileState</code> with its own
            optional <code className="inline">error</code>. A malformed project file does not prevent your user
            settings from loading — partial configuration beats no session.
          </p>
        </section>

        <section id="diagnostics">
          <h2><span className="anchor">#</span>Validation & unknown paths</h2>
          <p>
            Two diagnostics catch most mistakes.
          </p>
          <p>
            <b><code className="inline">unknownPaths</code></b> lists unrecognized <em>top-level</em> keys present
            in your files. The settings type ends with an index signature, so an unknown key is legal JSON
            and simply never read — a misspelled{" "}
            <code className="inline">"compation"</code> produces no error anywhere except this list.
          </p>
          <p>
            <b><code className="inline">ValidationIssue</code></b> carries a <code className="inline">path</code>,
            the <code className="inline">level</code> it came from, a{" "}
            <code className="inline">severity</code> of <code className="inline">error</code> or{" "}
            <code className="inline">warning</code>, and a message. The level is what makes it actionable: the
            same bad value in three files needs three different fixes.
          </p>
          <p>
            Warnings exist so a deprecated-but-working key can be reported without being treated as broken.
          </p>
        </section>

        <section id="provider">
          <h2><span className="anchor">#</span>provider</h2>
          <KeyTable rows={PROVIDER} cols={["Key", "Type", "Meaning"]} />
          <CodeBlock lang="json">{`{ "provider": { "name": "bedrock", "region": "us-east-1", "profile": "work" } }`}</CodeBlock>
          <p>
            Note what is <b>not</b> here: secrets. The setup flow stores a DeepSeek API key and Vertex
            credential-file path in private <code className="inline">~/.deepseek/config.json</code>; DeepSeek
            and AWS credentials may also come from supported environment variables. Never put them in project
            settings designed to be committed. See{" "}
            <a href="/docs/env-vars">Environment variables</a>.
          </p>
          <p>
            <code className="inline">provider.endpoint</code> takes priority over{" "}
            <code className="inline">DEEPSEEK_BASE_URL</code> — an explicit setting beats an ambient variable.
          </p>
        </section>

        <section id="models">
          <h2><span className="anchor">#</span>model</h2>
          <KeyTable rows={MODELS} cols={["Key", "Type", "Meaning"]} />
          <p>
            <code className="inline">model</code> accepts <b>either a string or an object</b>. The string form is
            backward compatibility carried forward as an ergonomic win — most people want one model, and{" "}
            <code className="inline">"model": "deepseek-v4-pro"</code> should not require an object.
          </p>
          <CodeBlock lang="json">{`{ "model": "deepseek-v4-pro" }

{ "model": { "default": "deepseek-v4-pro", "subagent": "deepseek-v4-flash" } }`}</CodeBlock>
          <p>
            Prefer <code className="inline">agents.subagentModel</code> for delegated work. The runtime resolves
            an explicit task model first, then a named agent's model, then{" "}
            <code className="inline">agents.subagentModel</code>, then the compatibility{" "}
            <code className="inline">model.subagent</code>, and finally the current/default model. See{" "}
            <a href="/docs/model-config#subagent">Model configuration</a>.
          </p>
        </section>

        <section id="agents">
          <h2><span className="anchor">#</span>agents</h2>
          <KeyTable rows={AGENTS} cols={["Key", "Type", "Default", "Meaning"]} />
          <p>
            These replace the orchestrator defaults and are then normalized against hard runtime bounds.
            For example, settings may raise concurrency above its default of 5, but settings validation caps
            it at 16; lower-level runtime normalization provides additional absolute clamps for all limits.
          </p>
          <p>
            <code className="inline">maxTokens</code> and <code className="inline">maxCostUsd</code> are budgets
            for delegated work. Exceeding them surfaces as{" "}
            <code className="inline">BUDGET_EXCEEDED</code> rather than as a silent truncation. See{" "}
            <a href="/docs/agent-teams#limits">Agent teams</a>.
          </p>
        </section>

        <section id="permissions-risk">
          <h2><span className="anchor">#</span>permissions & risk</h2>
          <KeyTable rows={PERMS} cols={["Key", "Type", "Meaning"]} />
          <p>
            Two independent systems share this section.{" "}
            <code className="inline">permissions</code> is declarative allow/deny;{" "}
            <code className="inline">risk</code> is the pattern-based classifier with around fifty built-in
            rules.
          </p>
          <p>
            <code className="inline">risk.enabled: false</code> does <b>not</b> disable risk assessment — it
            keeps every <b>high</b> rule and silences only <b>medium</b> ones. There is no setting that turns
            off confirmation for <code className="inline">rm -rf</code>.
          </p>
          <p>
            Overriding a rule by id is likewise asymmetric: medium rules are fully overridable, high rules
            keep their level and stay enabled regardless of what you write. Full detail in{" "}
            <a href="/docs/permissions">Permissions</a>.
          </p>
        </section>

        <section id="compaction">
          <h2><span className="anchor">#</span>compaction & promptRefiner</h2>
          <KeyTable rows={COMPACT} cols={["Key", "Type / default", "Meaning"]} />
          <p>
            <code className="inline">promptRefiner</code> rewrites a prompt for clarity before sending it.{" "}
            <code className="inline">minimumLength</code> defaults to 30 characters — refining "fix this" costs
            a model call to add nothing, since there is no intent to clarify.
          </p>
          <p>
            The refiner is instructed to preserve intent, but its result is still model-generated and may
            rephrase or omit nuance. Use the preview in <code className="inline">/config</code> when exact wording
            matters, or disable it when your prompts are already precise, including in{" "}
            <a href="/docs/headless">headless mode</a> — where the saved preference is honored.
          </p>
        </section>

        <section id="git">
          <h2><span className="anchor">#</span>git</h2>
          <KeyTable rows={GIT} cols={["Key", "Type", "Meaning"]} />
          <p>
            <code className="inline">git.worktree</code> has three values rather than a boolean, and the middle
            one is the useful one: <code className="inline">ask</code> offers isolation for risky work instead of
            always or never creating a worktree.
          </p>
          <p>
            <code className="inline">git.branchPattern</code> is substituted with{" "}
            <code className="inline">{"{slug}"}</code> and <code className="inline">{"{shortId}"}</code>, then{" "}
            <b>sanitized</b> — anything outside <code className="inline">[a-zA-Z0-9/_-]</code> becomes a hyphen.
            A pattern containing spaces or shell metacharacters cannot produce an invalid or dangerous ref.
            See <a href="/docs/worktrees#branches">Worktrees</a>.
          </p>
        </section>

        <section id="interface">
          <h2><span className="anchor">#</span>interface</h2>
          <KeyTable rows={INTERFACE} cols={["Key", "Type", "Meaning"]} />
          <p>
            <code className="inline">statusBar</code> and <code className="inline">narrowPriority</code> are a pair.
            The first lists what you want; the second lists what survives when the terminal is too narrow for
            all of it. Without the second, a narrow window would drop items in arbitrary order.
          </p>
          <CodeBlock lang="json">{`{ "interface": {
    "statusBar": ["mode", "model", "context", "tokens", "branch"],
    "narrowPriority": ["mode", "context"]
} }`}</CodeBlock>
          <p>
            See <a href="/docs/interface">Interface</a> and <a href="/docs/themes">Themes</a>.
          </p>
        </section>

        <section id="rest">
          <h2><span className="anchor">#</span>memory, sessions, lsp, mcp, goal, workflows</h2>
          <KeyTable rows={REST} cols={["Key", "Type", "Meaning"]} />
          <p>
            Two of these carry comments in the source marking them <b>user-scoped</b> on purpose.{" "}
            <code className="inline">lsp.servers</code> defines executable commands, and{" "}
            <code className="inline">mcp.enabled</code> governs whether project MCP servers load at all.
          </p>
          <p>
            Both are capabilities a cloned repository should not be able to grant itself: a project file that
            could register an executable language server, or auto-load an MCP server, would be remote code
            execution by <code className="inline">git clone</code>. Keeping them at the user level means the
            decision is always yours.
          </p>
          <CodeBlock lang="json">{`// ~/.deepseek/settings.json
{ "lsp": { "servers": [
    { "name": "typescript", "command": "typescript-language-server",
      "args": ["--stdio"], "extensions": [".ts", ".tsx"] }
] } }`}</CodeBlock>
        </section>

        <section id="hooks">
          <h2><span className="anchor">#</span>hooks</h2>
          <p>
            <code className="inline">hooks</code> takes a <code className="inline">HooksConfig</code> with three
            keys — <code className="inline">PreToolUse</code>, <code className="inline">PostToolUse</code> and{" "}
            <code className="inline">SessionStart</code>. The first two hold matcher lists; the third holds a
            flat command list.
          </p>
          <CodeBlock lang="json">{`{ "hooks": {
    "PostToolUse": [
      { "matcher": "edit_file|write_file",
        "hooks": [{ "type": "command", "command": "bunx tsc --noEmit" }] }
    ]
} }`}</CodeBlock>
          <p>
            Hooks run <code className="inline">sh -c</code> with your OS permissions. A failing PreToolUse
            hook returns a block decision; PostToolUse hooks are launched asynchronously and SessionStart
            failures are recorded without aborting initialization. Read <a href="/docs/hooks">Hooks</a> before
            enabling one you did not write.
          </p>
        </section>

        <section id="legacy">
          <h2><span className="anchor">#</span>Legacy keys</h2>
          <p>
            Four flat keys predate the nested structure and remain readable:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "36%" }}>Legacy key</th><th>Now</th></tr>
              </thead>
              <tbody>
                {LEGACY.map(([l, n]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{n}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The nested form wins when both are present. Values resolved from a legacy key report their origin
            as <code className="inline">legacy</code>, which is how you find them without grepping your files —
            the snapshot tells you which settings are still arriving the old way.
          </p>
        </section>

        <section id="export">
          <h2><span className="anchor">#</span>Exporting settings</h2>
          <p>
            The settings screen writes a versioned bundle — <code className="inline">version</code>,{" "}
            <code className="inline">exportedAt</code>, effective <code className="inline">settings</code>, memory,
            and the saved-session index — below the current project's{" "}
            <code className="inline">.deepseek/settings-export-&lt;timestamp&gt;.json</code>.
          </p>
          <p>
            The repository export API accepts memory and sessions as optional fields, but the interactive
            Export action supplies both. Secret-looking keys are removed recursively; project content is not.
            Review and redact the file before sharing it, or create a settings-only export through the API.
          </p>
          <CodeBlock lang="bash">{`/config     # fullscreen settings center — alias /settings
/doctor     # resolved values with their origin level`}</CodeBlock>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
