import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "retry", label: "Retry the last prompt" },
  { id: "retry-semantics", label: "What retry really repeats" },
  { id: "side-effects", label: "Side effects are not rolled back" },
  { id: "automatic", label: "Automatic request retries" },
  { id: "clear", label: "Clear the conversation" },
  { id: "clear-keeps", label: "What clear keeps" },
  { id: "persistence", label: "Saved-session behavior" },
  { id: "compare", label: "Clear, compact, undo or restart?" },
  { id: "recipes", label: "Safe recovery recipes" },
  { id: "limitations", label: "Known limitations" },
];

const CLEAR_STATE = [
  ["Model-facing history", "Cleared to the current system/project prompt."],
  ["Visible transcript", "Cleared immediately."],
  ["In-memory undo stack", "Cleared."],
  ["Modified-file list", "Cleared; files themselves are unchanged."],
  ["Workspace files", "Kept exactly as they are."],
  ["Model, effort and interaction mode", "Kept."],
  ["Working directory and loaded settings", "Kept."],
  ["Tool/directory approvals", "Kept for the process."],
  ["Memory, checkpoints and input history on disk", "Kept."],
  ["Goal and orchestration state", "Kept."],
  ["Token, cost, duration and tool-call counters", "Kept."],
  ["Last raw user prompt used by /retry", "Kept in the current process."],
  ["Session ID", "Kept; /clear does not create a new session."],
];

const CHOICES = [
  ["/retry", "Repeat the latest raw main-agent prompt", "Provider failure or an answer you want regenerated", "No"],
  ["/clear", "Discard live conversation context and the visible transcript", "A clean context in the same process/workspace", "No"],
  ["/compact", "Replace active history with an LLM-generated summary", "Keep decisions while freeing context", "No"],
  ["/undo", "Restore agent-written files from durable file checkpoints", "Reverse file changes", "Yes, for covered writes"],
  ["/checkpoint restore <id>", "Restore a saved model-message snapshot", "Return model context to a named point", "No automatic file rollback"],
  ["Exit and run deepseek", "Create a fresh process and session ID", "Reset process-lifetime state as well", "No"],
];

