import { CodeBlock, Note, Toc } from "../Layout";
import { DEFAULT_MODEL, LegacyAliasList, ModelTable, PricingSourceNote, PricingTable } from "../deepseekModels";

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
            The table lists the models on DeepSeek&apos;s official pricing page, synced daily. The built-in default is{" "}
            <code className="inline">{DEFAULT_MODEL}</code>; a model selected in <code className="inline">model.default</code>
            overrides it on startup. Sub-agents and the prompt refiner may each use separate model settings
            without changing the main session model.
          </p>
          <ModelTable />
          <p>
            The listed models support JSON output, tool calls, the Responses API, the Anthropic API and Chat Prefix
            Completion (beta). FIM Completion (beta) works only in non-thinking mode. Only models with vision accept the
            images DeepSeek Code sends when you paste or drop one into the prompt.
          </p>
          <p>
            The API <code className="inline">/models</code> endpoint is the source of truth for the models
            currently available to your account. The retired names <LegacyAliasList /> are still accepted, but move
            configuration to the IDs above.
          </p>
        </section>

        <section id="pricing"><h2><span className="anchor">#</span>Pricing</h2>
          <PricingTable />
          <PricingSourceNote />
          <p>
            The CLI&apos;s <code className="inline">/cost</code> prices each response at the peak or off-peak rate in
            effect when it arrives, so it follows the same schedule. It is still a local estimate, not an invoice.
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
            Listed models use their published context window in local calculations. Unknown or custom
            model ids fall back to 128,000 tokens so auto-compaction triggers conservatively.
          </p>
          <p>
            The listed API models support thinking and non-thinking modes. For the API,
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
