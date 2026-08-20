import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "purpose", label: "What an export is" },
  { id: "find", label: "Find a session ID" },
  { id: "command", label: "Export command" },
  { id: "formats", label: "Markdown vs JSON" },
  { id: "location", label: "Output path and permissions" },
  { id: "redaction", label: "Secret redaction" },
  { id: "privacy", label: "Privacy beyond secrets" },
  { id: "persistence", label: "Saved-session timing" },
  { id: "retention", label: "Retention and cleanup" },
  { id: "resume", label: "Export is not resume" },
  { id: "workflows", label: "Sharing workflows" },
  { id: "errors", label: "Errors and recovery" },
];

const FORMATS = [
  ["Markdown", "md", "Header metadata plus the visible UI conversation, with one section per role.", "Human review, issue reports and handoff notes."],
  ["JSON", "json", "The sanitized complete session record, including agent history, UI history, modified files and optional goal.", "Archival, structured inspection and tooling."],
];

const EXPORTED_JSON = [
  ["id / title", "Session identity and generated or saved title."],
  ["createdAt / updatedAt", "Lifecycle timestamps."],
  ["cwd", "Absolute workspace path captured by the session."],
  ["provider / model", "Provider and model selected for the session."],
  ["language / activeAgent", "UI language and active custom-agent identity."],
  ["agentMessages", "Model-facing message history and compact boundaries."],
  ["uiMessages", "Conversation and tool records shown in the terminal."],
  ["filesModified", "Paths tracked as modified during the session."],
  ["goal", "The optional persistent goal and its usage state."],
];

const ERRORS = [
  ["Usage: /sessions export …", "Supply a 12-character hexadecimal session ID and, optionally, json or md."],
  ["Format must be json or md", "Use one of the two supported lowercase format names."],
  ["Invalid session ID", "The ID has the wrong shape; paths and traversal strings are rejected."],
  ["Session … not found", "The saved session may belong to a pruned or cleared record, or the ID was copied incorrectly."],
  ["Permission denied", "Confirm the active workspace is writable and its .deepseek directory can be created."],
];

