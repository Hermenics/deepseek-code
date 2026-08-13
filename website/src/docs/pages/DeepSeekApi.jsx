import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "setup", label: "Setup" },
  { id: "models", label: "Models" },
  { id: "endpoint", label: "Custom endpoint" },
  { id: "discovery", label: "Model discovery" },
  { id: "usage", label: "Usage & context" },
  { id: "errors", label: "Common errors" },
  { id: "security", label: "Security" },
];

export default function DeepSeekApi() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb"><span>Docs</span><span className="sep">/</span><span>Providers</span><span className="sep">/</span><span className="current">DeepSeek API</span></nav>
        <div className="hero"><h1>DeepSeek API</h1><p className="tagline">The native provider: API-key setup, model selection, compatible gateways, usage accounting and diagnostics.</p></div>

        <section id="setup"><h2><span className="anchor">#</span>Setup</h2>
          <p>
            Choose <b>DeepSeek API</b> during first run and paste an API key, or supply it through the
            environment for an ephemeral session. The interactive setup saves the key in
            <code className="inline">~/.deepseek/config.json</code> with owner-only file permissions.
          </p>
          <CodeBlock lang="bash">{"export DEEPSEEK_API_KEY=\"sk-…\"\ndeepseek"}</CodeBlock>
          <p>Use <code className="inline">/config</code> to test the connection and <code className="inline">/model</code> to switch models.</p>
        </section>

        <section id="models"><h2><span className="anchor">#</span>Models</h2>
          <p>
            The built-in default is <code className="inline">deepseek-v4-flash</code>. A model selected in
            <code className="inline">model.default</code> overrides it on startup. Sub-agents and the prompt
            refiner may each use separate model settings without changing the main session model.
          </p>
          <div className="doc-table-wrap"><table className="doc-table"><thead><tr><th>Setting</th><th>Purpose</th></tr></thead><tbody>
            <tr><td><code className="inline">model.default</code></td><td>Main interactive and headless agent.</td></tr>
            <tr><td><code className="inline">model.subagent</code></td><td>Compatibility field for delegated work.</td></tr>
            <tr><td><code className="inline">agents.subagentModel</code></td><td>Default model used by the orchestrator.</td></tr>
            <tr><td><code className="inline">promptRefiner.model</code></td><td>Optional model for prompt refinement.</td></tr>
          </tbody></table></div>
        </section>

        <section id="endpoint"><h2><span className="anchor">#</span>Custom endpoint</h2>
          <p>
            DeepSeek Code speaks the OpenAI-compatible chat-completions and model-listing interfaces used by
            the DeepSeek service. Set a base URL when traffic must pass through a compatible gateway.
          </p>
          <CodeBlock lang="json">{"{\n  \"provider\": {\n    \"name\": \"deepseek\",\n    \"endpoint\": \"https://gateway.example.com/v1\",\n    \"timeoutMs\": 30000\n  }\n}"}</CodeBlock>
          <p>
            The settings endpoint wins over <code className="inline">DEEPSEEK_BASE_URL</code>. A custom
            gateway must preserve streaming, tool calls and usage fields for the full experience.
          </p>
          <Note>A gateway becomes part of your trust boundary. Review how it stores prompts, source content, tool schemas and credentials.</Note>
        </section>

        <section id="discovery"><h2><span className="anchor">#</span>Model discovery</h2>
          <p>
            The model picker requests the provider's model list with a ten-second deadline. If discovery
            fails, the session can still use an explicitly configured model. In Settings, <b>Test connection</b>
            fetches the list and makes it available to model-valued fields.
          </p>
          <p>
            Model descriptions for known suffixes such as <code className="inline">-flash</code> and
            <code className="inline">-pro</code> are formatted locally. Unknown descriptions may be cached in
            the credentials file for later display.
          </p>
        </section>

        <section id="usage"><h2><span className="anchor">#</span>Usage and context</h2>
          <p>
            Provider usage is accumulated per session as prompt, cached-input and completion tokens.
            <code className="inline">/cost</code> estimates spend using the CLI's pricing table;
            <code className="inline">/context</code> estimates how the current request is composed. Treat both
            as local estimates and use provider billing as the source of truth.
          </p>
          <p>
            Known V4 models use a one-million-token context limit in local calculations. Unknown or custom
            model ids fall back to 128,000 tokens so auto-compaction triggers conservatively.
          </p>
        </section>

        <section id="errors"><h2><span className="anchor">#</span>Common errors</h2>
          <div className="doc-table-wrap"><table className="doc-table"><thead><tr><th>Symptom</th><th>Check</th></tr></thead><tbody>
            <tr><td>401 or invalid key</td><td>Replace the stored key or environment variable; then restart.</td></tr>
            <tr><td>404 from a gateway</td><td>Confirm its base path and chat-completions compatibility.</td></tr>
            <tr><td>Model list fails, chat works</td><td>The gateway may not expose the models endpoint; configure the model explicitly.</td></tr>
            <tr><td>Streaming stops mid-turn</td><td>Check proxy buffering, provider timeout and the audit log.</td></tr>
          </tbody></table></div>
          <CodeBlock lang="bash">{"deepseek doctor\n# then inside a session\n/config\n/model"}</CodeBlock>
        </section>

        <section id="security"><h2><span className="anchor">#</span>Security</h2>
          <p>
            Never place an API key in project settings, steering, an agent definition or a prompt. Prefer an
            environment secret in CI. <code className="inline">deepseek logout</code> removes the saved
            credentials file but cannot revoke the key at the provider; revoke or rotate it at the provider
            when exposure is possible.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
