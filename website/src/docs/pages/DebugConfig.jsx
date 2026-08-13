import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "doctor", label: "Start with /doctor" },
  { id: "checks", label: "The six checks" },
  { id: "reading", label: "Reading the report" },
  { id: "mcp", label: "The MCP check" },
  { id: "origins", label: "Where a setting came from" },
  { id: "unknown", label: "Unknown paths & validation" },
  { id: "prompt", label: "System-summary boundary" },
  { id: "context", label: "Inspecting the context" },
  { id: "tools", label: "Inspecting tools & permissions" },
  { id: "workflow", label: "A debugging workflow" },
];

const CHECKS = [
  ["Runtime", "Bun.version", "Confirms which runtime is executing and its version."],
  ["Workspace", "existsSync(cwd) + accessibility", "The directory the session is rooted at."],
  ["Git", "on PATH", "Required for worktrees and the Git tool."],
  ["ripgrep", "on PATH", "Optional. Absent means search falls back to something slower."],
  ["Credentials", "credentials file exists", "Whether a provider is configured at all."],
  ["Settings", "settings file or loaded settings", "Reports the resolved provider name."],
];

const FIXES = [
  ["✗ Git: not found on PATH", "Install git. Worktrees and the Git tool are unavailable without it."],
  ["✗ ripgrep: not found on PATH", "Install ripgrep. Not fatal — search is just slower."],
  ["✗ Credentials: not found", "Run the provider setup, or export DEEPSEEK_API_KEY."],
  ["✗ Workspace: not accessible", "You launched in a directory that was deleted or is unreadable. cd somewhere valid."],
  ["✗ MCP config: invalid JSON", "The message includes the parse error. Fix .deepseek/mcp.json."],
];

const INSPECT = [
  ["/doctor", "Environment and configuration health."],
  ["/system", "Safe active-mode, allowlist, approval, permission and risk summary."],
  ["/context", "Where your context budget is going, by category."],
  ["/tools", "Which tools are enabled right now."],
  ["/permissions", "Effective allow, deny and risk rules."],
  ["/config", "Provider and language configuration."],
  ["/features", "Feature flags and their current values."],
  ["/cost", "Token usage and spend, including the cached fraction."],
];

const WORKFLOW = [
  ["Nothing works at all", "/doctor", "Credentials or workspace almost always."],
  ["A rule is ignored", "/cwd, file checks, then restart", "Confirm the project root and that the .md file exists and is readable; /system cannot display prompt text."],
  ["A setting has no effect", "Check level precedence", "A local file may be overriding your project file."],
  ["A tool is unavailable", "/tools then /permissions", "Either not enabled, or denied by a rule."],
  ["Responses got expensive", "/context then /cost", "Usually tool results or a large fixed floor."],
  ["An MCP server is missing", "/doctor", "The MCP check reports invalid JSON with the parse error."],
];

