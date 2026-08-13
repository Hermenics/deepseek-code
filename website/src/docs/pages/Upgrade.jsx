import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "check", label: "Automatic update checks" },
  { id: "update", label: "Update now" },
  { id: "dual", label: "Dual installations" },
  { id: "pin", label: "Pin a version" },
  { id: "uninstall", label: "Uninstall" },
  { id: "data", label: "Keep or remove data" },
  { id: "troubleshoot", label: "Troubleshoot updates" },
];

export default function Upgrade() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb"><span>Docs</span><span className="sep">/</span><span>Get Started</span><span className="sep">/</span><span className="current">Update & uninstall</span></nav>
        <div className="hero"><h1>Update & uninstall</h1><p className="tagline">How version checks work, how package managers are detected, and which local data survives removal.</p></div>

        <section id="check"><h2><span className="anchor">#</span>Automatic update checks</h2>
          <p>
            Interactive startup checks the npm registry for the latest published version. Successful checks
            are cached for one hour. Network or registry failures are silent and use a shorter ten-minute
            retry window, so an unavailable registry never prevents the CLI from starting.
          </p>
          <p>
            When a newer version exists, the startup prompt offers update, skip and dismiss. Skip defers the
            decision; dismiss records that exact version and hides it on later launches. A future version can
            still be offered.
          </p>
          <Note>Update checks contact the public npm registry. They do not send project files or conversation content.</Note>
        </section>

        <section id="update"><h2><span className="anchor">#</span>Update now</h2>
          <CodeBlock lang="bash">{"deepseek update"}</CodeBlock>
          <p>
            The command fetches the latest package metadata, compares it with the running version, updates
            the detected global installation and asks you to restart. You can also use the package manager directly:
          </p>
          <CodeBlock lang="bash">{"bun add -g @hermenics/deepseek-code@latest\n# or\nnpm install -g @hermenics/deepseek-code@latest"}</CodeBlock>
          <CodeBlock lang="bash">{"deepseek --version"}</CodeBlock>
        </section>

        <section id="dual"><h2><span className="anchor">#</span>Dual installations</h2>
          <p>
            DeepSeek Code checks both Bun's global package directory and npm's global root. If the package is
            installed through both, the built-in updater warns and updates both in parallel. This avoids the
            confusing state where one shell resolves an old binary while another resolves the new one.
          </p>
          <CodeBlock lang="bash">{"type -a deepseek\nbun pm ls -g | grep deepseek\nnpm ls -g @hermenics/deepseek-code --depth=0"}</CodeBlock>
          <p>If several binaries remain, inspect PATH order and uninstall the package manager you do not intend to use.</p>
        </section>

        <section id="pin"><h2><span className="anchor">#</span>Pin or roll back a version</h2>
          <CodeBlock lang="bash">{"bun add -g @hermenics/deepseek-code@0.6.9\n# or\nnpm install -g @hermenics/deepseek-code@0.6.9"}</CodeBlock>
          <p>
            A manual version install is the rollback mechanism. Local settings and sessions are not tied to
            the package directory, but an older release may not understand state created by a newer schema.
            Back up <code className="inline">~/.deepseek</code> before a significant downgrade.
          </p>
        </section>

        <section id="uninstall"><h2><span className="anchor">#</span>Uninstall the CLI</h2>
          <CodeBlock lang="bash">{"bun remove -g @hermenics/deepseek-code\n# or\nnpm uninstall -g @hermenics/deepseek-code"}</CodeBlock>
          <p>
            Removing the package removes the executable and bundled application, not your configuration,
            sessions, memory, checkpoints, installed skills or plugins.
          </p>
        </section>

        <section id="data"><h2><span className="anchor">#</span>Keep or remove local data</h2>
          <div className="doc-table-wrap"><table className="doc-table"><thead><tr><th>Path</th><th>Contents</th><th>Uninstall behavior</th></tr></thead><tbody>
            <tr><td><code className="inline">~/.deepseek/</code></td><td>Credentials, settings, sessions, memory, logs and feature state.</td><td>Preserved.</td></tr>
            <tr><td><code className="inline">~/.deepseek-code/</code></td><td>Installed plugins and file checkpoints.</td><td>Preserved.</td></tr>
            <tr><td><code className="inline">.deepseek/</code></td><td>Project settings, MCP config, steering, agents, workflows and worktrees.</td><td>Preserved with the project.</td></tr>
          </tbody></table></div>
          <p>
            Run <code className="inline">deepseek logout</code> before uninstalling if the goal is only to
            remove stored credentials. Delete broader state manually only after reviewing and backing up the
            exact directories; project-local files may be committed team configuration.
          </p>
        </section>

        <section id="troubleshoot"><h2><span className="anchor">#</span>Troubleshoot updates</h2>
          <p>
            “Permission denied” normally means the global package root is owned by another user. Fix the
            package-manager installation rather than running DeepSeek Code itself as root. A registry timeout
            leaves the current version untouched. If an update reports success but the version is unchanged,
            use <code className="inline">type -a deepseek</code> to find the binary your shell actually runs.
          </p>
          <CodeBlock lang="bash">{"deepseek doctor\ndeepseek --version\ncommand -v deepseek"}</CodeBlock>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
