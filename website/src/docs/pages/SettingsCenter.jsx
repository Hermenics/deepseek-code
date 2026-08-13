import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "open", label: "Open the settings center" },
  { id: "layout", label: "Responsive layout" },
  { id: "navigation", label: "Keyboard navigation" },
  { id: "scopes", label: "Choose an edit scope" },
  { id: "editing", label: "Editing value types" },
  { id: "actions", label: "Built-in actions" },
  { id: "apply", label: "Immediate vs restart" },
  { id: "recovery", label: "Errors and recovery" },
];

const KEYS = [
  ["↑ / ↓ or j / k", "Move through the focused category or setting list."],
  ["← / →", "Move focus between categories and settings in wide and medium layouts."],
  ["Enter", "Open a category, show detail on narrow layouts, or activate the selected setting."],
  ["e or Space", "Activate the selected setting from an item list."],
  ["Tab / Shift+Tab", "Cycle User, Project and Local edit scopes."],
  ["/", "Search labels, descriptions, category names and aliases."],
  ["r", "Remove this scope's override and reveal the inherited value."],
  ["Esc or q", "Go back one narrow-layout page or close the settings center."],
];

const KINDS = [
  ["Boolean", "Enter toggles the effective value and writes an explicit value at the selected scope."],
  ["Enum", "Enter cycles the allowed values. Model fields load the provider's current model list first."],
  ["Text", "An empty save removes the scoped override instead of storing an empty string."],
  ["Number", "Text is converted to a number, then normal settings validation runs before the atomic save."],
  ["List", "Comma-separated entries are trimmed and empty entries are removed."],
  ["JSON", "The editor parses JSON. Blank JSON input becomes an empty array."],
  ["Secret", "Input is masked and written only to the private credentials file, never a settings scope."],
  ["Action", "Runs an operation such as diagnostics, connection testing, export or opening a library."],
];

const ACTIONS = [
  ["Test connection", "Uses the edited provider settings and saved credentials, reports latency, and caches model IDs for model selectors."],
  ["Refiner preview", "Runs the current refinement configuration on sample text without submitting a normal agent turn."],
  ["Permission preview", "Resolves a tool name plus optional JSON arguments to ALLOW, DENY or ASK."],
  ["Clear approvals", "Forgets in-memory tool and external-directory approvals for this running session."],
  ["Diagnostics", "Shows all three paths, invalid JSON, validation issues and unknown top-level keys."],
  ["Open raw files", "Pauses the TUI and opens the selected settings file or private credentials file in VISUAL/EDITOR."],
  ["Export", "Writes effective settings, memory and the session index to a secret-filtered project-local JSON bundle."],
  ["Destructive cleanup", "Reset scope, clear memory and session deletion require a y/n confirmation."],
];

