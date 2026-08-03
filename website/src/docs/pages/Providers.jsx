import { CodeBlock, Note, Toc, Icon } from "../Layout";

const PROVIDERS = [
  { name: "DeepSeek API", badge: "default", auth: "API key from platform.deepseek.com", env: ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"] },
  { name: "Amazon Bedrock", auth: "AWS IAM credentials via ~/.aws/credentials", env: ["AWS_REGION", "AWS_PROFILE"] },
  { name: "Google Vertex AI", auth: "GCP service account JSON key", env: ["GCP_PROJECT", "GCP_LOCATION", "GCP_CREDENTIALS"] },
  { name: "Local (Ollama / LM Studio)", auth: "No auth — point to your local endpoint", env: ["LOCAL_BASE_URL", "LOCAL_MODEL"] },
];

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "table", label: "Providers & auth" },
  { id: "models", label: "Models" },
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
            DeepSeek Code speaks natively to multiple LLM backends. Pick one at first launch, or
            switch anytime with <code className="inline">/model</code>. Each provider has its own
            authentication flow.
          </p>
        </section>

        <section id="table">
          <h2><span className="anchor">#</span>Providers &amp; auth</h2>
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
          <p className="lead">Two first-class DeepSeek models ship out of the box:</p>
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
              </tbody>
            </table>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            Each provider also exposes provider-specific models (e.g. Bedrock Claude, Vertex
            Gemini, or any local Ollama tag).
          </p>
        </section>

        <section id="switching">
          <h2><span className="anchor">#</span>Switching providers</h2>
          <p>
            Switch the active model at any time:
          </p>
          <CodeBlock lang="bash">$ deepseek
❯ /model</CodeBlock>
          <p>
            Your selection is persisted for the next session.
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
