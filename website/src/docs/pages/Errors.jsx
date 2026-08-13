import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "how", label: "How errors are shaped" },
  { id: "startup", label: "Startup & configuration" },
  { id: "provider", label: "Provider errors" },
  { id: "bedrock", label: "Bedrock" },
  { id: "vertex", label: "Vertex AI" },
  { id: "permission", label: "Permission & risk" },
  { id: "task", label: "Task & orchestration" },
  { id: "moa", label: "MoA" },
  { id: "worktree", label: "Worktree" },
  { id: "extension", label: "Plugins & skills" },
  { id: "compaction", label: "Compaction" },
];

const STARTUP = [
  ["DEEPSEEK_API_KEY not set and no saved config found", "Headless mode with no provider configured.", "Export the key or configure a provider interactively first."],
  ["Usage: echo \"task\" | deepseek --pipe OR deepseek --pipe \"task\"", "--pipe with neither stdin nor an argument.", "Supply one of them."],
  ["<cwd> is not accessible", "The working directory exists but cannot be read.", "cd to a valid directory. Reported by /doctor."],
  ["MCP config: invalid JSON: <parse error>", ".deepseek/mcp.json does not parse.", "The parser's own message is included — fix that spot."],
];

const PERMISSION = [
  ["outside_workspace", "A path argument resolved outside the session workspace root."],
  ["risk", "A DEFAULT_RISK_RULES entry matched — rm, force-push, reset --hard, package installs."],
  ["permission", "No allow rule covers the call and it is not low-risk."],
  ["agent_config", "The active agent definition restricts this tool."],
  ["workflow", "A workflow requested a capability outside its authorized set."],
];

const TASK = [
  ["TIMED_OUT", "The attempt exceeded its deadline.", "Partial output is retained. Resume, or raise timeoutMs."],
  ["CANCELLED", "Cancelled by the coordinator.", "Resume with /task <id> resume."],
  ["INTERRUPTED", "Restored from a snapshot while it was running.", "The process died. Reattach a runner, then resume."],
  ["INVALID_RESULT", "The terminal call was missing, repeated, mixed or schema-invalid after one correction.", "Raw content is preserved — read it with /task <id> result."],
  ["VERIFICATION_INCONCLUSIVE", "The verifier returned PLAUSIBLE.", "Not confirmed. Judge it yourself."],
  ["VERIFICATION_REFUTED", "The verifier returned REFUTED.", "The claim did not hold."],
];

const MOA = [
  ["INVALID_CONFIG", "No reference models configured, or an unusable aggregator."],
  ["INSUFFICIENT_CANDIDATES", "Fewer unique successful candidates than minResponses."],
  ["AGGREGATOR_FAILED", "The synthesis call failed. Never falls back to a raw candidate."],
  ["BUDGET_EXCEEDED", "The parent's token or cost budget ran out mid-run."],
  ["CANCELLED", "Aborted through the abort signal."],
];

const WORKTREE = [
  ["Git worktrees are unavailable. Refusing an unsafe copied-workspace fallback.", "The project is not a git repository.", "Run git init, or work without isolation."],
  ["Worktree \"<name>\" has uncommitted changes and was preserved.", "Removal refused to destroy unsaved work.", "Commit, stash, or exit with --keep."],
  ["Invalid worktree name: \"<name>\" resolves outside worktrees directory", "Path containment rejected the name.", "Use a name from /worktree list."],
  ["Legacy copied worktree \"<name>\" was preserved; remove it manually after inspection.", "A pre-git worktree cannot be safely auto-removed.", "Inspect, then delete by hand."],
  ["Failed to generate unique worktree name after 10 attempts.", "Ten name collisions in a row.", "Clean up .deepseek/worktrees/."],
  ["git worktree add failed: <message>", "Git refused the operation.", "The git message is included — usually a branch that already exists."],
];

const EXTENSION = [
  ["Empty file: no frontmatter found", "SKILL.md is empty."],
  ["No frontmatter found: file must start with ---", "Something precedes the delimiter, often a blank line."],
  ["No frontmatter found: missing closing ---", "No closing delimiter on its own line."],
  ["Empty frontmatter", "Delimiters present, nothing between them."],
  ["SKILL.md missing required 'name' field", "name is absent."],
  ["SKILL.md missing required 'description' field", "description is absent or an empty quoted string."],
  ["Invalid skill name '<x>': must be kebab-case", "Failed /^[a-z0-9]+(-[a-z0-9]+)*$/."],
];

