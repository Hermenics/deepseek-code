import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "when", label: "When to use it" },
  { id: "run", label: "Run the doctor" },
  { id: "checks", label: "Checks explained" },
  { id: "exit-status", label: "Exit status & automation" },
  { id: "limits", label: "What it does not test" },
  { id: "fixes", label: "Fix each failure" },
  { id: "report", label: "Prepare a useful report" },
];

const CHECKS = [
  [
    "Runtime",
    "Confirms that the process is running under Bun and prints the detected Bun version.",
    "Reinstall or upgrade Bun if the packaged launcher rejects the runtime before the report starts.",
  ],
  [
    "Workspace",
    "Checks that the current working-directory path exists and passes a filesystem access probe.",
    "Move to an existing directory, then verify the permissions your intended tools need.",
  ],
  [
    "Git",
    "Runs git --version with a short timeout to confirm that git is available on PATH.",
    "Install git or correct PATH. Sessions can start without it, but Git tools and worktrees cannot work normally.",
  ],
  [
    "ripgrep",
    "Runs rg --version with a short timeout. Missing ripgrep makes the check fail even though fallback search may still work.",
    "Install ripgrep for the intended search performance, or treat this as an acknowledged advisory in your environment.",
  ],
  [
    "Credentials",
    "Checks only whether ~/.deepseek/config.json exists. It does not parse the file or authenticate with a provider.",
    "Configure a provider in the setup flow. Environment-only authentication can work even while this check remains red.",
  ],
  [
    "Settings",
    "Reports the effective provider name and confirms that user settings or the merged defaults are available.",
    "Open /settings and use its diagnostics view when you need field-level validation or origin information.",
  ],
  [
    "MCP config",
    "Reads <project>/.deepseek/mcp.json when present, verifies that it is JSON, and counts entries under servers.",
    "Correct the JSON syntax. Server startup, transport health, and tool discovery require a real session.",
  ],
];

const FIXES = [
  ["Runtime", "bun --version", "The global launcher requires Bun 1.1 or newer."],
  ["Workspace", "pwd", "Confirm that the directory still exists and that your account can access it."],
  ["Git", "git --version", "Confirm installation and PATH visibility in the same shell that starts DeepSeek Code."],
  ["ripgrep", "rg --version", "Install ripgrep or accept slower fallback search."],
  ["Credentials", "deepseek", "Complete provider setup, or verify your environment-based authentication separately."],
  ["Settings", "/settings", "Inspect validation issues and the User, Project, and Local origins."],
  ["MCP config", ".deepseek/mcp.json", "Fix the project JSON first, then restart the session to load servers."],
];

