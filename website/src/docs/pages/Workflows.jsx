import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "What a workflow is" },
  { id: "isolation", label: "Isolation & safety" },
  { id: "limits", label: "Limits & budgets" },
  { id: "replay", label: "Journal & replay" },
  { id: "storage", label: "Saving runs & storage" },
  { id: "usage", label: "Running workflows" },
  { id: "web", label: "Browser monitoring" },
  { id: "authoring", label: "Authoring a coordination program" },
];

const LIMITS = [
  ["MAX_AGENTS", "17 per run", "The 18th agent() call fails the run with a structural error"],
  ["MAX_CONCURRENCY", "16", "Cap on agents executing at the same time within one run"],
  ["timeoutMs", "120s default, max 3,600,000 (1h)", "Set on the run or per agent"],
  ["parallel / pipeline", "4,096 items", "More items throw inside the sandbox"],
  ["Script size", "256KB", "MAX_SOURCE_BYTES — larger scripts are rejected at parse"],
  ["Name regex", "^[a-z0-9][a-z0-9-]{0,63}$", "1-64 lowercase letters, numbers, or hyphens, starting alphanumeric"],
  ["Sync execution", "1s (SYNC_EXECUTION_TIMEOUT_MS)", "Per synchronous segment of the script in the VM sandbox"],
  ["Budgets", "maxTokens / maxCostUsd", "Optional per agent; exceeding marks the run budget_exhausted"],
];

