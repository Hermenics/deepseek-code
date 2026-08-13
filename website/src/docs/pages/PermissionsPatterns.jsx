import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "syntax", label: "Rule syntax" },
  { id: "names", label: "Use canonical tool names" },
  { id: "subjects", label: "What each pattern matches" },
  { id: "glob", label: "Glob semantics" },
  { id: "resolution", label: "Allow and deny resolution" },
  { id: "layers", label: "Scopes and suppression" },
  { id: "pipeline", label: "Where patterns fit" },
  { id: "risk", label: "Permission patterns vs risk" },
  { id: "recipes", label: "Practical recipes" },
  { id: "debug", label: "Debug a rule" },
  { id: "pitfalls", label: "Pitfalls" },
];

const SUBJECTS = [
  ["shell", "command", "Shell(git status)"],
  ["read_file", "path", "read_file(src/*)"],
  ["write_file", "path", "write_file(docs/*)"],
  ["patch_file", "path", "patch_file(src/*)"],
  ["web_fetch", "url", "web_fetch(https://docs.example.com/*)"],
  ["grep", "pattern only", "grep(TASK_*)"],
  ["Any other tool", "No pattern subject", "Use the bare tool name for an all-use rule"],
];

const OUTCOMES = [
  ["A deny rule matches", "deny"],
  ["Otherwise, an allow rule matches", "allow"],
  ["Allow rules exist, but none match", "ask"],
  ["Only deny rules exist and none match", "allow"],
  ["No permission configuration", "allow"],
];

const RECIPES = [
  ["Read/search baseline", "read_file, read_folder, glob, grep", "Bare names permit every call of those tools."],
  ["Git inspection via shell", "shell(git status), shell(git diff*), shell(git log*)", "Exact command subjects; include intentional argument variants."],
  ["Docs-only writes", "write_file(docs/*), patch_file(docs/*), edit_file(docs/*)", "List each write tool because rules do not alias tool families."],
  ["Block destructive shell", "shell(rm *), shell(git reset --hard*)", "Deny rules win even when an allow also matches."],
  ["One documentation host", "web_fetch(https://docs.example.com/*)", "Matches the literal URL string, case-insensitively."],
];

