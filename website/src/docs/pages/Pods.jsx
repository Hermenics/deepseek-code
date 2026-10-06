import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "model", label: "What a Pod is" },
  { id: "quickstart", label: "Create and run one" },
  { id: "manage", label: "Manage runs and state" },
  { id: "routines", label: "Schedule routines" },
  { id: "panel", label: "Web panel and event delivery" },
  { id: "host", label: "Deploy to a host" },
  { id: "browser", label: "Browser state" },
  { id: "data", label: "Storage and recovery" },
];

const OPERATIONS = [
  ["Queue work", "pods send POD MESSAGE; pods steer RUN MESSAGE", "Send a new request or add direction to a running one."],
  ["Inspect", "pods show POD; pods events POD; pods history POD QUERY", "Read the conversation, ordered events or matching past runs."],
  ["Control a run", "pods cancel RUN; pods retry RUN", "Stop or retry work. A failed run must be reconciled before retry unless --reconciled is used."],
  ["Keep context", "pods remember POD TEXT; pods notes POD", "Save source-attributed notes for later runs, with optional expiration."],
  ["Coordinate", "pods groups; pods group create|send|artifacts", "Send work to a group and inspect its messages and artifacts."],
];

export default function Pods() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Agents & orchestration</span><span className="sep">/</span><span className="current">Pods</span>
        </nav>

        <div className="hero">
          <h1>Persistent Pods</h1>
          <p className="tagline">
            Run named agents as durable workers. Pods keep their queue, conversations, notes and routines
            between CLI sessions, with a supervisor that starts and recovers worker processes.
          </p>
        </div>

        <section id="model">
          <h2><span className="anchor">#</span>What a Pod is</h2>
          <p>
            A Pod has a name, project directory and instructions. Sending it a message creates queued work;
            <code className="inline">deepseek pods serve</code> runs the supervisor that dispatches that queue,
            starts workers, recovers interrupted work and dispatches due routines. The default concurrency is
            two workers; set <code className="inline">--concurrency</code> from 1 to 16 to change it.
          </p>
          <p>
            Pods use the provider configuration available to the service process. Configure and test a provider
            before starting the supervisor. For a remote host, the built-in host installer currently requires a
            saved DeepSeek API profile.
          </p>
          <Note>
            Pods are separate from interactive saved sessions and from sub-agents. A Pod service must be running
            to execute queued work and schedules; a one-off <code className="inline">deepseek pods</code> command
            can still inspect and manage the saved state while the service is stopped.
          </Note>
        </section>

        <section id="quickstart">
          <h2><span className="anchor">#</span>Create and run one</h2>
          <CodeBlock lang="bash">{`# Create a named agent for this project
deepseek pods create release-watch \\
  --project "$PWD" \\
  --instructions "Review release changes and report risks. Ask before changing files."

# Queue a request, then start the worker service
deepseek pods send release-watch "Summarize the current release risks."
deepseek pods serve --concurrency 2

# In another terminal, inspect the Pod and its run history
deepseek pods show release-watch
deepseek pods list`}</CodeBlock>
          <p>
            <code className="inline">create</code> also accepts an optional configured agent name with
            <code className="inline">--agent</code>, and <code className="inline">--reviewer-model</code> sets a
            completion-review model. Use <code className="inline">deepseek pods help</code> for every command and
            option. All commands accept <code className="inline">--db PATH</code> to use a different database.
          </p>
          <p>
            Keep <code className="inline">serve</code> in the foreground while experimenting. To keep queued
            work running after logout or reboot, run it under a process supervisor such as systemd. The host
            installation command sets up a persistent user service for you.
          </p>
        </section>

        <section id="manage">
          <h2><span className="anchor">#</span>Manage runs and state</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "22%" }}>Task</th><th style={{ width: "43%" }}>Commands</th><th>Use</th></tr></thead>
              <tbody>{OPERATIONS.map(([task, commands, use]) => (
                <tr key={task}><td><b>{task}</b></td><td><code className="inline">{commands}</code></td><td>{use}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p>
            Runs and important decisions are recorded as events. If a run needs permission or an answer, use the
            web panel or <code className="inline">pods answer</code>. Before retrying a run that may already have
            produced an external effect, reconcile what happened with
            <code className="inline">pods reconcile RUN --evidence TEXT</code>. A run&apos;s cancellation does not
            disable its routine.
          </p>
          <p>
            A Pod can also keep source-attributed notes, learn a reusable procedure from a completed run, and
            attach a procedure to a routine. Use <code className="inline">pods notes</code>,
            <code className="inline">pods procedures</code> and <code className="inline">pods help</code> to inspect
            those operations.
          </p>
        </section>

        <section id="routines">
          <h2><span className="anchor">#</span>Schedule routines</h2>
          <p>
            Routines use explicit schedule data; their timing is not inferred from prompt wording. This example
            runs on weekdays at 9:00 in São Paulo time:
          </p>
          <CodeBlock lang="bash">{`deepseek pods routine release-watch \\
  --name weekday-review \\
  --prompt "Review newly merged changes and summarize release risks." \\
  --schedule '{"kind":"daily","hour":9,"minute":0,"timeZone":"America/Sao_Paulo","weekdays":[1,2,3,4,5]}'

deepseek pods routines release-watch
deepseek pods test-routine release-watch ROUTINE_ID`}</CodeBlock>
          <p>
            Daily schedules require an IANA time-zone name; weekday numbers use 0 for Sunday through 6 for
            Saturday. Routines can also run at a fixed interval or in response to an event topic. Use
            <code className="inline">pods test-routine</code> for a bounded read-only preview before enabling
            consequential work.
          </p>
        </section>

        <section id="panel">
          <h2><span className="anchor">#</span>Web panel and event delivery</h2>
          <p>
            The optional panel lets you inspect conversations and runs, respond to decisions, and control Pods
            from a browser. Set a private random token of at least 32 characters before enabling it:
          </p>
          <CodeBlock lang="bash">{`export DEEPSEEK_BOTS_TOKEN='replace-with-a-private-random-token-of-32-or-more-characters'
deepseek pods serve --web --host 127.0.0.1 --port 8787`}</CodeBlock>
          <p>
            The default listener is loopback-only. For remote access, put it behind an HTTPS reverse proxy and
            pass its origin with <code className="inline">--public-url</code>; do not expose the panel over plain
            HTTP. The panel token is an administrative credential. See
            <a href="/docs/env-vars#pods">DEEPSEEK_BOTS_TOKEN</a>.
          </p>
          <p>
            Pods can send run-completion and failure events to HTTPS webhook receivers. Delivery requests are
            signed with Ed25519; verify the signature at the receiver before trusting the payload. The CLI can
            add, disable, retry and inspect delivery targets.
          </p>
          <p>
            Groups coordinate several Pods and collect their artifacts. Browser sharing is disabled unless you
            explicitly create a group with <code className="inline">--share-browser</code>.
          </p>
        </section>

        <section id="host">
          <h2><span className="anchor">#</span>Deploy to a host</h2>
          <CodeBlock lang="bash">{`deepseek pods host install USER@HOST`}</CodeBlock>
          <p>
            The installer connects over SSH to an existing Debian or Ubuntu host with systemd. It asks before
            making remote changes, installs the runtime and latest published package, configures a persistent
            user service, and sends the selected local DeepSeek API profile through SSH. It does not provision a
            cloud machine, copy your local Pods database or open a public panel port. The remote host starts with
            its own database and a loopback-only panel.
          </p>
          <p>
            Use a regular SSH user, not root. Missing system packages may require passwordless sudo. The command
            prints an SSH tunnel and a one-time panel token after installation; keep the tunnel open while using
            the remote panel. The API profile is stored on the host with owner-only permissions.
          </p>
        </section>

        <section id="browser">
          <h2><span className="anchor">#</span>Browser state</h2>
          <p>
            Each Pod has a private Codimium browser profile for site cookies and session state. The profile is stored
            with that Pod&apos;s actor data and is excluded from <code className="inline">pods export</code>. After a cold
            start, previously open page URLs are only hints; visiting them still requires fresh origin approval.
          </p>
          <p>
            Pods in a group keep separate browser profiles by default. To share one profile and its cookies across the
            group, create it explicitly with <code className="inline">deepseek pods group create NAME --members ID,ID --share-browser</code>.
            Treat a shared profile as shared access to the same signed-in websites.
          </p>
        </section>

        <section id="data">
          <h2><span className="anchor">#</span>Storage and recovery</h2>
          <p>
            The default local database is <code className="inline">~/.deepseek/bots/state.db</code>. It contains
            Pod instructions, conversations, run state, decisions, notes and event history. The database and its
            adjacent actor data are private runtime state; back them up only to a location you trust.
          </p>
          <p>
            The database and actor directories use owner-only permissions. Export one Pod with
            <code className="inline">pods export POD</code> before sharing data; the export is still project and
            conversation content, so review it first. Change retention with
            <code className="inline">pods retention POD</code> and use
            <code className="inline">pods delete POD --confirm NAME_OR_ID</code> when removing a Pod.
          </p>
          <Note>
            The default database path and every runtime operation can be inspected with
            <code className="inline">deepseek pods help</code>. See
            <a href="/docs/deepseek-directory#home">DeepSeek directories</a> for other persistent local data.
          </Note>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
