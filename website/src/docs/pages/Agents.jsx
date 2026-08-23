import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what", label: "What an agent is" },
  { id: "builtins", label: "The built-in agents" },
  { id: "layers", label: "The five layers" },
  { id: "trust", label: "Workspace trust" },
  { id: "schema", label: "The config schema" },
  { id: "roles", label: "Roles" },
  { id: "usage", label: "usage: primary, subagent, both" },
  { id: "inheritance", label: "Inheritance with extends" },
  { id: "coherence", label: "Coherence rules" },
  { id: "limits", label: "Per-agent limits" },
  { id: "failfast", label: "Why bad configs abort loading" },
  { id: "using", label: "Using an agent" },
];

const BUILTINS = [
  ["coder", "executor", "Senior implementation engineer: smallest diff, strict YAGNI, follow existing patterns."],
  ["reviewer", "reviewer", "Senior code reviewer: rates findings CRITICAL / IMPORTANT / SUGGESTION."],
  ["tester", "executor", "Senior test engineer: tests that catch real failures."],
];

const LAYERS = [
  ["builtin", "compiled in", "coder, reviewer, tester."],
  ["user", "~/.deepseek/agents/", "Your agents, available in every project."],
  ["additional", "agents.additionalDirectories", "Extra directories you configure."],
  ["project", ".deepseek/agents/", "Team agents. Commit these."],
  ["local", ".deepseek/agents.local/", "Personal overrides. Gitignored."],
];

const SCHEMA = [
  ["name", "string", "Required. ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$"],
  ["systemPrompt", "string", "The agent's instructions. Required unless extends is present."],
  ["extends", "string", "Inherit from another agent, or builtin:<name>."],
  ["description", "string", "Shown in listings."],
  ["responsibility", "string", "What this agent is for. Minimum length 1."],
  ["usage", "'primary' | 'subagent' | 'both'", "Where the agent may run."],
  ["role", "reader | writer | executor | reviewer | unrestricted", "Tool family."],
  ["enabled", "boolean", "Switch the agent off without deleting it."],
  ["model", "string", "Per-agent model override."],
  ["tools / allowedTools", "'*' | string[]", "Tool allowlist. Unique items."],
  ["permissions", "{ policy, allow, deny }", "policy is inherit or isolated."],
  ["permissionProfile", "researcher-readonly | tester | writer-worktree | coordinator-integrator", "Runtime capability envelope."],
  ["contextMode", "'fresh' | 'fork'", "Whether prior results are injected as untrusted data."],
  ["isolation", "readonly-shared | git-worktree | serialized-writer", "Workspace isolation."],
  ["allowDelegation", "boolean", "Whether this agent may spawn sub-agents."],
  ["outputSchema", "object", "Custom result schema."],
  ["files", "string[]", "File globs the agent may reference."],
  ["color", "string", "Display color."],
];

const LIMITS = [
  ["timeoutMs", "1 … 86,400,000", "Per-attempt deadline. Maximum is 24 hours."],
  ["maxRetries", "0 … 10", "Bounded retries."],
  ["maxDepth", "0 … 32", "Delegation depth."],
  ["maxFanOut", "1 … 100", "Children per parent. Minimum 1 — zero would be a disabled agent."],
  ["maxTokens", "≥ 1", "Token budget."],
  ["maxCostUsd", "> 0", "Cost budget. Exclusive minimum — zero would mean no work at all."],
];

const COHERENCE = [
  ["allowDelegation: true with maxDepth: 0", "May delegate, may not nest. Contradiction."],
  ["researcher-readonly with non-readonly isolation", "A read-only profile in a writable workspace."],
  ["writer-worktree with non-worktree isolation", "A worktree writer without a worktree."],
  ["isolation: serialized-writer", "A runtime fallback, never a selectable mode."],
];

