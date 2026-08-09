import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "doctor", label: "deepseek doctor" },
  { id: "logs", label: "Logs" },
  { id: "updates", label: "Update notifier" },
  { id: "providers", label: "Provider-specific errors" },
  { id: "paths", label: "Where things live" },
  { id: "behaviors", label: "Known behaviors" },
];

const CHECKS = [
  ["Runtime", "Bun runtime present, with version"],
  ["Workspace", "Current directory exists and is accessible"],
  ["Git", "git found on PATH"],
  ["ripgrep", "rg found on PATH — missing only slows search down"],
  ["Credentials", "Saved credentials found in ~/.deepseek/config.json"],
  ["Settings", "User settings file exists or merged settings resolve"],
  ["MCP config", ".deepseek/mcp.json parses (none configured is fine)"],
];

const AUDIT_EVENTS = [
  ["session_start", "model, provider, cwd"],
  ["tool_call", "tool name and arguments"],
  ["tool_result", "tool, result (truncated to 200 chars), duration in ms"],
  ["compact / compact_error", "context compaction reason"],
  ["checkpoint", "checkpoint id (and optional label)"],
  ["session_end", "total tokens used"],
  ["mcp_server_load", "server name and transport"],
];

const PROVIDER_ERRORS = [
  ["Bedrock", "AWS credentials in the configured profile (~/.aws/credentials)"],
  ["Vertex", "GCP_CREDENTIALS pointing to the service-account JSON"],
  ["DeepSeek / local", "DEEPSEEK_API_KEY (or the raw error message)"],
];

const FILE_MAP = [
  ["~/.deepseek/config.json", "Secrets and provider credentials (0600)"],
  ["~/.deepseek/settings.json", "User-scope settings"],
  ["~/.deepseek/memory/", "Memory files (MEMORY.md, USER.md)"],
  ["~/.deepseek/sessions/", "Per-project session directories"],
  ["~/.deepseek/features.json", "Feature flags"],
  ["~/.deepseek/update-cooldown", "Update check deadline"],
  ["~/.deepseek/kernel.db", "Kernel reference database"],
  ["~/.deepseek/checkpoints/", "Conversation checkpoints"],
  ["~/.deepseek/task-snapshots/", "Orchestration task snapshots"],
  ["~/.deepseek/logs/", "dev.log and per-session audit JSONL"],
  [".deepseek/mcp.json", "Project MCP servers"],
  [".deepseek/workflows/", "Project workflows"],
  [".deepseek/worktrees/", "Git worktrees"],
  [".deepseek/steering/", "Project guidance markdown"],
];

const PARALLEL_SAFE = ["subagent", "ask_agent", "grep", "glob", "read_file", "read_folder", "web_fetch", "introspect"];

