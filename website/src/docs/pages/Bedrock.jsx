import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "prereqs", label: "Prerequisites" },
  { id: "configure", label: "Configure" },
  { id: "credentials", label: "Credential resolution" },
  { id: "models", label: "Model paths" },
  { id: "tools", label: "Tool compatibility" },
  { id: "discovery", label: "Discovery" },
  { id: "troubleshoot", label: "Troubleshooting" },
];

export default function Bedrock() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb"><span>Docs</span><span className="sep">/</span><span>Providers</span><span className="sep">/</span><span className="current">Amazon Bedrock</span></nav>
        <div className="hero"><h1>Amazon Bedrock</h1><p className="tagline">Run DeepSeek models through AWS credentials, SigV4 signing and the Bedrock runtime.</p></div>

        <section id="prereqs"><h2><span className="anchor">#</span>Prerequisites</h2>
          <p>
            Enable the desired DeepSeek model in the AWS region you will use. The principal needs permission
            to list foundation models and invoke the selected model. DeepSeek Code expects a standard AWS
            profile or complete temporary credentials in the environment.
          </p>
          <CodeBlock lang="bash">{"aws sts get-caller-identity --profile default\naws bedrock list-foundation-models --region us-east-1 --profile default"}</CodeBlock>
        </section>

        <section id="configure"><h2><span className="anchor">#</span>Configure</h2>
          <CodeBlock lang="json">{"{\n  \"provider\": {\n    \"name\": \"bedrock\",\n    \"region\": \"us-east-1\",\n    \"profile\": \"default\",\n    \"timeoutMs\": 30000\n  },\n  \"model\": {\n    \"default\": \"us.deepseek.r1-v1:0\"\n  }\n}"}</CodeBlock>
          <p>
            Region defaults to <code className="inline">us-east-1</code>, profile to
            <code className="inline">default</code>, and the provider's built-in model default is
            <code className="inline">us.deepseek.r1-v1:0</code>.
          </p>
        </section>

        <section id="credentials"><h2><span className="anchor">#</span>Credential resolution</h2>
          <p>
            If both <code className="inline">AWS_ACCESS_KEY_ID</code> and
            <code className="inline">AWS_SECRET_ACCESS_KEY</code> exist, the AWS environment provider is used.
            Otherwise DeepSeek Code loads the configured shared profile. Temporary credentials should include
            the session token expected by the AWS SDK.
          </p>
          <Note>AWS secret keys are not copied into DeepSeek Code's credential file. Rotation remains an AWS concern.</Note>
        </section>

        <section id="models"><h2><span className="anchor">#</span>Two model paths</h2>
          <p>
            DeepSeek V3-family ids use Bedrock's OpenAI-compatible mantle endpoint. Requests are signed with
            SigV4 and sent as chat completions. DeepSeek R1 uses the native Bedrock runtime invocation path.
            The model id selects this behavior automatically.
          </p>
          <div className="doc-table-wrap"><table className="doc-table"><thead><tr><th>Model family</th><th>Transport</th><th>Consequence</th></tr></thead><tbody>
            <tr><td>V3.1 / V3.2</td><td>Bedrock mantle chat completions</td><td>Native tool-calling path.</td></tr>
            <tr><td>R1</td><td>Bedrock InvokeModel</td><td>Tool metadata is translated into the prompt because the native route lacks chat tool calls.</td></tr>
          </tbody></table></div>
        </section>

        <section id="tools"><h2><span className="anchor">#</span>Tool compatibility</h2>
          <p>
            V3-family models receive structured tool definitions. On the R1 path, DeepSeek Code describes
            tools in the prompt and parses structured tool requests from the answer. That compatibility layer
            keeps the agent loop available, but malformed model output can fail where native tool calls would
            have been schema-delimited.
          </p>
          <p>For tool-heavy work, prefer a Bedrock model exposed through the chat-completions path when available.</p>
        </section>

        <section id="discovery"><h2><span className="anchor">#</span>Model discovery</h2>
          <p>
            <code className="inline">/model</code> asks the Bedrock control-plane API for foundation models,
            filters ids containing “deepseek” and sorts them. An empty list is not fatal; it can mean missing
            list permission, regional availability or a transient API failure.
          </p>
        </section>

        <section id="troubleshoot"><h2><span className="anchor">#</span>Troubleshooting</h2>
          <div className="doc-table-wrap"><table className="doc-table"><thead><tr><th>Symptom</th><th>Likely check</th></tr></thead><tbody>
            <tr><td>Models list, chat fails</td><td>Invocation permission, model access and the credentials used by the signed runtime request.</td></tr>
            <tr><td>Signature mismatch</td><td>Region, clock, temporary credential completeness and proxy rewriting.</td></tr>
            <tr><td>Model not found</td><td>Inference-profile id and regional availability.</td></tr>
            <tr><td>Tool call is plain text</td><td>Whether the selected id took the R1 compatibility path.</td></tr>
          </tbody></table></div>
          <CodeBlock lang="bash">{"deepseek doctor\naws sts get-caller-identity --profile default"}</CodeBlock>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