export default function SessionExport() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Session export</span>
        </nav>

        <div className="hero">
          <h1>Exporting sessions</h1>
          <p className="tagline">Create a redacted Markdown transcript or structured JSON snapshot without exposing the raw session file.</p>
        </div>

        <section id="purpose">
          <h2><span className="anchor">#</span>What an export is</h2>
          <p>
            A session export is a <b>sanitized copy</b> of one persisted DeepSeek Code session. It is useful for
            review, support, incident analysis, archiving or handing a conversation to another person. Exporting
            does not modify, move or delete the original session.
          </p>
          <p>
            The command reads the saved session record, redacts recognized secrets recursively and writes a new
            file under the active workspace's <code className="inline">.deepseek/</code> directory. It never
            writes to an arbitrary path supplied by the session ID.
          </p>
          <Note>
            “Sanitized” means known secret shapes are redacted. It does not mean the transcript is anonymous,
            publication-ready or free of private business information.
          </Note>
        </section>

        <section id="find">
          <h2><span className="anchor">#</span>Find a session ID</h2>
          <p>
            Interactive session IDs are 12 hexadecimal characters. DeepSeek Code prints the current ID in the
            resume command when the CLI exits cleanly. You can also launch the project-scoped resume picker;
            each entry includes its exact ID beside the update time and model.
          </p>
          <CodeBlock lang="bash">{"$ deepseek --resume\n# ↑/↓ selects a saved session; each card displays its 12-character ID\n\n# A clean exit also prints:\nResume this session:\ndeepseek --resume a1b2c3d4e5f6"}</CodeBlock>
          <p>
            Type <code className="inline">/sessions</code> inside the CLI to see up to ten recent saved sessions
            across workspaces, with title, date, user-message count and working directory. The picker is the
            clearest way to copy the exact ID for the current project.
          </p>
        </section>

        <section id="command">
          <h2><span className="anchor">#</span>Export command</h2>
          <CodeBlock lang="bash">{"> /sessions export a1b2c3d4e5f6 md\nSanitized session export written to /home/you/acme/.deepseek/session-a1b2c3d4e5f6.sanitized.md\n\n> /sessions export a1b2c3d4e5f6 json\nSanitized session export written to /home/you/acme/.deepseek/session-a1b2c3d4e5f6.sanitized.json"}</CodeBlock>
          <p>
            Syntax is <code className="inline">/sessions export &lt;id&gt; [json|md]</code>. The format defaults
            to Markdown when omitted. IDs are matched case-insensitively but must contain exactly twelve
            hexadecimal characters.
          </p>
          <p>
            Export lookup is scoped to the active workspace. The same ID in another project is not eligible for export
            from here, even if it exists in the global session store. The output goes to the current workspace&apos;s
            <code className="inline">.deepseek/</code> directory.
          </p>
        </section>

        <section id="formats">
          <h2><span className="anchor">#</span>Markdown vs JSON</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "18%" }}>Format</th><th style={{ width: "10%" }}>Name</th><th>Contents</th><th style={{ width: "26%" }}>Best for</th></tr></thead>
            <tbody>{FORMATS.map(([format, name, content, use]) => (
              <tr key={format}><td><b>{format}</b></td><td><code className="inline">{name}</code></td><td>{content}</td><td>{use}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            Markdown begins with the session ID, last update time, workspace, and provider/model. It then renders
            each visible UI message under a role heading. It does not reproduce the complete model-facing history.
          </p>
          <p>
            JSON preserves the complete session shape after redaction:
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "28%" }}>Field</th><th>Meaning</th></tr></thead>
            <tbody>{EXPORTED_JSON.map(([field, meaning]) => (
              <tr key={field}><td><code className="inline">{field}</code></td><td>{meaning}</td></tr>
            ))}</tbody>
          </table></div>
          <Note>
            Prefer Markdown when a human needs the visible conversation. JSON exposes more operational context
            and should be shared only when the recipient genuinely needs it.
          </Note>
        </section>

        <section id="location">
          <h2><span className="anchor">#</span>Output path and permissions</h2>
          <p>
            The filename is deterministic:
            <code className="inline">.deepseek/session-&lt;id&gt;.sanitized.&lt;format&gt;</code>. Existing output
            for the same ID and format is replaced with a fresh export. New files are created with owner-only
            <code className="inline">0600</code> permissions.
          </p>
          <CodeBlock lang="bash">{"$ ls -l .deepseek/session-a1b2c3d4e5f6.sanitized.md\n-rw------- 1 you you 18432 Aug 12 14:30 .deepseek/session-a1b2c3d4e5f6.sanitized.md"}</CodeBlock>
          <p>
            The command creates <code className="inline">.deepseek/</code> if needed. That directory is not a
            universal guarantee that every repository ignores every file beneath it. Check
            <code className="inline">git status</code> and add a suitable ignore rule before creating exports in
            a shared checkout.
          </p>
        </section>

        <section id="redaction">
          <h2><span className="anchor">#</span>Secret redaction</h2>
          <p>
            Redaction walks the complete session recursively. Values under secret-looking field names are
            replaced, and strings are scanned for common private-key blocks, provider tokens, bearer credentials,
            access-key identifiers and key/value forms such as password, secret, credential or token.
          </p>
          <CodeBlock lang="text">{"Before export:\nUse token=sk-examplevalue123 for the test request.\n\nAfter export:\nUse token=[REDACTED] for the test request."}</CodeBlock>
          <p>
            The same sanitizer is applied before formatting either JSON or Markdown, so Markdown is not a weaker
            redaction path. Object keys matter in JSON; recognizable token syntax matters inside free text.
          </p>
          <Note>
            Redaction is heuristic and cannot recognize every proprietary credential format or a secret described
            indirectly. Search the finished file for organization-specific prefixes, hosts, account numbers and
            sensitive names before sending it anywhere.
          </Note>
        </section>

        <section id="privacy">
          <h2><span className="anchor">#</span>Privacy beyond secrets</h2>
          <p>
            An export can still contain absolute paths, repository names, filenames, prompts, source fragments,
            tool output, errors, commit details, model/provider names and goal text. None of those are credentials,
            so automatic secret redaction should not remove them.
          </p>
          <p>
            Treat the export as private by default. Review it locally, remove unrelated conversation sections,
            replace customer or incident identifiers, and confirm the intended sharing channel. If you edit the
            sanitized copy, do not confuse it with a reproducible export of the original session.
          </p>
        </section>

        <section id="persistence">
          <h2><span className="anchor">#</span>Saved-session timing</h2>
          <p>
            Interactive sessions persist after a turn completes. The saved record contains UI and model-facing
            messages, files tracked as modified, provider/model, language, active agent and optional goal. Export
            reads that on-disk record, not transient text that is still streaming.
          </p>
          <p>
            Wait for the turn to finish before exporting the current conversation. If the process is interrupted
            before the latest state is saved, the export can represent the previous persisted turn. A session-save
            failure does not crash the CLI, so inspect the export when completeness matters.
          </p>
        </section>

        <section id="retention">
          <h2><span className="anchor">#</span>Retention and cleanup</h2>
          <p>
            Session retention defaults to 50. The oldest saved sessions beyond
            <code className="inline">sessions.retention</code> are pruned across the user's session store. Set a
            positive integer in settings when you need a different history depth.
          </p>
          <CodeBlock lang="json">{"{\n  \"sessions\": {\n    \"retention\": 100,\n    \"autoResume\": \"off\"\n  }\n}"}</CodeBlock>
          <p>
            The Settings center can clear sessions for the current project or globally, both with confirmation.
            Clearing the raw session store does not hunt down sanitized copies already exported into repositories;
            delete or archive those separately.
          </p>
        </section>

        <section id="resume">
          <h2><span className="anchor">#</span>Export is not resume</h2>
          <p>
            <code className="inline">deepseek --resume &lt;id&gt;</code> restores conversation state for continued
            work. Export produces a static file for inspection. Editing or importing that file does not change the
            original session, and there is no session-import command.
          </p>
          <p>
            Resume choices and export lookup are filtered to the current working directory. Run the picker or export
            command from the same project root used by the saved session. A direct ID from another workspace is
            rejected rather than copied into the current project&apos;s export path.
          </p>
        </section>

        <section id="workflows">
          <h2><span className="anchor">#</span>Sharing workflows</h2>
          <p>
            For a support report, export Markdown and add the minimal environment details needed to reproduce the
            issue. For machine analysis, export JSON and process a local copy. For a code review, prefer the actual
            Git diff plus a short transcript excerpt; the conversation is not a substitute for the patch.
          </p>
          <CodeBlock lang="text">{"Before sharing an export:\n1. Open the generated file locally.\n2. Search for organization-specific secret prefixes and private identifiers.\n3. Remove unrelated prompts, paths and tool output.\n4. Attach the exact version and reproduction steps separately.\n5. Confirm the export is not staged in Git."}</CodeBlock>
        </section>

        <section id="errors">
          <h2><span className="anchor">#</span>Errors and recovery</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "33%" }}>Message or symptom</th><th>Resolution</th></tr></thead>
            <tbody>{ERRORS.map(([error, resolution]) => <tr key={error}><td><b>{error}</b></td><td>{resolution}</td></tr>)}</tbody>
          </table></div>
          <p>
            If a needed session was pruned or cleared, DeepSeek Code cannot reconstruct it from the index. An
            earlier sanitized export is still readable, but it is not resumable state.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