export default function Troubleshooting() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Troubleshooting</span>
        </nav>

        <div className="hero">
          <h1>Troubleshooting &amp; diagnostics</h1>
          <p className="tagline">
            Doctor checks, log locations, update behavior and provider-specific errors — the fastest
            way from "something is off" to a diagnosis.
          </p>
        </div>

        <section id="doctor">
          <h2><span className="anchor">#</span>deepseek doctor</h2>
          <p>
            <code className="inline">deepseek doctor</code> runs a quick local setup check
            (<code className="inline">src/doctor.ts</code>) and exits <code className="inline">0</code>{" "}
            when everything is ready, or <code className="inline">1</code> when any check fails. The
            same report is available in-session via <code className="inline">/doctor</code>.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Check</th><th>What it verifies</th></tr>
              </thead>
              <tbody>
                {CHECKS.map(([name, detail]) => (
                  <tr key={name}>
                    <td><code className="inline">{name}</code></td>
                    <td>{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="text">{`$ deepseek doctor
DeepSeek Code doctor · /home/you/project

✓ Runtime: Bun 1.2.15
✓ Workspace: /home/you/project
✓ Git: available
✗ ripgrep: not found on PATH; search may be slower
✓ Credentials: configured
✓ Settings: provider: deepseek
✓ MCP config: none configured

1 check needs attention.`}</CodeBlock>
          <Note>
            Only <code className="inline">ripgrep</code> is optional: without it search still works,
            just slower. Everything else failing means something needs fixing before a session will
            behave.
          </Note>
        </section>

        <section id="logs">
          <h2><span className="anchor">#</span>Logs</h2>
          <p>
            Two logs live under <code className="inline">~/.deepseek/logs/</code>. The <b>dev log</b>{" "}
            (<code className="inline">dev.log</code>) is only written when the process runs with{" "}
            <code className="inline">NODE_ENV=development</code>: it captures stderr output,
            <code className="inline">uncaughtException</code> and <code className="inline">unhandledRejection</code>{" "}
            events, and is truncated on each start.
          </p>
          <p>
            The <b>session audit log</b> is a per-session JSONL file,{" "}
            <code className="inline">session-&lt;timestamp&gt;-&lt;hex&gt;.jsonl</code>, written with
            <code className="inline">0600</code> permissions and used for debugging one session at a
            time. Each line is a JSON event:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Event</th><th>Payload</th></tr>
              </thead>
              <tbody>
                {AUDIT_EVENTS.map(([event, payload]) => (
                  <tr key={event}>
                    <td><code className="inline">{event}</code></td>
                    <td>{payload}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Tool results are truncated to 200 characters and all values pass through{" "}
            <code className="inline">redactSecrets</code>, so keys and tokens never land in the log.
            Audit-log failures are swallowed on purpose — logging must never crash the agent.
          </p>
        </section>

        <section id="updates">
          <h2><span className="anchor">#</span>Update notifier</h2>
          <p>
            On startup the CLI checks the npm registry for the latest version — a single lightweight
            request with a 5s timeout. The cooldown is stored as a <b>deadline</b>, not a timestamp:
            <code className="inline">~/.deepseek/update-cooldown</code> holds the next allowed check
            time. A successful check pushes it 1 hour out; a failed check only 10 minutes — so a
            transient network failure never silences the update notice for an hour.
          </p>
          <p>
            Versions you dismiss are remembered in{" "}
            <code className="inline">~/.deepseek/dismissed-update-version</code>. To bypass the
            notifier entirely, run <code className="inline">deepseek update</code>: it checks
            immediately and installs the new version with{" "}
            <code className="inline">npm install -g</code>, printing the result and exit code.
          </p>
        </section>

        <section id="providers">
          <h2><span className="anchor">#</span>Provider-specific errors</h2>
          <p>
            Chat failures are annotated with the most likely cause per provider
            (<code className="inline">src/utils/chatError.ts</code>):
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Provider</th><th>Check first</th></tr>
              </thead>
              <tbody>
                {PROVIDER_ERRORS.map(([provider, fix]) => (
                  <tr key={provider}>
                    <td><code className="inline">{provider}</code></td>
                    <td>{fix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            <code className="inline">/models</code> may keep working (it uses the native SDK) while
            the chat endpoint fails on credentials. A missing <code className="inline">GCP_CREDENTIALS</code>{" "}
            or an invalid AWS profile produces this exact symptom — the error message says so.
          </Note>
        </section>

        <section id="paths">
          <h2><span className="anchor">#</span>Where things live</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "45%" }}>Path</th><th>Contents</th></tr>
              </thead>
              <tbody>
                {FILE_MAP.map(([path, contents]) => (
                  <tr key={path}>
                    <td><code className="inline">{path}</code></td>
                    <td>{contents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            User-level state lives under <code className="inline">~/.deepseek/</code>; project-level
            state lives inside the repository under <code className="inline">.deepseek/</code> — both
            are safe to inspect when diagnosing issues.
          </p>
        </section>

        <section id="behaviors">
          <h2><span className="anchor">#</span>Known behaviors</h2>
          <ul className="capabilities">
            <li>
              <b>Pipe mode denies destructive commands by default</b> — with no interactive prompt
              available, the confirm handler answers <code className="inline">false</code>, so{" "}
              <code className="inline">--pipe</code> runs are limited to safe operations.
            </li>
            <li>
              <b>Plan and Review modes are strictly read-only</b> — mutating git, memory and todo
              actions are blocked.
            </li>
            <li>
              <b><code className="inline">reasoning_content</code> is preserved</b> — the exclusive
              DeepSeek reasoner field is carried through and passed back to the API on every turn, so
              reasoning stays consistent across calls.
            </li>
            <li>
              <b>Parallel tool calls for safe tools</b> — when the model emits several calls, read-only
              and isolated tools run concurrently:{" "}
              {PARALLEL_SAFE.map((tool) => <code className="inline" key={tool}>{tool}</code>).reduce((acc, el) => [acc, ", ", el])}.
              Everything else runs sequentially.
            </li>
          </ul>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
