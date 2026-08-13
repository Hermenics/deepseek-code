import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "behavior", label: "Queue behavior" },
  { id: "order", label: "Order and capacity" },
  { id: "immediate", label: "Commands that run immediately" },
  { id: "cancel", label: "Cancel and clear" },
  { id: "display", label: "What the queue displays" },
  { id: "steering", label: "Steering effectively" },
];

export default function PromptQueue() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Prompt queue</span>
        </nav>
        <div className="hero">
          <h1>Queue prompts while the agent works</h1>
          <p className="tagline">Keep typing during a long turn; DeepSeek Code preserves the order and submits each message when the previous turn settles.</p>
        </div>

        <section id="behavior">
          <h2><span className="anchor">#</span>Queue behavior</h2>
          <p>
            The input stays active while the main agent is running. Type a prompt and press Enter: instead
            of interrupting the current tool loop, the text appears beneath the transcript with a queue
            marker. When the turn finishes, the oldest queued message starts automatically.
          </p>
          <CodeBlock lang="text">{`⏎ after the fix, run the focused test
⏎ then explain the compatibility impact
⏎ finally summarize changed files`}</CodeBlock>
          <p>
            A queued message is a full future turn. It can use tools, change files, and respond to the state
            left by every message ahead of it.
          </p>
        </section>

        <section id="order">
          <h2><span className="anchor">#</span>Order and capacity</h2>
          <p>
            Messages run first-in, first-out. The queue holds at most ten entries. When it is full, further
            submissions are not added; wait for one entry to start or cancel the active turn and re-enter
            the important instruction.
          </p>
          <Note>
            The queue is in-memory session UI state. It is not a durable job system and is not restored after
            the process exits.
          </Note>
        </section>

        <section id="immediate">
          <h2><span className="anchor">#</span>Commands that run immediately</h2>
          <p>
            Three command shapes bypass normal queueing while work is active. <code className="inline">/btw
            &lt;question&gt;</code> starts a tool-free side question. <code className="inline">/workflows</code>
            opens the monitor, and workflow pause, resume, or stop controls are dispatched immediately so
            you can manage a running workflow without waiting for it to finish.
          </p>
          <CodeBlock lang="bash">{`/btw what is the current approach?
/workflows
/workflow pause <run-id>
/workflow resume <run-id>
/workflow stop <run-id>`}</CodeBlock>
          <p>
            Other slash commands are queued like ordinary input when the main turn is busy. This avoids
            mutating session state in the middle of an unrelated operation.
          </p>
        </section>

        <section id="cancel">
          <h2><span className="anchor">#</span>Cancel and clear</h2>
          <p>
            Press Ctrl+C or Esc while loading to abort the active agent operation. Aborting also clears the
            entire queued-message list, because later prompts may depend on a turn that did not complete.
            Any running shell process owned by the foreground turn is stopped as part of the same action.
          </p>
          <p>
            There is no per-entry delete or reorder control. If one queued instruction is wrong, cancel,
            then resubmit the messages you still want in the correct order.
          </p>
        </section>

        <section id="display">
          <h2><span className="anchor">#</span>What the queue displays</h2>
          <p>
            The visual preview shows the first 60 characters of each message and adds an ellipsis when the
            text is longer. This is display-only: the complete prompt is retained and submitted. Large paste
            placeholders are expanded back to their original contents before queueing.
          </p>
        </section>

        <section id="steering">
          <h2><span className="anchor">#</span>Steering effectively</h2>
          <p>
            Queue instructions that make sense after the active turn: verification, explanation, follow-up
            edits, or a next independent task. If the running agent must see a correction before its next
            tool call, cancel the turn and submit the correction immediately. Queueing is sequencing, not
            live steering of an in-flight model response.
          </p>
          <p>
            Prefer one coherent message over several fragments. Each queue entry becomes another provider
            round trip and another full-context turn.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
