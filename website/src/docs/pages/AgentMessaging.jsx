import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "why", label: "Why a mailbox" },
  { id: "shape", label: "Message shape" },
  { id: "types", label: "The eight message types" },
  { id: "guarantees", label: "Delivery guarantees" },
  { id: "dedup", label: "Deduplication" },
  { id: "permission", label: "The permission handshake" },
  { id: "sending", label: "Sending from the coordinator" },
  { id: "notes", label: "Background answers as @agent notes" },
  { id: "security", label: "Why messages are not instructions" },
  { id: "patterns", label: "Coordination patterns" },
];

const FIELDS = [
  ["messageId", "Unique id. The deduplication key."],
  ["senderId", "Who sent it. Checked on receipt, not trusted from the payload alone."],
  ["recipientId", "Who it is for. A worker cannot read another worker's mail."],
  ["type", "One of eight structured types — see below."],
  ["correlationId", "Ties a reply back to the request that caused it."],
  ["taskId", "The task this message concerns."],
  ["timestamp", "When it was sent."],
  ["payload", "An object whose fields depend on the type; a question may carry a text field."],
  ["status", "pending or processed — the acknowledgement bit."],
];

const TYPES = [
  ["progress", "Worker → coordinator", "Intermediate status while work continues."],
  ["result", "Worker → coordinator", "A produced result, distinct from the terminal envelope."],
  ["blocked", "Worker → coordinator", "The worker cannot proceed and has stopped."],
  ["question", "Worker → coordinator", "A question that needs an answer to continue."],
  ["error", "Worker → coordinator", "A recoverable error worth reporting without failing the task."],
  ["cancel", "Coordinator → worker", "A cancellation request."],
  ["permission", "Both directions", "A permission request from a worker, or a grant/denial back."],
  ["resource", "Both directions", "Resource negotiation — budgets, leases, capacity."],
];

const GUARANTEES = [
  ["Ordered", "Messages are delivered in send order per recipient. Causality survives."],
  ["Deduplicated", "Repeat sends of the same messageId collapse into one delivery."],
  ["Acknowledged", "Every message carries pending/processed state, so nothing is silently dropped."],
  ["Addressed", "recipientId scopes visibility. There is no broadcast channel between workers."],
  ["Validated", "Every message is schema-validated before it enters the mailbox."],
];

const PATTERNS = [
  ["Ask, do not assume", "A worker that hits an ambiguity should send question and block, not guess and proceed."],
  ["Report progress on long work", "A silent worker and a hung worker look identical. progress distinguishes them."],
  ["Grant narrowly", "Approve the specific tool the worker asked for, then resume. Do not pre-approve broadly."],
  ["Prefer results over chatter", "The terminal envelope is the contract. Messages are for coordination, not for delivering work."],
];

