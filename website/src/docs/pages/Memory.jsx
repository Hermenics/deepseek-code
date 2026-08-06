import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "Two memory systems" },
  { id: "memory-tool", label: "The memory tool" },
  { id: "auto-learned", label: "Auto-learned memory" },
  { id: "steering", label: "Project knowledge (DEEPSEEK.md)" },
  { id: "safety", label: "Safety & sanitization" },
  { id: "commands", label: "Managing with /memory" },
];

const SYSTEMS = [
  ["Project knowledge", "DEEPSEEK.md, AGENTS.md, .deepseek/steering/*.md", "You / your repo", "Facts, conventions, and patterns the agent should know"],
  ["Persistent memory", "MEMORY.md, USER.md", "The agent", "Project facts/conventions and your preferences/style"],
];

const ACTIONS = [
  ["add", "Add a new fact or preference"],
  ["replace", "Replace an entry by unique substring"],
  ["remove", "Remove an entry by unique substring"],
  ["list", "Show everything stored"],
];

export default function Memory() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Memory</span>
        </nav>

        <div className="hero">
          <h1>Memory &amp; project knowledge</h1>
          <p className="tagline">
            What the agent remembers about you and your project — across sessions.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Two memory systems</h2>
          <p>
            DeepSeek Code remembers what it learns about you and your project across sessions.
            Two complementary mechanisms do the work: <b>durable knowledge files</b> you and your
            repo maintain, and a <b>persistent memory store</b> the agent can read and write. Both
            are injected into the system prompt at startup — always as an <i>untrusted reference</i>,
            never as instructions.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "24%" }}>System</th><th style={{ width: "38%" }}>Files</th><th style={{ width: "18%" }}>Written by</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {SYSTEMS.map(([s, f, w, p]) => (
                  <tr key={s}>
                    <td><b style={{ color: "var(--text-strong)" }}>{s}</b></td>
                    <td><code className="inline">{f}</code></td>
                    <td>{w}</td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">MEMORY.md</code> holds agent-side facts and conventions;{" "}
            <code className="inline">USER.md</code> holds your preferences and style. Both are loaded
            at startup and folded into the system prompt, alongside the durable knowledge files.
          </p>
        </section>

        <section id="memory-tool">
          <h2><span className="anchor">#</span>The memory tool</h2>
          <p>
            The agent manages persistent memory through the <code className="inline">memory</code>{" "}
            tool, which targets either <code className="inline">agent</code> (facts, conventions) or{" "}
            <code className="inline">user</code> (preferences, style). It supports four actions:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Action</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {ACTIONS.map(([a, d]) => (
                  <tr key={a}>
                    <td><code className="inline">{a}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="bash">{`# Add a project fact to agent memory
memory action=add target=agent content="Uses vitest for unit tests"

# Replace an entry containing "vitest"
memory action=replace target=agent match="vitest" content="Uses vitest, not jest"

# Store a preference in user memory
memory action=add target=user content="Prefers Portuguese comments"

# List everything currently stored
memory action=list target=agent`}</CodeBlock>
          <p>
            Entries are persisted under <code className="inline">~/.deepseek/memory/</code>, or{" "}
            <code className="inline">.deepseek/memory/</code> inside the project when configured with{" "}
            <code className="inline">scope: project</code>. The store is capped at{" "}
            <b>2000 characters total</b> and deduplicated — adding an entry that already exists is a
            no-op.
          </p>
          <p>
            On disk, entries are <code className="inline">\n§\n</code>-delimited in a single{" "}
            <code className="inline">MEMORY.md</code> / <code className="inline">USER.md</code> file written
            with <code className="inline">0600</code> permissions. The first time a user-scoped store is
            configured, files are <b>automatically migrated</b> from the legacy{" "}
            <code className="inline">~/.deepseek-code/memory/</code> location, and all writes are
            serialized through a file lease so concurrent sessions can't interleave.
          </p>
        </section>

        <section id="auto-learned">
          <h2><span className="anchor">#</span>Auto-learned memory</h2>
          <p>
            At the end of each completed turn, DeepSeek Code makes a quiet background LLM call over
            the last ~10 messages and extracts <b>0 or 1</b> new durable fact. Each candidate is
            classified as a <code className="inline">user_preference</code> (routed to{" "}
            <code className="inline">USER.md</code>) or a <code className="inline">project_fact</code>{" "}
            (routed to <code className="inline">MEMORY.md</code>), then validated before saving:
            6–100 characters, normalized whitespace, deduplicated, and run through the safety
            filter.
          </p>
          <p>
            Concretely, the sync runs after a turn contains <b>at least two assistant messages</b>.
            A background LLM call reviews the last ~10 messages and returns exactly one JSON object —{" "}
            <code className="inline">{"{"}"kind":"user_preference"|"project_fact"|"none","fact":"..."{"}"}</code>.
            <code className="inline">kind: none</code> saves nothing; a{" "}
            <code className="inline">user_preference</code> is routed to <code className="inline">USER.md</code>{" "}
            and a <code className="inline">project_fact</code> to <code className="inline">MEMORY.md</code>.
            Facts outside <b>6–100 characters</b>, greeting-style text (e.g. "hello", "oi"), and
            anything the safety filter rejects are discarded before saving.
          </p>
          <p>
            The extraction prompt explicitly refuses to save greetings, assistant text,
            instructions, policies, permissions, or anything that tries to alter rules.
          </p>
          <Note>
            Auto-learning is fire-and-forget. It never blocks your turn and fails silently — a
            rejected extraction is simply discarded.
          </Note>
        </section>

        <section id="steering">
          <h2><span className="anchor">#</span>Project knowledge (DEEPSEEK.md)</h2>
          <p>
            The <code className="inline">update_knowledge</code> tool records project knowledge into{" "}
            <code className="inline">DEEPSEEK.md</code>, either appending a new{" "}
            <code className="inline">## Section</code> or replacing an existing one. A brand-new file is
            created with the <code className="inline"># DEEPSEEK.md — Project Knowledge</code> header,
            and a replacement overwrites from the heading up to the next <code className="inline">##</code>{" "}
            (or end of file). Section names are validated against a strict character allowlist
            (letters, numbers, spaces, hyphens, slashes, parentheses, periods, commas, colons), and
            existing sections are matched with regex-safe escaping so a malformed heading can't
            corrupt the file.
          </p>
          <CodeBlock lang="text">{`# DEEPSEEK.md — Project Knowledge

## Conventions
Uses vitest for unit tests. Prefer ESM imports.`}</CodeBlock>
          <p>
            At startup the agent loads <code className="inline">DEEPSEEK.md</code> (from the project
            root or <code className="inline">.deepseek/</code>), <code className="inline">AGENTS.md</code>, and
            every <code className="inline">.md</code> file under <code className="inline">.deepseek/steering/</code>,
            then injects them into the system prompt. <code className="inline">AGENTS.md</code> is the
            interoperable instructions file shared with other coding agents;{" "}
            <code className="inline">DEEPSEEK.md</code> stays DeepSeek-specific knowledge.
          </p>
        </section>

        <section id="safety">
          <h2><span className="anchor">#</span>Safety &amp; sanitization</h2>
          <p>
            Every memory entry passes through <code className="inline">isSafeMemoryEntry</code>, which
            rejects attempts to inject instruction or policy overrides — entries that try to{" "}
            <code className="inline">ignore</code>, <code className="inline">override</code>,{" "}
            <code className="inline">bypass</code>, or <code className="inline">disable</code> rules are
            refused. The memory snapshot is always injected under a{" "}
            <i>Memory (untrusted reference)</i> header and framed explicitly as fallible context that
            cannot alter policies, safety, permissions, or tool access. Writes to the store are
            serialized through a file lease (<code className="inline">src/orchestration/fileLease.ts</code>)
            so concurrent sessions can't corrupt the files.
          </p>
        </section>

        <section id="commands">
          <h2><span className="anchor">#</span>Managing with /memory</h2>
          <p>
            The <code className="inline">/memory</code> command (alias <code className="inline">/mem</code>) shows
            or clears entries:
          </p>
          <CodeBlock lang="bash">{`/memory               # show all entries
/memory clear         # clear everything
/memory clear agent   # clear only agent memory
/memory clear user    # clear only user memory`}</CodeBlock>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
