import { CodeBlock, Note, Toc, Icon } from "../Layout";

const PROVIDERS = [
  { name: "DeepSeek API", badge: "default", auth: "API key from platform.deepseek.com", env: ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"] },
  { name: "Amazon Bedrock", auth: "AWS IAM credentials via ~/.aws/credentials", env: ["AWS_REGION", "AWS_PROFILE"] },
  { name: "Google Vertex AI", auth: "GCP service account JSON key", env: ["GCP_PROJECT", "GCP_LOCATION", "GCP_CREDENTIALS"] },
  { name: "Local (Ollama / LM Studio)", auth: "No auth — point to your local endpoint", env: ["LOCAL_BASE_URL", "LOCAL_MODEL"] },
];

// Default model + transport behavior per provider (src/agent/llmClient.ts)
const DEFAULT_MODELS = [
  { name: "DeepSeek API", model: "deepseek-v4-flash", streaming: "Yes", tools: "Native" },
  { name: "Amazon Bedrock", model: "us.deepseek.r1-v1:0", streaming: "V3.x: yes · R1: no", tools: "V3.x: native · R1: emulated" },
  { name: "Google Vertex AI", model: "deepseek-ai/deepseek-r1", streaming: "No", tools: "Via OpenAI-compatible endpoint" },
  { name: "Local (Ollama / LM Studio)", model: "llama3", streaming: "Yes", tools: "Native (OpenAI-compatible)" },
];

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "table", label: "Providers & auth" },
  { id: "models", label: "Models" },
  { id: "behavior", label: "Behavior by provider" },
  { id: "bedrock", label: "Bedrock specifics" },
  { id: "vertex", label: "Vertex specifics" },
  { id: "switching", label: "Switching providers" },
  { id: "next", label: "Next steps" },
];