export default function Errors() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Reference</span><span className="sep">/</span><span className="current">Error reference</span>
        </nav>

        <div className="hero">
          <h1>Error reference</h1>
          <p className="tagline">
            What each message means, what caused it, and what to do — grouped by the subsystem that raised it.
          </p>
        </div>

        <section id="how">
          <h2><span className="anchor">#</span>How errors are shaped</h2>
          <p>
            Errors follow three conventions across the codebase, and knowing them makes an unfamiliar message
            easier to place.
          </p>
          <p>
            <b>Typed codes for machine handling.</b> Orchestration and MoA raise stable codes —{" "}
            <code className="inline">TIMED_OUT</code>, <code className="inline">INVALID_RESULT</code>,{" "}
            <code className="inline">AGGREGATOR_FAILED</code> — rather than message strings, so callers branch on
            a value instead of parsing prose.
          </p>
          <p>
            <b>Diagnosis attached where it is not obvious.</b> Provider errors are wrapped with context
            explaining a known asymmetry, rather than passed through raw.
          </p>
          <p>
            <b>Failing closed, loudly.</b> When a safety mechanism is unavailable, the operation is refused
            with a message saying so. Several errors on this page exist specifically to prevent a silent
            degradation.
          </p>
        </section>

        <section id="startup">
          <h2><span className="anchor">#</span>Startup & configuration</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Message</th><th style={{ width: "28%" }}>Cause</th><th>Fix</th></tr>
              </thead>
              <tbody>
                {STARTUP.map(([m, c, f]) => (
                  <tr key={m}>
                    <td><code className="inline">{m}</code></td>
                    <td>{c}</td>
                    <td>{f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Settings problems do not raise. Each level records its own error and unrecognized keys are
            collected into <code className="inline">unknownPaths</code>, so a broken project file leaves your
            user settings working. See <a href="/docs/debug-config">Debug your config</a>.
          </p>
        </section>

        <section id="provider">
          <h2><span className="anchor">#</span>Provider errors</h2>
          <p>
            Chat errors are formatted per provider. For DeepSeek and local endpoints the underlying message
            is passed through unchanged — there is no useful extra context to add.
          </p>
          <p>
            For Bedrock and Vertex, an explanation is attached, and it addresses one specific confusion
            documented in the source: <b><code className="inline">/model</code> can work while chat fails.</b>
          </p>
          <p>
            Model listing uses each platform's native SDK. Chat goes through an OpenAI-compatible endpoint
            with different credential requirements. Seeing a model list is therefore not evidence that chat
            is configured — and without that note, a working{" "}
            <code className="inline">/model</code> makes an auth failure look like a bug.
          </p>
        </section>

        <section id="bedrock">
          <h2><span className="anchor">#</span>Bedrock</h2>
          <p>
            An error is classified as authentication when it contains{" "}
            <code className="inline">UnrecognizedClientException</code>,{" "}
            <code className="inline">AccessDeniedException</code>,{" "}
            <code className="inline">InvalidSignatureException</code>,{" "}
            <code className="inline">not authorized</code> or <code className="inline">credentials</code>:
          </p>
          <CodeBlock lang="text">{`AWS credentials error calling chat (<raw>).
Note: /models may work (uses native SDK), but the OpenAI-compatible chat
endpoint requires valid AWS credentials in the configured profile
(~/.aws/credentials).`}</CodeBlock>
          <p>
            Anything else gets the general form, which still carries the SDK-versus-endpoint note because
            that distinction is the most common cause regardless of the exact message.
          </p>
          <p>
            <b>Fix:</b> confirm the profile named in <code className="inline">provider.profile</code> has valid
            credentials and Bedrock permissions in <code className="inline">provider.region</code>. See{" "}
            <a href="/docs/providers">Providers</a>.
          </p>
        </section>

        <section id="vertex">
          <h2><span className="anchor">#</span>Vertex AI</h2>
          <p>
            Classified as a credentials problem when the message contains{" "}
            <code className="inline">GCP_CREDENTIALS</code>, <code className="inline">service account</code>,{" "}
            <code className="inline">PERMISSION_DENIED</code> or <code className="inline">UNAUTHENTICATED</code>:
          </p>
          <CodeBlock lang="text">{`Google Vertex AI authentication error (<raw>).
Note: /models may work (uses native SDK), but the OpenAI-compatible chat
endpoint requires GCP_CREDENTIALS (path to the service account JSON).`}</CodeBlock>
          <p>
            <b>Fix:</b> point <code className="inline">GCP_CREDENTIALS</code> at the service account JSON and
            confirm the account has Vertex AI permissions on{" "}
            <code className="inline">provider.projectId</code> in <code className="inline">provider.location</code>.
          </p>
        </section>

        <section id="permission">
          <h2><span className="anchor">#</span>Permission & risk</h2>
          <p>
            Permission prompts and refusals carry a reason. Read it before changing configuration — the fixes
            are different:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Reason</th><th>Raised when</th></tr>
              </thead>
              <tbody>
                {PERMISSION.map(([r, w]) => (
                  <tr key={r}>
                    <td><code className="inline">{r}</code></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            A denial raises <code className="inline">DenyAbortError</code>, which unwinds the whole turn rather
            than returning an error to the model. That is deliberate: a model told "permission denied" tends
            to look for another route, and the point of denying was to stop the operation.
          </p>
          <Note>
            In <a href="/docs/headless#safety">headless mode</a>, everything requiring interactive
            confirmation is denied automatically. There is no human to ask.
          </Note>
        </section>

        <section id="task">
          <h2><span className="anchor">#</span>Task & orchestration</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>Code</th><th style={{ width: "36%" }}>Meaning</th><th>What to do</th></tr>
              </thead>
              <tbody>
                {TASK.map(([c, m, d]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{m}</td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Two structural errors are raised before anything mutates: a dependency that does not exist, and a
            dependency that would create a cycle or a self-reference. Both are rejected at insertion, so a
            refused edge leaves the graph unchanged.
          </p>
          <p>
            <code className="inline">INVALID_RESULT</code> is the one worth understanding.{" "}
            A worker gets exactly <b>one</b> correction attempt at its terminal call; after that the task
            fails and the raw content is preserved. One retry fixes a formatting slip; unlimited retries let
            a worker loop forever guessing at a schema.
          </p>
        </section>

        <section id="moa">
          <h2><span className="anchor">#</span>MoA</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Code</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {MOA.map(([c, m]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            All five arrive as <code className="inline">MoAExecutionError</code> with a{" "}
            <code className="inline">partial</code> payload — the reference results gathered so far, and the
            aggregator result if it got that far. The candidates are not lost when synthesis fails.
          </p>
          <p>
            <code className="inline">AGGREGATOR_FAILED</code> deliberately does not fall back to returning the
            first candidate. Handing back one unreviewed answer while the caller believes they received a
            synthesis is worse than an error. See <a href="/docs/moa">Mixture of Agents</a>.
          </p>
        </section>

        <section id="worktree">
          <h2><span className="anchor">#</span>Worktree</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "38%" }}>Message</th><th style={{ width: "26%" }}>Cause</th><th>Fix</th></tr>
              </thead>
              <tbody>
                {WORKTREE.map(([m, c, f]) => (
                  <tr key={m}>
                    <td><code className="inline">{m}</code></td>
                    <td>{c}</td>
                    <td>{f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The first two are refusals, not failures. Both exist to prevent a worse outcome — a fake
            worktree with none of the safety properties, and the deletion of uncommitted work. Neither is
            overridable by a flag. See <a href="/docs/worktrees">Worktrees</a>.
          </p>
        </section>

        <section id="extension">
          <h2><span className="anchor">#</span>Plugins & skills</h2>
          <p>
            Skill validation returns a structured error rather than throwing, so a malformed skill reports
            its own problem without taking the session down:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "48%" }}>Message</th><th>Cause</th></tr>
              </thead>
              <tbody>
                {EXTENSION.map(([m, c]) => (
                  <tr key={m}>
                    <td><code className="inline">{m}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Plugin installs fail on two patterns: a repo slug that does not match{" "}
            <code className="inline">REPO_PATTERN</code>, and a name that does not match{" "}
            <code className="inline">PLUGIN_NAME_PATTERN</code>. The repo check is a security boundary — the slug
            becomes part of a path and a git argument.
          </p>
          <p>
            Agent definitions fail early and loudly by design: invalid JSON, unknown fields, traversal globs,
            an invalid schema, unsafe inheritance, or a profile/isolation mismatch aborts registry loading
            and names the source path. Silently skipping a broken agent file was the old behavior and it hid
            real misconfiguration.
          </p>
        </section>

        <section id="compaction">
          <h2><span className="anchor">#</span>Compaction</h2>
          <p>
            <code className="inline">Nothing to compact.</code> is a normal result, not an error — there was no
            conversation after the last boundary.
          </p>
          <p>
            Real failures are recorded as <code className="inline">compact_error</code> in the{" "}
            <a href="/docs/monitoring-audit">audit log</a> with a reason, and they increment{" "}
            <code className="inline">consecutiveFailures</code>. At three, automatic compaction disables itself
            for the session — see <a href="/docs/compaction#breaker">the circuit breaker</a>.
          </p>
          <p>
            Manual <code className="inline">/compact</code> and <code className="inline">/clear</code> keep working
            after the breaker opens. If auto-compaction has stopped and context keeps filling, that is the
            state you are in.
          </p>
          <p>
            Related: <a href="/docs/troubleshooting">Troubleshooting</a> for symptom-driven diagnosis,{" "}
            <a href="/docs/debug-config">Debug your config</a> for configuration problems.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
