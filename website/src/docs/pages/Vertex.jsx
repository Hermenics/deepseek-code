import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "prereqs", label: "Prerequisites" },
  { id: "configure", label: "Configure" },
  { id: "auth", label: "Authentication flow" },
  { id: "endpoint", label: "Endpoint" },
  { id: "models", label: "Model discovery" },
  { id: "rotation", label: "Rotation" },
  { id: "troubleshoot", label: "Troubleshooting" },
];

export default function Vertex() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb"><span>Docs</span><span className="sep">/</span><span>Providers</span><span className="sep">/</span><span className="current">Google Vertex AI</span></nav>
        <div className="hero"><h1>Google Vertex AI</h1><p className="tagline">Connect a Google Cloud project with a service account, scoped access tokens and the Vertex OpenAI-compatible endpoint.</p></div>

        <section id="prereqs"><h2><span className="anchor">#</span>Prerequisites</h2>
          <p>
            Enable Vertex AI in the target project, make the desired publisher model available in the chosen
            location, and create a service account that can invoke it. DeepSeek Code currently authenticates
            Vertex with a readable service-account JSON file.
          </p>
          <CodeBlock lang="bash">{"gcloud services enable aiplatform.googleapis.com --project=my-project\ntest -r /secure/path/vertex-service-account.json"}</CodeBlock>
        </section>

        <section id="configure"><h2><span className="anchor">#</span>Configure</h2>
          <CodeBlock lang="json">{"{\n  \"provider\": {\n    \"name\": \"vertex\",\n    \"projectId\": \"my-project\",\n    \"location\": \"us-central1\",\n    \"timeoutMs\": 30000\n  },\n  \"model\": {\n    \"default\": \"deepseek-ai/deepseek-r1\"\n  }\n}"}</CodeBlock>
          <p>
            The service-account path is entered in first-run setup or the User-scoped credentials editor. The
            location defaults to <code className="inline">us-central1</code>; the built-in model default is
            <code className="inline">deepseek-ai/deepseek-r1</code>.
          </p>
        </section>

        <section id="auth"><h2><span className="anchor">#</span>Authentication flow</h2>
          <p>
            DeepSeek Code opens the configured key file through Google authentication and requests an OAuth
            token with the cloud-platform scope. It injects that bearer token into provider requests instead
            of the placeholder key used by the OpenAI-compatible client.
          </p>
          <p>
            Tokens are cached in memory and refreshed with a five-minute safety margin before their expected
            expiry. The authentication client is reused while the credential path is unchanged.
          </p>
          <Note>The credential JSON is not uploaded as a file. It is used locally to obtain an access token, which is then sent to Google Cloud.</Note>
        </section>

        <section id="endpoint"><h2><span className="anchor">#</span>Endpoint construction</h2>
          <p>
            Project and location determine the Vertex host and OpenAI-compatible endpoint. A wrong location
            can look like a missing model even when IAM is correct. Keep the configured location aligned with
            the publisher model's availability.
          </p>
        </section>

        <section id="models"><h2><span className="anchor">#</span>Model discovery</h2>
          <p>
            The model picker queries the DeepSeek publisher collection, converts returned publisher paths
            into ids accepted by the OpenAI-compatible endpoint, removes empty entries and sorts the result.
            Failure returns an empty list without crashing the session.
          </p>
          <p>
            An explicit <code className="inline">model.default</code> remains usable when discovery permission
            is absent, provided the service account can invoke that model.
          </p>
        </section>

        <section id="rotation"><h2><span className="anchor">#</span>Credential rotation</h2>
          <p>
            Replace the JSON file at the configured path or change the path in User settings, then restart
            DeepSeek Code. Restarting drops the in-memory token and authentication-client cache. Revoke the
            previous key in Google Cloud after validating the replacement.
          </p>
        </section>

        <section id="troubleshoot"><h2><span className="anchor">#</span>Troubleshooting</h2>
          <div className="doc-table-wrap"><table className="doc-table"><thead><tr><th>Symptom</th><th>Check</th></tr></thead><tbody>
            <tr><td>Service account path required</td><td>The credentials path is missing from the private config.</td></tr>
            <tr><td>UNAUTHENTICATED</td><td>Key validity, host clock and whether the file belongs to the intended service account.</td></tr>
            <tr><td>PERMISSION_DENIED</td><td>Vertex IAM role, project id, model access and organization policy.</td></tr>
            <tr><td>Empty model picker</td><td>Publisher-list permission and location; try the explicit model id.</td></tr>
          </tbody></table></div>
          <CodeBlock lang="bash">{"deepseek doctor\ngcloud auth activate-service-account --key-file=/secure/path/vertex-service-account.json\ngcloud auth print-access-token"}</CodeBlock>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
