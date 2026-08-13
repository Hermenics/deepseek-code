import { CodeBlock, Note, Toc } from "../Layout";
const TOC = [
  { id: "model", label: "The permission model" },
  { id: "rules", label: "Rule syntax" },
  { id: "matching", label: "Glob matching" },
  { id: "suppress", label: "allow, deny & suppress" },
  { id: "risk", label: "The risk system" },
  { id: "high", label: "High-risk rules" },
  { id: "medium", label: "Medium-risk rules" },
  { id: "conditions", label: "Conditional rules" },
  { id: "resolution", label: "How a rule is chosen" },
  { id: "customizing", label: "Customizing risk" },
  { id: "answers", label: "Answering a prompt" },
  { id: "profiles", label: "Profiles & workers" },
];
const DECISIONS = [
  ["allow", "Run without asking."],
  ["deny", "Block the call. A configured deny returns a blocked result; refusing a prompt ends the turn."],
  ["ask", "Prompt the user. In a worker, this blocks the task instead."],
];
const HIGH_SHELL = [
  ["shell:rm", "rm *"],
  ["shell:rm-rf", "rm -rf *"],
  ["shell:sudo", "sudo *"],
  ["shell:chmod", "chmod *"],
  ["shell:systemctl", "systemctl *"],
  ["shell:force-push", "git push *--force*  (plus four -f variants)"],
  ["shell:reset-hard", "git reset --hard*"],
  ["shell:checkout-destructive", "git checkout -- *"],
  ["shell:clean", "git clean *"],
  ["shell:npm-install", "npm install*"],
  ["shell:bun-add", "bun add*"],
  ["shell:pip-install", "pip install*"],
  ["shell:apt-install", "apt install*"],
  ["shell:docker-rm", "docker *--rm*"],
  ["shell:build", "bun run build*"],
  ["shell:deploy-run", "*run deploy*"],
  ["shell:deploy-script", "*deploy.sh*"],
  ["shell:deploy-cmd", "*serverless deploy*"],
  ["shell:deploy-cdk", "cdk deploy*"],
];
const HIGH_OTHER = [
  ["git:push", "git", "push"],
  ["git:pull", "git", "pull"],
  ["git:force-push", "git", "push --force"],
  ["write:deepseek-config", "write_file", "*.deepseek/*"],
  ["edit:deepseek-config", "edit_file", "*.deepseek/*"],
  ["patch:deepseek-config", "patch_file", "*.deepseek/*"],
  ["write:steering", "write_file", "*.deepseek/steering/*"],
  ["edit:steering", "edit_file", "*.deepseek/steering/*"],
];

const MEDIUM = [
  ["shell:git-push", "shell", "git push*"],
  ["shell:git-commit", "shell", "git commit*"],
  ["shell:npm-install-dev", "shell", "npm install --save-dev*"],
  ["shell:bun-add-dev", "shell", "bun add -d*"],
  ["write:config-package", "write_file", "*package.json"],
  ["write:config-tsconfig", "write_file", "*tsconfig*"],
  ["write:config-dockerfile", "write_file", "*Dockerfile*"],
];

const CONDITIONS = [
  ["large_overwrite", "high", "write_file", "The file being overwritten has at least largeFileLines (default 100) lines."],
  ["multi_edit_burst", "medium", "write_file, edit_file, patch_file", "recentWriteCount has reached burstCount (default 3)."],
];

const ANSWERS = [
  ["once", "This call only. The next identical call asks again."],
  ["session", "This tool for the rest of the session. In memory only."],
  ["directory", "An approved external directory tree for path tools in this session."],
  ["always", "Writes the bare tool name to User settings. Future sessions inherit that broad allow."],
  ["deny", "Refuse. The turn unwinds rather than continuing."],
];