export default function PermissionsPatterns() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Permission patterns</span>
        </nav>

        <div className="hero">
          <h1>Permission rule patterns</h1>
          <p className="tagline">
            Write precise allow and deny rules, understand the exact value each tool matches, and predict when
            unmatched calls run, ask, or stop.
          </p>
        </div>

        <section id="syntax">
          <h2><span className="anchor">#</span>Rule syntax</h2>
          <p>A permission rule has one of two forms:</p>
          <CodeBlock lang="text">{`tool_name
tool_name(pattern)`}</CodeBlock>
          <p>
            The bare form matches every invocation of that exact tool. The parenthesized form matches only when
            the tool has a supported pattern subject and that subject matches. Tool names are compared
            case-insensitively at runtime; pattern matching is also case-insensitive.
          </p>
          <CodeBlock lang="json">{`{
  "permissions": {
    "allow": [
      "read_file",
      "grep",
      "shell(git status)",
      "shell(git diff*)"
    ],
    "deny": [
      "shell(rm *)",
      "write_file(*.env)"
    ]
  }
}`}</CodeBlock>
          <p>
            Settings validation requires an identifier beginning with a letter or underscore and optional
            non-empty parentheses. It reports malformed values in <code className="inline">/config</code>
            diagnostics. Whitespace outside the rule changes parsing; keep rules compact and canonical.
          </p>
        </section>

        <section id="names">
          <h2><span className="anchor">#</span>Use canonical tool names</h2>
          <p>
            Rules match the actual tool-call name, not the friendly TUI label and not a conceptual family.
            The display name <code className="inline">Bash</code> corresponds to
            <code className="inline">shell</code>; <code className="inline">Read</code> corresponds to
            <code className="inline">read_file</code>; <code className="inline">Edit</code> may be
            <code className="inline">patch_file</code> or <code className="inline">edit_file</code>.
          </p>
          <CodeBlock lang="text">{`Precise
shell(git status)
read_file(src/*)
patch_file(docs/*)

Looks familiar but matches a different/nonexistent tool
Shell(git status)        # works only because tool names are lowercased
ReadFile(src/*)          # becomes "readfile", not "read_file"
Bash(git status)         # becomes "bash", not "shell"`}</CodeBlock>
          <p>
            Existing examples that use PascalCase concatenations such as <code className="inline">ReadFile</code>
            are misleading for this runtime. Case is ignored, underscores are not. Copy names from
            <code className="inline">/tools</code> or the tool reference.
          </p>
          <Note>
            Rules for dynamically discovered MCP tools must use their exact names, including separators. A pattern
            subject is unavailable unless the matcher explicitly supports that tool, so use a bare rule when in doubt.
          </Note>
        </section>

        <section id="subjects">
          <h2><span className="anchor">#</span>What each pattern matches</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "22%" }}>Tool</th><th style={{ width: "24%" }}>Matched argument</th><th>Example</th></tr></thead>
            <tbody>{SUBJECTS.map(([tool, subject, example]) => <tr key={tool}><td><code className="inline">{tool}</code></td><td><code className="inline">{subject}</code></td><td><code className="inline">{example}</code></td></tr>)}</tbody>
          </table></div>
          <p>
            The permission matcher does not pattern-match <code className="inline">read_folder</code> paths,
            glob working directories, edit-file paths, Git actions, workflow scripts, or arbitrary JSON
            serialization. A parenthesized rule for an unsupported tool never matches because there is no subject.
          </p>
          <p>
            For <code className="inline">grep</code>, the subject is the regular-expression search pattern—not the
            directory being searched. <code className="inline">grep(secret*)</code> says nothing about which
            folder can be searched. Filesystem containment remains a separate check.
          </p>
          <p>
            Permission matching uses the arguments after any PreToolUse hook rewrite. A hook cannot obtain
            authorization for one command and then silently execute a different one; the modified input is what
            deny/allow rules inspect.
          </p>
        </section>

        <section id="glob">
          <h2><span className="anchor">#</span>Glob semantics</h2>
          <p>
            Patterns support <code className="inline">*</code> for zero or more characters and
            <code className="inline">?</code> for exactly one character. Matching is against the entire subject,
            not a substring, so add leading or trailing stars intentionally. There are no character classes,
            brace expansion, alternation, escaping language, or special path-separator semantics.
          </p>
          <CodeBlock lang="text">{`shell(git status)     matches exactly "git status"
shell(git diff*)      matches "git diff" and "git diff -- src/app.ts"
shell(*git diff*)     also matches a command with a prefix before "git diff"
read_file(src/?.ts)  matches src/a.ts, not src/auth.ts
read_file(src/*)     * can cross slashes; it is not a filesystem globstar rule`}</CodeBlock>
          <p>
            Comparison lowercases both sides. Permission rules do not normalize whitespace in shell commands,
            while the separate risk matcher does. Therefore <code className="inline">shell(git status)</code>
            does not cover leading spaces, doubled spaces, chained commands, or environment prefixes. Prefer a
            narrowly useful wildcard and test the real command shapes you expect.
          </p>
          <p>
            More than ten <code className="inline">*</code> wildcards makes the matcher return no match. This
            bounds pathological patterns. For an allow rule, no match falls back to ask when any allow list exists;
            for a deny rule, it means that particular deny did not fire.
          </p>
        </section>

        <section id="resolution">
          <h2><span className="anchor">#</span>Allow and deny resolution</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th>Condition</th><th style={{ width: "20%" }}>Decision</th></tr></thead>
            <tbody>{OUTCOMES.map(([condition, result]) => <tr key={condition}><td>{condition}</td><td><code className="inline">{result}</code></td></tr>)}</tbody>
          </table></div>
          <p>
            Deny always wins. Allow order does not express precedence; the first matching allow and the tenth
            matching allow have the same effect. The crucial global behavior is that the presence of <em>any</em>
            allow rule turns every unmatched tool call into <code className="inline">ask</code>.
          </p>
          <CodeBlock lang="json">{`{
  "permissions": {
    "allow": ["shell(git status)"],
    "deny": ["shell(rm *)"]
  }
}`}</CodeBlock>
          <p>
            In that configuration, <code className="inline">read_file</code>,
            <code className="inline">grep</code>, and <code className="inline">shell(bun test)</code> all ask,
            even though the allow list mentions only shell. Add the baseline tools you intend to run unattended or
            omit allow rules and rely on targeted denies plus risk prompts.
          </p>
        </section>

        <section id="layers">
          <h2><span className="anchor">#</span>Scopes and suppression</h2>
          <p>
            Permission arrays merge from user to project to local settings. Duplicate exact strings collapse.
            A narrower scope can remove an inherited allow with
            <code className="inline">permissions.suppress</code>; suppression itself is an exact string list,
            not a glob matcher.
          </p>
          <CodeBlock lang="json">{`{
  "permissions": {
    "suppress": ["shell(bun run build*)"],
    "allow": ["shell(bun test*)"]
  }
}`}</CodeBlock>
          <p>
            Suppression is applied as levels are merged. It removes matching earlier allows, then the same scope's
            own allows are added. Deny rules accumulate and cannot be suppressed. A local file can narrow inherited
            convenience but cannot erase a team safety denial.
          </p>
          <p>
            Choosing “Always allow” in an interactive permission prompt persists the bare canonical tool name at
            user scope. That is intentionally broad: approving one <code className="inline">shell</code> call
            forever adds an all-shell allow, not a command-specific pattern. Prefer hand-authored narrow rules when
            command scope matters.
          </p>
        </section>

        <section id="pipeline">
          <h2><span className="anchor">#</span>Where patterns fit</h2>
          <p>
            A matching allow is not the first or last authorization layer. The main agent evaluates the mode gate,
            PreToolUse rewrites/blocks, path approval where applicable, mandatory risk confirmation, permission
            rules, the active agent's tool allowlist, then executes and runs post hooks.
          </p>
          <p>
            Consequently, an allow cannot enable a write tool in Review mode, open a protected file, widen an agent
            allowlist, approve an external directory, bypass a hook, or suppress mandatory high risk. It answers
            only the declarative permission-rule stage.
          </p>
          <CodeBlock lang="bash">{`/permissions    # effective mode tools, agent allowlist, rules, risk and session approvals
/config         # origin and validation diagnostics
/tools          # canonical tool names enabled in this session`}</CodeBlock>
        </section>

        <section id="risk">
          <h2><span className="anchor">#</span>Permission patterns vs risk</h2>
          <p>
            Permission rules answer “is this invocation allowed by configuration?” Risk rules answer “does this
            operation require human confirmation?” They use similar glob syntax but are different systems with
            different subjects, normalization, defaults, and precedence.
          </p>
          <p>
            Mandatory high-risk defaults cannot be disabled or downgraded. Even if a permission allow matches,
            operations such as destructive deletion, force-push, hard reset, privileged commands, package
            installation, protected configuration writes, structured Git push/pull, and large overwrites still
            require their risk decision.
          </p>
          <p>
            <code className="inline">permissions.autoApproveLowRisk</code> affects only an
            <code className="inline">ask</code> from permission rules when no risk rule matched. It does not turn a
            deny into allow and does not classify medium risk as low.
          </p>
          <Note>
            Workers apply permission policy and risk independently. A coordinator mailbox grant can satisfy one
            exact pending permission request; it does not override the worker's profile or risk rejection.
          </Note>
        </section>

        <section id="recipes">
          <h2><span className="anchor">#</span>Practical recipes</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "24%" }}>Intent</th><th style={{ width: "40%" }}>Rules</th><th>Notes</th></tr></thead>
            <tbody>{RECIPES.map(([intent, rules, notes]) => <tr key={intent}><td><b>{intent}</b></td><td><code className="inline">{rules}</code></td><td>{notes}</td></tr>)}</tbody>
          </table></div>
          <CodeBlock lang="json">{`{
  "permissions": {
    "allow": [
      "read_file", "read_folder", "glob", "grep",
      "write_file(docs/*)", "patch_file(docs/*)", "edit_file"
    ],
    "deny": [
      "shell(rm *)", "shell(git reset --hard*)",
      "write_file(*.env)", "patch_file(*.env)"
    ]
  }
}`}</CodeBlock>
          <p>
            The example intentionally uses bare <code className="inline">edit_file</code>: this runtime cannot
            pattern-match its path in permission rules. If docs-only surgical edits are a hard boundary, omit that
            tool and use a supported patch/write path rule, or enforce the path with a reviewed hook and normal
            filesystem containment.
          </p>
        </section>

        <section id="debug">
          <h2><span className="anchor">#</span>Debug a rule</h2>
          <CodeBlock lang="text">{`1. Run /tools and copy the exact tool name.
2. Run /permissions and confirm the effective allow, deny, mode and agent layers.
3. Open /config diagnostics and fix malformed or wrong-scope entries.
4. Identify the match subject: command, path, URL, or grep pattern.
5. Compare the complete subject to the complete glob, including spaces and prefixes.
6. Check whether a deny, mode, path, risk, agent, or hook layer stopped it instead.
7. Clear session approvals in /config if an earlier decision masks the test.`}</CodeBlock>
          <p>
            Test with a harmless operation and inspect the prompt reason. A reason of
            <code className="inline">permission</code> points to this rule system;
            <code className="inline">risk</code>, <code className="inline">outside_workspace</code>,
            <code className="inline">agent_config</code>, and <code className="inline">workflow</code> require a
            different fix.
          </p>
        </section>

        <section id="pitfalls">
          <h2><span className="anchor">#</span>Pitfalls</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "34%" }}>Mistake</th><th>Consequence</th></tr></thead>
            <tbody>
              <tr><td>Using <code className="inline">ReadFile</code></td><td>It normalizes to <code className="inline">readfile</code>, which does not match <code className="inline">read_file</code>.</td></tr>
              <tr><td>Adding one allow and expecting other tools unchanged</td><td>Every unmatched invocation now asks.</td></tr>
              <tr><td>Writing <code className="inline">edit_file(src/*)</code></td><td>The tool has no permission pattern subject, so it never matches.</td></tr>
              <tr><td>Using a filesystem glob mental model</td><td><code className="inline">*</code> crosses slashes and there is no globstar distinction.</td></tr>
              <tr><td>Assuming risk whitespace normalization applies</td><td>Permission shell patterns compare the literal spacing supplied to the tool.</td></tr>
              <tr><td>Relying on “Always allow” for one command</td><td>It persists a bare all-use tool allow.</td></tr>
              <tr><td>Allowing a path outside the project in settings</td><td>The external-path gate still asks; permissions do not define filesystem roots.</td></tr>
              <tr><td>Trying to suppress a deny</td><td>Deny accumulation is intentional and cannot be undone at a narrower scope.</td></tr>
            </tbody>
          </table></div>
          <p>
            See <a href="/docs/permissions">Permissions</a>, <a href="/docs/security">Security</a>, and
            <a href="/docs/external-paths">External paths</a> for the layers around pattern resolution.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
