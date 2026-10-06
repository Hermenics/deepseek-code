import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "enable", label: "Enable the browser" },
  { id: "server", label: "Run a local dev server" },
  { id: "actions", label: "Browser actions" },
  { id: "control", label: "Watch and take over" },
  { id: "safety", label: "Approvals and safety" },
  { id: "limits", label: "Limits" },
];

const ACTIONS = [
  ["Inspect", "snapshot, find, screenshot, logs, network, tabs", "Read page structure, browser console output, network activity and open tabs; screenshots require a vision-capable model."],
  ["Navigate", "navigate, back, forward, reload", "Move between pages after origin approval."],
  ["Interact", "click, hover, type, select, check, press, scroll, wait", "Use native browser input and wait for page changes."],
  ["Verify", "expect, batch", "Check a page condition or run up to 25 ordered actions in one call."],
  ["Hand off", "handoff, dialog, emulate, upload", "Ask you to take over, handle dialogs, emulate a device or color scheme, and upload an approved workspace file."],
  ["Export", "export", "Produce Playwright test code from browser actions recorded in the current session."],
];

export default function BrowserAutomation() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Tools</span><span className="sep">/</span><span className="current">Browser automation</span>
        </nav>

        <div className="hero">
          <h1>Browser automation</h1>
          <p className="tagline">
            Let the agent inspect and exercise interactive web pages in an isolated Chromium-family browser,
            with approval gates for navigation and actions.
          </p>
        </div>

        <section id="enable">
          <h2><span className="anchor">#</span>Enable the browser</h2>
          <p>
            Browser access is off by default. In a session, run <code className="inline">/features browser on</code>;
            this saves the choice for your user account and applies it across projects. You also need an installed
            Chrome, Chromium, Edge or Brave browser. Windows is not supported yet.
          </p>
          <p>
            The <code className="inline">browser</code> tool is for interactive pages and UI checks. For a simple
            text fetch, use <a href="/docs/web-fetch">web_fetch</a>; it does not render JavaScript or operate controls.
          </p>
          <Note>
            An ordinary interactive session uses a separate temporary profile and a minimal environment. It does
            not use your everyday browser profile or its saved cookies, and the temporary profile is removed when
            the browser closes. Persistent Pods use a separate Codimium profile; see
            <a href="/docs/pods#browser">Pods browser state</a>.
          </Note>
        </section>

        <section id="server">
          <h2><span className="anchor">#</span>Run a local dev server</h2>
          <p>
            The <code className="inline">dev_server</code> tool starts a project server from
            <code className="inline">.deepseek/launch.json</code> or
            <code className="inline">.claude/launch.json</code>. If neither file exists, add a configuration like
            this to the project:
          </p>
          <CodeBlock lang="json">{`{
  "configurations": [
    {
      "name": "web",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 3000
    }
  ]
}`}</CodeBlock>
          <p>
            The agent can then call <code className="inline">dev_server</code> with
            <code className="inline">start</code>, <code className="inline">list</code>,
            <code className="inline">logs</code> or <code className="inline">stop</code>. Starting a server
            asks for your approval, and editing its configuration requires approval again. The tool waits for the
            configured port to accept connections and reports the local URL.
          </p>
          <p>
            The server process uses a minimal base environment plus values explicitly listed in the configuration;
            project environment variables are not inherited. Servers stop when their owning session ends or changes
            project.
          </p>
        </section>

        <section id="actions">
          <h2><span className="anchor">#</span>Browser actions</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead><tr><th style={{ width: "18%" }}>Purpose</th><th style={{ width: "32%" }}>Actions</th><th>What they do</th></tr></thead>
              <tbody>{ACTIONS.map(([purpose, actions, description]) => (
                <tr key={purpose}><td><b>{purpose}</b></td><td><code className="inline">{actions}</code></td><td>{description}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p>
            Browser snapshots expose accessible page structure and references the agent can use in later actions.
            Batched actions run in order and stop on the first failure by default. An exported Playwright test is
            returned as code for you to save and run; it is not written to your project automatically.
          </p>
        </section>

        <section id="control">
          <h2><span className="anchor">#</span>Watch and take over</h2>
          <p>
            Run <code className="inline">/browser</code> or <code className="inline">/browser status</code> to see
            whether the browser is running, which tabs are open and which origins are approved. Use
            <code className="inline">/browser show</code> to open its window, <code className="inline">/browser hide</code>
            to hide it, or <code className="inline">/browser close</code> to end the browser session. The status bar
            shows the active site while tabs are open.
          </p>
          <p>
            When a flow needs your input, the agent can hand control to you. Finish the step in the visible browser
            and choose <b>Done</b>; the agent then resumes from the page you left open. This is useful for a login
            or another step that should stay under your control.
          </p>
        </section>

        <section id="safety">
          <h2><span className="anchor">#</span>Approvals and safe handling</h2>
          <ul className="capabilities">
            <li><b>Origins:</b> navigating to a site requires approval. Public-page interaction has a separate approval, and sending text to a public page asks each time.</li>
            <li><b>Restricted targets:</b> sensitive fields and private-network destinations are blocked; local loopback dev servers are supported. Redirects and popups cannot bypass the origin check.</li>
            <li><b>Page content:</b> text read from a page is treated as untrusted input and cannot grant the page authority over your request.</li>
            <li><b>Files:</b> uploads are limited to workspace files. Downloads stay outside the project in a private temporary folder, are capped at 50 MB, and are deleted when the browser closes; reading one requires your approval.</li>
          </ul>
          <Note>
            Review each approval prompt in context. Approving a site to navigate does not automatically approve
            clicking controls or entering text on that site.
          </Note>
        </section>

        <section id="limits">
          <h2><span className="anchor">#</span>Limits</h2>
          <p>
            The browser and dev-server tools are available to the main agent; delegated sub-agents cannot use them.
            The browser needs a supported local browser installation and a display only when you ask to show its
            window. A normal agent run may keep it headless.
          </p>
          <p>
            See <a href="/docs/features">Feature flags</a>, <a href="/docs/tools#browser">Tools</a>, and
            <a href="/docs/permissions">Permissions</a> for the gate, tool inventory and approval model.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
