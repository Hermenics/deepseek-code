import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "start", label: "Start a plan" },
  { id: "read-only", label: "Read-only contract" },
  { id: "plan-file", label: "The plan file" },
  { id: "required", label: "Required plan content" },
  { id: "approval", label: "Approval and feedback" },
  { id: "modes", label: "Plan mode vs planning" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const SECTIONS = [
  ["Context", "Current state, requested change, and why it matters."],
  ["Recommended Approach", "Chosen implementation strategy and why it beats the alternatives."],
  ["Critical Files", "Files expected to be created, changed, or removed, with a reason for each."],
  ["Existing Utilities to Reuse", "Helpers, types, and established patterns that avoid duplicate machinery."],
  ["Verification", "Concrete checks that prove the eventual implementation works."],
];

export default function PlanModeGuide() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Plan mode</span>
        </nav>
        <div className="hero">
          <h1>Plan mode</h1>
          <p className="tagline">Explore a change read-only, persist a structured implementation plan, and require explicit approval before building.</p>
        </div>

        <section id="start">
          <h2><span className="anchor">#</span>Start a plan</h2>
          <CodeBlock lang="bash">{`/plan migrate provider configuration without changing the persisted schema`}</CodeBlock>
          <p>
            The command creates a uniquely named Markdown file under <code className="inline">.plans/</code>
            in the active workspace and switches both the UI and agent to Plan mode. The agent then explores
            the repository, writes the plan, and submits that exact file for review.
          </p>
          <p>
            The filename contains a readable slug derived from the task plus a random suffix, so repeated
            plans for the same task do not overwrite each other.
          </p>
        </section>

        <section id="read-only">
          <h2><span className="anchor">#</span>Read-only contract</h2>
          <p>
            Plan mode allows repository reads, search, LSP navigation, public web fetches, product
            introspection, goal inspection, read-only Git actions, and read-only views of todos and memory.
            It may also launch a workflow only when that workflow uses read-only agents.
          </p>
          <p>
            Shell execution, normal file writes, knowledge mutation, delegation tools, MoA, and goal
            mutation are unavailable. The sole write exception is the designated plan file through the
            dedicated plan writer. Mode enforcement happens at tool execution; it is not merely a prompt
            suggestion.
          </p>
          <Note>
            Git is limited to status, diff, and log. A plan cannot stage, commit, stash, pull, push, or change
            branches.
          </Note>
        </section>

        <section id="plan-file">
          <h2><span className="anchor">#</span>The plan file</h2>
          <p>
            Only the runtime-designated path can be submitted. A model cannot point the approval dialog at
            another file. The plan writer receives the approved path from the runtime, so it cannot be used
            as a general-purpose write primitive.
          </p>
          <p>
            Plan files are ordinary Markdown and remain in <code className="inline">.plans/</code> after the
            dialog. Decide as a team whether to commit that directory; DeepSeek Code does not automatically
            add, ignore, or delete it.
          </p>
        </section>

        <section id="required">
          <h2><span className="anchor">#</span>Required plan content</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "30%" }}>Section</th><th>What it must answer</th></tr></thead>
              <tbody>{SECTIONS.map(([name, meaning]) => <tr key={name}><td><b>{name}</b></td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            These headings make the plan executable by another developer or a later session. A useful plan
            names real paths and tests without embedding source-code excerpts or pretending that exploration
            already proved the implementation.
          </p>
        </section>

        <section id="approval">
          <h2><span className="anchor">#</span>Approval and feedback</h2>
          <p>
            Submission opens a scrollable Markdown preview. Choose Yes with <code className="inline">y</code>
            or Enter on the first option; approval returns the session to Build mode so implementation can
            begin. Choose No with <code className="inline">n</code>, type feedback, and press Enter to return
            the feedback to the planner for another revision.
          </p>
          <p>
            Esc returns from feedback to the choice list. Esc or Ctrl+C on the choice list aborts the plan
            approval flow and returns to Build mode without approving implementation.
          </p>
        </section>

        <section id="modes">
          <h2><span className="anchor">#</span>Plan mode vs planning in a prompt</h2>
          <p>
            Asking “make a plan” in Build mode is conversational guidance; write tools remain available.
            Running <code className="inline">/plan</code> creates an enforced capability boundary, a durable
            artifact, and an approval checkpoint. Use the command for broad, risky, unfamiliar, or
            cross-cutting work. For a two-line change, a short plan in the normal response is enough.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <p>
            If submission says the path is wrong, the plan attempted to submit something other than the
            designated file. If no approval handler is available, the plan is not auto-approved. If a tool
            reports that it is unavailable, check <a href="/docs/permissions">Permissions</a>; do not switch
            tools to bypass the Plan-mode boundary.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
