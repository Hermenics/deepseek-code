import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "flow", label: "First-run flow" },
  { id: "storage", label: "What is stored" },
  { id: "precedence", label: "Resolution order" },
  { id: "deepseek", label: "DeepSeek API" },
  { id: "aws", label: "Amazon Bedrock" },
  { id: "gcp", label: "Google Vertex AI" },
  { id: "local", label: "Local providers" },
  { id: "rotate", label: "Rotate credentials" },
  { id: "logout", label: "Log out" },
  { id: "ci", label: "CI & containers" },
];

export default function Authentication() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb"><span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Authentication</span></nav>
        <div className="hero"><h1>Authentication</h1><p className="tagline">Credentials for every provider, where they live, how they are resolved, and how to remove them.</p></div>

        <section id="flow"><h2><span className="anchor">#</span>First-run flow</h2>
          <p>
            On the first interactive launch, choose a theme, choose one of four provider families, and enter
            the fields that provider needs. Required fields are validated before the setup advances. Secrets
            are masked while typing. Escape returns to the previous step; Ctrl+C exits.
          </p>
          <p>
            Setup saves a named provider profile. The profile contains connection fields and, for the
            DeepSeek API, its key; user settings point to the active profile. AWS uses the normal credential
            provider chain; local endpoints require no secret.
          </p>
        </section>

        <section id="storage"><h2><span className="anchor">#</span>What is stored</h2>
          <div className="doc-table-wrap"><table className="doc-table"><thead><tr><th>File</th><th>Typical contents</th><th>Protection</th></tr></thead><tbody>
            <tr><td><code className="inline">~/.deepseek/provider-profiles.json</code></td><td>Named providers, model choices, API keys and credential paths.</td><td>Atomic writes with owner-only mode.</td></tr>
            <tr><td><code className="inline">~/.deepseek/config.json</code></td><td>Legacy credentials and compatibility bootstrap values.</td><td>Owner-only mode.</td></tr>
            <tr><td><code className="inline">~/.deepseek/settings.json</code></td><td>Active profile ID and other user preferences.</td><td>Owner-only mode; still keep secrets out.</td></tr>
            <tr><td>AWS credential sources</td><td>Profile, environment credentials or temporary STS credentials.</td><td>Managed by the AWS toolchain, not copied by DeepSeek Code.</td></tr>
          </tbody></table></div>
          <Note>Commit project settings only after checking that they contain no credentials. User settings and config belong outside the repository.</Note>
        </section>

        <section id="precedence"><h2><span className="anchor">#</span>Resolution order</h2>
          <p>
            Interactive startup loads the active saved profile. If no profile is selected, it picks the first
            available one; an older single-provider configuration can be migrated to a profile. Without a
            ready profile, <code className="inline">DEEPSEEK_API_KEY</code> can supply the default provider.
          </p>
          <p>
            Headless mode uses the same saved configuration. If it finds neither a ready saved provider nor
            <code className="inline">DEEPSEEK_API_KEY</code>, it exits with code 1 instead of opening a prompt.
          </p>
        </section>

        <section id="deepseek"><h2><span className="anchor">#</span>DeepSeek API</h2>
          <CodeBlock lang="bash">{"export DEEPSEEK_API_KEY=\"sk-…\"\n# optional compatible gateway\nexport DEEPSEEK_BASE_URL=\"https://api.deepseek.com\""}</CodeBlock>
          <p>
            The base URL defaults to the public DeepSeek endpoint. A configured{" "}
            <code className="inline">provider.endpoint</code> takes priority over the environment override.
            Use HTTPS for remote gateways and understand their logging and retention policy.
          </p>
          <p>
            Interactive DeepSeek setup validates the key before saving it by requesting{" "}
            <code className="inline">GET https://api.deepseek.com/models</code> with an eight-second timeout. A{" "}
            <code className="inline">401</code> or <code className="inline">403</code> rejects the key; another
            provider error is reported as a service or account problem; an unreachable official endpoint lets you
            enter a custom base URL. This check targets the official endpoint, so verify custom gateways separately.
          </p>
        </section>

        <section id="aws"><h2><span className="anchor">#</span>Amazon Bedrock</h2>
          <CodeBlock lang="bash">{"aws configure --profile deepseek\naws sts get-caller-identity --profile deepseek"}</CodeBlock>
          <p>
            Configure <code className="inline">provider.region</code> and{" "}
            <code className="inline">provider.profile</code>. When both access-key environment variables are
            present, temporary environment credentials are preferred; otherwise the selected shared profile
            is used. The CLI never copies AWS secret keys into its own config.
          </p>
        </section>

        <section id="gcp"><h2><span className="anchor">#</span>Google Vertex AI</h2>
          <p>
            Vertex requires project id, location and a service-account JSON path. DeepSeek Code reads that
            file through Google authentication, requests the cloud-platform scope and refreshes the access
            token before expiry. The JSON credential itself stays at the path you configured.
          </p>
          <CodeBlock lang="bash">{"test -r /secure/path/service-account.json\nexport GCP_CREDENTIALS=/secure/path/service-account.json"}</CodeBlock>
        </section>

        <section id="local"><h2><span className="anchor">#</span>Local providers</h2>
          <p>
            Ollama, LM Studio and other OpenAI-compatible local servers normally require only an endpoint and
            model name. If the endpoint omits a scheme, DeepSeek Code prefixes HTTP. Authentication headers
            for arbitrary local gateways are not a separate first-run field; place authenticated remote
            gateways behind a compatible trusted configuration rather than embedding secrets in a URL.
          </p>
        </section>

        <section id="rotate"><h2><span className="anchor">#</span>Rotate credentials</h2>
          <p>
            Open <code className="inline">/config</code> → <b>Provider profiles</b> to edit and reactivate
            a saved connection, or update its external AWS/GCP source. Vertex access tokens are cached in
            memory, so restart the process when you need credential rotation to take effect immediately.
          </p>
        </section>

        <section id="logout"><h2><span className="anchor">#</span>Log out</h2>
          <CodeBlock lang="bash">{"deepseek logout"}</CodeBlock>
          <p>
            Logout removes <code className="inline">~/.deepseek/config.json</code>, the legacy{" "}
            <code className="inline">~/.deepseek/.env</code>, and
            <code className="inline"> ~/.deepseek/provider-profiles.json</code>. It does not delete settings, sessions, memory,
            AWS profiles, a Vertex JSON key, plugins or project files. The in-app{" "}
            <code className="inline">/logout</code> command performs the same credential cleanup and exits.
          </p>
        </section>

        <section id="ci"><h2><span className="anchor">#</span>CI and containers</h2>
          <p>
            Prefer ephemeral environment credentials or workload identity. Mount only the project paths the
            job needs, use headless mode, and keep JSON output separate from stderr progress. Never bake
            <code className="inline">config.json</code> into an image.
          </p>
          <CodeBlock lang="yaml">{"env:\n  DEEPSEEK_API_KEY: <secret supplied by CI>\nsteps:\n  - run: deepseek --pipe --json \"review the current diff\""}</CodeBlock>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
