import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "model", label: "Choose the main model" },
  { id: "selector", label: "Interactive model selector" },
  { id: "direct", label: "Switch directly by ID" },
  { id: "effects", label: "What a model switch changes" },
  { id: "providers", label: "Provider-specific behavior" },
  { id: "defaults", label: "Defaults and settings" },
  { id: "context", label: "Context-limit resolution" },
  { id: "effort", label: "Reasoning effort" },
  { id: "effort-matrix", label: "Effort by provider" },
  { id: "scope", label: "Persistence and scope" },
  { id: "strategy", label: "Practical selection strategy" },
  { id: "troubleshooting", label: "Troubleshooting" },
];

const PROVIDERS = [
  ["DeepSeek", "deepseek-v4-flash", "Lists models through the provider-compatible models endpoint."],
  ["Amazon Bedrock", "us.deepseek.r1-v1:0", "Uses the AWS foundation-model catalog and keeps only DeepSeek model IDs."],
  ["Google Vertex AI", "deepseek-ai/deepseek-r1", "Uses Vertex model discovery for DeepSeek deployments."],
  ["Local", "Configured local model, otherwise llama3", "Uses the local OpenAI-compatible /v1/models endpoint."],
];

const LIMITS = [
  ["Direct DeepSeek: deepseek-v4-flash", "1,000,000"],
  ["Direct DeepSeek: deepseek-v4-pro", "1,000,000"],
  ["Direct aliases: deepseek-chat / deepseek-reasoner", "1,000,000"],
  ["Amazon Bedrock", "128,000"],
  ["Google Vertex AI", "128,000"],
  ["Unknown or custom model ID", "128,000"],
];

const EFFORT = [
  ["low", "Concise, quick answer hint", "thinking disabled", "Fast, straightforward tasks"],
  ["high", "Thorough, comprehensive hint", "thinking enabled; reasoning_effort high", "Default balance"],
  ["max", "Deepest-reasoning and edge-case hint", "thinking enabled; reasoning_effort max", "Hard design and debugging"],
];