export default function Permissions() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Permissions</span>
        </nav>

        <div className="hero">
          <h1>Permissions</h1>
          <p className="tagline">
            Two independent authorization systems govern tool calls: declarative allow/deny rules, and a
            pattern-based risk model with 42 built-in rules.
          </p>
        </div>

        <section id="model">
          <h2><span className="anchor">#</span>The permission model</h2>
          <p>
            Tool calls are subject to <b>risk assessment</b> and <b>permission resolution</b>; path-based
            tools also need a safe workspace path or an approved external directory. These checks are
            independent, and any applicable check can stop a call.
          </p>
          <p>
            The outcome of resolution is one of three decisions:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Decision</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {DECISIONS.map(([d, e]) => (
                  <tr key={d}>
                    <td><code className="inline">{d}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            A configured <code className="inline">deny</code> rule returns a blocked tool result to the main
            agent. If you answer <code className="inline">deny</code> at an interactive permission, risk, or
            external-path prompt, the runtime aborts the turn instead. Workers handle a declarative
            <code className="inline">ask</code> differently: the task becomes blocked for coordinator review.
          </p>
          <Note>
            The systems do not override each other. A risk match can require authorization even when an
            allow rule matches, and a permission rule can deny a call with no risk match.
          </Note>
        </section>

        <section id="rules">
          <h2><span className="anchor">#</span>Rule syntax</h2>
          <p>
            A rule is a tool name with an optional pattern in parentheses:
          </p>
          <CodeBlock lang="text">{`shell(git *)       → tool "shell",      pattern "git *"
read_file          → tool "read_file",  matches every read
write_file(*.ts)   → tool "write_file", pattern "*.ts"`}</CodeBlock>
          <p>
            Tool names are case-insensitive but separators are not invented: <code className="inline">Shell</code>
            matches <code className="inline">shell</code>, while <code className="inline">ReadFile</code> becomes
            <code className="inline">readfile</code> and does not match <code className="inline">read_file</code>.
            Use the exact names shown by <code className="inline">/tools</code>. Invalid syntax is reported by
            settings validation; at runtime a malformed string normally matches no registered tool.
          </p>
          <p>
            <b>No pattern means every use of that tool.</b> That is the most common mistake in a settings
            file: <code className="inline">"allow": ["shell"]</code> approves every shell command you will ever
            run, not just the ones you had in mind.
          </p>
          <CodeBlock lang="json">{`// .deepseek/settings.json
{
  "permissions": {
    "allow": ["read_file", "grep", "glob", "shell(git status)", "shell(git diff*)"],
    "deny":  ["shell(rm *)", "write_file(*.env)"],
    "autoApproveLowRisk": true
  }
}`}</CodeBlock>
        </section>

        <section id="matching">
          <h2><span className="anchor">#</span>Glob matching</h2>
          <p>
            Patterns use <code className="inline">*</code> for any characters and{" "}
            <code className="inline">?</code> for one. Matching is case-insensitive and uses a bounded glob
            matcher rather than regular-expression translation. Patterns with more than ten asterisks are
            rejected.
          </p>
          <p>
            Matching covers the entire value and avoids regular-expression backtracking. Any pattern with
            more than <b>ten asterisks</b> is refused outright.
          </p>
          <p>
            The refusal returns <code className="inline">false</code> — no match — which fails toward{" "}
            <em>not</em> applying the rule. For an allow rule that means the call still gets evaluated
            normally rather than being silently approved by an unevaluatable pattern.
          </p>
          <p>
            Declarative permission matching uses the shell command exactly as supplied; it does not trim or
            collapse whitespace. Risk matching is separate and does normalize shell whitespace. See{" "}
            <a href="/docs/permission-patterns">Permission patterns</a> for match subjects and edge cases.
          </p>
        </section>

        <section id="suppress">
          <h2><span className="anchor">#</span>allow, deny & suppress</h2>
          <p>
            Permissions resolve across the three settings levels — user, project, local — and a narrower
            level can add rules. It can also <b>remove an inherited allow rule</b> with{" "}
            <code className="inline">suppress</code>:
          </p>
          <CodeBlock lang="json">{`// .deepseek/settings.local.json
{
  "permissions": {
    "suppress": ["Shell(bun run build*)"]
  }
}`}</CodeBlock>
          <p>
            Suppression takes the <b>exact rule string</b>, not a pattern that matches it. That is what makes
            it auditable: you can read a suppress list and know precisely which inherited rules it disables,
            with no need to compute glob overlaps.
          </p>
          <p>
            <b>Deny rules cannot be suppressed.</b> This is the one asymmetry in the whole model, and it is
            what makes a deny rule meaningful. A team that denies{" "}
            <code className="inline">Shell(rm -rf *)</code> in the project settings needs that to hold even
            though every developer can write a local file — otherwise the deny list is a suggestion.
          </p>
          <p>
            In the main coordinator, <code className="inline">autoApproveLowRisk</code> skips a declarative
            <code className="inline">ask</code> prompt when no risk rule matched. It does not override a deny,
            mode gate, path check, profile, or hook.
          </p>
        </section>

        <section id="risk">
          <h2><span className="anchor">#</span>The risk system</h2>
          <p>
            Risk is a separate, pattern-based classification with two levels — and the second level is
            context-dependent:
          </p>
          <p>
            <b>High</b> requires coordinator confirmation and is blocked inside a worker. <b>Medium</b> does not
            require confirmation in the main coordinator, but the worker executor blocks it. A call matching
            no risk rule passes the risk check, though other authorization layers still apply.
          </p>
          <p>
            That asymmetry is the most interesting decision in the file.{" "}
            <code className="inline">git commit</code> is medium: when you asked for it, confirming is friction;
            when an autonomous worker decides to do it on its own, it is worth stopping. The same operation
            carries different risk depending on who initiated it.
          </p>
          <p>
            The content a rule matches against depends on the tool:{" "}
            <code className="inline">command</code> for shell, <code className="inline">path</code> for the write
            tools, and <code className="inline">action</code> plus a{" "}
            <code className="inline">--force</code> suffix for git. Tools not in that list have no matchable
            content, so no pattern rule can apply to them.
          </p>
        </section>

        <section id="high">
          <h2><span className="anchor">#</span>High-risk rules</h2>
          <p>Shell patterns classified as high risk:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "34%" }}>Rule id</th><th>Pattern</th></tr>
              </thead>
              <tbody>
                {HIGH_SHELL.map(([i, p]) => (
                  <tr key={i}>
                    <td><code className="inline">{i}</code></td>
                    <td><code className="inline">{p}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Force-push has <b>five</b> separate rules. Glob matching cannot express "the token{" "}
            <code className="inline">-f</code> anywhere", so each position it can appear in gets its own
            pattern — mid-command, at the end, immediately after <code className="inline">push</code>, and bare.
            Verbose, and it closes the gaps a single clever pattern would leave.
          </p>
          <p>
            Package installs being high risk surprises people. The reasoning is supply chain: an install
            executes arbitrary lifecycle scripts from the network, which is a larger capability than most
            file edits.
          </p>
          <p>Non-shell high-risk rules:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Rule id</th><th style={{ width: "20%" }}>Tool</th><th>Pattern</th></tr>
              </thead>
              <tbody>
                {HIGH_OTHER.map(([i, t, p]) => (
                  <tr key={i}>
                    <td><code className="inline">{i}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td><code className="inline">{p}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Two clusters matter here. <b>Git through the structured tool is still high risk</b> — the{" "}
            <code className="inline">git</code> tool is an ergonomic alternative to shelling out, not a way
            around the confirmation, so <code className="inline">push</code> and{" "}
            <code className="inline">pull</code> are gated on both paths.
          </p>
          <p>
            Rules also classify writes under <code className="inline">.deepseek/</code> as high risk. Path
            safety normally rejects those protected paths before execution; a valid flat workflow file is
            the narrow workspace exception and still receives risk review. Protected names are checked
            relative to each approved root, so never approve a protected directory itself as an external
            root—approve an appropriate parent and keep the protected segment visible to path validation.
          </p>
        </section>

        <section id="medium">
          <h2><span className="anchor">#</span>Medium-risk rules</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Rule id</th><th style={{ width: "20%" }}>Tool</th><th>Pattern</th></tr>
              </thead>
              <tbody>
                {MEDIUM.map(([i, t, p]) => (
                  <tr key={i}>
                    <td><code className="inline">{i}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td><code className="inline">{p}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The dev-dependency variants are the clearest illustration of the level split.{" "}
            <code className="inline">npm install*</code> is high, but{" "}
            <code className="inline">npm install --save-dev*</code> is medium — a longer, more specific pattern
            that wins by specificity and downgrades the level. A production dependency ships to users; a dev
            dependency does not.
          </p>
        </section>

        <section id="conditions">
          <h2><span className="anchor">#</span>Conditional rules</h2>
          <p>
            Two rules match on <b>context</b> rather than on a pattern:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>Condition</th>
                  <th style={{ width: "12%" }}>Level</th>
                  <th style={{ width: "26%" }}>Tools</th>
                  <th>Fires when</th>
                </tr>
              </thead>
              <tbody>
                {CONDITIONS.map(([c, l, t, f]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{f}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">large_overwrite</code> catches the operation that looks routine and is
            not: replacing a 400-line file wholesale. It needs the existing line count to be supplied by the
            caller, and <b>skips the rule entirely when that is missing</b> rather than assuming. An
            unmeasurable condition produces no match instead of a guess in either direction.
          </p>
          <p>
            <code className="inline">multi_edit_burst</code> catches volume. Three writes in quick succession
            is a pattern of behavior rather than a single dangerous act — individually reasonable, worth a
            look together.
          </p>
        </section>

        <section id="resolution">
          <h2><span className="anchor">#</span>How a rule is chosen</h2>
          <p>
            With 42 default rules, several can match one call. Resolution is deterministic:
          </p>
          <p>
            <b>1. Merge.</b> User rules override defaults <em>by id</em>. Rules with new ids are appended.
          </p>
          <p>
            <b>2. Filter.</b> Rules with <code className="inline">enabled: false</code> drop out. If{" "}
            <code className="inline">risk.enabled</code> is <code className="inline">false</code>, only{" "}
            <b>high</b> rules survive — disabling risk assessment silences medium, never high.
          </p>
          <p>
            <b>3. Sort by specificity.</b> Longer pattern first. At equal length, high before medium.
          </p>
          <p>
            <b>4. First match wins.</b> The first rule that matches produces the assessment.
          </p>
          <p>
            Sorting by <b>pattern length</b> is a heuristic standing in for specificity, and it is why{" "}
            <code className="inline">npm install --save-dev*</code> (25 chars) is evaluated before{" "}
            <code className="inline">npm install*</code> (12 chars). It is not a perfect measure of
            specificity, and it is a rule you can reason about without simulating the matcher.
          </p>
          <Note>
            One override is protected. Attempting to override a built-in <b>high</b> rule keeps the original level and
            forces <code className="inline">enabled: true</code> — you may change its description, you may not
            downgrade or disable it. Only medium rules are fully overridable.
          </Note>
        </section>

        <section id="customizing">
          <h2><span className="anchor">#</span>Customizing risk</h2>
          <CodeBlock lang="json">{`// .deepseek/settings.json
{
  "risk": {
    "enabled": true,
    "thresholds": {
      "largeFileLines": 200,
      "burstCount": 5
    },
    "rules": [
      { "id": "shell:terraform", "level": "high", "tool": "shell",
        "pattern": "terraform apply*",
        "description": "Applies infrastructure changes" },
      { "id": "shell:git-commit", "enabled": false }
    ]
  }
}`}</CodeBlock>
          <p>
            The first entry adds a rule with a new id and a custom{" "}
            <code className="inline">description</code>, which is what appears in the confirmation prompt. A
            description explaining <em>why</em> turns a prompt from an interruption into a decision.
          </p>
          <p>
            The second disables a rule by id — and works only because{" "}
            <code className="inline">shell:git-commit</code> is medium. The same entry against{" "}
            <code className="inline">shell:rm-rf</code> would be ignored.
          </p>
          <p>
            Raise <code className="inline">thresholds</code> in a codebase where 100-line files are small or
            multi-file edits are routine, and the corresponding rules stop firing on normal work.
          </p>
        </section>

        <section id="answers">
          <h2><span className="anchor">#</span>Answering a prompt</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Answer</th><th>Effect</th></tr>
              </thead>
              <tbody>
                {ANSWERS.map(([a, e]) => (
                  <tr key={a}>
                    <td><code className="inline">{a}</code></td>
                    <td>{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Every prompt names the reason it appeared —{" "}
            <code className="inline">outside_workspace</code>, <code className="inline">risk</code>,{" "}
            <code className="inline">permission</code>, <code className="inline">agent_config</code> or{" "}
            <code className="inline">workflow</code>. Read it before answering; a{" "}
            <code className="inline">risk</code> prompt and a <code className="inline">permission</code> prompt
            have different fixes.
          </p>
          <p>
            <code className="inline">session</code> and <code className="inline">directory</code> live in memory
            and vanish on exit. Only <code className="inline">always</code> persists — it writes a rule to your
            User settings. That rule is the bare tool name, so it allows every use of that tool; remove it in
            <code className="inline">/config</code> when you no longer want that scope.
          </p>
        </section>

        <section id="profiles">
          <h2><span className="anchor">#</span>Profiles & workers</h2>
          <p>
            Workers get a fourth layer. A <b>permission profile</b> is a capability envelope checked{" "}
            <em>before</em> declarative rules, so rules can narrow a profile but never open it:{" "}
            <code className="inline">researcher-readonly</code>, <code className="inline">tester</code>,{" "}
            <code className="inline">writer-worktree</code>, <code className="inline">coordinator-integrator</code>.
          </p>
          <p>
            An <code className="inline">ask</code> decision behaves differently there. With no human attached to
            a worker, processing stops at that call, later calls in the same batch do not run, the task
            blocks, and a permission message goes to the coordinator. Calls earlier in the batch may already
            have completed because worker calls are evaluated in order. High-risk calls are blocked rather
            than entering this permission-grant handshake.
          </p>
          <p>
            The final tool set a worker receives is the <b>intersection</b> of its role's tools, its
            profile's tools and its parent's allowlist. Delegation can only narrow privileges — this is the
            non-widening rule that makes unattended parallel work safe. See{" "}
            <a href="/docs/agent-teams#profiles">Agent teams</a> and{" "}
            <a href="/docs/agent-messaging#permission">the permission handshake</a>.
          </p>
          <CodeBlock lang="bash">{`/permissions    # effective allow, deny and risk rules
/system         # active mode and permission summary`}</CodeBlock>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