export default function Agents() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Agents</span><span className="sep">/</span><span className="current">Agents</span>
        </nav>

        <div className="hero">
          <h1>Agents</h1>
          <p className="tagline">
            Named, declarative configurations — prompt, role, tools, permission profile and limits — resolved
            through five layers and validated before anything loads.
          </p>
        </div>

        <section id="what">
          <h2><span className="anchor">#</span>What an agent is</h2>
          <p>
            An agent is a JSON file describing how a particular kind of work should be done: what the model
            is told, which tools it may use, what permission envelope it runs under, and what limits bound
            it.
          </p>
          <p>
            The same definition serves two purposes. It can be your <b>primary</b> session — launched with{" "}
            <code className="inline">deepseek agent reviewer</code> — or a <b>sub-agent</b> spawned by the{" "}
            <code className="inline">subagent</code> tool. Which of those are allowed is declared by the agent
            itself.
          </p>
          <p>
            The canonical location is <code className="inline">.deepseek/agents/*.json</code>. Definitions are
            validated eagerly on load and again after inheritance is resolved.
          </p>
        </section>

        <section id="builtins">
          <h2><span className="anchor">#</span>The built-in agents</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Agent</th><th style={{ width: "16%" }}>Role</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {BUILTINS.map(([a, r, p]) => (
                  <tr key={a}>
                    <td><code className="inline">{a}</code></td>
                    <td><code className="inline">{r}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            All three ship with <code className="inline">usage: 'both'</code>, so each works as a primary
            session or a worker. All three end with the protected{" "}
            <code className="inline">submit_result</code> protocol.
          </p>
          <p>
            Internally each built-in is registered as extending{" "}
            <code className="inline">builtin:&lt;its own name&gt;</code>. That self-reference is what makes the
            inheritance path uniform — a user definition extending{" "}
            <code className="inline">builtin:coder</code> resolves through exactly the same machinery as one
            extending another user agent.
          </p>
          <p>
            Turn one off with <code className="inline">agents.disabledBuiltins</code> in{" "}
            <a href="/docs/settings">settings</a>.
          </p>
        </section>

        <section id="layers">
          <h2><span className="anchor">#</span>The five layers</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Layer</th><th style={{ width: "32%" }}>Directory</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {LAYERS.map(([l, d, p]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{d}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Later layers win, so <code className="inline">agents.local/</code> beats{" "}
            <code className="inline">agents/</code> beats your user directory beats the built-ins. It is the same
            shape as <a href="/docs/settings#levels">settings</a> for the same reason: a team needs shared
            definitions in version control, an individual needs to deviate without dirtying the repository.
          </p>
          <p>
            <code className="inline">additional</code> sits between user and project. Configured through{" "}
            <code className="inline">agents.additionalDirectories</code>, it is how a shared team library outside
            the repository gets loaded without pretending to be either personal or project-local.
          </p>
        </section>

        <section id="trust">
          <h2><span className="anchor">#</span>Workspace trust</h2>
          <p>
            Built-in and User-scope agents are trusted by their source. Project, Local and additional agents
            are treated as untrusted executable guidance until you approve them for the current workspace.
            Loading an unapproved agent fails closed and asks for an explicit decision in the UI.
          </p>
          <CodeBlock lang="text">{`agent definition       .deepseek/agents/reviewer.json
trust record            ~/.deepseek/workspace-trust.json
approval binding        canonical path + SHA-256 content hash`}</CodeBlock>
          <p>
            Editing the JSON, changing an inherited definition, or moving the file changes the artifact and
            requires a new approval. The runtime tracks the source and current trust state so a project agent
            is not confused with a User-scope override; <code className="inline">/agents</code> shows the source
            layer in its compact listing.
          </p>
          <Note>
            An agent's system prompt and referenced files are still untrusted task guidance. They can specialize
            the agent, but cannot grant tools, permissions, policy exceptions or authority over the user's request.
          </Note>
        </section>

        <section id="schema">
          <h2><span className="anchor">#</span>The config schema</h2>
          <p>
            Definitions are validated against{" "}
            <code className="inline">AGENT_CONFIG_SCHEMA</code>, which sets{" "}
            <code className="inline">additionalProperties: false</code> — an unknown field is an <b>error</b>, not
            something ignored:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Field</th><th style={{ width: "32%" }}>Type</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {SCHEMA.map(([f, t, m]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{t}</code></td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Rejecting unknown fields is what makes a typo actionable. A permissive schema would accept{" "}
            <code className="inline">"permissionprofile"</code> and silently run the agent with no profile — a
            security-relevant setting quietly absent. Here it fails at load with the field name.
          </p>
          <p>
            The <code className="inline">name</code> pattern requires an alphanumeric first character and allows
            letters, digits, hyphens and underscores up to 64 characters. Names become filesystem and
            registry keys, and a leading hyphen would read as a flag.
          </p>
          <p>
            One requirement is expressed as a disjunction:{" "}
            <code className="inline">anyOf: [systemPrompt, extends]</code>. An agent must either say what it is
            or say what it inherits from. A definition with neither is a name with no behavior.
          </p>
        </section>

        <section id="roles">
          <h2><span className="anchor">#</span>Roles</h2>
          <p>
            <code className="inline">role</code> selects a tool family:{" "}
            <code className="inline">reader</code>, <code className="inline">writer</code>,{" "}
            <code className="inline">executor</code>, <code className="inline">reviewer</code>,{" "}
            <code className="inline">unrestricted</code>.
          </p>
          <p>
            When a sub-agent is spawned without an explicit role, it is <b>inferred from the task wording</b>,
            and ambiguity resolves to the narrowest option — see{" "}
            <a href="/docs/subagents#roles">Sub-agents</a>.
          </p>
          <p>
            <code className="inline">unrestricted</code> is not a bypass. The final tool set is the{" "}
            <b>intersection</b> of the role's tools, the permission profile's tools, and the parent's
            allowlist, so an unrestricted role is still capped by its profile and its parent.
          </p>
        </section>

        <section id="usage">
          <h2><span className="anchor">#</span>usage: primary, subagent, both</h2>
          <p>
            <code className="inline">usage</code> declares where an agent may run, and it defaults to{" "}
            <code className="inline">primary</code> for user definitions.
          </p>
          <p>
            That default is a safety decision. A newly written agent runs where <b>you</b> invoke it, not
            wherever an autonomous coordinator decides to spawn it. Opting into{" "}
            <code className="inline">subagent</code> or <code className="inline">both</code> is explicit.
          </p>
          <p>
            It also determines broadcast membership:{" "}
            <code className="inline">ask_agent</code> with <code className="inline">broadcast: true</code> reaches
            every enabled agent whose usage is <code className="inline">subagent</code> or{" "}
            <code className="inline">both</code>. An agent that never opted in is never broadcast to.
          </p>
        </section>

        <section id="inheritance">
          <h2><span className="anchor">#</span>Inheritance with extends</h2>
          <CodeBlock lang="json">{`// .deepseek/agents/strict-coder.json
{
  "name": "strict-coder",
  "extends": "builtin:coder",
  "systemPrompt": "Be even more conservative about new abstractions. Never add a dependency without asking.",
  "maxFanOut": 2
}`}</CodeBlock>
          <p>
            <code className="inline">extends</code> takes either another agent's name or{" "}
            <code className="inline">builtin:&lt;name&gt;</code>. Resolution handles chains — an agent extending an
            agent that itself extends a built-in — by resolving pending definitions recursively.
          </p>
          <p>
            Two failure modes are caught explicitly and named in the error: extending a <b>missing</b> agent,
            and extending a missing <b>built-in</b>. They get separate messages because the fixes differ — a
            typo in a name versus a built-in you disabled in settings.
          </p>
          <p>
            <b>Cyclic inheritance is rejected.</b> Two agents extending each other would otherwise recurse
            until the stack gave out, at a point far from the actual mistake.
          </p>
          <p>
            Validation runs <b>twice</b>: once on the raw file and once after inheritance resolves. Two valid
            fragments can compose into an invalid whole — a base with{" "}
            <code className="inline">maxDepth: 0</code> and a child with{" "}
            <code className="inline">allowDelegation: true</code> are each fine alone and contradictory merged.
          </p>
        </section>

        <section id="coherence">
          <h2><span className="anchor">#</span>Coherence rules</h2>
          <p>
            Four combinations pass the schema and are still refused, because they are internally
            contradictory:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "44%" }}>Rejected</th><th>Why</th></tr>
              </thead>
              <tbody>
                {COHERENCE.map(([r, w]) => (
                  <tr key={r}>
                    <td><code className="inline">{r}</code></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The profile-isolation pairs are the important ones. A{" "}
            <code className="inline">researcher-readonly</code> agent placed in a writable workspace would have
            a read-only <em>tool set</em> in a mutable <em>environment</em> — the profile would look enforced
            while the isolation contradicted it. Requiring them to agree means a profile means the same thing
            everywhere.
          </p>
          <p>
            <code className="inline">serialized-writer</code> is rejected outright as a selectable value with an
            explicit message: it is what the runtime falls back to when a git worktree cannot be created, not
            a mode to request. Choosing it deliberately would be asking for degraded isolation.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Per-agent limits</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Field</th><th style={{ width: "26%" }}>Range</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([f, r, n]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{r}</code></td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The bounds encode intent rather than arbitrary caution.{" "}
            <code className="inline">maxFanOut</code> has a minimum of 1 because zero children means an agent
            that cannot do the thing it was configured for.{" "}
            <code className="inline">maxCostUsd</code> uses an <b>exclusive</b> minimum because a budget of zero
            authorizes nothing — if you want that, disable the agent.
          </p>
          <p>
            Agent limits narrow the session limits from <a href="/docs/settings#agents">settings</a>. They
            cannot raise them.
          </p>
        </section>

        <section id="failfast">
          <h2><span className="anchor">#</span>Why bad configs abort loading</h2>
          <p>
            An invalid definition <b>aborts registry loading</b> and names the source path. Invalid JSON,
            unknown fields, traversal globs, a failed schema, unsafe inheritance or a profile/isolation
            mismatch all stop the load rather than skipping the file.
          </p>
          <p>
            Earlier behavior was to skip malformed agent files silently. That was changed deliberately, and
            the reasoning is in the migration notes: a silently skipped agent looks identical to an agent
            that was never written. You invoke it, it is not found, and the actual cause — a trailing comma
            three weeks ago — is invisible.
          </p>
          <p>
            Failing loudly costs you a startup error and saves the debugging session.
          </p>
          <Note>
            File globs in <code className="inline">files</code> are project-relative, do not follow symlinks,
            reject secrets, and share a total context budget. An agent cannot use its file list to read
            outside the project or to load unbounded content.
          </Note>
        </section>

        <section id="using">
          <h2><span className="anchor">#</span>Using an agent</h2>
          <CodeBlock lang="bash">{`$ deepseek agent reviewer
$ deepseek agent reviewer "check src/auth for injection risks"

> /agents           # list what is registered, with source and usage
> /agent reviewer   # load one mid-session`}</CodeBlock>
          <p>
            <code className="inline">/agents</code> reports each agent's name and source layer, which is how
            you tell a project agent from a local override with the same name. Trust is checked again when the
            agent is loaded.
          </p>
          <CodeBlock lang="json">{`{ "name": "subagent", "arguments": {
    "task": "audit src/agent/session.ts for null dereferences",
    "agent": "reviewer",
    "verify": true
} }`}</CodeBlock>
          <p>
            Passing <code className="inline">agent</code> to the{" "}
            <code className="inline">subagent</code> tool loads the definition and the worker inherits its role,
            model, tools, permission profile and limits. See{" "}
            <a href="/docs/subagents">Sub-agents</a> and{" "}
            <a href="/docs/agent-teams">Agent teams</a>.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
