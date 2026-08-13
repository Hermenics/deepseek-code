import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "paths", label: "Path safety" },
  { id: "shell", label: "Shell sandbox" },
  { id: "webfetch", label: "WebFetch anti-SSRF" },
  { id: "mcp", label: "MCP hardening" },
  { id: "risk", label: "Risk rules" },
  { id: "permissions", label: "Permissions model" },
  { id: "secrets", label: "Secrets" },
  { id: "scope", label: "Scope: project vs user" },
];

const BLOCKED_DIRS = [".agent", ".claude", ".kiro", ".github", ".deepseek", "node_modules", "dist", "build", ".git"];

const SENSITIVE_FILES = [
  [".env*, .env.local…", "environment files"],
  ["*.pem, *.key, *.p12, *.pfx", "private keys and certificate stores"],
  ["id_rsa, id_ed25519, id_ecdsa, id_dsa (+ .pub)", "SSH key material"],
  [".aws/credentials, .aws/config", "AWS credentials and profile config"],
  ["*service-account*.json, gcloud*.json", "cloud service-account keys"],
  ["credentials.json, secrets.*", "credential and secret stores"],
  [".netrc, .npmrc, .pypirc, known_hosts", "credential files"],
];

const DESTRUCTIVE = [
  ["rm -rf / --force / --recursive", "recursive or forced deletion"],
  ["git reset --hard, git clean -f", "discarding work"],
  ["git push --force / -f", "force-pushing history"],
  ["drop table|database, truncate table", "database destruction"],
  ["mkfs, dd of=, > /dev/sd* / /dev/nvme*", "filesystem and block-device writes"],
  ["chmod -R 777", "loosening permissions recursively"],
  ["sudo rm", "privileged deletion"],
];

const HIGH_RISK = [
  ["shell", "rm, rm -rf, force push, git reset --hard, git clean, git checkout --"],
  ["shell", "npm install, bun add, pip install, apt install, sudo, systemctl, docker --rm, chmod"],
  ["shell", "deploy commands: *run deploy*, deploy.sh, serverless deploy, cdk deploy, bun run build"],
  ["write_file / edit_file / patch_file", "writes into .deepseek/ (including .deepseek/steering/)"],
  ["write_file", "large overwrites (≥ 100 lines)"],
  ["git", "push, pull"],
];

const MEDIUM_RISK = [
  ["shell", "git push, git commit, npm install --save-dev, bun add -d"],
  ["write_file", "package.json, tsconfig*, Dockerfile"],
  ["write_file / patch_file", "write bursts (≥ 3 edits in a turn)"],
];