export default function Providers() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Providers</span>
        </nav>

        <div className="hero">
          <h1>Providers</h1>
          <p className="tagline">
            Bring your own model — DeepSeek API, Bedrock, Vertex, or a local endpoint.
          </p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>Overview</h2>
          <p>
            DeepSeek Code speaks natively to multiple LLM backends. Pick a provider during setup or in
            <code className="inline">/config</code>; then use <code className="inline">/model</code> to choose
            among that provider&apos;s available models. Each provider has its own authentication flow.
          </p>
        </section>

        <section id="table">
          <h2><span className="anchor">#</span>Providers & auth</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "24%" }}>Provider</th>
                  <th style={{ width: "38%" }}>How to authenticate</th>
                  <th>Env / config keys</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDERS.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <b style={{ color: "var(--text-strong)" }}>{p.name}</b>
                      {p.badge && <span className="badge" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 10 }}>{p.badge}</span>}
                    </td>
                    <td>{p.auth}</td>
                    <td>{p.env.map((e, i) => (
                      <span key={e}>
                        <code className="inline">{e}</code>{i < p.env.length - 1 && <span style={{ margin: "0 4px", color: "var(--text-faint)" }}>·</span>}
                      </span>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            Secrets are saved only to <code className="inline">~/.deepseek/config.json</code>,
            never to the project.
          </Note>
        </section>

        <section id="models">
          <h2><span className="anchor">#</span>Models</h2>
          <p className="lead">Three first-class DeepSeek models ship out of the box:</p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Model ID</th>
                  <th>Description</th>
                  <th style={{ width: "14%" }}>Context</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><code className="inline">deepseek-v4-flash</code> <span className="badge" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 10 }}>default</span></td><td>Fast, general purpose</td><td><code className="inline">1M</code></td></tr>
                <tr><td><code className="inline">deepseek-v4-pro</code></td><td>Advanced reasoning</td><td><code className="inline">1M</code></td></tr>
                <tr><td><code className="inline">deepseek-v4-flash-vision-exp</code></td><td>Experimental vision</td><td><code className="inline">1M</code></td></tr>
              </tbody>
            </table>
          </div>
          <p className="lead" style={{ marginTop: 24 }}>
            Each provider also defaults to a provider-specific model when{" "}
            <code className="inline">model.default</code> is not set:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Provider</th>
                  <th style={{ width: "30%" }}>Default model</th>
                  <th style={{ width: "20%" }}>Streaming</th>
                  <th>Tool calling</th>
                </tr>
              </thead>
              <tbody>
                {DEFAULT_MODELS.map((m) => (
                  <tr key={m.name}>
                    <td><b style={{ color: "var(--text-strong)" }}>{m.name}</b></td>
                    <td><code className="inline">{m.model}</code></td>
                    <td>{m.streaming}</td>
                    <td>{m.tools}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            The built-in Bedrock and Vertex discovery paths filter for DeepSeek model IDs. A local endpoint
            can expose whatever model IDs its OpenAI-compatible server reports.
          </p>
        </section>

        <section id="behavior">
          <h2><span className="anchor">#</span>Behavior by provider</h2>
          <p><b>Streaming.</b> Enabled for the DeepSeek API and local endpoints. It is disabled
            for Vertex, and for Bedrock it depends on the model: V3.x models stream through the
            bedrock-mantle Chat Completions endpoint, while R1 uses the native InvokeModel API
            without streaming.</p>
          <p><b>Tool calling.</b> Native on DeepSeek, local, and Bedrock V3.x. Bedrock R1 and
            other non-tool-calling models use an <b>emulated XML prompt protocol</b> — the model
            answers with a strict JSON tool-use contract instead of structured tool calls. Vertex
            goes through the OpenAI-compatible endpoint with native tool calling.</p>
          <p><b>Thinking control.</b> The <code className="inline">reasoning_effort</code> and{" "}
            <code className="inline">thinking</code> parameters are only sent to DeepSeek and
            Bedrock providers. Other providers receive the effort hint in the system prompt only.{" "}
            <code className="inline">reasoning_content</code> is preserved and passed back for
            DeepSeek models, so streamed thinking keeps working across turns.</p>
          <p><b>Base URLs.</b></p>
          <CodeBlock lang="text">{`DeepSeek: config baseURL  →  DEEPSEEK_BASE_URL  →  https://api.deepseek.com
Local:    default http://localhost:11434/v1 (http:// is added if the scheme is missing)
Bedrock:  V3.x → https://bedrock-mantle.{region}.api.aws/v1
          R1   → https://bedrock-runtime.{region}.amazonaws.com/v1
Vertex:   https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/endpoints/openapi`}</CodeBlock>
        </section>

        <section id="bedrock">
          <h2><span className="anchor">#</span>Bedrock specifics</h2>
          <p>
            Bedrock has two transport paths, chosen automatically by model ID:
          </p>
          <ul className="capabilities">
            <li><b>bedrock-mantle Chat Completions</b> for V3.x models (IDs containing <code className="inline">v3</code>, not <code className="inline">r1</code>) — OpenAI-compatible with native tool calling, signed with SigV4</li>
            <li><b>Native InvokeModel</b> for R1 — <code className="inline">tools</code> and <code className="inline">tool_choice</code> are stripped, and <code className="inline">max_completion_tokens</code> is translated to <code className="inline">max_tokens</code></li>
          </ul>
          <p>
            Credentials come from the environment (<code className="inline">AWS_ACCESS_KEY_ID</code>{" "}
            + <code className="inline">AWS_SECRET_ACCESS_KEY</code>, including temporary STS
            credentials) or from <code className="inline">~/.aws/credentials</code> using the{" "}
            <code className="inline">AWS_PROFILE</code> profile (default <code className="inline">default</code>).
            The region defaults to <code className="inline">us-east-1</code>. The{" "}
            <code className="inline">/model</code> picker lists only model IDs containing{" "}
            <code className="inline">deepseek</code>.
          </p>
        </section>

        <section id="vertex">
          <h2><span className="anchor">#</span>Vertex specifics</h2>
          <p>
            Vertex uses <code className="inline">GoogleAuth</code> with a{" "}
            <code className="inline">keyFile</code> pointing at the{" "}
            <code className="inline">GCP_CREDENTIALS</code> service-account JSON — the client
            refuses to start without it. The OAuth token is cached for one hour and refreshed
            five minutes before expiry; the cache is invalidated automatically if the credentials
            path changes.
          </p>
          <p>
            Both <code className="inline">GCP_PROJECT</code> and{" "}
            <code className="inline">GCP_LOCATION</code> are required (location defaults to{" "}
            <code className="inline">us-central1</code>), and the default model is{" "}
            <code className="inline">deepseek-ai/deepseek-r1</code>.
          </p>
        </section>

        <section id="switching">
          <h2><span className="anchor">#</span>Switching the active model</h2>
          <p>
            Switch the active model for the current process at any time:
          </p>
          <CodeBlock lang="bash">$ deepseek
❯ /model</CodeBlock>
          <p>
            This does not switch providers or write settings. Change <code className="inline">provider.name</code>
            and related credentials in <code className="inline">/config</code> when the next session should use
            another provider.
          </p>
        </section>

        <section id="next">
          <h2><span className="anchor">#</span>Next steps</h2>
          <div className="next-links">
            <a className="next-card" href="/docs/settings">
              <div className="nc-title">Settings <Icon.Arrow /></div>
              <div className="nc-desc">Scopes, precedence, and secrets.</div>
            </a>
            <a className="next-card" href="/docs/quickstart">
              <div className="nc-title">Quickstart <Icon.Arrow /></div>
              <div className="nc-desc">Configure a provider on first run.</div>
            </a>
          </div>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
