import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "what-a-goal", label: "What a goal is" },
  { id: "goal-command", label: "The /goal command" },
  { id: "goal-tools", label: "Goal tools" },
  { id: "continuation", label: "Continuation & limits" },
  { id: "todo-pairing", label: "Goals vs. todos" },
];

const STATUSES = [
  ["active", "The agent is working toward the objective"],
  ["paused", "Held via /goal pause or update_goal paused"],
  ["blocked", "Same blocker reported 3+ consecutive times"],
  ["budget_limited", "Turn or token budget exhausted"],
  ["usage_limited", "Usage limit reached"],
  ["complete", "The objective was achieved"],
];

const TOOLS = [
  ["create_goal", "Set a new goal. objective is required; tokenBudget is optional. Fails if an unfinished goal already exists."],
  ["get_goal", "Read the current goal: objective, status, tokens used, budget, remaining budget, elapsed time, block reason, continuation count."],
  ["update_goal", "Change status: complete when achieved, paused to hold, active to resume. blocked requires a blocker."],
];

export default function Goals() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Goals</span>
        </nav>

        <div className="hero">
          <h1>Goals</h1>
          <p className="tagline">
            Long-running objectives the agent keeps working toward across turns — with budgets, pauses, and automatic continuation.
          </p>
        </div>

        <section id="what-a-goal">
          <h2><span className="anchor">#</span>What a goal is</h2>
          <p>
            A goal is a <b>persistent objective</b> the agent keeps working toward across turns. Instead of
            completing one request and stopping, the agent keeps going — re-prompting itself with a continuation
            message — until the goal is achieved, blocked, or a limit is hit.
          </p>
          <p>
            The agent tracks <b>one session goal</b>. State lives in memory and is persisted with the session
            (<code className="inline">SessionData.goal</code>), so it survives reloads. A goal moves through a
            small state machine:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Status</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {STATUSES.map(([status, meaning]) => (
                  <tr key={status}>
                    <td><code className="inline">{status}</code></td>
                    <td>{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="goal-command">
          <h2><span className="anchor">#</span>The /goal command</h2>
          <p>
            <code className="inline">/goal</code> is the human-facing control surface. With no arguments it shows
            the current goal's status; with an objective it sets one.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "30%" }}>Usage</th><th>Behavior</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><code className="inline">/goal</code></td>
                  <td>Show status: objective, status (with block reason when blocked), tokens used and budget, and turns used out of the max.</td>
                </tr>
                <tr>
                  <td><code className="inline">/goal &lt;objective&gt;</code></td>
                  <td>Set a new goal and start working on it. Fails if an unfinished goal exists.</td>
                </tr>
                <tr>
                  <td><code className="inline">/goal &lt;objective&gt; --turns &lt;n&gt;</code></td>
                  <td>Same, with a custom continuation limit. <code className="inline">--turns</code> can appear anywhere in the arguments.</td>
                </tr>
                <tr>
                  <td><code className="inline">/goal edit</code></td>
                  <td>Informational — shows the current objective. Replacing it is done by setting a new one.</td>
                </tr>
                <tr>
                  <td><code className="inline">/goal pause</code></td>
                  <td>Cancel any pending continuation and hold the goal as <code className="inline">paused</code>.</td>
                </tr>
                <tr>
                  <td><code className="inline">/goal resume</code></td>
                  <td>Re-validate turn and token limits, then schedule the next continuation (~200&nbsp;ms). Refused if the goal is complete or budget-limited.</td>
                </tr>
                <tr>
                  <td><code className="inline">/goal clear</code></td>
                  <td>Cancel any pending continuation and remove the goal entirely.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Setting a goal injects a prompt that tells the agent to call{" "}
            <code className="inline">update_goal</code> with <code className="inline">complete</code> when
            achieved, or <code className="inline">blocked</code> with a description after 3 consecutive turns on
            the same blocker.
          </p>
        </section>

        <section id="goal-tools">
          <h2><span className="anchor">#</span>Goal tools</h2>
          <p>
            Three tools expose goals to the agent itself, so the model can manage progress mid-session:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Tool</th><th>What it does</th></tr>
              </thead>
              <tbody>
                {TOOLS.map(([name, desc]) => (
                  <tr key={name}>
                    <td><code className="inline">{name}</code></td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">create_goal</code> accepts an optional{" "}
            <code className="inline">tokenBudget</code> — when the goal spends more than the budget, its status
            becomes <code className="inline">budget_limited</code>. Like the command, it fails if an unfinished
            goal already exists.
          </p>
          <p>
            <code className="inline">update_goal</code> with <code className="inline">status: "blocked"</code>{" "}
            requires a <code className="inline">blocker</code> description. The goal only actually blocks after{" "}
            <b>3 consecutive occurrences of the same blocker</b>; before that, the tool replies with a counter
            (for example <code className="inline">Blocker noted (2/3). Goal still active.</code>).
          </p>
        </section>

        <section id="continuation">
          <h2><span className="anchor">#</span>Continuation & limits</h2>
          <p>
            A goal continues automatically. When a turn ends with the goal still{" "}
            <code className="inline">active</code>, the agent:
          </p>
          <ol>
            <li>Adds the turn's tokens to <code className="inline">tokensUsed</code>.</li>
            <li>Stops with <code className="inline">budget_limited</code> if the continuation count reached the max, or if <code className="inline">tokensUsed</code> reached the <code className="inline">tokenBudget</code>.</li>
            <li>Otherwise increments the count and schedules the next turn ~200&nbsp;ms later.</li>
          </ol>
          <p>
            The default max is <b>3 goal continuations</b> (<code className="inline">GOAL_MAX_CONTINUATIONS</code>,
            overridable via <code className="inline">settings.goal.maxContinuations</code> or{" "}
            <code className="inline">--turns</code>). Each continuation is driven by{" "}
            <code className="inline">buildContinuationPrompt</code>, which injects a message like:
          </p>
          <CodeBlock lang="text">{`[Goal continuation 2/3]

Continue working toward the goal:
"Add a dark theme to the TUI"

1234/no limit tokens consumed. 12m elapsed.

When achieved: call update_goal with status "complete".
If blocked (3+ consecutive same reason): call update_goal with status "blocked" + describe blocker.`}</CodeBlock>
          <p>
            Elapsed time is measured from <code className="inline">startedAt</code> while the goal is active and
            <b>freezes when the goal leaves the active state</b> — pausing, blocking, or completing a goal stops
            the clock until it resumes.
          </p>
        </section>

        <section id="todo-pairing">
          <h2><span className="anchor">#</span>Goals vs. todos</h2>
          <p>
            Goals pair naturally with the todo tool for multi-step work: the todo tool is the{" "}
            <b>in-session checklist</b> of concrete steps, while a goal is the <b>cross-turn objective</b> that
            keeps the agent working on the overall outcome. Use todos to break the work down and a goal to make
            sure it gets finished.
          </p>
          <Note>
            Only one goal exists per session. If you want to switch objectives, clear or complete the current
            goal first — setting a new one while another is unfinished returns an error.
          </Note>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
