import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "What a workflow is" },
  { id: "isolation", label: "Isolation & safety" },
  { id: "usage", label: "Running workflows" },
  { id: "authoring", label: "Authoring a coordination program" },
];

const HELPERS = [
  ["agent(prompt, options)", "Run one sub-agent; resolves to its result"],
  ["parallel(thunks)", "Run many agents concurrently via Promise.allSettled"],
  ["pipeline(items, ...stages)", "Push each item through stages in sequence"],
  ["workflow(name, args)", "Run a saved child workflow"],
  ["log(value) / phase(value)", "Emit a log line / update the run's phase"],
  ["args / budget", "Deep-frozen inputs; budget.spent and budget.remaining in tokens and cost"],
];

export default function Workflows() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Workflows</span>
        </nav>

        <div className="hero">
          <h1>Dynamic workflows</h1>
          <p className="tagline">
            Turn a multi-step job into a single, repeatable coordination script.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>What a workflow is</h2>
          <p>
            Dynamic workflows turn a multi-step job into a single, repeatable script the agent runs
            for you. A workflow is a bounded JavaScript coordination program: it fans out to
            specialist sub-agents, chains their results through stages, and returns one value — with
            live budget tracking, git-worktree isolation for writers, and a persisted run history you
            can replay.
          </p>
          <p>
            A workflow is a plain JavaScript program executed by the <code className="inline">workflow</code>{" "}
            tool inside a sandboxed worker. Every script must start with a <code className="inline">meta</code>{" "}
            export that names and describes it; the rest of the file is the coordination logic, and its
            top-level <code className="inline">return</code> value becomes the run's result.
          </p>
          <CodeBlock lang="js">{`export const meta = {
  name: "code-review",
  description: "Reviews the current diff with parallel specialist agents",
};`}</CodeBlock>
          <p>Inside the program these helpers and globals are available:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "40%" }}>Helper / global</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {HELPERS.map(([h, d]) => (
                  <tr key={h}>
                    <td><code className="inline">{h}</code></td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            <code className="inline">agent</code> options include <code className="inline">label</code>,{" "}
            <code className="inline">phase</code>, <code className="inline">schema</code> (a JSON Schema{" "}
            <code className="inline">object</code>), <code className="inline">model</code>,{" "}
            <code className="inline">effort</code> (<code className="inline">low</code> |{" "}
            <code className="inline">high</code> | <code className="inline">max</code>),{" "}
            <code className="inline">isolation</code>, <code className="inline">agentType</code>,{" "}
            <code className="inline">timeoutMs</code>, <code className="inline">maxTokens</code>, and{" "}
            <code className="inline">maxCostUsd</code>.
          </Note>
        </section>

        <section id="isolation">
          <h2><span className="anchor">#</span>Isolation &amp; safety</h2>
          <p>
            Workflows that write code get the same isolation as sub-agents. Pass{" "}
            <code className="inline">isolation: "worktree"</code> to <code className="inline">agent()</code> to run the
            writer in its own git worktree under <code className="inline">.deepseek/worktrees/</code>.
          </p>
          <p>
            Launching a workflow requires explicit approval unless the script has been approved before
            or you are in <code className="inline">auto</code> interaction mode. Approvals are hash-persisted
            per project in <code className="inline">~/.deepseek/workflow-approvals.json</code>; approving once
            with "always" skips the prompt on future runs of the same script.
          </p>
          <p>
            Runs are bounded by <code className="inline">timeoutMs</code> (default 120s),{" "}
            <code className="inline">maxTokens</code>, and <code className="inline">maxCostUsd</code>, and may spawn at
            most 17 agents. Exceeding a budget marks the run <code className="inline">budget_exhausted</code>; plan
            and review modes refuse writer agents entirely.
          </p>
        </section>

        <section id="usage">
          <h2><span className="anchor">#</span>Running workflows</h2>
          <p>
            The model triggers a workflow as a tool call, but you stay in control from the TUI:
          </p>
          <CodeBlock lang="bash">{`/workflow run code-review '{"scope":"src/agent"}'
/workflows
/workflow restart 3f2a9c81`}</CodeBlock>
          <ul className="capabilities">
            <li><code className="inline">/workflow run &lt;name&gt; [args-json]</code> — run a saved workflow with arguments</li>
            <li><code className="inline">/workflow pause|resume|stop &lt;run-id&gt;</code> — control an active run</li>
            <li><code className="inline">/workflow restart &lt;run-id&gt;</code> — re-run a previous run from its persisted script, args, and options</li>
            <li><code className="inline">/workflows</code> — monitor runs, phases, and usage</li>
          </ul>
          <p>
            Workflows saved under <code className="inline">.deepseek/workflows/</code> (project) or{" "}
            <code className="inline">~/.deepseek/workflows/</code> (user) are also discoverable as their own{" "}
            <code className="inline">/name</code> commands.
          </p>
        </section>

        <section id="authoring">
          <h2><span className="anchor">#</span>Authoring a coordination program</h2>
          <p>
            Track progress with <code className="inline">phase</code>, fan out work with{" "}
            <code className="inline">parallel</code>, and thread results through a{" "}
            <code className="inline">pipeline</code>:
          </p>
          <CodeBlock lang="js">{`phase("reviewing");
const [security, style, tests] = await parallel([
  () => agent("Review for security issues", { isolation: "worktree", effort: "high" }),
  () => agent("Review code style", { isolation: "worktree" }),
  () => agent("Review test coverage", { isolation: "worktree" }),
]);

phase("synthesizing");
const report = await pipeline([security, style, tests],
  (results) => results.filter(Boolean).join("\\n\\n"),
  (text) => \`# Review\\n\\n\${text}\`,
);

log(\`spent \${budget.spent.tokens} tokens\`);
return report;`}</CodeBlock>
          <Note>
            <code className="inline">parallel</code> and <code className="inline">pipeline</code> resolve failed items
            to <code className="inline">null</code> — keep array positions and filter before merging. Child
            workflows run with <code className="inline">workflow(name, args)</code> need prior approval and cannot
            start another workflow.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
