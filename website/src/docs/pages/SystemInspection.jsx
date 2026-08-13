import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "system", label: "/system at a glance" },
  { id: "not-prompt", label: "It does not reveal the prompt" },
  { id: "fields", label: "Read every field" },
  { id: "permissions", label: "/system vs /permissions" },
  { id: "tools", label: "Inspect available tools" },
  { id: "runtime", label: "Inspect runtime health" },
  { id: "usage", label: "Inspect context and usage" },
  { id: "activity", label: "Inspect session activity" },
  { id: "workflow", label: "A diagnostic workflow" },
  { id: "security", label: "Security and disclosure boundary" },
  { id: "limits", label: "Limits and stale state" },
];

const SYSTEM_FIELDS = [
  ["Mode", "The active Build, Plan, Review or Auto interaction mode."],
  ["Allowed tools", "The active custom-agent allowlist: unrestricted, a named list, or all tools with confirmation."],
  ["Mode tools", "The concrete built-in tool names admitted by the current interaction-mode gate."],
  ["Session approvals", "Tool or external-directory approvals granted for the current process."],
  ["Permission rules", "The effective settings permission object, rendered as compact JSON."],
  ["Risk rules", "The effective risk configuration, rendered as compact JSON."],
];

const COMMANDS = [
  ["/system", "Mode and raw permission-policy snapshot", "No", "No"],
  ["/permissions", "Explained tool-authorization decision layers", "No", "No"],
  ["/tools", "Names of currently registered built-in and MCP tools", "No", "No"],
  ["/doctor", "Runtime, workspace, local executables, credentials-file presence, settings and MCP JSON", "Local probes", "No"],
  ["/context or /ctx", "Exact last provider total plus estimated category allocation", "No", "No"],
  ["/cost", "Cumulative token counters and estimated cost", "No", "No"],
  ["/stats", "Process duration, model/provider, token/activity/context and estimated cost", "No", "No"],
  ["/files", "Paths tracked as modified during the current in-process history", "No", "No"],
  ["/tasks", "Task DAG and states", "No", "No"],
  ["/sessions", "Up to ten recent persisted session summaries", "Disk reads", "No"],
];