export default function ModelAndEffort() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Configuration</span><span className="sep">/</span><span className="current">Model & effort</span>
        </nav>

        <div className="hero">
          <h1>Model and effort</h1>
          <p className="tagline">Choose the model that executes the main agent and independently tune how much reasoning the current process requests.</p>
        </div>

        <section id="model">
          <h2><span className="anchor">#</span>Choose the main model</h2>
          <p>
            The main model answers prompts, plans tool calls and drives the foreground agent loop. Select it
            interactively with <code className="inline">/model</code> or switch directly by exact provider ID.
          </p>
          <CodeBlock lang="text">{"> /model\n# DeepSeek Code fetches the active provider's model list and opens a selector.\n\n> /model deepseek-v4-pro\nModel switched to deepseek-v4-pro"}</CodeBlock>
          <p>
            There is no separate <code className="inline">/models</code> command. Entering it produces an
            unknown-command message; the plural internal result is reached only by
            <code className="inline">/model</code> with no argument.
          </p>
        </section>

        <section id="selector">
          <h2><span className="anchor">#</span>Interactive model selector</h2>
          <p>
            With no argument, <code className="inline">/model</code> asks the active provider for available
            models. Up/Down or <code className="inline">j</code>/<code className="inline">k</code> moves through
            the list, Enter applies the highlighted ID, and Escape leaves the current model unchanged.
          </p>
          <p>
            Model labels are derived from IDs for readability. Known suffixes such as
            <code className="inline">-flash</code>, <code className="inline">-pro</code> and
            <code className="inline">-reasoner</code> receive built-in descriptions. For unknown IDs,
            DeepSeek Code can ask the current model for short descriptions in background batches and cache
            accepted results in <code className="inline">~/.deepseek/config.json</code>.
          </p>
          <Note>
            Background description generation can make provider requests that are not added to the main
            conversation&apos;s usage counters. Opening the selector is therefore not guaranteed to be cost-free
            when the provider returns previously unseen model IDs.
          </Note>
          <p>
            If discovery fails or times out, the picker shows “No models available from this provider.” The
            discovery path normally returns an empty list rather than surfacing the underlying provider error
            in the conversation. You can still try an exact known ID with the direct form.
          </p>
        </section>

        <section id="direct">
          <h2><span className="anchor">#</span>Switch directly by ID</h2>
          <p>
            The direct form accepts the first whitespace-delimited argument as an arbitrary model string. IDs
            may contain slashes, dots, colons and version suffixes. DeepSeek Code does not validate membership
            in the discovered list or make a test request before displaying success.
          </p>
          <CodeBlock lang="text">{"> /model google/gemini-2.0-flash-001\nModel switched to google/gemini-2.0-flash-001\n\n> /model anthropic.claude-3-5-sonnet-20241022-v2:0\nModel switched to anthropic.claude-3-5-sonnet-20241022-v2:0"}</CodeBlock>
          <p>
            Those examples demonstrate accepted ID syntax, not cross-provider compatibility. The active
            provider, endpoint and credentials do not change. If the selected ID is unavailable there, the
            next model request fails. Additional words after the first model token are ignored.
          </p>
          <Note>
            Model IDs cannot contain spaces. Copy the exact identifier exposed by your provider; a friendly
            display label such as “DeepSeek V4 Pro” is not the API ID.
          </Note>
        </section>

        <section id="effects">
          <h2><span className="anchor">#</span>What a model switch changes</h2>
          <p>A successful selection immediately updates:</p>
          <ul className="capabilities">
            <li><b>Main-agent requests.</b> The next foreground model call uses the selected ID.</li>
            <li><b>Context limit.</b> The status and compaction calculations re-resolve the window for provider plus model.</li>
            <li><b>Orchestrator fallback.</b> New delegated tasks inherit the selected model only when no explicit task, agent or sub-agent setting takes precedence.</li>
            <li><b>New workflow runtime configuration.</b> Later workflow work uses the updated default where its own request does not override it.</li>
            <li><b>Status output.</b> The model label changes in the footer and subsequent <code className="inline">/cost</code>/<code className="inline">/stats</code> output.</li>
          </ul>
          <p>
            Existing conversation messages are retained. Running tasks are not restarted or migrated, and a
            task with its own configured model keeps that selection. Switching models does not clear files,
            approvals, cost counters or the current effort level.
          </p>
        </section>

        <section id="providers">
          <h2><span className="anchor">#</span>Provider-specific behavior</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "21%" }}>Provider</th><th style={{ width: "29%" }}>Default model</th><th>Discovery</th></tr></thead>
            <tbody>{PROVIDERS.map(([provider, model, discovery]) => (
              <tr key={provider}><td><b>{provider}</b></td><td><code className="inline">{model}</code></td><td>{discovery}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            <code className="inline">/model</code> chooses an ID within the already initialized provider. It
            does not switch from DeepSeek to Bedrock, Vertex or local, and it does not reload credentials or
            endpoint configuration. Change provider settings through <code className="inline">/config</code>
            and restart when changing the transport itself.
          </p>
          <p>
            Bedrock supports distinct native and OpenAI-compatible transport paths for different DeepSeek model
            families. Because the client transport is established at startup, choose the intended Bedrock model
            in settings before launching when moving between those families rather than relying on a mid-session ID switch.
          </p>
        </section>

        <section id="defaults">
          <h2><span className="anchor">#</span>Defaults and settings</h2>
          <p>
            Set the durable main default with <code className="inline">model.default</code>. Configure worker
            models separately: an explicit task model wins first, followed by the selected custom-agent model,
            <code className="inline">agents.subagentModel</code>, the compatibility fallback
            <code className="inline">model.subagent</code>, and finally the live main model.
          </p>
          <CodeBlock lang="json">{'{\n  "provider": {\n    "name": "deepseek"\n  },\n  "model": {\n    "default": "deepseek-v4-pro",\n    "subagent": "deepseek-v4-flash"\n  },\n  "agents": {\n    "subagentModel": "deepseek-v4-flash"\n  }\n}'}</CodeBlock>
          <p>
            Effective settings merge user, project and local levels. A direct
            <code className="inline">/model &lt;id&gt;</code> changes only the live process; it does not edit any
            settings file. For a local provider with an explicit local model configured during provider setup,
            that provider selection takes precedence over <code className="inline">model.default</code> at startup.
          </p>
        </section>

        <section id="context">
          <h2><span className="anchor">#</span>Context-limit resolution</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th>Provider/model category</th><th style={{ width: "28%" }}>Window used by DeepSeek Code</th></tr></thead>
            <tbody>{LIMITS.map(([category, limit]) => (
              <tr key={category}><td>{category}</td><td><code className="inline">{limit}</code> tokens</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            Bedrock and Vertex are capped at 128,000 in the client regardless of the selected ID. Unknown
            direct or local models also use a conservative 128,000 fallback. That fallback controls context
            display and compaction timing; it is not a claim about the remote model&apos;s actual maximum.
          </p>
          <p>
            Switching from a recognized one-million-token model to an unknown ID can therefore make the same
            history appear much fuller. Run <code className="inline">/context</code> after a switch and compact
            if the new effective limit leaves insufficient headroom.
          </p>
        </section>

        <section id="effort">
          <h2><span className="anchor">#</span>Reasoning effort</h2>
          <p>
            Effort is independent of model choice. The live main agent starts at
            <code className="inline">high</code>. Run <code className="inline">/effort</code>,
            <code className="inline">/effort status</code> or <code className="inline">/effort current</code>
            to open the selector. Left/Right adjusts, Enter applies and Escape cancels.
          </p>
          <CodeBlock lang="text">{"> /effort low\nEffort: low — Quick, straightforward responses\n\n> /effort max\nEffort: max — Maximum reasoning depth (best with deepseek-reasoner)\n\n> /effort auto\nEffort: high — Comprehensive responses with extensive thinking"}</CodeBlock>
          <p>
            Valid explicit levels are <code className="inline">low</code>, <code className="inline">high</code>
            and <code className="inline">max</code>. The accepted aliases
            <code className="inline">auto</code> and <code className="inline">unset</code> both set
            <code className="inline">high</code>; there is no adaptive automatic mode. Names are case-insensitive.
          </p>
        </section>

        <section id="effort-matrix">
          <h2><span className="anchor">#</span>Effort by provider</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "14%" }}>Level</th><th style={{ width: "30%" }}>System instruction</th><th style={{ width: "30%" }}>DeepSeek / Bedrock request</th><th>Best fit</th></tr></thead>
            <tbody>{EFFORT.map(([level, hint, native, use]) => (
              <tr key={level}><td><code className="inline">{level}</code></td><td>{hint}</td><td>{native}</td><td>{use}</td></tr>
            ))}</tbody>
          </table></div>
          <p>
            Selecting a level rebuilds the system instruction while preserving conversation history. For direct
            DeepSeek and Bedrock, the main request also receives native thinking controls. Vertex and local
            providers receive no effort-specific API fields, so only the system instruction influences behavior.
          </p>
          <p>
            A provider or model can reject or ignore fields it does not support. The confirmation message means
            DeepSeek Code updated local runtime state; it is not proof that the remote model honors the requested
            reasoning depth exactly.
          </p>
          <Note>
            Effort applies to the main agent. Delegated tasks choose effort independently when their task request
            supplies one; changing the slider does not retroactively alter running workers.
          </Note>
        </section>

        <section id="scope">
          <h2><span className="anchor">#</span>Persistence and scope</h2>
          <p>
            Neither a slash-command model switch nor effort selection writes the layered settings files.
            The next eligible session save records the active model as metadata, but session records contain no
            effort field. A new process resolves its model from provider setup and current settings and starts
            effort at high.
          </p>
          <p>
            Resume loads saved conversation messages but does not force the saved model back onto the new runtime.
            The picker can therefore show one saved model while the resumed status bar shows another. Select the
            desired model explicitly after resume if current settings changed.
          </p>
          <p>
            Model and effort changes also do not reset accumulated usage. <code className="inline">/cost</code>
            estimates the cumulative counters using the <em>currently selected model&apos;s</em> price table, so a
            mixed-model session is not a precise per-model invoice.
          </p>
        </section>

        <section id="strategy">
          <h2><span className="anchor">#</span>Practical selection strategy</h2>
          <div className="doc-table-wrap"><table className="doc-table">
            <thead><tr><th style={{ width: "31%" }}>Work</th><th style={{ width: "25%" }}>Starting point</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td>Mechanical edit or quick explanation</td><td>Fast model, low effort</td><td>Minimizes latency when the solution path is already clear.</td></tr>
              <tr><td>Normal implementation</td><td>Configured default, high effort</td><td>Balanced tool use and reasoning is the process default.</td></tr>
              <tr><td>Architecture or subtle debugging</td><td>Strong model, max effort</td><td>More deliberation is valuable when a wrong decision is expensive.</td></tr>
              <tr><td>Wide delegated research</td><td>Strong main, cheaper sub-agent model</td><td>The coordinator keeps capability while bounded workers use a lower-cost default.</td></tr>
            </tbody>
          </table></div>
          <p>
            Change one dimension at a time when diagnosing quality. A stronger model with high effort tells you
            whether capability was limiting; max effort on the same model tells you whether deliberation was limiting.
          </p>
        </section>

        <section id="troubleshooting">
          <h2><span className="anchor">#</span>Troubleshooting</h2>
          <h3>The selector is empty</h3>
          <p>Check provider credentials and connectivity, then use the exact known provider ID if discovery alone is unavailable. <code className="inline">/doctor</code> does not test model listing or authentication.</p>
          <h3>“Model switched” is followed by a provider error</h3>
          <p>The direct command accepts arbitrary IDs without validation. Switch back to an ID returned by the active provider; changing providers requires configuration and a restart.</p>
          <h3>Effort appears to have no effect</h3>
          <p>Vertex and local endpoints receive only the prompt-level instruction, and provider/model support varies. Confirm the active model with <code className="inline">/stats</code> and test a task where reasoning depth is observable.</p>
          <h3>Context percentage jumped after switching</h3>
          <p>The context window was re-resolved. Unknown IDs and all Bedrock/Vertex models use 128,000; run <code className="inline">/context</code> and compact before the next large turn.</p>
          <h3>A resumed session uses the wrong model or effort</h3>
          <p>Resume does not restore runtime selection from saved metadata, and effort is not persisted. Apply <code className="inline">/model &lt;id&gt;</code> and <code className="inline">/effort &lt;level&gt;</code> in the new process.</p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
