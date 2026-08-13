import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "overview", label: "What refinement does" },
  { id: "when", label: "When it runs" },
  { id: "preserves", label: "What it must preserve" },
  { id: "settings", label: "Settings" },
  { id: "preview", label: "Preview and test" },
  { id: "cost", label: "Latency, cost, and privacy" },
  { id: "failure", label: "Failure behavior" },
];

const SETTINGS = [
  ["promptRefiner.enabled", "true", "Enable refinement for eligible prompts."],
  ["promptRefiner.model", "Current session model", "Use a separate model for the refinement request."],
  ["promptRefiner.minimumLength", "30", "Skip messages shorter than this character count."],
  ["promptRefiner.excludeTypes", "[\"command\"]", "Reserved exclusion metadata; slash commands are always skipped."],
];

export default function PromptRefinerGuide() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Prompt refiner</span>
        </nav>
        <div className="hero">
          <h1>Prompt refinement</h1>
          <p className="tagline">Optionally turn a broad coding request into a structured instruction before the main agent begins, while preserving the original intent and language.</p>
        </div>

        <section id="overview">
          <h2><span className="anchor">#</span>What refinement does</h2>
          <p>
            Prompt refinement is enabled by default. Before an eligible foreground message reaches the
            agent loop, DeepSeek Code asks a model whether added structure would help. A useful refinement
            can clarify role, objective, sub-goals, likely files, success criteria, and the need for targeted
            questions. If refinement adds no value, the original text passes through unchanged.
          </p>
          <p>
            Input history and retry keep what you actually typed, not the expanded variant. The transcript
            therefore remains understandable and <code className="inline">/retry</code> does not amplify an
            already refined prompt.
          </p>
        </section>

        <section id="when">
          <h2><span className="anchor">#</span>When it runs</h2>
          <p>
            Refinement is considered only when it is enabled, the prompt meets the configured minimum
            length, and the text does not begin with <code className="inline">/</code>. The refiner is also
            instructed to skip simple questions, greetings, clear self-contained requests, translations,
            explanations, summaries, non-coding tasks, and short follow-ups such as “continue.”
          </p>
          <p>
            Requests that explicitly name DeepSeek Code's native Dynamic Workflow feature bypass refinement.
            This prevents a refinement pass from reinterpreting a request to use the built-in workflow
            runtime as a request to build or adopt a different framework.
          </p>
        </section>

        <section id="preserves">
          <h2><span className="anchor">#</span>What it must preserve</h2>
          <p>
            The refinement contract requires the same language, intent, and scope as the original. It may
            add clarity and completion criteria; it must not redirect the task, introduce unrelated work,
            replace a native feature, or silently choose an outcome the user did not request.
          </p>
          <Note>
            The original request remains authoritative. If the resulting behavior appears broader than what
            you typed, disable refinement and retry the original prompt.
          </Note>
        </section>

        <section id="settings">
          <h2><span className="anchor">#</span>Settings</h2>
          <CodeBlock lang="json">{`{
  "promptRefiner": {
    "enabled": true,
    "model": "deepseek-v4-flash",
    "minimumLength": 30,
    "excludeTypes": ["command"]
  }
}`}</CodeBlock>
          <div className="doc-table-wrap">
            <table className="doc-table"><thead><tr><th>Key</th><th>Default</th><th>Meaning</th></tr></thead>
              <tbody>{SETTINGS.map(([key, value, meaning]) => <tr key={key}><td><code className="inline">{key}</code></td><td><code className="inline">{value}</code></td><td>{meaning}</td></tr>)}</tbody>
            </table>
          </div>
          <p>
            <code className="inline">minimumLength</code> must be a positive integer. Settings are layered in
            the normal User, Project, and Local order; use the settings center to see which scope supplied
            the effective value.
          </p>
        </section>

        <section id="preview">
          <h2><span className="anchor">#</span>Preview and test</h2>
          <p>
            Open <code className="inline">/config</code>, navigate to Prompt Refiner, and use its preview
            action. The result reports one of three outcomes: Refined with the candidate text, Skip with the
            untouched original, or Error with the provider message. Preview does not submit the prompt as a
            coding task.
          </p>
        </section>

        <section id="cost">
          <h2><span className="anchor">#</span>Latency, cost, and privacy</h2>
          <p>
            An eligible prompt can add one non-streaming provider request before normal execution, with up
            to 1,024 output tokens. Choosing a smaller dedicated model reduces this overhead. The prompt is
            sent to the configured provider, so the same data-handling and gateway trust considerations as
            normal chat apply.
          </p>
          <p>
            Disable refinement for latency-sensitive one-shot automation. Headless workflows benefit most
            from already explicit prompts rather than another model pass.
          </p>
        </section>

        <section id="failure">
          <h2><span className="anchor">#</span>Failure behavior</h2>
          <p>
            A refiner error is fail-open for usability: the original prompt continues to the main agent.
            Empty output and an explicit Skip response do the same. Refinement should never make the core
            coding session unavailable.
          </p>
          <p>
            During the extra request the footer shows <code className="inline">Refining…</code>, then changes
            to normal working status when execution begins.
          </p>
        </section>
      </main>
      <Toc items={TOC} />
    </>
  );
}
