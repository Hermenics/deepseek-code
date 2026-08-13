import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "model", label: "What the palette is" },
  { id: "matching", label: "Matching rules" },
  { id: "keyboard", label: "Keyboard workflow" },
  { id: "ghost", label: "Ghost completion" },
  { id: "arguments", label: "Arguments & execution" },
  { id: "workflows", label: "Saved workflows" },
  { id: "busy", label: "Busy sessions" },
  { id: "limits", label: "Limits & accessibility" },
];

const KEYS = [
  ["/", "At the beginning of an otherwise empty draft, list every registered command, alias and cached workflow command."],
  ["Up / Down", "Move through matches and wrap from the first row to the last or the last to the first."],
  ["Tab", "Execute the selected row immediately while the dropdown is open."],
  ["Enter", "Execute the selected row immediately; with no matches, submit the typed text normally."],
  ["Type a space", "Close the dropdown and continue editing arguments."],
];

export default function CommandPalette() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Interface</span><span className="sep">/</span><span className="current">Command palette</span>
        </nav>

        <div className="hero">
          <h1>Command palette</h1>
          <p className="tagline">
            Discover and dispatch slash commands from inline completion, with prefix-first matching and a fuzzy fallback.
          </p>
        </div>

        <section id="model">
          <h2><span className="anchor">#</span>What the command palette is</h2>
          <p>
            The command palette is the autocomplete dropdown attached to the prompt editor; it is not a separate modal
            screen and has no dedicated global shortcut. It opens only when the draft begins with
            <code className="inline">/</code> and contains no whitespace. Type a command name to narrow the list.
          </p>
          <CodeBlock lang="text">{"/           all available command names and aliases\n/chec       prefix matches such as /checkpoint\n/chk        fuzzy fallback when no command starts with /chk\n/model      an exact command remains selectable\n/model d    dropdown closed; edit the argument normally"}</CodeBlock>
          <p>
            Suggestions are assembled from the live command registry, aliases and saved workflow commands discovered for
            the current workspace. The exact list can therefore differ between installations, projects and sessions. Use
            <code className="inline">/help</code> for the authoritative command reference after selection.
          </p>
        </section>

        <section id="matching">
          <h2><span className="anchor">#</span>Prefix-first and fuzzy matching</h2>
          <p>
            A bare slash returns the complete suggestion set in registry order. Once another character is present, exact
            case-sensitive prefix matches win. Fuzzy search runs only when there are no prefix matches; it tolerates modest
            misspellings and returns at most eight candidates.
          </p>
          <p>
            Prefix results and the bare-slash list are not capped at eight. The dropdown itself displays a moving window of
            at most six rows, keeping the selected row visible while you move through a longer result set. In narrow
            terminals, descriptions are truncated; the command names remain the primary identification.
          </p>
          <Note>
            Whitespace anywhere in the draft closes matching. The palette searches command names, not descriptions or
            argument values, and matching starts only when the first character is a slash.
          </Note>
        </section>

        <section id="keyboard">
          <h2><span className="anchor">#</span>Keyboard workflow</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Keys</th><th>Behavior</th></tr></thead>
              <tbody>
                {KEYS.map(([keys, action]) => <tr key={keys}><td><code className="inline">{keys}</code></td><td>{action}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p>
            There is no mouse requirement and no click-to-select contract. If arrow sequences are unavailable in your
            terminal, type the exact command and its arguments, then press Enter. Adding a space is also the reliable way
            to leave completion visible state without clearing the draft.
          </p>
          <p>
            Escape is not a palette-specific close key. In the standard editor it participates in the double-Escape draft
            clear behavior; in Vim it changes or cancels the current Vim state. Avoid using Escape merely to dismiss matches.
          </p>
        </section>

        <section id="ghost">
          <h2><span className="anchor">#</span>Dropdown selection versus ghost completion</h2>
          <p>
            Two completion systems can appear together. The dropdown has a highlighted row and Tab or Enter executes that
            row. Dim ghost text extends the command already being typed; Tab, or Right while the caret is at the end,
            accepts that ghost into the draft without dispatching it.
          </p>
          <CodeBlock lang="text">{"Typed:  /checkp\nGhost:       oint\n\nTab with the dropdown selected  → executes /checkpoint\nRight at the end for ghost text → inserts /checkpoint"}</CodeBlock>
          <p>
            Ghost text is shown only when the caret is at the end. Command completion has priority over recognized argument
            hints and prompt-history completion. A placeholder such as <code className="inline">&lt;model-name&gt;</code> is
            informational: accepting it does not insert the placeholder as an argument.
          </p>
          <Note>
            Look at whether a selectable row is visible before pressing Tab. The same key means immediate dispatch for the
            dropdown and insertion for ghost completion.
          </Note>
        </section>

        <section id="arguments">
          <h2><span className="anchor">#</span>Arguments and execution</h2>
          <p>
            Choosing a row submits the bare command exactly as displayed. The palette does not universally open an argument
            form. Commands that can run without arguments show status or open their normal picker; commands that require
            arguments may return usage guidance. To supply an argument, type or accept the command name, add a space, enter
            the argument and then submit.
          </p>
          <CodeBlock lang="text">{"/model\n/model deepseek-reasoner\n/checkpoint save before-refactor\n/effort max\n/btw what changed in the last tool call?"}</CodeBlock>
          <p>
            Slash-command parsing happens only after submission. A command-looking string pasted into the editor is still
            just a draft until Enter, but large-paste markers expand before dispatch. Review pasted content that can begin
            with a slash or exclamation mark.
          </p>
          <p>
            Selecting a command clears the draft, attached long-paste blocks and current completion state, then resets Vim
            editing to insert mode. Command aliases can appear as their own suggestions and execute through the same parser.
          </p>
        </section>

        <section id="workflows">
          <h2><span className="anchor">#</span>Saved workflow commands</h2>
          <p>
            Saved workflows can expose direct slash commands alongside built-ins. Their suggestions come from the workflow
            discovery cache for the current working directory and become available after startup discovery refreshes it.
            A workflow description is shown when metadata supplies one; otherwise a generic run description is used.
          </p>
          <CodeBlock lang="text">{"/<workflow-name>\n/workflow list\n/workflow status <run-id>"}</CodeBlock>
          <p>
            Built-in commands and aliases are registered first and duplicate names are removed. A workflow that collides
            with an existing command name is therefore not a reliable way to override that built-in. Changing projects or
            adding a workflow can change later suggestion results after the cache is refreshed.
          </p>
        </section>

        <section id="busy">
          <h2><span className="anchor">#</span>Using completion while the agent is busy</h2>
          <p>
            The palette can remain visible while a turn is running, but visibility does not mean every command has explicit
            busy-session semantics. Ordinary text submitted during a turn goes to the prompt queue. Side questions and live
            workflow controls have dedicated immediate paths; other commands can open UI, change state, report usage or be
            handled differently by their command implementation.
          </p>
          <CodeBlock lang="text">{"/btw which test is running now?\n/workflow pause <run-id>\n/workflow resume <run-id>\n/workflow stop <run-id>"}</CodeBlock>
          <Note>
            While work is active, type the complete busy-safe command and required arguments instead of executing a bare
            highlighted row. For configuration and model changes, waiting until the current turn finishes is the predictable path.
          </Note>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits and accessibility</h2>
          <ul className="capabilities">
            <li><b>Trigger:</b> leading slash with no whitespace; there is no modal launcher or remappable palette shortcut.</li>
            <li><b>Search:</b> command names only; prefix matches are case-sensitive and preferred over fuzzy results.</li>
            <li><b>Viewport:</b> six visible rows; fuzzy fallback returns eight at most, while prefix sets can be longer.</li>
            <li><b>Execution:</b> Tab or Enter on a selected row dispatches immediately rather than inserting for review.</li>
            <li><b>Arguments:</b> the dropdown closes at whitespace and does not validate arguments while you type.</li>
            <li><b>Discovery:</b> workflow suggestions depend on the current workspace cache and may appear after initialization.</li>
          </ul>
          <p>
            Command names and descriptions are textual, but the selected row is distinguished primarily by color. Screen
            readers receive terminal redraws rather than an announced listbox role or selected-item event. When selection
            state is ambiguous, avoid arrows and enter an exact full command manually.
          </p>
          <p>
            See <a href="/docs/commands">Commands</a> for command behavior,
            <a href="/docs/input-editor"> Input editor</a> for history completion, and
            <a href="/docs/workflows"> Workflows</a> for saved workflow discovery.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
