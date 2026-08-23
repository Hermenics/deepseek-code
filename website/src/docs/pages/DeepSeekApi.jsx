import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "setup", label: "Setup" },
  { id: "models", label: "API models" },
  { id: "pricing", label: "Pricing" },
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
          <p>
            Interactive setup checks the key against <code className="inline">GET https://api.deepseek.com/models</code>
            before saving it. Invalid credentials are rejected; if the official endpoint is unreachable, setup offers a
            custom base URL instead. Use <code className="inline">/config</code> to test a saved connection and{" "}
            <code className="inline">/model</code> to switch models.
          </p>
        </section>

        <section id="models"><h2><span className="anchor">#</span>API models</h2>
          <p>
            The current DeepSeek API exposes three first-class model ids:
            <code className="inline">deepseek-v4-flash</code>, <code className="inline">deepseek-v4-pro</code>
            and <code className="inline">deepseek-v4-flash-vision-exp</code>.
            The built-in default is Flash; a model selected in <code className="inline">model.default</code>
            overrides it on startup. Sub-agents and the prompt refiner may each use separate model settings
            without changing the main session model.
          </p>
          <div className="doc-table-wrap doc-table-wrap--stacked"><table className="doc-table doc-table--stacked"><thead><tr><th>Model ID</th><th>API version</th><th>Context</th><th>Max output</th><th>FIM</th><th>Concurrency</th></tr></thead><tbody>
            <tr><td data-label="Model ID"><code className="inline">deepseek-v4-flash</code></td><td data-label="API version"><code className="inline">DeepSeek-V4-Flash-0731</code></td><td data-label="Context"><code className="inline">1M</code></td><td data-label="Max output"><code className="inline">384K</code></td><td data-label="FIM">Non-thinking only</td><td data-label="Concurrency"><code className="inline">2500</code></td></tr>
            <tr><td data-label="Model ID"><code className="inline">deepseek-v4-pro</code></td><td data-label="API version"><code className="inline">DeepSeek-V4-Pro-0813</code></td><td data-label="Context"><code className="inline">1M</code></td><td data-label="Max output"><code className="inline">384K</code></td><td data-label="FIM">Non-thinking only</td><td data-label="Concurrency"><code className="inline">500</code></td></tr>
            <tr><td data-label="Model ID"><code className="inline">deepseek-v4-flash-vision-exp</code></td><td data-label="API version"><code className="inline">DeepSeek-V4-Flash-Vision-Exp</code></td><td data-label="Context"><code className="inline">1M</code></td><td data-label="Max output"><code className="inline">384K</code></td><td data-label="FIM">Not supported</td><td data-label="Concurrency"><code className="inline">2500</code></td></tr>
          </tbody></table></div>
          <p>
            All three models support JSON output, tool calls, the Responses API, the Anthropic API and Chat
            Prefix Completion (beta). FIM Completion (beta) is available only in non-thinking mode for Flash
            and Pro; the Vision experimental model does not support FIM.
          </p>
          <p>
            The API <code className="inline">/models</code> endpoint is the source of truth for the models
            currently available to your account. The legacy names <code className="inline">deepseek-chat</code>
            and <code className="inline">deepseek-reasoner</code> alias non-thinking Flash and thinking Flash,
            respectively, and should not be used for new configuration.
          </p>
        </section>

        <section id="pricing"><h2><span className="anchor">#</span>Pricing</h2>
          <p>USD per one million tokens. DeepSeek now publishes separate off-peak and peak rates for cache hits, cache misses and output.</p>
          <div className="doc-table-wrap doc-table-wrap--stacked"><table className="doc-table doc-table--stacked"><thead><tr><th>Model</th><th>Cache hit<br />off-peak / peak</th><th>Cache miss<br />off-peak / peak</th><th>Output<br />off-peak / peak</th></tr></thead><tbody>
            <tr><td data-label="Model"><code className="inline">deepseek-v4-flash</code></td><td data-label="Cache hit"><code className="inline">$0.007 / $0.014</code></td><td data-label="Cache miss"><code className="inline">$0.22 / $0.44</code></td><td data-label="Output"><code className="inline">$0.66 / $1.32</code></td></tr>
            <tr><td data-label="Model"><code className="inline">deepseek-v4-pro</code></td><td data-label="Cache hit"><code className="inline">$0.022 / $0.044</code></td><td data-label="Cache miss"><code className="inline">$0.66 / $1.32</code></td><td data-label="Output"><code className="inline">$1.98 / $3.96</code></td></tr>
            <tr><td data-label="Model"><code className="inline">deepseek-v4-flash-vision-exp</code></td><td data-label="Cache hit"><code className="inline">$0.007 / $0.014</code></td><td data-label="Cache miss"><code className="inline">$0.22 / $0.44</code></td><td data-label="Output"><code className="inline">$0.66 / $1.32</code></td></tr>
          </tbody></table></div>
          <p>
            Prices can change, and the provider determines the peak/off-peak schedule. Check the{" "}
            <a href="https://api-docs.deepseek.com/quick_start/pricing/" target="_blank" rel="noreferrer">official DeepSeek pricing page</a>
            {" "}before budgeting or topping up. The CLI&apos;s <code className="inline">/cost</code> is a local
            estimate and does not currently model peak/off-peak billing, so it is not an invoice.
          </p>
        </section>

        <section id="endpoint"><h2><span className="anchor">#</span>Custom endpoint</h2>
          <p>
            DeepSeek Code speaks the OpenAI-compatible chat-completions and model-listing interfaces used by
            the DeepSeek service. Set a base URL when traffic must pass through a compatible gateway.
          </p>
          <CodeBlock lang="text">{"OpenAI-compatible base URL: https://api.deepseek.com\nAnthropic-compatible base URL: https://api.deepseek.com/anthropic\nModels endpoint: GET https://api.deepseek.com/models"}</CodeBlock>
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
          <p>
            All three API models support thinking and non-thinking modes. For the API,
            <code className="inline">reasoning_effort</code> accepts <code className="inline">high</code> and
            <code className="inline">max</code>; lower values are normalized by the API, while
            <code className="inline">thinking: {"{ type: 'disabled' }"}</code> explicitly turns thinking off.
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
