import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "purpose", label: "Purpose" },
  { id: "execution", label: "Execution environment" },
  { id: "limits", label: "Timeout and output" },
  { id: "authorization", label: "Authorization" },
  { id: "workers", label: "Worker sandbox" },
  { id: "cancellation", label: "Cancellation and failures" },
  { id: "practices", label: "Reliable command prompts" },
];

export default function ShellCommands() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Tools</span><span className="sep">/</span><span className="current">Shell commands</span>
        </nav>
        <div className="hero">
          <h1>Shell command execution</h1>
          <p className="tagline">Run builds, tests, formatters, and diagnostics with explicit workspace, timeout, permission, and worker-isolation behavior.</p>
        </div>

        <section id="purpose">
          <h2><span className="anchor">#</span>Purpose</h2>
          <p>
            The shell tool executes a command through the system shell in the active workspace. It is the
            general path for project scripts, tests, builds, formatters, and diagnostics that do not have a
            dedicated native tool.
          </p>
          <CodeBlock lang="text">{`Run the focused authentication test first. If it passes, run typecheck.
Report each exact command and exit result; do not install anything.`}</CodeBlock>
          <p>
            Prefer dedicated file, search, LSP, and Git tools for their domains. They expose structured
            inputs, narrower permissions, and clearer failure messages.
          </p>
        </section>

        <section id="execution">
          <h2><span className="anchor">#</span>Execution environment</h2>
          <p>
            Foreground commands run from the agent's current working directory. Entering a worktree or using
            <code className="inline">/cwd</code> changes that directory for later calls. The command is a shell
            string, so quoting, pipes, redirects, glob expansion, and environment substitution follow the
            installed system shell.
          </p>
          <p>
            Do not put secrets directly in command text: commands can appear in the transcript, audit log,
            process listings, and shell diagnostics.
          </p>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Timeout and output</h2>
          <p>
            The runtime default is five minutes. The agent can request a positive custom timeout in seconds
            for a known long-running command. Standard output and standard error are combined for the tool
            result and capped at 50,000 characters. A successful command with no output returns
            <code className="inline">(no output)</code>.
          </p>
          <Note>
            A timeout is a safety bound, not a background-job feature. Use workflows or background tasks for
            work that must remain observable and controllable while the main session continues.
          </Note>
        </section>

        <section id="authorization">
          <h2><span className="anchor">#</span>Authorization</h2>
          <p>
            Shell is unavailable in Review and Plan modes. In Build mode, configured allow/deny rules and
            risk classification apply before execution. High-risk defaults include destructive filesystem
            and Git operations, package installation, privilege escalation, service control, deploy commands,
            and production builds. Auto mode expands tool availability but does not erase destructive-action
            safeguards or the user's authority over external effects.
          </p>
          <p>
            The executor performs an additional destructive-command check. A destructive call must come from
            the coordinator context with confirmation recorded for that exact operation; worker tasks cannot
            self-authorize it.
          </p>
        </section>

        <section id="workers">
          <h2><span className="anchor">#</span>Worker sandbox</h2>
          <p>
            Non-coordinator tasks run shell commands inside a Bubblewrap sandbox when supported. The worker
            sees its workspace at a fixed mount, receives a fresh temporary home and temp directory, has no
            inherited secrets, and has network, process, IPC, and host identity namespaces isolated.
          </p>
          <p>
            Research/test workers receive a read-only workspace. A writer with a real Git worktree receives
            a writable workspace. Serialized-writer fallback deliberately blocks shell writes, because path
            validation cannot constrain arbitrary shell redirection safely without worktree isolation.
          </p>
        </section>

        <section id="cancellation">
          <h2><span className="anchor">#</span>Cancellation and failures</h2>
          <p>
            Ctrl+C or Esc during a foreground turn propagates cancellation to the active command. Timeout,
            non-zero exit, missing executables, and cancellation return an error result containing stderr
            when available plus bounded stdout. The agent must not claim a check passed merely because the
            command produced familiar-looking text; exit status is decisive.
          </p>
        </section>

        <section id="practices">
          <h2><span className="anchor">#</span>Reliable command prompts</h2>
          <p>
            Name the exact scope and escalation order: focused test before full suite, typecheck before build,
            read-only diagnosis before mutation. Tell the agent not to install dependencies or change external
            state unless that is part of the request. For a server or watcher, ask for a bounded readiness
            check or use a managed background task instead of leaving a foreground process open indefinitely.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