export default function Security() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Security</span>
        </nav>

        <div className="hero">
          <h1>Security</h1>
          <p className="tagline">
            Layered, fail-closed hardening on every tool call — path containment, OS-level sandboxing,
            SSRF defenses, and a risk floor that no setting can disable.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Overview</h2>
          <p>
            Every tool call is checked by the same pipeline before it executes:
          </p>
          <CodeBlock lang="text">{`mode gate → pre-tool hooks → path and risk authorization → settings rules → agent allowlist → execution`}</CodeBlock>
          <p>
            The layers below are the hardening under that pipeline. They run regardless of mode and
            cannot be turned off through permissions or settings. Path-based file tools require containment
            or an explicit external-directory approval, worker shell commands cannot see your home directory,
            and a fetch cannot reach private or metadata-network targets. The coordinator shell is different:
            it runs on the host in the active workspace, so its command paths are not constrained by file-tool
            external-path approvals.
          </p>
          <Note>
            The pipeline is evaluated in order and each stage can deny the call. Plan and Review modes
            additionally block mutating git, memory, and todo actions.
          </Note>
        </section>

        <section id="paths">
          <h2><span className="anchor">#</span>Path safety</h2>
          <p>
            Every file and directory tool routes through{" "}
            <code className="inline">resolveSafePath</code> / <code className="inline">assertSafePath</code>{" "}
            (<code className="inline">src/tools/shared/pathSafety.ts</code>). The returned path is the
            only one the tool is allowed to use. A path is valid when it stays inside the workspace
            root or inside an explicitly approved external path; anything else is rejected. These
            approvals govern path-aware tools, not paths embedded in coordinator shell commands.
          </p>
          <p>
            Symlink escapes are caught by resolving the nearest existing ancestor with{" "}
            <code className="inline">fs.realpath</code> and checking it against the canonical approved
            root — a symlink that points outside the workspace is refused even if the literal path
            looks contained. Protected names are rejected relative to the workspace or approved root:
          </p>
          <ul className="capabilities">
            <li>
              <b>Blocked directories</b> —{" "}
              {BLOCKED_DIRS.map((dir) => <code className="inline" key={dir}>{dir}</code>).reduce((acc, el) => [acc, ", ", el])}{" "}
              — both on the requested path and on the canonical path.
            </li>
            <li>
              <b>Sensitive files</b> — rejected by basename pattern, agent or no:
            </li>
          </ul>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "40%" }}>Pattern</th><th>Why it is blocked</th></tr>
              </thead>
              <tbody>
                {SENSITIVE_FILES.map(([pattern, why]) => (
                  <tr key={pattern}>
                    <td><code className="inline">{pattern}</code></td>
                    <td>{why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            Approve a directory <em>above</em> a protected child, never the protected directory itself.
            Protected-name checks are relative to each approved root; choosing the protected directory as
            the root would hide its own name from that relative-path check. Sensitive filenames remain
            blocked within approved external roots.
          </Note>
          <p>
            Writes are atomic: content is staged in a temporary file, the target is re-validated after
            authorization, and only then renamed into place — preserving the existing file mode. Each
            write holds a per-file lease (<code className="inline">acquireFileLease</code>), so
            concurrent agents cannot interleave and corrupt the same file.
          </p>
        </section>

        <section id="shell">
          <h2><span className="anchor">#</span>Shell sandbox</h2>
          <p>
            For every permission profile except the coordinator, shell commands run inside a{" "}
            <b>bubblewrap</b> sandbox (<code className="inline">src/tools/Shell/Shell.ts</code>):
          </p>
          <ul className="capabilities">
            <li><b>Read-only system</b> — <code className="inline">/usr</code>, <code className="inline">/bin</code>, <code className="inline">/lib</code>, <code className="inline">/lib64</code> mounted read-only.</li>
            <li><b>Workspace only</b> — the project is bind-mounted at <code className="inline">/mnt</code>; read-only for the tester profile, read-write for workers. Nothing else from your machine is visible.</li>
            <li><b>Ephemeral state</b> — <code className="inline">/tmp</code> is a tmpfs; <code className="inline">/dev</code> and <code className="inline">/proc</code> are minimal.</li>
            <li><b>Isolated namespaces</b> — network, PID, IPC and UTS namespaces are unshared; the process dies with its parent (<code className="inline">--die-with-parent</code>).</li>
            <li><b>Cleared environment</b> — only <code className="inline">PATH=/opt/bin:/usr/local/bin:/usr/bin:/bin</code>, <code className="inline">HOME=/tmp</code>, <code className="inline">TMPDIR=/tmp</code> are set; no inherited secrets.</li>
          </ul>
          <p>
            Destructive shell patterns require coordinator-integrator execution plus an explicit runtime
            authorization marker. Worker shell calls matching them are blocked rather than promoted into the
            coordinator's host shell:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "45%" }}>Pattern</th><th>Why it is blocked</th></tr>
              </thead>
              <tbody>
                {DESTRUCTIVE.map(([pattern, why]) => (
                  <tr key={pattern}>
                    <td><code className="inline">{pattern}</code></td>
                    <td>{why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            Commands default to a 30s timeout and output is capped, so a runaway or chatty process
            cannot hang the session.
          </Note>
        </section>

        <section id="webfetch">
          <h2><span className="anchor">#</span>WebFetch anti-SSRF</h2>
          <p>
            The <code className="inline">web_fetch</code> tool (<code className="inline">src/tools/WebFetch/WebFetch.ts</code>)
            is hardened against server-side request forgery. Only <code className="inline">http://</code> and{" "}
            <code className="inline">https://</code> URLs are accepted, and private targets are blocked{" "}
            <b>by hostname and by resolved IP</b>:
          </p>
          <ul className="capabilities">
            <li><b>Hostname blocklist</b> — localhost and loopback, <code className="inline">10.x</code>, <code className="inline">192.168.x</code>, <code className="inline">172.16–31.x</code>, link-local <code className="inline">169.254.x</code>, and cloud metadata endpoints (<code className="inline">169.254.169.254</code>, <code className="inline">metadata.google.internal</code>).</li>
            <li><b>DNS pinning</b> — every target is resolved first; if <i>any</i> resolved address is private, the request is blocked. The connection is then pinned to the public IP while the original <code className="inline">Host</code> header and TLS server name are preserved — a resolver that answers with a private address on the second lookup (DNS rebinding) changes nothing.</li>
            <li><b>Fail-closed resolution</b> — a DNS failure (2s resolution timeout) blocks the request rather than letting it through.</li>
          </ul>
          <p>
            Fetches follow at most 5 redirects (re-checked at each hop), time out after 15s, and
            return at most 20,000 characters of stripped page text — scripts and styles are removed.
          </p>
        </section>

        <section id="mcp">
          <h2><span className="anchor">#</span>MCP hardening</h2>
          <p>
            MCP servers (<code className="inline">src/agent/mcp.ts</code>) run with the least
            environment that still works:
          </p>
          <ul className="capabilities">
            <li><b>Minimal env</b> — stdio servers inherit only <code className="inline">PATH</code>, <code className="inline">TMPDIR</code> and <code className="inline">LANG</code>. Critical variables — <code className="inline">PATH</code>, <code className="inline">HOME</code>, <code className="inline">USER</code>, <code className="inline">SHELL</code>, <code className="inline">LD_*</code>, <code className="inline">DYLD_*</code>, <code className="inline">PYTHONPATH</code>, <code className="inline">NODE_OPTIONS</code>, <code className="inline">NODE_PATH</code>, <code className="inline">BUN_INSTALL</code> — can never be overridden by server configuration.</li>
            <li><b>Command validation</b> — <code className="inline">validateMcpCommand</code> rejects empty commands, path traversal (<code className="inline">../</code>), and shell injection characters (<code className="inline">;`&lt;&gt;&&||$(&gt;&gt;&lt;&lt;</code>) before any process is spawned.</li>
            <li><b>Timeouts</b> — tool calls are raced against a 30s timeout so an unresponsive server cannot hang the agent.</li>
            <li><b>Audit trail</b> — every successful server load is recorded as an <code className="inline">mcp_server_load</code> event in the session audit log.</li>
          </ul>
        </section>

        <section id="risk">
          <h2><span className="anchor">#</span>Risk rules</h2>
          <p>
            Risk rules (<code className="inline">src/permissions/risk.ts</code>) match tool input against
            glob patterns and conditions. Built-in <b>high</b> rules cannot be disabled or downgraded — not by
            an id override and not even by <code className="inline">risk.enabled: false</code>. In the coordinator,
            they require confirmation; in a worker, they are blocked and do not use the mailbox permission
            handshake. <b>Medium</b> rules require confirmation only in a worker context, where the current
            executor also blocks the call.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Level</th><th>Examples</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><b style={{ color: "var(--text-strong)" }}>High</b></td>
                  <td>
                    {HIGH_RISK.map(([tool, examples]) => (
                      <div key={examples}><code className="inline">{tool}</code> — {examples}</div>
                    ))}
                  </td>
                </tr>
                <tr>
                  <td><b style={{ color: "var(--text-strong)" }}>Medium</b></td>
                  <td>
                    {MEDIUM_RISK.map(([tool, examples]) => (
                      <div key={examples}><code className="inline">{tool}</code> — {examples}</div>
                    ))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            The <code className="inline">.deepseek/</code> risk rules still exist, but ordinary settings,
            steering, and nested workflow paths are normally rejected first by path safety. A valid flat
            project workflow file is the narrow exception and remains subject to risk authorization.
          </p>
          <p>
            Add custom rules via <code className="inline">risk.rules</code> (new ids append, existing
            ids override defaults) and tune thresholds with{" "}
            <code className="inline">risk.thresholds.largeFileLines</code> (default 100) and{" "}
            <code className="inline">risk.thresholds.burstCount</code> (default 3). Matching sorts by
            specificity — longer patterns first, then high before medium.
          </p>
        </section>

        <section id="permissions">
          <h2><span className="anchor">#</span>Permissions model</h2>
          <p>
            Permission resolution is <b>deny first, then allow</b>. The outcome of a call depends on
            which rules exist, in this order:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th>Condition</th><th style={{ width: "30%" }}>Result</th></tr>
              </thead>
              <tbody>
                <tr><td>A deny rule matches</td><td><code className="inline">deny</code> — call blocked</td></tr>
                <tr><td>An allow rule matches</td><td><code className="inline">allow</code></td></tr>
                <tr><td>Allow rules exist, none match</td><td><code className="inline">ask</code></td></tr>
                <tr><td>Only deny rules (or no rules at all)</td><td><code className="inline">allow</code></td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Deny rules can never be suppressed. <code className="inline">suppress</code> only removes
            an <b>inherited</b> allow rule from a lower scope, by exact string. When the result is{" "}
            <code className="inline">ask</code>, <code className="inline">permissions.autoApproveLowRisk</code>{" "}
            skips the prompt if no risk rule matched. Choosing <code className="inline">always</code> at
            the prompt persists the rule into User-scope <code className="inline">permissions.allow</code>.
          </p>
        </section>

        <section id="secrets">
          <h2><span className="anchor">#</span>Secrets</h2>
          <p>
            Credentials are stored <b>only</b> in <code className="inline">~/.deepseek/config.json</code>{" "}
            (<code className="inline">src/settings/repository.ts</code>) — written atomically with{" "}
            <code className="inline">0600</code> permissions. They never go into{" "}
            <code className="inline">settings.json</code> or the repository: the settings loader
            rejects any key that looks like a secret (api key, token, secret, credential, password)
            with an explicit error.
          </p>
          <p>
            Secret-shaped values are also scrubbed wherever they could leak: settings exports strip
            secret-named keys, and log/audit serialization runs{" "}
            <code className="inline">redactSecrets</code>, which replaces API keys (<code className="inline">sk-…</code>,{" "}
            <code className="inline">ghp_…</code>, <code className="inline">AKIA…</code>), PEM private key blocks,
            bearer tokens and <code className="inline">key=value</code> credential patterns with{" "}
            <code className="inline">[REDACTED]</code>.
          </p>
        </section>

        <section id="scope">
          <h2><span className="anchor">#</span>Scope: project vs user</h2>
          <p>
            Anything that executes code on your machine is honored <b>only at User scope</b>:
            executable hooks, LSP server commands, and MCP servers configured in project or local
            settings are ignored (the settings validator flags them as warnings). Project MCP servers
            are off by default — enabling them is an explicit User-scope choice.
          </p>
          <Note>
            If a project's <code className="inline">settings.json</code> declares hooks or MCP servers
            and they are not running, that is the security model working as designed.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