export default function DebugConfig() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Debug your config</span>
        </nav>

        <div className="hero">
          <h1>Debug your config</h1>
          <p className="tagline">
            When behavior does not match expectation, the cause is almost always a setting resolving from a
            level you forgot about. Here is how to find out which.
          </p>
        </div>

        <section id="doctor">
          <h2><span className="anchor">#</span>Start with /doctor</h2>
          <p>
            <code className="inline">/doctor</code> runs a fixed set of environment checks and prints a
            pass/fail line for each:
          </p>
          <CodeBlock lang="text">{`> /doctor
✓ Runtime: Bun 1.1.38
✓ Workspace: /home/you/proj
✓ Git: available
✗ ripgrep: not found on PATH; search may be slower
✓ Credentials: configured
✓ Settings: provider: deepseek
✓ MCP config: 2 servers configured

1 check needs attention.`}</CodeBlock>
          <p>
            It is deliberately cheap and non-interactive — filesystem existence checks and PATH lookups, no
            network calls, no model calls. That makes it safe to run any time, including as the first thing
            you do when something is behaving strangely.
          </p>
        </section>

        <section id="checks">
          <h2><span className="anchor">#</span>The six checks</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Check</th><th style={{ width: "30%" }}>Tests</th><th>Why it matters</th></tr>
              </thead>
              <tbody>
                {CHECKS.map(([c, t, w]) => (
                  <tr key={c}>
                    <td><b style={{ color: "var(--text-strong)" }}>{c}</b></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The <b>ripgrep</b> check is the one that surprises people by being non-fatal. Its detail text says
            so explicitly — <em>search may be slower</em> — because a missing optional dependency should read
            differently from a missing required one, even though both render with a{" "}
            <code className="inline">✗</code>.
          </p>
          <p>
            The <b>Credentials</b> check tells you what to do rather than just what is wrong:{" "}
            <em>configure a provider before starting a session</em>. A failing check that does not suggest the
            next step is a check you have to look up.
          </p>
        </section>

        <section id="reading">
          <h2><span className="anchor">#</span>Reading the report</h2>
          <p>
            The summary line at the bottom is the actual verdict:
          </p>
          <CodeBlock lang="text">{`Everything looks ready.        — nothing failed
2 checks need attention.      — count of failures`}</CodeBlock>
          <p>
            Note the wording: <em>need attention</em>, not <em>failed</em>. Several checks are advisory, and
            a report with one <code className="inline">✗</code> can describe a perfectly working setup.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "38%" }}>Line</th><th>Fix</th></tr>
              </thead>
              <tbody>
                {FIXES.map(([l, f]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td>{f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            The Workspace check is special-cased: if the directory exists but is not accessible, the check is{" "}
            <em>replaced</em> with a failure saying so. Existing and being usable are different conditions and
            get different messages.
          </Note>
        </section>

        <section id="mcp">
          <h2><span className="anchor">#</span>The MCP check</h2>
          <p>
            The MCP check has three outcomes rather than two:
          </p>
          <CodeBlock lang="text">{`✓ MCP config: none configured           no file — fine
✓ MCP config: 2 servers configured      parsed, count reported
✗ MCP config: invalid JSON: <error>     the actual parse error`}</CodeBlock>
          <p>
            "No config" is a <b>pass</b>, not a failure. Most projects do not use MCP, and reporting its
            absence as a problem would train people to ignore the report.
          </p>
          <p>
            When the JSON is broken, the parser's own error message is included. A trailing comma in{" "}
            <code className="inline">.deepseek/mcp.json</code> is otherwise a silent failure where servers just
            do not appear, and you have no reason to suspect the file.
          </p>
        </section>

        <section id="origins">
          <h2><span className="anchor">#</span>Where a setting came from</h2>
          <p>
            This is the single most common configuration confusion: a setting that has no effect because
            something else is overriding it.
          </p>
          <p>
            Settings resolve across three levels — <code className="inline">user</code>,{" "}
            <code className="inline">project</code>, <code className="inline">local</code> — with local winning. The
            loader does not just merge them; it records an <b>origin</b> for every resolved path and the full
            list of values that were overridden.
          </p>
          <CodeBlock lang="text">{`agents.subagentModel
  effective  deepseek-v4-flash
  origin     local
  overrides  project → deepseek-v4-pro
             user    → deepseek-v4-pro`}</CodeBlock>
          <p>
            When a project setting appears to be ignored, the answer is nearly always a{" "}
            <code className="inline">.deepseek/settings.local.json</code> you created weeks ago and forgot.
            Because it is gitignored, it is invisible in every diff and code review.
          </p>
          <p>
            The <code className="inline">suppress</code> mechanism in permissions is worth remembering here too:
            it removes an inherited allow rule at a narrower scope, but <b>deny rules cannot be
            suppressed</b>. A denied tool stays denied no matter what a lower level says. See{" "}
            <a href="/docs/permissions">Permissions</a>.
          </p>
        </section>

        <section id="unknown">
          <h2><span className="anchor">#</span>Unknown paths & validation</h2>
          <p>
            The settings loader produces two diagnostics that catch most typos:
          </p>
          <p>
            <b><code className="inline">unknownPaths</code></b> lists keys present in your files that the schema
            does not recognize. A misspelled <code className="inline">"compation"</code> does not error — it is
            simply never read — so this list is the only place it becomes visible.
          </p>
          <p>
            <b><code className="inline">ValidationIssue</code></b> reports problems with a{" "}
            <code className="inline">path</code>, the <code className="inline">level</code> it came from, a{" "}
            <code className="inline">severity</code> of <code className="inline">error</code> or{" "}
            <code className="inline">warning</code>, and a message. The level is what makes it actionable — the
            same wrong value in three files needs three different fixes.
          </p>
          <p>
            Malformed files are also non-fatal by design. Each level records its own{" "}
            <code className="inline">error</code>, so a broken project file does not prevent your user settings
            from loading. Partial configuration beats no session.
          </p>
        </section>

        <section id="prompt">
          <h2><span className="anchor">#</span>The system-summary boundary</h2>
          <p>
            <code className="inline">/system</code> does <b>not</b> print the assembled system prompt. It returns
            a deliberately safe snapshot containing the interaction mode, custom-agent allowlist, tools admitted
            by the mode, approvals granted in this process, and effective permission/risk settings.
          </p>
          <CodeBlock lang="text">{`> /system
Active mode & permissions:

Mode: build
Allowed tools: no restriction
Mode tools (18): …
Session approvals: none
Permission rules: {"autoApproveLowRisk":false}
Risk rules: {"enabled":true}`}</CodeBlock>
          <p>
            The command never exposes steering content, <code className="inline">AGENTS.md</code>,
            <code className="inline">DEEPSEEK.md</code>, memory text, effort instructions, hooks or the base
            prompt. It therefore cannot prove that one specific rule reached the model.
          </p>
          <p>
            To diagnose project instructions, first run <code className="inline">/cwd</code>, then inspect the
            expected files in that exact workspace. Steering accepts readable
            <code className="inline">.deepseek/steering/*.md</code> files; the two supported project entry files
            are root <code className="inline">AGENTS.md</code> and root or
            <code className="inline">.deepseek/DEEPSEEK.md</code>. Restart after edits so initialization reads
            them again. Changing directories with <code className="inline">/cwd</code> also rebuilds project context.
          </p>
          <p>
            <code className="inline">/context</code> can show whether the aggregate System Prompt category is
            unexpectedly large, but it is a proportional size estimate, not a content inspector. If files are
            present and freshly loaded but behavior still differs, check for contradictory instructions and
            reduce unnecessary prompt volume.
          </p>
          <Note>
            Older help text calls <code className="inline">/system</code> “show the system prompt.” That label
            is stale; the runtime intentionally returns only the safe mode-and-permission summary.
          </Note>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Inspecting the context</h2>
          <p>
            <code className="inline">/context</code> is a configuration tool as much as a budget tool. The
            category breakdown diagnoses different problems:
          </p>
          <p>
            A large <b>System Prompt</b> means steering or project instructions have grown. A large{" "}
            <b>Tools</b> figure means many tools are enabled — disabling unused ones is the only lever on
            that category. A large <b>Memory</b> figure means the memory store has accumulated more than it
            needs.
          </p>
          <p>
            All three are <a href="/docs/context-window#reducing">fixed floor</a> costs paid on every call,
            which is why they are worth auditing occasionally rather than only when something breaks.
          </p>
        </section>

        <section id="tools">
          <h2><span className="anchor">#</span>Inspecting tools & permissions</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Command</th><th>Shows</th></tr>
              </thead>
              <tbody>
                {INSPECT.map(([c, s]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{s}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            When a tool call is refused, the prompt carries a{" "}
            <a href="/docs/how-it-works#gates">reason</a> —{" "}
            <code className="inline">outside_workspace</code>, <code className="inline">risk</code>,{" "}
            <code className="inline">permission</code>, <code className="inline">agent_config</code> or{" "}
            <code className="inline">workflow</code>. Read the reason before changing configuration: a{" "}
            <code className="inline">risk</code> refusal and a <code className="inline">permission</code> refusal
            have completely different fixes.
          </p>
        </section>

        <section id="workflow">
          <h2><span className="anchor">#</span>A debugging workflow</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Symptom</th><th style={{ width: "24%" }}>Check first</th><th>Usual cause</th></tr>
              </thead>
              <tbody>
                {WORKFLOW.map(([s, c, u]) => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td><code className="inline">{c}</code></td>
                    <td>{u}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The general order is: <b>environment</b> (<code className="inline">/doctor</code>), then{" "}
            <b>configuration</b> (levels and origins), then <b>runtime policy and context size</b>{" "}
            (<code className="inline">/system</code>, <code className="inline">/permissions</code>,
            <code className="inline">/context</code>). Inspect instruction files directly because no slash
            command reveals the complete model prompt. Most people start in the middle, changing settings
            before confirming the environment is sound.
          </p>
          <p>
            For failures during a run rather than at configuration time, the{" "}
            <a href="/docs/monitoring-audit">audit log</a> has every tool call with its arguments and
            duration. Related: <a href="/docs/errors">Error reference</a>,{" "}
            <a href="/docs/troubleshooting">Troubleshooting</a>.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