export default function SystemInspection() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">System inspection</span>
        </nav>

        <div className="hero">
          <h1>System inspection</h1>
          <p className="tagline">Inspect the active mode, permissions, tools, runtime, context and session state without sending an agent prompt or exposing hidden instructions.</p>
        </div>

        <section id="system">
          <h2><span className="anchor">#</span><code className="inline">/system</code> at a glance</h2>
          <p>
            <code className="inline">/system</code> appends a safe, read-only snapshot of the main agent&apos;s
            interaction mode and authorization inputs. It performs no provider request, spends no model tokens
            and does not execute a tool.
          </p>
          <CodeBlock lang="text">{"> /system\nActive mode & permissions:\n\nMode: build\nAllowed tools: no restriction\nMode tools (18): read_file, write_file, patch_file, shell, …\nSession approvals: none\nPermission rules: {\"autoApproveLowRisk\":false}\nRisk rules: {\"enabled\":true,\"thresholds\":{\"largeFileLines\":100,\"burstCount\":3}}"}</CodeBlock>
          <p>
            The tool count and names vary with the installed version and active mode. Permission and risk JSON
            reflect effective layered settings, so project/local overrides can make two workspaces report differently.
          </p>
          <h3>Inspection command map</h3>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "19%" }}>Command</th><th>Reports</th><th style={{ width: "16%" }}>External work</th><th style={{ width: "13%" }}>Model tokens</th></tr></thead>
            <tbody>{COMMANDS.map(([command, reports, external, tokens]) => (
              <tr key={command}><td><code className="inline">{command}</code></td><td>{reports}</td><td>{external}</td><td>{tokens}</td></tr>
            ))}</tbody>
          </table></div>
        </section>

        <section id="not-prompt">
          <h2><span className="anchor">#</span>It does not reveal the prompt</h2>
          <p>
            Despite older help text describing it as “show the system prompt,” the command never returns the
            internal system prompt, steering text, <code className="inline">AGENTS.md</code>,
            <code className="inline">DEEPSEEK.md</code>, memory snapshot, hook content or other hidden instructions.
            It calls the summary “Active mode & permissions” and encloses only that safe summary in a code block.
          </p>
          <Note>
            Use <code className="inline">/system</code> to answer “what may this agent do right now?” It cannot
            answer “what exact instructions were sent to the model?”
          </Note>
        </section>

        <section id="fields">
          <h2><span className="anchor">#</span>Read every field</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "27%" }}>Field</th><th>Meaning</th></tr></thead>
            <tbody>{SYSTEM_FIELDS.map(([field, meaning]) => (
              <tr key={field}><td><b>{field}</b></td><td>{meaning}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            “Allowed tools: no restriction” means no custom-agent-specific allowlist is active; it does
            <b> not</b> bypass the interaction-mode gate, settings policy, risk checks, hooks, path safety or
            per-call confirmations. Likewise, an item under session approvals does not authorize unrelated
            tools or paths.
          </p>
          <p>
            “All (each call confirmed)” is the special custom-agent wildcard state. It means all tools are in
            scope for that agent but each call still goes through confirmation and the other policy layers.
          </p>
        </section>

        <section id="permissions">
          <h2><span className="anchor">#</span><code className="inline">/system</code> vs <code className="inline">/permissions</code></h2>
          <p>
            Both commands inspect the same live permission state, but they format it for different jobs.
            <code className="inline">/system</code> is a compact safe summary of active mode and permissions.
            <code className="inline">/permissions</code> expands policy into user-facing categories and prints
            the decision order.
          </p>
          <CodeBlock lang="text">{"> /permissions\nCurrent mode: build\nTools allowed in mode: …\nAgent allowlist: no agent-specific allowlist\nSettings allow rules: none\nSettings deny rules: none\nRisk checks: enabled (…)\nApproved this session: none\n\nDecision order: mode gate -> risk rules in Build mode -> settings allow/deny rules outside Build mode -> agent allowlist -> hooks -> tool execution."}</CodeBlock>
          <p>
            Prefer <code className="inline">/permissions</code> when diagnosing why a call prompts or is denied.
            It reports default risk-rule counts, custom/overridden rule counts and effective large-overwrite and
            write-burst thresholds. Prefer <code className="inline">/system</code> when comparing the raw
            active mode and permission posture. Use <code className="inline">/config</code> to inspect settings
            origins and validation diagnostics.
          </p>
        </section>

        <section id="tools">
          <h2><span className="anchor">#</span>Inspect available tools</h2>
          <p>
            <code className="inline">/tools</code> lists the names currently registered on the agent. Names
            without the MCP separator appear under Built-in tools; connected MCP tool names appear in a
            separate MCP section.
          </p>
          <CodeBlock lang="text">{"> /tools\nBuilt-in tools (24):\n  read_file\n  write_file\n  shell\n  …\n\nMCP tools (3):\n  github__search_repositories\n  …"}</CodeBlock>
          <p>
            Registration is not authorization. A tool can appear here and still be unavailable in the current
            mode, excluded by an agent allowlist, denied by settings, blocked by path safety or subject to confirmation.
            Pair <code className="inline">/tools</code> with <code className="inline">/permissions</code>.
          </p>
          <p>
            The list is rebuilt when the agent initializes or the working directory changes. MCP tools appear
            only when MCP is enabled and their servers connected successfully; use the startup error message and
            <code className="inline">/doctor</code> for configuration problems.
          </p>
        </section>

        <section id="runtime">
          <h2><span className="anchor">#</span>Inspect runtime health</h2>
          <p>
            Run <code className="inline">/doctor</code> inside the TUI to check the <em>agent&apos;s active</em>
            working directory. The report covers Bun, workspace existence/access, Git and ripgrep availability,
            saved-credentials-file presence, effective provider name and project MCP JSON syntax/server count.
          </p>
          <CodeBlock lang="text">{"> /doctor\nDeepSeek Code doctor · /home/you/acme\n\n✓ Runtime: Bun 1.3.13\n✓ Workspace: /home/you/acme\n✓ Git: available\n✓ ripgrep: available\n✓ Credentials: configured\n✓ Settings: provider: deepseek\n✓ MCP config: 2 servers configured\n\nEverything looks ready."}</CodeBlock>
          <p>
            Doctor is a fast local diagnostic. It does not authenticate to a provider, send a model request,
            validate quota, start MCP servers, test Git repository health or prove write access. The standalone
            <code className="inline">deepseek doctor</code> variant checks the shell working directory and exits
            with status 1 if any line fails; the slash command only displays a message.
          </p>
        </section>

        <section id="usage">
          <h2><span className="anchor">#</span>Inspect context and usage</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "26%" }}>Command</th><th>Use it for</th><th>Accuracy boundary</th></tr></thead>
            <tbody>
              <tr><td><code className="inline">/context</code> / <code className="inline">/ctx</code></td><td>What occupies the current model window.</td><td>Total usage comes from the last provider response; category sizes are proportional character-based estimates.</td></tr>
              <tr><td><code className="inline">/cost</code></td><td>Model, cumulative prompt/completion/cache counters and estimated USD.</td><td>Unknown models use a fallback price table; it is not an invoice.</td></tr>
              <tr><td><code className="inline">/stats</code></td><td>Process duration, model/provider, tokens, user turns, tool calls, files, context and estimated cost.</td><td>Counters describe the live process, not necessarily all metadata loaded from a saved session.</td></tr>
            </tbody>
          </table></div>
          <CodeBlock lang="text">{"> /context\nContext: 42.0% (420,000 / 1,000,000 tokens)\n\n  (proportional estimates — total is exact from provider)\n\n  System Prompt  ███░░░░░░░░░░░░░░░░░  18%      75,600\n  Messages       █████░░░░░░░░░░░░░░░  31%     130,200\n  Free           ████████████░░░░░░░░  58%     580,000"}</CodeBlock>
          <p>
            Before the first successful provider response—or immediately after compaction until another response
            updates the total—<code className="inline">/context</code> reports that the breakdown is unavailable.
          </p>
        </section>

        <section id="activity">
          <h2><span className="anchor">#</span>Inspect session activity</h2>
          <p>
            Use <code className="inline">/files</code> for the in-memory set of paths the agent has tracked as
            modified, <code className="inline">/tasks</code> for the orchestration task tree, and
            <code className="inline">/workflows</code> for the interactive Dynamic Workflow monitor.
            <code className="inline">/sessions</code> reads persisted conversation summaries instead.
          </p>
          <CodeBlock lang="text">{"> /files\nFiles modified this session:\n  src/auth.ts\n  tests/auth.test.ts\n\n> /tasks\n# The current task DAG and states are displayed."}</CodeBlock>
          <p>
            These surfaces have different lifetimes. <code className="inline">/clear</code> empties the live
            modified-file set but does not alter files or task state. Resume loads conversation history but does
            not repopulate every process counter or the live modified-file tracker.
          </p>
        </section>

        <section id="workflow">
          <h2><span className="anchor">#</span>A diagnostic workflow</h2>
          <p>When behavior differs from expectation, inspect from broadest policy to narrowest symptom:</p>
          <CodeBlock lang="text">{"> /cwd\ncwd: /home/you/acme\n\n> /system\n# Confirm mode and raw effective policy.\n\n> /permissions\n# Confirm authorization layers and session approvals.\n\n> /tools\n# Confirm that the capability registered.\n\n> /doctor\n# Check local runtime and configuration shape.\n\n> /context\n# Check whether context pressure may be affecting the turn."}</CodeBlock>
          <p>
            This sequence is read-only and token-free. Only after it establishes the active state should you
            run a reproduction prompt or mutating tool workflow.
          </p>
        </section>

        <section id="security">
          <h2><span className="anchor">#</span>Security and disclosure boundary</h2>
          <p>
            Inspection output can still reveal absolute paths, model/provider choices, tool names, policy rules,
            approved external directories and session titles. Review it before pasting into an issue or chat.
            The safe <code className="inline">/system</code> boundary prevents prompt disclosure; it does not make
            every reported operational detail anonymous.
          </p>
          <p>
            <code className="inline">/sessions export</code> applies recognized secret redaction to a copy.
            Ordinary inspection messages shown in the TUI are not a substitute for that export pipeline.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and stale state</h2>
          <p>
            Most inspection commands snapshot in-memory state at invocation. Values can change immediately
            afterward: another task can finish, a provider turn can update usage, or a directory rebase can
            reload settings and tools. Run the relevant command again after a state transition.
          </p>
          <p>
            Model and effort selectors do not appear in <code className="inline">/system</code>; the active model
            is visible in the status bar and <code className="inline">/stats</code>, while effort is inspected by
            running <code className="inline">/effort</code>. The active provider appears in
            <code className="inline">/stats</code> and effective settings, not in the system summary.
          </p>
          <p>
            No inspection command proves that a future provider request or tool execution will succeed. Network,
            quota, filesystem races, hooks and per-call risk evaluation remain runtime boundaries.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
