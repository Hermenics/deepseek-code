import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "open", label: "Open the library" },
  { id: "screen", label: "Read the screen" },
  { id: "filters", label: "Filter definitions" },
  { id: "create", label: "Create and duplicate" },
  { id: "edit", label: "Edit JSON or prompt" },
  { id: "disable", label: "Disable, delete and restore" },
  { id: "scope", label: "Scope behavior" },
  { id: "limitations", label: "Current limitations" },
];

const KEYS = [
  ["↑ / ↓ or j / k", "Select an agent."],
  ["u", "Cycle usage filter: all, primary, subagent."],
  ["o", "Cycle origin filter: all, builtin, user, additional, project, local."],
  ["n", "Create a new definition in the selected settings scope."],
  ["c", "Duplicate the selected definition into the selected scope."],
  ["e", "Open the selected scoped JSON definition in VISUAL/EDITOR."],
  ["p", "Edit only the specialization prompt as temporary Markdown."],
  ["Space or d", "Delete a same-scope definition or create a scoped disable override."],
  ["r", "Remove the scoped override and reveal the inherited definition."],
  ["Esc or q", "Return to the settings center."],
];

export default function AgentLibraryGuide() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Agents</span><span className="sep">/</span><span className="current">Agent library</span>
        </nav>

        <div className="hero">
          <h1>Agent library</h1>
          <p className="tagline">
            Manage built-in and custom primary/subagent definitions from one scoped terminal interface.
          </p>
        </div>

        <section id="open">
          <h2><span className="anchor">#</span>Open the library</h2>
          <CodeBlock lang="bash">{"/config\n# Agent Behavior is separate; choose the Agents category\n# Select Agent library and press Enter"}</CodeBlock>
          <p>
            The library loads the same merged registry used by <code className="inline">/agent</code> and delegated
            task selection. The settings center's current User, Project or Local scope determines where create,
            duplicate, disable, delete and restore operations write.
          </p>
        </section>

        <section id="screen">
          <h2><span className="anchor">#</span>Read the screen</h2>
          <p>
            The left pane shows names plus origin or disabled state. The detail pane shows description, usage,
            role, model, effective tools, origin and whether the definition overrides another one. It also shows
            a 320-character single-line preview of the specialization prompt.
          </p>
          <p>
            The protected result protocol is displayed separately: summary, confidence, files read and changed,
            issues, suggestions and metadata. Editing the specialization prompt does not replace that executor
            protocol.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "30%" }}>Key</th><th>Action</th></tr></thead>
              <tbody>{KEYS.map(([key, action]) => <tr key={key}><td><code className="inline">{key}</code></td><td>{action}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section id="filters">
          <h2><span className="anchor">#</span>Filter definitions</h2>
          <p>
            The usage filter treats <code className="inline">usage: both</code> as matching both primary and
            subagent views. Definitions with no usage field are treated as primary. The origin filter exposes
            where the winning registry entry came from, including extra configured directories.
          </p>
          <p>
            Changing either filter returns selection to the first matching row. When nothing matches, the
            library shows an empty-state message instead of retaining a stale detail pane.
          </p>
        </section>

        <section id="create">
          <h2><span className="anchor">#</span>Create and duplicate</h2>
          <p>
            Press <code className="inline">n</code> and enter a name. The starter definition is enabled for both
            primary and subagent use, uses executor role defaults, and includes a short conservative prompt.
            It is immediately persisted and the registry is reloaded.
          </p>
          <p>
            Press <code className="inline">c</code> to copy the selected effective definition under a new name.
            The suggested name appends <code className="inline">-copy</code>. Agent-name and schema validation
            run before persistence. There is no separate collision prompt: choosing an existing same-scope name
            replaces that file atomically.
          </p>
          <Note>
            Creation is intentionally minimal. Use JSON editing for description, role, usage, model, tools,
            extensions or inheritance after the starter exists.
          </Note>
        </section>

        <section id="edit">
          <h2><span className="anchor">#</span>Edit JSON or prompt</h2>
          <p>
            Press <code className="inline">e</code> for the complete JSON definition. If a built-in is inherited,
            the library first creates a scoped definition extending <code className="inline">builtin:name</code>,
            then opens it. Closing the editor reloads the full registry.
          </p>
          <p>
            Press <code className="inline">p</code> to edit only <code className="inline">systemPrompt</code> as
            Markdown. This path supports a command-style editor value and has terminal/platform fallbacks. The
            returned text is saved together with the rest of the selected effective configuration.
          </p>
          <p>
            See <a href="/docs/external-editor">External editor integration</a> for the important difference
            between the raw-JSON and prompt editor launchers.
          </p>
        </section>

        <section id="disable">
          <h2><span className="anchor">#</span>Disable, delete and restore</h2>
          <p>
            Delete behavior depends on origin. A definition already owned by the selected scope is removed from
            that scope. A built-in is added to <code className="inline">agents.disabledBuiltins</code>. Another
            inherited definition is copied into the selected scope with{" "}
            <code className="inline">enabled: false</code>.
          </p>
          <p>
            Restore is the inverse. For a built-in it removes that name from the selected scope's disabled list;
            for other definitions it deletes the selected scope's file. The lower-priority definition then
            becomes effective again after registry reload.
          </p>
        </section>

        <section id="scope">
          <h2><span className="anchor">#</span>Scope behavior</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th>Scope</th><th>Typical purpose</th><th>Sharing</th></tr></thead>
              <tbody>
                <tr><td>User</td><td>Personal agents available across repositories.</td><td>Not project-controlled.</td></tr>
                <tr><td>Project</td><td>Team definitions under the repository's agent directory.</td><td>Can be committed.</td></tr>
                <tr><td>Local</td><td>Machine-specific override for this repository.</td><td>Keep uncommitted.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Additional agent directories can contribute registry entries, but they are discovery origins rather
            than write targets in this screen. Editing one creates an override at User, Project or Local scope.
          </p>
        </section>

        <section id="limitations">
          <h2><span className="anchor">#</span>Current limitations</h2>
          <p>
            Editing a non-built-in inherited agent currently creates a same-name{" "}
            <code className="inline">extends</code> value. Leaving that value unchanged produces an inheritance
            cycle when the registry reloads. Remove <code className="inline">extends</code> to make a full copy,
            or point it to a differently named base before closing the editor.
          </p>
          <p>
            Deletion and disable actions happen immediately; this library has no additional y/n prompt and no
            undo stack. Restore can reveal an inherited definition, but it cannot recover a same-scope custom
            file after deletion unless version control or a backup contains it.
          </p>
          <p>
            The library does not select the current primary agent. Use <code className="inline">/agent</code> to
            activate one now, or set <code className="inline">agents.default</code> for the next session. It also
            does not validate that every named tool exists until the registry/runtime consumes the definition.
          </p>
          <p>
            Continue with <a href="/docs/agents">Agent definitions</a>,{" "}
            <a href="/docs/subagents">Sub-agents</a>, and <a href="/docs/settings-center">Settings center</a>.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
