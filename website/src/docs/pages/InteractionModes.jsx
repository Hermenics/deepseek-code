import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "The four modes" },
  { id: "gating", label: "What each mode allows" },
  { id: "plan-mode", label: "Plan mode" },
  { id: "config", label: "Configuring the default mode" },
];

const MODES = [
  ["Build (default)", "shell, write_file, patch_file, update_knowledge, subagent, ask_agent", "Unsafe actions confirm"],
  ["Plan", "write_plan, submit_plan", "Plan approval dialog"],
  ["Review", "—", "None"],
  ["Auto", "Allowlist bypassed — every tool", "None"],
];

export default function InteractionModes() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Interaction modes</span>
        </nav>

        <div className="hero">
          <h1>Interaction modes</h1>
          <p className="tagline">
            Four modes — Build, Plan, Review, Auto — that dial the model from "explore and propose" to "do everything".
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>The four modes</h2>
          <p>
            DeepSeek Code ships with four interaction modes — <b>Build</b>, <b>Plan</b>,{" "}
            <b>Review</b>, and <b>Auto</b> — that you cycle through with <code className="inline">Shift+Tab</code>.
            Each mode exposes its own tool allowlist, enforced in the agent's tool pipeline. The
            current mode shows in the status bar, and <b>Build is the default</b>.
          </p>
          <p>
            Every mode shares the same read-only base: <code className="inline">read_file</code>,{" "}
            <code className="inline">read_folder</code>, <code className="inline">glob</code>,{" "}
            <code className="inline">grep</code>, <code className="inline">lsp</code>,{" "}
            <code className="inline">web_fetch</code>, <code className="inline">introspect</code>,{" "}
            <code className="inline">todo</code>, <code className="inline">memory</code>,{" "}
            <code className="inline">git</code>, and <code className="inline">workflow</code>. On top of that base:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Mode</th><th style={{ width: "48%" }}>Extra tools</th><th>Confirmation</th></tr>
              </thead>
              <tbody>
                {MODES.map(([m, tools, conf]) => (
                  <tr key={m}>
                    <td><b style={{ color: "var(--text-strong)" }}>{m}</b></td>
                    <td><code className="inline">{tools}</code></td>
                    <td>{conf}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">Shift+Tab</code> walks the mode list <code className="inline">plan → review → build → auto</code>{" "}
            and wraps around, so from the default Build mode one press lands directly on Auto.
          </p>
        </section>

        <section id="gating">
          <h2><span className="anchor">#</span>What each mode allows</h2>
          <p>
            The per-mode allowlists are enforced in the agent's unified tool-execution pipeline: a
            tool that isn't in the current mode's allowlist is blocked before any hooks run, and the
            model gets an error such as{" "}
            <code className="inline">Tool 'X' is not available in &lt;mode&gt; mode. Switch to Build mode to use this tool.</code>{" "}
            The block is also written to the audit log.
          </p>
          <p>
            Two rules cut across the per-mode lists:
          </p>
          <ul className="capabilities">
            <li><b>MCP tools</b> (names containing <code className="inline">__</code>) follow shell rules: allowed only in modes that permit shell — Build and Auto — and blocked in Plan and Review.</li>
            <li><b>Auto bypasses the allowlist entirely</b>: every tool is allowed, and interactive confirmations are disabled.</li>
          </ul>
          <p>
            The model can activate Build and Plan on its own, but never Auto —{" "}
            <code className="inline">canModelActivateMode</code> returns <code className="inline">false</code> for{" "}
            <code className="inline">auto</code>. Auto is user-only: reach it with{" "}
            <code className="inline">Shift+Tab</code> or set it as the default (User scope only).
          </p>
          <Note>
            Review is strictly read-only, but even reads are trimmed — <code className="inline">git</code> is
            limited to <code className="inline">status</code>, <code className="inline">diff</code>, and{" "}
            <code className="inline">log</code>, and <code className="inline">memory</code>/<code className="inline">todo</code> to the{" "}
            <code className="inline">list</code> action. No mutation sneaks through.
          </Note>
        </section>

        <section id="plan-mode">
          <h2><span className="anchor">#</span>Plan mode</h2>
          <p>
            <code className="inline">/plan &lt;task&gt;</code> switches the session to Plan mode. The agent
            generates a plan path under <code className="inline">.plans/</code> named{" "}
            <code className="inline">&lt;slug&gt;-&lt;id&gt;.md</code>, sets it as the designated plan file, and
            injects a Plan-mode prompt with required sections: Context, Recommended Approach,
            Critical Files, Existing Utilities to Reuse, and Verification.
          </p>
          <CodeBlock lang="bash">/plan <span className="k">add retry with backoff to the fetch wrapper</span></CodeBlock>
          <p>
            The model explores read-only, then writes its plan with <code className="inline">write_plan</code> —
            the tool auto-injects the plan path, so the model only supplies content.{" "}
            <code className="inline">write_plan</code> refuses to run if no plan path is set. When it's done,
            the model calls <code className="inline">submit_plan</code>, which opens a <b>user approval
            dialog</b> showing the plan path, its content, and the model's summary.
          </p>
          <p>
            The plan path is validated server-side: <code className="inline">submit_plan</code> with any path
            other than the designated one is rejected. Plan mode writes nothing else —{" "}
            <code className="inline">git</code> stays limited to <code className="inline">status</code>/
            <code className="inline">diff</code>/<code className="inline">log</code>, and{" "}
            <code className="inline">memory</code>/<code className="inline">todo</code> to <code className="inline">list</code>.
          </p>
          <Note>
            Plan mode is enforced, not just prompt-instructed. Writes outside the plan file are
            blocked by the allowlist, and the plan path is checked on the way in.
          </Note>
        </section>

        <section id="config">
          <h2><span className="anchor">#</span>Configuring the default mode</h2>
          <p>
            Set the mode a session starts in with <code className="inline">settings.interaction.defaultMode</code>{" "}
            (default: <code className="inline">build</code>):
          </p>
          <CodeBlock lang="text">{`interaction: {
  "defaultMode": "build"
}`}</CodeBlock>
          <p>
            Valid values are <code className="inline">plan</code>, <code className="inline">review</code>,{" "}
            <code className="inline">build</code>, and <code className="inline">auto</code>, with two scope caveats:
          </p>
          <ul className="capabilities">
            <li><b>Auto</b> can only be selected at <b>User</b> scope — Project and Local scopes reject <code className="inline">interaction.defaultMode = "auto"</code>.</li>
            <li><b>Project MCP servers</b> (<code className="inline">settings.mcp</code>) can also only be enabled at User scope.</li>
          </ul>
          <p>
            <code className="inline">Shift+Tab</code> flips the mode live for the current session; the setting
            only controls the starting mode.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