export default function AgentMessaging() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Agent messaging</span>
        </nav>

        <div className="hero">
          <h1>Agent messaging</h1>
          <p className="tagline">
            Ordered, deduplicated, acknowledged messages between a coordinator and its workers — structured
            data, never instructions.
          </p>
        </div>

        <section id="why">
          <h2><span className="anchor">#</span>Why a mailbox</h2>
          <p>
            A worker runs in its own loop, in its own workspace, with its own permissions. It cannot call
            back into your session and it cannot see your conversation. When it needs something —
            permission for a tool, an answer to an ambiguity, a way to report that it is stuck — it needs a
            channel.
          </p>
          <p>
            <code className="inline">TaskMailbox</code> is that channel. It is deliberately not a shared
            variable, an event emitter, or a chat log. Every message is a validated, addressed, acknowledged
            record, because coordination between processes that hold different privileges is exactly where
            informality causes security bugs.
          </p>
          <p>
            The three properties that matter: messages are listed <b>in send order</b>, a repeated
            <b>message id</b> is delivered at most once, and each message is <b>known to have been
            processed</b> or not.
          </p>
        </section>

        <section id="shape">
          <h2><span className="anchor">#</span>Message shape</h2>
          <p>
            All envelopes are version <code className="inline">1</code>.{" "}
            <code className="inline">TaskMessageV1</code> carries:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Field</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {FIELDS.map(([f, p]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`{
  "messageId": "m-7c31a9",
  "senderId": "t-4f21",
  "recipientId": "coordinator",
  "type": "permission",
  "correlationId": "req-2b81",
  "taskId": "t-4f21",
  "timestamp": "2026-08-11T14:22:07.412Z",
  "payload": { "tool": "shell", "args": { "command": "bun test" }, "reason": "requires coordinator permission" },
  "status": "pending"
}`}</CodeBlock>
          <p>
            <code className="inline">payload</code> is always an object, but it may contain prose—for example,
            a question answer uses a <code className="inline">text</code> field. Permission requests instead
            carry a tool, exact <code className="inline">args</code>, and reason, making a later grant
            verifiable rather than interpretive.
          </p>
        </section>

        <section id="types">
          <h2><span className="anchor">#</span>The eight message types</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "16%" }}>Type</th><th style={{ width: "24%" }}>Direction</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {TYPES.map(([t, d, m]) => (
                  <tr key={t}>
                    <td><code className="inline">{t}</code></td>
                    <td>{d}</td>
                    <td>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">result</code> and the terminal result envelope are different things. A{" "}
            <code className="inline">result</code> message is an intermediate hand-off while the task continues;
            the envelope is how the task <em>ends</em>. Only the envelope is validated against the output
            schema and only the envelope settles the task.
          </p>
          <p>
            <code className="inline">blocked</code> is a state announcement, not a request. It says the worker
            has stopped and why — usually paired with a <code className="inline">question</code> or{" "}
            <code className="inline">permission</code> message carrying what it needs to continue.
          </p>
        </section>

        <section id="guarantees">
          <h2><span className="anchor">#</span>Delivery guarantees</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "22%" }}>Guarantee</th><th>What it buys</th></tr>
              </thead>
              <tbody>
                {GUARANTEES.map(([g, w]) => (
                  <tr key={g}>
                    <td><b style={{ color: "var(--text-strong)" }}>{g}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Ordering is per recipient, which is the useful granularity. A coordinator receiving from five
            workers does not need those five streams globally ordered relative to each other — it needs each
            worker's own sequence to make sense.
          </p>
          <p>
            Acknowledgement is explicit state on the message rather than an implicit "you read it". A message
            sitting at <code className="inline">pending</code> is visible as unprocessed work, which is how a
            coordinator that stalled can be distinguished from one that considered and declined.
          </p>
        </section>

        <section id="dedup">
          <h2><span className="anchor">#</span>Deduplication</h2>
          <p>
            The mailbox keys on <code className="inline">messageId</code>. Sending the same id twice does not
            produce two deliveries.
          </p>
          <p>
            This matters whenever a sender retries delivery with the same id. A normal second send without
            that id is a new message and is not deduplicated.
          </p>
          <p>
            Deduplication is not merely "ignore the second one". Messages are compared for deep equality, so
            a repeat with the same id but a <em>different</em> payload is a genuine conflict rather than a
            duplicate, and is not silently collapsed. An id is a promise that the content is the same.
          </p>
        </section>

        <section id="permission">
          <h2><span className="anchor">#</span>The permission handshake</h2>
          <p>
            This is the most important flow in the system, because it is where a worker with narrow
            privileges asks for something it does not have.
          </p>
          <CodeBlock lang="text">{`worker                                     coordinator
  │
  │  needs shell: "bun test"
  │  permission rules say ask
  │
  ├── processing stops at this call; later calls do not run
  ├── task → blocked
  ├── blocked state appears in /tasks
  ├── permission message ────────────────────►  coordinator mailbox
  │      envelope messageId + { tool, args, reason }
  │                                              you decide
  │  ◄──────────────────────────────────────  /task <id> message allow shell
  │      grant bound to requestId + tool + args
  │
  ├── grant acknowledged, verified against sender
  └── /task <id> resume  →  same handle continues`}</CodeBlock>
          <p>
            Four properties make this safe:
          </p>
          <p>
            <b>An ask stops processing at that call.</b> The asking call and every later call in the same
            batch do not run. Calls earlier in the batch may already have completed because worker tool calls
            are evaluated sequentially; there is no whole-batch preflight.
          </p>
          <p>
            <b>Ask is never allow.</b> There is no timeout that converts an unanswered request into approval,
            and no default that lets an unattended worker proceed.
          </p>
          <p>
            <b>Grants are bound.</b> A grant references the exact request id, tool <em>and</em> arguments.
            Approving <code className="inline">bun test</code> does not approve the next{" "}
            <code className="inline">shell</code> call, however similar.
          </p>
          <p>
            <b>Grants cannot be forged.</b> They are structured messages with a checked sender. No amount of
            text a worker generates can create or broaden a grant, because grants are not parsed from text at
            all.
          </p>
          <Note>
            High-risk worker calls sit outside this flow: the worker executor blocks them as tool results.
            A mailbox <code className="inline">allow</code> resolves only the matching declarative permission
            request; it cannot authorize a risk block.
          </Note>
        </section>

        <section id="sending">
          <h2><span className="anchor">#</span>Sending from the coordinator</h2>
          <CodeBlock lang="bash">{`/task <id> message allow shell        # grant the pending request
/task <id> message deny shell         # refuse it
/task <id> message use the v2 API     # free-text answer to a question
/task <id> resume                     # continue the same handle`}</CodeBlock>
          <p>
            <code className="inline">allow</code> and <code className="inline">deny</code> are recognized forms
            that produce structured permission grants. Anything else is delivered as a{" "}
            <code className="inline">question</code> answer — content the worker reads as data.
          </p>
          <p>
            Resume continues the <b>same handle and workspace</b>, but it queues a new attempt and increments
            the attempt count. The pending grant is consumed only after its request id, tool, exact arguments,
            task, and sender all match.
          </p>
        </section>

        <section id="notes">
          <h2><span className="anchor">#</span>Background answers as @agent notes</h2>
          <p>
            Background dispatch through <code className="inline">ask_agent</code> uses the same substrate but a
            different surface. It returns a handle immediately, and when the worker answers, the response is
            injected into your <b>next foreground turn</b> as an <code className="inline">@agent</code> note.
          </p>
          <p>
            Those notes are explicitly <b>informational context, never new tasks</b>. A background worker
            cannot enqueue work into your session by answering a question — it can only tell you something.
          </p>
          <p>
            See <a href="/docs/subagents">Sub-agents</a> for the dispatch side.
          </p>
        </section>

        <section id="security">
          <h2><span className="anchor">#</span>Why messages are not instructions</h2>
          <p>
            Everything above rests on one boundary: <b>a message is data the recipient reads, not an
            instruction it obeys.</b>
          </p>
          <p>
            The same rule governs <a href="/docs/agent-teams#context">fork context</a>, where prior results
            arrive as labeled untrusted JSON in a user message rather than as system instructions, and{" "}
            <a href="/docs/moa">MoA synthesis</a>, where candidate outputs are handed to the synthesizer as
            labeled data separate from its instruction.
          </p>
          <p>
            The threat is concrete. If a worker's output became instructions for the next agent, a single
            confused or compromised worker could rewrite the behavior of everything downstream of it —
            prompt injection with the whole orchestrator as the blast radius. Keeping every inter-agent
            channel in the data plane means the worst a bad message can do is be wrong.
          </p>
        </section>

        <section id="patterns">
          <h2><span className="anchor">#</span>Coordination patterns</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "32%" }}>Pattern</th><th>Why</th></tr>
              </thead>
              <tbody>
                {PATTERNS.map(([p, w]) => (
                  <tr key={p}>
                    <td><b style={{ color: "var(--text-strong)" }}>{p}</b></td>
                    <td>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The first is the one that changes outcomes. A worker that guesses when it should have asked
            produces work that looks complete and is subtly wrong — the most expensive failure mode there
            is, because it survives review. Blocking on a question costs you one message.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
