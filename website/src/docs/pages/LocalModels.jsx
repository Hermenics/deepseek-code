import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "requirements", label: "Compatibility requirements" },
  { id: "ollama", label: "Ollama" },
  { id: "lmstudio", label: "LM Studio" },
  { id: "other", label: "Other runtimes" },
  { id: "models", label: "Model selection" },
  { id: "tools", label: "Tool calling" },
  { id: "context", label: "Context & performance" },
  { id: "network", label: "Network boundary" },
  { id: "troubleshoot", label: "Troubleshooting" },
];

export default function LocalModels() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb"><span>Docs</span><span className="sep">/</span><span>Providers</span><span className="sep">/</span><span className="current">Local models</span></nav>
        <div className="hero"><h1>Local models</h1><p className="tagline">Use Ollama, LM Studio or another OpenAI-compatible server while keeping inference on infrastructure you control.</p></div>

        <section id="requirements"><h2><span className="anchor">#</span>Compatibility requirements</h2>
          <p>
            The local provider expects an OpenAI-compatible base URL, chat completions, streaming responses
            and model listing. Agentic work additionally requires reliable tool calls. A server that can
            answer chat but cannot emit structured tool calls can discuss code but will not operate the CLI
            effectively.
          </p>
          <p>
            If the configured URL has no scheme, DeepSeek Code prefixes <code className="inline">http://</code>.
            The default endpoint is <code className="inline">http://localhost:11434/v1</code> and the fallback
            model name is <code className="inline">llama3</code>.
          </p>
        </section>

        <section id="ollama"><h2><span className="anchor">#</span>Ollama</h2>
          <CodeBlock lang="bash">{"ollama serve\nollama pull deepseek-r1:8b\ncurl http://localhost:11434/v1/models"}</CodeBlock>
          <CodeBlock lang="json">{"{\n  \"provider\": {\n    \"name\": \"local\",\n    \"endpoint\": \"http://localhost:11434/v1\"\n  },\n  \"model\": {\n    \"default\": \"deepseek-r1:8b\"\n  }\n}"}</CodeBlock>
          <p>Use the exact model id returned by the server, including its tag.</p>
        </section>

        <section id="lmstudio"><h2><span className="anchor">#</span>LM Studio</h2>
          <p>
            Load a model, start LM Studio's local API server, copy its OpenAI-compatible URL and choose
            <b>Local model</b> in DeepSeek Code. The common default is:
          </p>
          <CodeBlock lang="bash">{"curl http://localhost:1234/v1/models"}</CodeBlock>
          <CodeBlock lang="json">{"{\n  \"provider\": {\n    \"name\": \"local\",\n    \"endpoint\": \"http://localhost:1234/v1\"\n  }\n}"}</CodeBlock>
        </section>

        <section id="other"><h2><span className="anchor">#</span>Other runtimes</h2>
          <p>
            llama.cpp servers, vLLM, LocalAI and internal gateways can work when they expose the same
            interface. Test model listing and one streaming chat request before debugging DeepSeek Code. If a
            gateway requires a custom authorization header, the local provider has no dedicated header field;
            use a trusted compatible proxy arrangement or the native DeepSeek endpoint configuration.
          </p>
        </section>

        <section id="models"><h2><span className="anchor">#</span>Model selection</h2>
          <p>
            First-run setup stores the chosen local model as a provider-specific value. That value takes
            priority over <code className="inline">model.default</code>. To change it later, reconfigure the
            provider or update the private local-model value; <code className="inline">/model</code> changes the
            active session model.
          </p>
          <p>Model discovery calls the server's models endpoint with the configured provider timeout.</p>
        </section>

        <section id="tools"><h2><span className="anchor">#</span>Tool calling quality</h2>
          <p>
            Tool calling is the decisive capability for a coding agent. Check whether the model supports the
            OpenAI tool schema, emits valid JSON arguments and preserves tool-call ids across a streamed turn.
            Small reasoning models often answer the task instead of calling a tool or generate malformed
            arguments under long context.
          </p>
          <Note>When local chat works but file and shell tools never run, test the model's tool-call support before changing permissions.</Note>
        </section>

        <section id="context"><h2><span className="anchor">#</span>Context and performance</h2>
          <p>
            Unknown local model ids use a conservative 128,000-token limit in the CLI's context calculation.
            Your runtime may be configured with much less. Lower the compaction threshold or start focused
            sessions if the server truncates prompts, runs out of memory or becomes slow at long context.
          </p>
          <p>
            Throughput depends on model size, quantization, accelerator memory, context length and concurrent
            sub-agents. Start with one agent and a focused task before increasing orchestration concurrency.
          </p>
        </section>

        <section id="network"><h2><span className="anchor">#</span>Network boundary</h2>
          <p>
            “Local” describes the provider adapter, not necessarily the network location. An endpoint on
            another machine receives prompts, source excerpts and tool schemas. Use TLS and authentication
            for remote hosts, bind development servers deliberately, and do not expose an unauthenticated
            inference port to an untrusted network.
          </p>
        </section>

        <section id="troubleshoot"><h2><span className="anchor">#</span>Troubleshooting</h2>
          <CodeBlock lang="bash">{"curl -sS http://localhost:11434/v1/models\nss -ltnp | grep 11434"}</CodeBlock>
          <div className="doc-table-wrap"><table className="doc-table"><thead><tr><th>Symptom</th><th>Check</th></tr></thead><tbody>
            <tr><td>Connection refused</td><td>Server process, port, bind address and container networking.</td></tr>
            <tr><td>Model not found</td><td>Exact id from the models endpoint.</td></tr>
            <tr><td>Tool arguments malformed</td><td>Model template and native tool-call support.</td></tr>
            <tr><td>Very slow first token</td><td>Model load, context size, GPU offload and concurrent workers.</td></tr>
          </tbody></table></div>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
