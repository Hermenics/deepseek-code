import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "rules", label: "Permission rules" },
  { id: "decision", label: "Decision order" },
  { id: "risk", label: "Risk rules" },
  { id: "approvals", label: "Session approvals" },
  { id: "explain", label: "Auditing with /permissions" },
];

const EXAMPLES = [
  ["ReadFile", "read_file", "all reads"],
  ["Shell(git *)", "shell", "any git command"],
  ["WebFetch(api.*)", "web_fetch", "URLs starting api."],
  ["Grep(*secret*)", "grep", "patterns containing secret"],
];

const DECISIONS = [
  ["A deny rule matches", "deny — call blocked"],
  ["An allow rule matches", "allow"],
  ["Allow rules exist, none match", "ask"],
  ["Only deny rules (or no rules at all)", "allow"],
];

const APPROVALS = [
  ["once", "Allow this single call"],
  ["session", "Remember for the rest of the session"],
  ["directory", "Approve an external directory tree for write tools (session-scoped)"],
  ["always", "Persist into User-scope permissions.allow"],
  ["deny", "Abort the turn with DenyAbortError"],
];

export default function Permissions() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Permissions</span>
        </nav>

        <div className="hero">
          <h1>Permissions &amp; risk</h1>
          <p className="tagline">
            Layered gating on every tool call — low-risk work runs unattended, destructive operations always stop for a human.
          </p>
        </div>

        <section id="rules">
          <h2><span className="anchor">#</span>Permission rules</h2>
          <p>
            Rules live under <code className="inline">settings.permissions</code> as arrays of strings like{" "}
            <code className="inline">Shell(git *)</code> or <code className="inline">ReadFile</code>. A rule names a
            tool and, optionally, a parenthesized pattern matched against the tool's input (a shell
            command, a file path, a URL, a grep pattern).
          </p>
          <CodeBlock lang="text">{`// settings.json
{
  "permissions": {
    "allow": ["ReadFile", "Edit", "Shell(git status)"],
    "deny": ["Shell(sudo *)", "WriteFile(.env)"],
    "suppress": ["Shell(npm run dev)"],
    "autoApproveLowRisk": false
  }
}`}</CodeBlock>
          <p>
            Rules are parsed by <code className="inline">parseRule</code> and matched case-insensitively with
            an iterative glob (<code className="inline">globMatch</code>) that swaps regex backtracking for a
            safe walking algorithm — no ReDoS on pathological patterns. <code className="inline">suppress</code>{" "}
            hides an <b>inherited</b> allow rule at a lower scope by exact string;{" "}
            <code className="inline">deny</code> and high-risk rules can never be suppressed.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Example rule</th><th style={{ width: "24%" }}>Tool</th><th>Pattern matched</th></tr>
              </thead>
              <tbody>
                {EXAMPLES.map(([r, t, p]) => (
                  <tr key={r}>
                    <td><code className="inline">{r}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            A rule with no pattern allows every use of that tool. Deny rules always win over allow
            rules for the same call.
          </Note>
        </section>

        <section id="decision">
          <h2><span className="anchor">#</span>Decision order</h2>
          <p>
            Permission resolution checks <b>deny first, then allow</b>:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th>Condition</th><th style={{ width: "30%" }}>Result</th></tr>
              </thead>
              <tbody>
                {DECISIONS.map(([c, r]) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td><code className="inline">{r}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            When the result is <code className="inline">ask</code>,{" "}
            <code className="inline">permissions.autoApproveLowRisk</code> (default{" "}
            <code className="inline">false</code>) skips the prompt if no risk rule matched. The full
            enforcement pipeline is: <b>mode gate → risk rules → settings allow/deny → agent allowlist
            → hooks → execution</b>. Plan and Review modes additionally block mutating git, memory, and
            todo actions.
          </p>
        </section>

        <section id="risk">
          <h2><span className="anchor">#</span>Risk rules</h2>
          <p>
            Default risk rules flag destructive shell, git, and file operations. High-risk rules{" "}
            <b>always require confirmation in every mode</b>; medium-risk rules only inside subagents.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Level</th><th>Examples</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><b style={{ color: "var(--text-strong)" }}>High</b></td>
                  <td><code className="inline">rm</code>, <code className="inline">rm -rf</code>, force push, <code className="inline">git reset --hard</code>, <code className="inline">git clean</code>, <code className="inline">git checkout --</code>, <code className="inline">npm install</code> / <code className="inline">bun add</code> / <code className="inline">pip install</code> / <code className="inline">apt install</code>, <code className="inline">sudo</code>, <code className="inline">systemctl</code>, <code className="inline">docker --rm</code>, <code className="inline">chmod</code>, deploy commands (<code className="inline">*run deploy*</code>, <code className="inline">deploy.sh</code>, <code className="inline">serverless deploy</code>, <code className="inline">cdk deploy</code>), writes into <code className="inline">.deepseek/</code>, large overwrites (≥ 100 lines)</td>
                </tr>
                <tr>
                  <td><b style={{ color: "var(--text-strong)" }}>Medium</b></td>
                  <td><code className="inline">git push</code> / <code className="inline">git commit</code>, writes to <code className="inline">package.json</code>, <code className="inline">tsconfig*</code>, <code className="inline">Dockerfile</code>, write bursts (≥ 3 in a turn), <code className="inline">npm install --save-dev</code>, <code className="inline">bun add -d</code></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            You can add custom rules or override defaults by id (<code className="inline">risk.rules</code>), and
            tune thresholds via <code className="inline">risk.thresholds.largeFileLines</code> (default 100) and{" "}
            <code className="inline">risk.thresholds.burstCount</code> (default 3). Matches sort by specificity
            (longer pattern first), then high before medium.
          </p>
          <Note>
            High-risk rules cannot be disabled — not even by an override or{" "}
            <code className="inline">risk.enabled: false</code>. They are the floor of the risk system.
          </Note>
        </section>

        <section id="approvals">
          <h2><span className="anchor">#</span>Session approvals</h2>
          <p>
            When a call needs confirmation, the interactive handler offers five decisions:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Decision</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {APPROVALS.map(([d, e]) => (
                  <tr key={d}>
                    <td><code className="inline">{d}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Paths outside the workspace are resolved per directory: writes there prompt with the
            external directory, and <code className="inline">directory</code> registers it so siblings in the
            same tree pass without re-asking.
          </p>
        </section>

        <section id="explain">
          <h2><span className="anchor">#</span>Auditing with /permissions</h2>
          <p>
            Run <code className="inline">/permissions</code> to print a readable report of the current state:
            the active mode and its allowed tools, the agent-specific allowlist (or{" "}
            <code className="inline">*</code> when all tools prompt), your <code className="inline">settings</code>{" "}
            allow/deny rules, risk-rule status (counts of high/medium defaults, custom rules,
            overrides, thresholds), everything approved this session, and the decision order. Run it
            any time you're unsure why a call was blocked or allowed.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