export default function RetryAndClear() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Retry & clear</span>
        </nav>

        <div className="hero">
          <h1>Retry and clear</h1>
          <p className="tagline">Repeat a prompt or reset live context without confusing either action for rollback, compaction, deletion or a new session.</p>
        </div>

        <section id="retry">
          <h2><span className="anchor">#</span>Retry the last prompt</h2>
          <p>
            <code className="inline">/retry</code> submits the most recent raw prompt that reached the main
            agent. It takes no arguments. The visible transcript is trimmed back to the latest user row,
            then that original text is submitted again using the current model, effort, interaction mode,
            working directory and settings.
          </p>
          <CodeBlock lang="text">{"> Add validation to the webhook handler.\n⚠ Error: Service unavailable\n\n> /retry\n# The prompt “Add validation to the webhook handler.” is submitted again."}</CodeBlock>
          <p>
            If no prompt has reached the agent in this process, the command reports:
          </p>
          <CodeBlock lang="text">{"> /retry\nNothing to retry."}</CodeBlock>
          <p>
            Slash commands and <code className="inline">!</code> shell lines do not become the retry target.
            A side question asked with <code className="inline">/btw</code> is also separate from main-agent
            prompt history.
          </p>
        </section>

        <section id="retry-semantics">
          <h2><span className="anchor">#</span>What retry really repeats</h2>
          <p>
            The stored target is exactly what you typed before prompt refinement. If refinement is enabled,
            the repeated text goes through the refiner again; the effective model prompt can therefore differ
            from the first attempt. Retry does not pin the previous model, mode, directory or generated prompt.
          </p>
          <p>
            The terminal removes the last visible user turn and everything displayed after it so the regenerated
            attempt replaces that section visually. The internal model history is <b>not rewound</b>: messages and
            tool results from the previous attempt remain, followed by a new copy of the user prompt.
          </p>
          <Note>
            Treat <code className="inline">/retry</code> as “ask again with today&apos;s runtime state,” not
            “replay an identical request from an earlier snapshot.” Use a checkpoint when exact context state matters.
          </Note>
        </section>

        <section id="side-effects">
          <h2><span className="anchor">#</span>Side effects are not rolled back</h2>
          <p>
            A retry can call tools again. Files written by the first attempt, shell commands already executed,
            Git changes, network requests, messages sent to tasks and external service effects all remain in place.
            The second attempt observes that modified world and may repeat non-idempotent work.
          </p>
          <CodeBlock lang="text">{"> /files\nFiles modified this session:\n  src/webhook.ts\n\n> /undo\nRestored src/webhook.ts\n\n> /retry"}</CodeBlock>
          <p>
            Before retrying a mutating task, inspect <code className="inline">/files</code>, review the Git
            diff and decide whether to keep or undo partial work. For an external action that cannot be rolled
            back, write a new prompt explaining what already happened instead of blindly retrying.
          </p>
          <Note>
            Permission confirmations are evaluated again only when existing session approval and policy do not
            already cover the repeated tool call. A retry is never a guarantee of a fresh confirmation dialog.
          </Note>
        </section>

        <section id="automatic">
          <h2><span className="anchor">#</span>Automatic request retries</h2>
          <p>
            DeepSeek Code also has transport-level retry logic that is separate from the slash command. An
            eligible model request that fails with HTTP <code className="inline">429</code> or
            <code className="inline">503</code> is tried up to three additional times after fixed waits of
            one, two and four seconds. Including the original request, that is at most four attempts.
          </p>
          <p>
            Other status codes and ordinary errors are surfaced immediately. A user abort is never retried,
            and aborting during a backoff cancels the wait. There is no user setting for these delays or the
            attempt count.
          </p>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "27%" }}>Mechanism</th><th style={{ width: "28%" }}>Trigger</th><th>Conversation effect</th></tr></thead>
            <tbody>
              <tr><td><code className="inline">automatic retry</code></td><td>HTTP 429 or 503 during an eligible request</td><td>Repeats the same in-flight request before the turn fails.</td></tr>
              <tr><td><code className="inline">/retry</code></td><td>User command after the turn returns</td><td>Starts a new turn from the saved raw prompt.</td></tr>
            </tbody>
          </table></div>
        </section>

        <section id="clear">
          <h2><span className="anchor">#</span>Clear the conversation</h2>
          <p>
            <code className="inline">/clear</code> immediately removes every visible message and replaces
            model history with only the current system/project prompt. It makes no provider request and does
            not summarize anything.
          </p>
          <CodeBlock lang="text">{"> /clear\n# The transcript disappears and the input is ready for a new prompt.\n\n> Work only from the current repository state. Explain the failing test."}</CodeBlock>
          <p>
            The new prompt still runs inside the same DeepSeek Code process. It uses the current workspace,
            provider, model, policy and session ID, but it does not carry the old user/assistant/tool messages.
          </p>
        </section>

        <section id="clear-keeps">
          <h2><span className="anchor">#</span>What clear keeps</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "38%" }}>State</th><th>After <code className="inline">/clear</code></th></tr></thead>
            <tbody>{CLEAR_STATE.map(([state, result]) => (
              <tr key={state}><td><b>{state}</b></td><td>{result}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            The distinction between the modified-file <em>list</em> and files on disk matters. Clear forgets
            what the agent tracked during this process; it never restores or deletes those files. Review the
            diff before clearing if you may need the tracker to identify partial changes.
          </p>
          <p>
            Because the last raw main-agent prompt remains in memory, entering
            <code className="inline">/retry</code> immediately after <code className="inline">/clear</code>
            can repopulate the fresh context by rerunning the pre-clear task.
          </p>
        </section>

        <section id="persistence">
          <h2><span className="anchor">#</span>Saved-session behavior</h2>
          <p>
            Clear itself does not delete a saved session and does not force an immediate session save. The
            existing record on disk can still contain the pre-clear conversation for a short time. After a
            later main-agent turn completes, the same session ID is saved again with the cleared history plus
            new messages, replacing that record&apos;s conversation state.
          </p>
          <p>
            Therefore <code className="inline">/clear</code> is neither durable deletion nor a guaranteed
            archive of the old conversation. Export anything you need to preserve before clearing, and manage
            sensitive saved records separately from the live TUI.
          </p>
          <CodeBlock lang="text">{"> /sessions export a1b2c3d4e5f6 md\nSanitized session export written to /home/you/acme/.deepseek/session-a1b2c3d4e5f6.sanitized.md\n\n> /clear"}</CodeBlock>
          <Note>
            Starting a truly independent session requires exiting and launching <code className="inline">deepseek</code>
            again. That creates a new ID and resets process-lifetime counters and approvals.
          </Note>
        </section>

        <section id="compare">
          <h2><span className="anchor">#</span>Clear, compact, undo or restart?</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "24%" }}>Action</th><th style={{ width: "31%" }}>Changes</th><th>Best use</th><th style={{ width: "14%" }}>Rolls back files?</th></tr></thead>
            <tbody>{CHOICES.map(([action, changes, use, rollback]) => (
              <tr key={action}><td><code className="inline">{action}</code></td><td>{changes}</td><td>{use}</td><td>{rollback}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            Compact is preferable when the earlier conversation contains decisions the agent still needs.
            Clear is preferable when that context is irrelevant or actively confusing. Neither operation is
            a substitute for Git or file checkpoints.
          </p>
        </section>

        <section id="recipes">
          <h2><span className="anchor">#</span>Safe recovery recipes</h2>
          <h3>A provider returned 429 or 503</h3>
          <p>Wait for the built-in retries. If the turn ultimately fails, inspect any completed tool effects before using <code className="inline">/retry</code>.</p>
          <h3>The answer is poor but no tools ran</h3>
          <p>Switch model or effort if needed, then retry. The new turn uses the new runtime selection and the original raw wording.</p>
          <CodeBlock lang="text">{"> /model deepseek-v4-pro\nModel switched to deepseek-v4-pro\n\n> /effort max\nEffort: max — Maximum reasoning depth (best with deepseek-v4-pro)\n\n> /retry"}</CodeBlock>
          <h3>The agent partially edited files</h3>
          <p>Review <code className="inline">/files</code> and the diff, undo unwanted writes, then give a corrective prompt that names the remaining state. Do not assume retry will start clean.</p>
          <h3>The conversation is polluted but decisions matter</h3>
          <p>Use <code className="inline">/compact</code>. Clear only when you are willing to restate all required context.</p>
        </section>

        <section id="limitations">
          <h2><span className="anchor">#</span>Known limitations</h2>
          <p>
            Retry availability is process-local. Resuming saved messages does not reconstruct the dedicated
            “last raw user prompt” field, so <code className="inline">/retry</code> reports “Nothing to retry”
            until you submit a new main-agent prompt in the resumed process.
          </p>
          <p>
            Retry&apos;s UI replacement is deeper than its model-history replacement: the previous attempt
            disappears visually but remains visible to the model. If you require an actual history rewind,
            restore a checkpoint or clear and restate the task.
          </p>
          <p>
            Clear does not cancel tasks, stop workflows, pause goals, revoke approvals or reset usage counters.
            Handle each of those surfaces with its own command before treating the process as operationally fresh.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
