import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "purpose", label: "What /btw is for" },
  { id: "during-work", label: "While work is running" },
  { id: "context", label: "Context and isolation" },
  { id: "limits", label: "Limits" },
  { id: "controls", label: "Controls" },
  { id: "patterns", label: "Good uses" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const COMPARE = [
  ["Normal prompt", "Queued while the main turn is busy", "Can use tools and change the workspace", "Becomes part of the main conversation"],
  ["/btw question", "Starts immediately", "Cannot use tools or take actions", "Does not redirect the main turn"],
];

export default function SideQuestions() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Side questions</span>
        </nav>

        <div className="hero">
          <h1>Ask a side question with /btw</h1>
          <p className="tagline">
            Get a short, tool-free answer from the current conversation without steering or stopping the
            main agent.
          </p>
        </div>

        <section id="purpose">
          <h2><span className="anchor">#</span>What /btw is for</h2>
          <p>
            Use <code className="inline">/btw</code> when the agent is already working and you want an
            explanation, status clarification, or definition that should not become a new instruction.
          </p>
          <CodeBlock lang="text">{`/btw why did you choose a worktree here?
/btw what does the yellow context indicator mean?
/btw which test is currently failing?`}</CodeBlock>
          <p>
            The answer appears in a separate panel. The main turn continues independently, including any
            tools, background tasks, and streaming output already in progress.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th>Input</th><th>When it runs</th><th>Capabilities</th><th>Effect on main work</th></tr></thead>
              <tbody>{COMPARE.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>

        <section id="during-work">
          <h2><span className="anchor">#</span>While work is running</h2>
          <p>
            Press Enter on a <code className="inline">/btw …</code> input while the main agent is busy. It is
            recognized as an immediate side question instead of being added to the normal message queue.
            Other prompts wait in FIFO order until the active turn finishes.
          </p>
          <p>
            Starting another side question cancels the previous side-question request and replaces its
            panel. It does not cancel the main agent. To cancel the main turn, use Ctrl+C or Esc instead.
          </p>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Context and isolation</h2>
          <p>
            A side question receives a safe snapshot of the current conversation after the latest
            compaction boundary. If the main agent has begun a tool exchange that is not complete yet, the
            snapshot stops before that exchange. This prevents an invalid half-finished call/result pair
            from reaching the provider.
          </p>
          <p>
            The side answer is produced by the active provider, model, and effort setting. Its usage counts
            toward the session token and cost totals. It is a real model request, not a local tooltip.
          </p>
          <Note>
            The side request cannot see a tool result that has not arrived yet. Ask again after the main
            agent finishes if the answer depends on the final command output or diff.
          </Note>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits</h2>
          <p>
            A side question is intentionally one response with no tool use. It cannot read a new file, run a
            command, edit code, inspect live task state beyond what is already in conversation, or promise a
            later action. The response is capped at 2,048 output tokens and the request times out after 60
            seconds.
          </p>
          <p>
            If you need evidence that is not already in context, queue a normal prompt instead. If you need
            a concurrent investigation with tools, use a <a href="/docs/subagents">sub-agent</a> or a
            <a href="/docs/workflows">workflow</a>.
          </p>
        </section>

        <section id="controls">
          <h2><span className="anchor">#</span>Controls</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "28%" }}>Key</th><th>Behavior</th></tr></thead>
              <tbody>
                <tr><td><code className="inline">Space</code>, <code className="inline">Enter</code>, or <code className="inline">Esc</code></td><td>Dismiss the side-question panel.</td></tr>
                <tr><td><code className="inline">Ctrl+C</code> or <code className="inline">Ctrl+D</code></td><td>Dismiss the panel and cancel an unfinished side request.</td></tr>
                <tr><td>New <code className="inline">/btw</code></td><td>Cancel and replace the previous side request.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="patterns">
          <h2><span className="anchor">#</span>Good uses</h2>
          <p>
            Good questions ask about information the conversation already contains: why an approach was
            selected, what a status label means, which files have been discussed, or how two proposed
            options differ. Keep them narrow enough for one direct answer.
          </p>
          <p>
            Do not use <code className="inline">/btw</code> to add requirements such as “also update the
            migration” or “do not touch the API.” Those are steering instructions and belong in the normal
            queue so the main agent is guaranteed to receive them.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <p>
            An empty invocation returns <code className="inline">Usage: /btw &lt;question&gt;</code>. A timeout,
            provider error, or empty provider response is shown inside the side panel. Dismiss it and retry
            only if the underlying provider is healthy; <a href="/docs/doctor">Doctor</a> covers setup
            failures.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