export default function SettingsCenter() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Settings center</span>
        </nav>

        <div className="hero">
          <h1>Settings center</h1>
          <p className="tagline">
            Operate the full-screen configuration UI confidently: scopes, search, editors, diagnostics,
            live application, restart boundaries and recovery.
          </p>
        </div>

        <section id="open">
          <h2><span className="anchor">#</span>Open the settings center</h2>
          <CodeBlock lang="bash">{"/config\n# alias\n/settings"}</CodeBlock>
          <p>
            The screen loads the User, Project and Local settings files together with the private credentials
            file. It displays the merged effective value while keeping the selected write scope separate.
            Editing a Project value therefore does not overwrite a higher-priority Local override.
          </p>
          <p>
            Categories cover providers and models, agent behavior, context, permissions, agents, memory and
            sessions, Git, interface, hooks and advanced integrations. Search is global across those categories.
          </p>
        </section>

        <section id="layout">
          <h2><span className="anchor">#</span>Responsive layout</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th>Terminal width</th><th>Layout</th><th>Navigation model</th></tr></thead>
              <tbody>
                <tr><td><code className="inline">110+</code></td><td>Wide</td><td>Categories, items and detail are visible together.</td></tr>
                <tr><td><code className="inline">72–109</code></td><td>Medium</td><td>Categories and items share the screen; detail is compressed.</td></tr>
                <tr><td><code className="inline">&lt;72</code></td><td>Narrow</td><td>Separate category, item and detail pages.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Below 40 columns or 12 rows the UI warns that the terminal is too small for safe editing. It still
            renders, but expanding the terminal avoids clipped values and ambiguous confirmation prompts.
          </p>
        </section>

        <section id="navigation">
          <h2><span className="anchor">#</span>Keyboard navigation</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Key</th><th>Action</th></tr></thead>
              <tbody>{KEYS.map(([key, action]) => <tr key={key}><td><code className="inline">{key}</code></td><td>{action}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Search matches human labels and descriptions rather than raw JSON alone. Enter accepts the current
            query and leaves its filtered result set visible. Escape clears the query and restores the full list;
            Escape from the normal screen backs out or closes.
          </p>
        </section>

        <section id="scopes">
          <h2><span className="anchor">#</span>Choose an edit scope</h2>
          <p>
            The header always shows the active scope. Tab cycles User → Project → Local; Shift+Tab cycles in
            reverse. The detail pane shows the effective value, its origin, whether this scope inherits or
            overrides it, the default when available, and the explicit precedence chain.
          </p>
          <Note>
            Scope restrictions still apply. Auto mode, executable hooks, LSP server commands and consent to
            load project MCP servers are User-scoped controls. Project or Local entries for those capabilities
            are diagnosed and ignored rather than made executable.
          </Note>
        </section>

        <section id="editing">
          <h2><span className="anchor">#</span>Editing value types</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "22%" }}>Kind</th><th>Save behavior</th></tr></thead>
              <tbody>{KINDS.map(([kind, behavior]) => <tr key={kind}><td><b>{kind}</b></td><td>{behavior}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            Enter saves an inline editor and Escape cancels it. JSON is parsed before saving, numeric fields are
            converted to numbers, and fields with registered validators are checked. Parse or validation failures
            appear in the status line; the existing file remains unchanged because scoped writes use a temporary
            file followed by rename.
          </p>
        </section>

        <section id="actions">
          <h2><span className="anchor">#</span>Built-in actions</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "25%" }}>Action</th><th>What happens</th></tr></thead>
              <tbody>{ACTIONS.map(([name, behavior]) => <tr key={name}><td><b>{name}</b></td><td>{behavior}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            The Agent and Hook libraries are nested full-screen views. Returning from the Agent library reloads
            the registry and settings snapshot; the Hook library always reads and writes executable hooks at
            User scope.
          </p>
        </section>

        <section id="apply">
          <h2><span className="anchor">#</span>Immediate vs restart</h2>
          <p>
            Most compatible values are passed back to the running agent after each save: model defaults,
            orchestration limits, memory configuration and interface preferences can update live. The detail
            pane marks these with <b>Applies immediately</b>.
          </p>
          <p>
            Provider identity, endpoint and cloud-location fields, default agent, auto-resume, alternate screen,
            and MCP enablement are marked <b>Applies next session</b>. Saving them does not reconstruct the
            current provider client or terminal root. Use Reload settings to reread files, but restart when the
            item explicitly carries the restart marker.
          </p>
        </section>

        <section id="recovery">
          <h2><span className="anchor">#</span>Errors and recovery</h2>
          <p>
            If the selected scope contains invalid JSON, the header says saves are blocked. Open that scope's
            raw file, correct it, close the editor and let the settings center reload. A malformed scope is
            represented as empty for effective merging, so the rest of the screen remains usable.
          </p>
          <p>
            Press <code className="inline">r</code> on an ordinary setting to remove only this scope's field.
            Use Reset scope only when you intend to replace the entire selected file with an empty object;
            that action also removes unknown keys and requires confirmation.
          </p>
          <p>
            Continue with <a href="/docs/settings">Settings reference</a>,{" "}
            <a href="/docs/debug-config">Debug configuration</a>, and{" "}
            <a href="/docs/external-editor">External editor</a>.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