const HELPERS = [
  ["agent(prompt, options)", "Run one sub-agent; resolves to its text, or a validated object when options.schema is set (null on failure)"],
  ["parallel(thunks)", "Run thunks concurrently and wait for all of them (a barrier); a failed thunk resolves to null"],
  ["pipeline(items, ...stages)", "Push each item through every stage independently, no barrier; stages receive (previous, item, index)"],
  ["workflow(nameOrRef, args)", "Run a saved workflow by name or { scriptPath } as a child; its agents show under a ▸ name group"],
  ["log(value) / phase(value)", "Emit a log line / start a new progress group"],
  ["args", "The tool's args input, deep-frozen"],
  ["budget", "total (token ceiling or null), spent(), remaining() (Infinity when unbounded), maxCostUsd, spentCostUsd(), remainingCostUsd()"],
  ["Date.now() / Math.random() / new Date()", "Throw inside a workflow — they would break resume; pass timestamps and seeds through args"],
  ["Tool inputs", "script, scriptPath, name, args, resumeFromRunId, timeoutMs, maxTokens, maxCostUsd — resumeFromRunId replays every unchanged agent() call from that run's journal"],
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
            <code className="inline">medium</code> | <code className="inline">high</code> |{" "}
            <code className="inline">xhigh</code> | <code className="inline">max</code>),{" "}
            <code className="inline">isolation</code>, <code className="inline">agentType</code>, and — only when the
            user asked for a budget — <code className="inline">timeoutMs</code>, <code className="inline">maxTokens</code>, and{" "}
            <code className="inline">maxCostUsd</code>; an agent that hits its own limit fails and resolves to{" "}
            <code className="inline">null</code>.
          </Note>
        </section>

        <section id="isolation">
          <h2><span className="anchor">#</span>Isolation & safety</h2>
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
            Runs are bounded by <code className="inline">timeoutMs</code> (default 120s, max 1h),{" "}
            <code className="inline">maxTokens</code>, and <code className="inline">maxCostUsd</code>, and may spawn at
            most 17 agents. Exceeding a budget marks the run <code className="inline">budget_exhausted</code>; plan
            and review modes refuse writer agents entirely — <code className="inline">isolation: "worktree"</code>{" "}
            throws in those modes. Workflows can be switched off with{" "}
            <code className="inline">settings.workflows.enabled: false</code> or the{" "}
            <code className="inline">DEEPSEEK_DISABLE_WORKFLOWS=1</code> environment variable, and child workflows
            need their own approval before they run.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits & budgets</h2>
          <p>Exact bounds enforced per run:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "28%" }}>Limit</th><th style={{ width: "26%" }}>Value</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {LIMITS.map(([l, v, n]) => (
                  <tr key={l}>
                    <td><code className="inline">{l}</code></td>
                    <td><code className="inline">{v}</code></td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Exceeding the agent limit is a structural error — the run fails rather than silently
            truncating. The sync-execution limit is per synchronous segment inside the VM sandbox, not
            a cap on total run time; overall runtime is governed by <code className="inline">timeoutMs</code>.
          </p>
        </section>

        <section id="replay">
          <h2><span className="anchor">#</span>Journal & replay</h2>
          <p>
            Every <code className="inline">agent()</code> and <code className="inline">workflow()</code> call is journaled
            with a SHA-256 fingerprint of its method and arguments. When a run starts, the manager
            looks for a previous run with identical <b>script + args + options</b> hashes
            (<code className="inline">findReplay</code>): completed calls whose fingerprints match are replayed —
            their results are returned and their usage is counted, but no agents are re-spent.
          </p>
          <p>
            The first call whose entry is missing, failed, or has a different fingerprint breaks the
            replay and execution continues fresh from that point; a corrupted journal disables replay
            for the run entirely. Entries marked <code className="inline">budget_exhausted</code> are not replayed:
            execution continues fresh from that call, and the earlier exhaustion does not propagate into
            the new run.
          </p>
        </section>

        <section id="storage">
          <h2><span className="anchor">#</span>Saving runs & storage</h2>
          <p>
            <code className="inline">/workflow save &lt;run-id&gt; &lt;name&gt;</code> persists a finished run as a saved
            workflow at <code className="inline">.deepseek/workflows/&lt;name&gt;.js</code> in the project — written
            with mode <code className="inline">0600</code> and the <code className="inline">wx</code> flag, so it never
            overwrites an existing file and refuses to write through a symlink (symlinked directories
            along the path are rejected too).
          </p>
          <p>
            Every run is stored under{" "}
            <code className="inline">~/.deepseek/projects/&lt;projectHash&gt;/&lt;sessionHash&gt;/workflows/&lt;runId&gt;/</code>{" "}
            as <code className="inline">workflow.js</code>, <code className="inline">args.json</code>,{" "}
            <code className="inline">run.json</code>, and <code className="inline">journal.json</code> — written atomically
            (temp file + rename) with <code className="inline">0700</code> directories and{" "}
            <code className="inline">0600</code> files. <code className="inline">/workflows</code> lists the 100 most
            recent runs.
          </p>
          <p>
            Discovery is capped at 256 workflows per directory, and symlinks that escape a workflow
            directory are rejected. When a project workflow and a user workflow share a name, the
            project's wins.
          </p>
        </section>

        <section id="usage">
          <h2><span className="anchor">#</span>Running workflows</h2>
          <p>
            The model triggers a workflow as a tool call, but you stay in control from the TUI or Browser Workspace:
          </p>
          <CodeBlock lang="bash">{`/workflow run code-review '{"scope":"src/agent"}'
/workflows
/workflow restart 3f2a9c81`}</CodeBlock>
          <ul className="capabilities">
            <li><code className="inline">/workflow run &lt;name&gt; [args-json]</code> — run a saved workflow with arguments</li>
            <li><code className="inline">/workflow save &lt;run-id&gt; &lt;name&gt;</code> — persist a run as a saved workflow</li>
            <li><code className="inline">/workflow pause|resume|stop &lt;run-id&gt;</code> — control an active run</li>
            <li><code className="inline">/workflow restart &lt;run-id&gt;</code> — re-run a previous run from its persisted script, args, and options, reusing its journal so completed agents are not rerun; <code className="inline">/workflow resume</code> does the same for a run that is not paused</li>
            <li><code className="inline">/workflows</code> — monitor runs, phases, and usage</li>
          </ul>
          <p>
            Workflows saved under <code className="inline">.deepseek/workflows/</code> (project) or{" "}
            <code className="inline">~/.deepseek/workflows/</code> (user) are also discoverable as their own{" "}
            <code className="inline">/name</code> commands.
          </p>
        </section>

        <section id="web">
          <h2><span className="anchor">#</span>Browser monitoring</h2>
          <p>
            The <a href="/docs/browser-workspace">Browser Workspace</a> receives workflow events while a run is active.
            Its activity row updates with the workflow name, current phase, status, agent count and token usage instead
            of waiting for the final <code className="inline">workflow</code> tool result.
          </p>
          <p>
            Calls to <code className="inline">log(value)</code> become live progress text on that same row. A blocked
            sub-agent remains visible with <code className="inline">BLOCKED · reason</code>, so a run that is waiting on
            intervention is distinguishable from one that is still executing. Streamed tool-argument fragments also stay
            grouped into one activity item.
          </p>
          <p>
            Workflow commands, saved workflow suggestions and custom commands use the same resolver in the browser and
            TUI. The two interfaces still own separate agent conversations, while both observe the same local workflow
            storage and filesystem.
          </p>
        </section>

        <section id="authoring">
          <h2><span className="anchor">#</span>Authoring a coordination program</h2>
          <p>
            Track progress with <code className="inline">phase</code>, fan out work with{" "}
            <code className="inline">parallel</code>, and thread results through a{" "}
            <code className="inline">pipeline</code>:
          </p>
          <CodeBlock lang="js">{`export const meta = {
  name: "review-changes",
  description: "Review the diff across dimensions, then verify each finding",
  phases: [{ title: "Review" }, { title: "Verify" }],
};

const FINDINGS = { type: "object", properties: { findings: { type: "array", items: { type: "object",
  properties: { file: { type: "string" }, title: { type: "string" } }, required: ["file", "title"] } } }, required: ["findings"] };
const VERDICT = { type: "object", properties: { isReal: { type: "boolean" } }, required: ["isReal"] };
const DIMENSIONS = [
  { key: "bugs", prompt: "Find correctness bugs in the current git diff." },
  { key: "security", prompt: "Find security issues in the current git diff." },
];

// pipeline: each dimension starts verifying as soon as its own review finishes.
const results = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: "review:" + d.key, phase: "Review", schema: FINDINGS }),
  (review, d) => parallel((review?.findings ?? []).map((f) => () =>
    agent("Try to refute this finding: " + JSON.stringify(f), { label: "verify:" + f.file, phase: "Verify", schema: VERDICT })
      .then((v) => ({ ...f, dimension: d.key, real: v?.isReal === true })))),
);

log(\`spent \${budget.spent()} of \${budget.total ?? "unbounded"} tokens\`);
return results.flat().filter(Boolean).filter((f) => f.real);`}</CodeBlock>
          <Note>
            <code className="inline">parallel</code> and <code className="inline">pipeline</code> resolve failed items
            to <code className="inline">null</code> — keep array positions and filter before merging. Prefer{" "}
            <code className="inline">pipeline</code>; reach for a <code className="inline">parallel</code> barrier only when a
            later step needs every prior result at once. Child workflows run with{" "}
            <code className="inline">workflow(nameOrRef, args)</code>, need prior approval outside Auto mode, and cannot
            start another workflow. To iterate on a run, edit the file at its <code className="inline">scriptPath</code> and
            call the tool again with <code className="inline">resumeFromRunId</code>.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
