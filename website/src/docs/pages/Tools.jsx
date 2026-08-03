import { CodeBlock, Note, Toc } from "../Layout";

const TOOL_GROUPS = [
  {
    title: "File operations",
    items: [
      ["ReadFile", "Read a file from the workspace"],
      ["WriteFile", "Create or overwrite a file"],
      ["PatchFile", "Apply a surgical patch to an existing file"],
      ["ReadFolder", "List the contents of a directory"],
    ],
  },
  {
    title: "Search & shell",
    items: [
      ["Glob", "Find files matching a pattern"],
      ["Grep", "Search file contents for a pattern"],
      ["Shell", "Run a shell command in the workspace"],
      ["Git", "Run git operations"],
    ],
  },
  {
    title: "Web & context",
    items: [
      ["WebFetch", "Fetch a URL and read its contents"],
      ["Memory", "Read and write persistent memory"],
      ["Todo", "Manage a task list during a session"],
      ["Introspect", "Inspect the agent's own capabilities and state"],
    ],
  },
  {
    title: "Orchestration",
    items: [
      ["SubAgent", "Spawn a focused sub-agent for a bounded task"],
      ["MoA", "Mixture of agents — fan out and synthesize answers"],
    ],
  },
];

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "groups", label: "Tool groups" },
  { id: "customize", label: "Extending tools" },
];

export default function Tools() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Tools</span>
        </nav>

        <div className="hero">
          <h1>Tools</h1>
          <p className="tagline">
            The capabilities DeepSeek Code ships with out of the box.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Overview</h2>
          <p>
            Tools are how the agent acts on your behalf. Every tool below is enabled by default
            and can be gated, extended, or replaced through configuration and hooks.
          </p>
          <div className="tools-grid">
            {["ReadFile", "WriteFile", "PatchFile", "Shell", "Glob", "Grep", "Git", "ReadFolder", "WebFetch", "SubAgent", "Memory", "Todo", "Introspect", "MoA"].map((t) => (
              <span className="tool-chip" key={t}><span className="dot-tool" />{t}</span>
            ))}
          </div>
        </section>

        <section id="groups">
          <h2><span className="anchor">#</span>Tool groups</h2>
          {TOOL_GROUPS.map((g) => (
            <div key={g.title}>
              <h3>{g.title}</h3>
              <div className="doc-table-wrap">
                <table className="doc-table">
                  <thead>
                    <tr>
                      <th style={{ width: "30%" }}>Tool</th>
                      <th>What it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(([name, desc]) => (
                      <tr key={name}>
                        <td><code className="inline">{name}</code></td>
                        <td>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>

        <section id="customize">
          <h2><span className="anchor">#</span>Extending tools</h2>
          <p>
            Tools can be extended or replaced with <b>custom tools</b> defined by the project, and
            <b> pre/post hooks</b> run around tool execution to validate or transform results.
          </p>
          <CodeBlock lang="text">{`// a custom tool module
export default {
  name: "MyTool",
  description: "Does something useful",
  async execute(args) { /* ... */ },
};`}</CodeBlock>
          <Note>
            Use <code className="inline">/tools</code> inside a session to see which tools are
            active in the current project.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