export default function Doctor() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Doctor</span>
        </nav>

        <div className="hero">
          <h1>Doctor</h1>
          <p className="tagline">
            Run a fast, offline-oriented health check for the runtime, workspace, local tools,
            credentials, settings, and project MCP configuration.
          </p>
        </div>

        <section id="when">
          <h2><span className="anchor">#</span>When to use it</h2>
          <p>
            Run the doctor after installation, when moving between shells or machines, before opening
            a bug report, or whenever search, Git, provider setup, or MCP behavior looks different from
            what you expect. It gives you one deterministic summary without starting an agent turn or
            spending model tokens.
          </p>
          <p>
            There are two entry points. The standalone command is useful before the TUI can start and
            exposes an exit status. The slash command runs inside the current session and checks the
            agent&apos;s active working directory.
          </p>
        </section>

        <section id="run">
          <h2><span className="anchor">#</span>Run the doctor</h2>
          <CodeBlock lang="bash">{`# From your shell
$ deepseek doctor

# From an interactive DeepSeek Code session
/doctor`}</CodeBlock>
          <p>A healthy standalone report has this shape:</p>
          <CodeBlock lang="text">{`DeepSeek Code doctor · /home/you/project

✓ Runtime: Bun 1.3.13
✓ Workspace: /home/you/project
✓ Git: available
✓ ripgrep: available
✓ Credentials: configured
✓ Settings: provider: deepseek
✓ MCP config: 2 servers configured

Everything looks ready.`}</CodeBlock>
          <p>
            A failed line uses <code className="inline">✗</code>, includes a short explanation, and
            contributes to the final count. The report is plain text, so it is readable in terminals,
            CI logs, and issue descriptions.
          </p>
          <Note>
            The slash command displays the same checks as an assistant message. It does not terminate
            the session or expose a shell exit code; use <code className="inline">deepseek doctor</code>{" "}
            when another process needs a pass/fail result.
          </Note>
        </section>

        <section id="checks">
          <h2><span className="anchor">#</span>Checks explained</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "18%" }}>Check</th>
                  <th style={{ width: "44%" }}>What it actually verifies</th>
                  <th>How to interpret it</th>
                </tr>
              </thead>
              <tbody>
                {CHECKS.map(([name, verifies, interpretation]) => (
                  <tr key={name}>
                    <td><code className="inline">{name}</code></td>
                    <td>{verifies}</td>
                    <td>{interpretation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Git and ripgrep probes each have a two-second ceiling. The MCP check is project-scoped: run
            the command from the repository whose <code className="inline">.deepseek/mcp.json</code>{" "}
            you want to inspect. A missing MCP file is healthy and appears as
            <code className="inline">none configured</code>.
          </p>
        </section>

        <section id="exit-status">
          <h2><span className="anchor">#</span>Exit status & automation</h2>
          <p>
            The standalone command exits with <code className="inline">0</code> only when every check
            is green. If one or more checks fail, it exits with <code className="inline">1</code>. That
            rule applies uniformly: a missing optional accelerator such as ripgrep still produces exit
            status 1 because the doctor reports health, not severity levels.
          </p>
          <CodeBlock lang="bash">{`$ deepseek doctor
$ echo $?
0`}</CodeBlock>
          <p>You can use that contract in a workstation bootstrap or container smoke check:</p>
          <CodeBlock lang="bash">{`if deepseek doctor; then
  echo "DeepSeek Code is ready"
else
  echo "Review the failed checks"
  exit 1
fi`}</CodeBlock>
          <Note>
            Decide whether your automation truly requires every green check. For example, a minimal
            environment may intentionally omit ripgrep, while a worktree workflow cannot reasonably
            ignore a missing Git executable.
          </Note>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>What it does not test</h2>
          <p>
            The doctor is deliberately quick and mostly local. A green report is evidence that the
            workstation is shaped correctly, not proof that every external service is reachable.
          </p>
          <ul className="capabilities">
            <li><b>No provider request.</b> It does not validate an API key, AWS profile, GCP service account, local endpoint, model access, quota, or billing.</li>
            <li><b>No network probe.</b> DNS, proxies, TLS inspection, firewalls, and registry access are outside this report.</li>
            <li><b>No Git repository validation.</b> It finds the executable but does not require the current directory to be a repository or inspect worktree health.</li>
            <li><b>No write test.</b> Workspace access is checked, but the doctor does not create a file to prove write permission.</li>
            <li><b>No complete settings audit.</b> Use the settings diagnostics screen for invalid fields, unknown keys, and scope origins.</li>
            <li><b>No MCP connection.</b> Valid JSON and a server count do not prove that a configured process starts or that its tools load.</li>
          </ul>
          <p>
            To test the missing layers, start a session and make a small provider request, use
            <code className="inline">/tools</code> to confirm MCP tool registration, and use
            <code className="inline">/worktree status</code> for isolated Git work.
          </p>
        </section>

        <section id="fixes">
          <h2><span className="anchor">#</span>Fix each failure</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Failure</th><th style={{ width: "24%" }}>First check</th><th>Next action</th></tr>
              </thead>
              <tbody>
                {FIXES.map(([name, command, action]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td><code className="inline">{command}</code></td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Re-run from the same shell and directory after each fix. PATH, environment variables, and
            project-relative configuration can differ between a terminal, an IDE task, SSH, and a CI
            runner.
          </p>
        </section>

        <section id="report">
          <h2><span className="anchor">#</span>Prepare a useful report</h2>
          <p>
            If the problem remains, include the smallest reproducible command, the observed result, the
            expected result, operating system and terminal, and these non-secret diagnostics:
          </p>
          <CodeBlock lang="bash">{`$ deepseek --version
$ bun --version
$ deepseek doctor
$ git --version
$ rg --version`}</CodeBlock>
          <p>
            Add the provider name and whether authentication comes from saved setup, environment
            variables, AWS, GCP, or a local server. For a TUI problem, include terminal dimensions and
            whether alternate screen, Vim mode, or reduced motion is enabled. For an MCP problem,
            identify the server and transport without pasting secrets.
          </p>
          <Note>
            Never attach <code className="inline">~/.deepseek/config.json</code>, service-account JSON,
            environment dumps, complete audit logs, or raw headers to a public issue. Redact tokens,
            credentials, private paths, repository content, and customer data first. Report suspected
            credential exposure through the private security channel, not a public bug.
          </Note>
          <p>
            Continue with <a href="/docs/troubleshooting">Troubleshooting</a> for log locations and
            provider errors, or <a href="/docs/authentication">Authentication</a> for provider-specific
            setup.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
