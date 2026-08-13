import { CodeBlock, Note, Toc } from "../Layout";

const TOC = [
  { id: "why", label: "Why nine reviewers" },
  { id: "perspectives", label: "The nine perspectives" },
  { id: "pipeline", label: "The pipeline" },
  { id: "finding", label: "The finding schema" },
  { id: "normalize", label: "Normalization & dedup" },
  { id: "verification", label: "Batch verification" },
  { id: "classification", label: "Reading a classification" },
  { id: "gaps", label: "The gap sweep" },
  { id: "failures", label: "Partial failure" },
  { id: "using", label: "Using it" },
];

const PERSPECTIVES = [
  ["correctness", "Does the code do what it claims? Off-by-ones, wrong branches, bad assumptions."],
  ["security", "Injection, path traversal, secret handling, privilege boundaries, unsafe deserialization."],
  ["concurrency", "Races, unsynchronized shared state, deadlocks, non-atomic read-modify-write."],
  ["error-handling", "Swallowed exceptions, unchecked results, failures that surface as success."],
  ["regressions", "Behavior a caller depended on that this change quietly alters."],
  ["tests", "Coverage of the new path, tests that cannot fail, missing edge cases."],
  ["compatibility", "API and schema changes, migrations, platform and version assumptions."],
  ["performance", "Accidental O(n²), work inside loops, unbounded allocation, redundant IO."],
  ["maintainability", "Structure that will be expensive to change: duplication, leaky abstractions."],
];

const FINDING = [
  ["title", "string, required", "One line naming the defect."],
  ["description", "string, required", "What is wrong, specifically."],
  ["impact", "string, required", "What breaks as a consequence. Forces a concrete failure claim."],
  ["file", "string, optional", "Path, when the finding is anchored to one."],
  ["line", "integer ≥ 1, optional", "Line number, when applicable."],
  ["evidence", "string[], required", "Citations backing the claim. An unevidenced finding is invalid."],
];

const ASSESSMENT = [
  ["findingId", "string, required", "Which finding this assessment addresses."],
  ["classification", "CONFIRMED | PLAUSIBLE | REFUTED", "The verdict."],
  ["reason", "string, required", "Why the verifier reached it."],
  ["evidence", "string[], required", "What the verifier itself looked at."],
];

const CLASSES = [
  ["CONFIRMED", "The verifier independently reproduced the defect.", "Fix it."],
  ["PLAUSIBLE", "Not disproven, not confirmed — or verification was unavailable.", "Judge it yourself."],
  ["REFUTED", "The verifier established the finding is wrong.", "Discard it."],
];

const RESULT = [
  ["schemaVersion", "Always 1."],
  ["findings", "Normalized, deduplicated, classified findings."],
  ["reviewerFailures", "Per-perspective failures: which reviewer failed and why."],
  ["verificationAvailable", "False when the verification pass could not run at all."],
  ["gaps", "What the optional gap sweep says was not covered."],
  ["gapSweepError", "Present when the gap sweep itself failed."],
];

export default function CodeReview() {
  return (
    <>
      <main className="content">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Docs</span><span className="sep">/</span><span>Guides</span><span className="sep">/</span><span className="current">Multi-agent review</span>
        </nav>

        <div className="hero">
          <h1>Multi-agent review</h1>
          <p className="tagline">
            Nine independent reviewers, one adversarial verification pass, and a classification you can act
            on. Findings are evidence-backed or they are not findings.
          </p>
        </div>

        <section id="why">
          <h2><span className="anchor">#</span>Why nine reviewers</h2>
          <p>
            A single reviewer asked to "find problems" produces a predictable distribution: a lot of style
            commentary, a few real bugs, and almost nothing about concurrency or compatibility. Not because
            it cannot reason about those, but because a general prompt has no reason to prioritize them.
          </p>
          <p>
            Fixing that with a longer prompt does not work — a checklist inside one context competes for
            attention with itself. Fixing it with <b>separate reviewers, each given one lens</b> does, because
            each runs in its own context with its own instruction and nothing else to be distracted by.
          </p>
          <p>
            The second half is equally important. Independent reviewers produce confident-sounding findings
            that are sometimes wrong, so every finding goes through an adversarial verification pass before
            it reaches you.
          </p>
          <p>
            Reviewers are <b>read-only</b>. They run under the{" "}
            <code className="inline">researcher-readonly</code>{" "}
            <a href="/docs/agent-teams#profiles">profile</a> — a review pass cannot modify your code.
          </p>
        </section>

        <section id="perspectives">
          <h2><span className="anchor">#</span>The nine perspectives</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Perspective</th><th>Looks for</th></tr>
              </thead>
              <tbody>
                {PERSPECTIVES.map(([p, l]) => (
                  <tr key={p}>
                    <td><code className="inline">{p}</code></td>
                    <td>{l}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The list is fixed in <code className="inline">REVIEW_PERSPECTIVES</code> and typed, so a perspective
            is a compile-time constant rather than a string you can typo. You may pass a{" "}
            <b>subset</b> for a narrower pass — a documentation change does not need a concurrency reviewer —
            but you cannot invent one, because a perspective without a written brief produces the same
            unfocused output that having perspectives was meant to avoid.
          </p>
          <p>
            The set is deliberately weighted toward failure modes that survive normal review.{" "}
            <b>Regressions</b> and <b>compatibility</b> are the two humans skip most often, because both
            require holding the <em>previous</em> behavior in mind while reading the new code.
          </p>
        </section>

        <section id="pipeline">
          <h2><span className="anchor">#</span>The pipeline</h2>
          <CodeBlock lang="text">{`  ┌─ correctness ─┐
  ├─ security ────┤
  ├─ concurrency ─┤
  ├─ error-hand. ─┤
  ├─ regressions ─┼──► validate ──► normalize ──► dedup ──┐
  ├─ tests ───────┤     (schema)      (ids)      (merge)  │
  ├─ compat. ─────┤                                       │
  ├─ performance ─┤                                       ▼
  └─ maintain. ───┘                          ┌─ batch verification ─┐
     read-only, parallel                     │ CONFIRMED / PLAUSIBLE│
                                             │ / REFUTED            │
                                             └──────────┬───────────┘
                                                        ▼
                                                  gap sweep (optional)`}</CodeBlock>
          <p>
            Reviewers are scheduled as ordinary orchestrator tasks, so everything from{" "}
            <a href="/docs/parallel-tasks">parallel tasks</a> applies: concurrency limits, per-attempt
            deadlines, bounded retries, and a typed result envelope each.
          </p>
          <p>
            Verification is a <b>separate batch task</b>, not a per-finding call. It receives the whole
            normalized set at once, which lets it weigh findings against each other — two reviewers pointing
            at the same code from different angles is corroboration, and a per-finding verifier could not see
            that.
          </p>
        </section>

        <section id="finding">
          <h2><span className="anchor">#</span>The finding schema</h2>
          <p>
            Reviewer output is validated against a strict schema with{" "}
            <code className="inline">additionalProperties: false</code>. A reviewer that returns prose, or an
            object with extra fields, fails validation rather than being parsed leniently:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Field</th><th style={{ width: "26%" }}>Constraint</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {FINDING.map(([f, c, p]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{c}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock lang="json">{`{
  "title": "Token refresh races with concurrent requests",
  "description": "refreshToken() is called without a lock; two in-flight
                  requests can both see an expired token and both refresh.",
  "impact": "The second refresh invalidates the first token, so a request
             that already started with it fails with 401.",
  "file": "src/auth/token.ts",
  "line": 88,
  "evidence": [
    "src/auth/token.ts:88 — no mutex around the expiry check",
    "src/auth/client.ts:41 — requests are issued concurrently"
  ]
}`}</CodeBlock>
          <p>
            Two constraints do most of the work. <b>impact is required</b>, which forces every finding to
            name a concrete consequence — "this is not ideal" cannot be expressed in this schema. And{" "}
            <b>evidence is required</b> as an array of non-empty strings, so a finding must cite what it is
            based on. Findings that fail validation are rejected with the index and the specific errors, not
            silently dropped.
          </p>
          <Note>
            This is the same fail-closed principle as{" "}
            <a href="/docs/parallel-tasks#envelope">result envelopes</a>: unparseable output is a failure,
            never an ambiguous pass.
          </Note>
        </section>

        <section id="normalize">
          <h2><span className="anchor">#</span>Normalization & dedup</h2>
          <p>
            Nine reviewers on the same code will overlap. The correctness and concurrency reviewers will both
            find a race; security and error-handling will both find a swallowed exception around a
            credential.
          </p>
          <p>
            Normalization assigns each finding a stable <code className="inline">findingId</code> and merges
            duplicates. The merged finding keeps a <code className="inline">perspectives</code> array listing{" "}
            <b>every</b> reviewer that raised it, rather than attributing it to whichever ran first.
          </p>
          <p>
            That array is signal you should read. A finding raised by one perspective is one lens's opinion.
            The same finding raised independently by three is three lenses converging — and it survived
            deduplication precisely because it was described the same way by reviewers that could not see
            each other's output.
          </p>
        </section>

        <section id="verification">
          <h2><span className="anchor">#</span>Batch verification</h2>
          <p>
            The verifier receives findings with their ids and returns one assessment per finding:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "20%" }}>Field</th><th style={{ width: "30%" }}>Constraint</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {ASSESSMENT.map(([f, c, p]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td><code className="inline">{c}</code></td>
                    <td>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The verifier must supply its <b>own</b> evidence. Restating the reviewer's citations is not
            verification — the whole point is a second independent look at the code, not a second opinion
            about the first opinion.
          </p>
          <p>
            The same isolation applies as in <a href="/docs/subagents">sub-agent verification</a>: the
            verifier sees the finding, not the reviewer's working transcript. It cannot be talked into
            agreeing by a persuasive chain of reasoning it never sees.
          </p>
        </section>

        <section id="classification">
          <h2><span className="anchor">#</span>Reading a classification</h2>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "18%" }}>Class</th><th style={{ width: "46%" }}>Means</th><th>Do</th></tr>
              </thead>
              <tbody>
                {CLASSES.map(([c, m, d]) => (
                  <tr key={c}>
                    <td><code className="inline">{c}</code></td>
                    <td>{m}</td>
                    <td><b style={{ color: "var(--text-strong)" }}>{d}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">PLAUSIBLE</code> is the honest middle and it carries two distinct
            situations. Either the verifier looked and could not settle it, or verification did not run at
            all — in which case findings remain <code className="inline">PLAUSIBLE</code> with an explicit{" "}
            <code className="inline">verificationError</code> attached.
          </p>
          <p>
            That distinction is deliberate. A failed verification never silently upgrades findings to
            confirmed, and never discards them as refuted. It leaves them exactly where an unverified
            finding belongs — needing your judgment — and tells you why.
          </p>
          <p>
            Practically: fix <code className="inline">CONFIRMED</code>, triage{" "}
            <code className="inline">PLAUSIBLE</code> starting with the ones raised by multiple perspectives, and
            read a few <code className="inline">REFUTED</code> entries to calibrate how the verifier is behaving.
          </p>
        </section>

        <section id="gaps">
          <h2><span className="anchor">#</span>The gap sweep</h2>
          <p>
            An optional final task runs <b>after</b> classification and asks a different question: not "what
            is wrong" but <b>"what did we not look at"</b>.
          </p>
          <p>
            It sees the classified findings and reports coverage gaps — a module nobody examined, a
            perspective that failed and left a blind spot, a claim asserted but never checked. Its output is
            the <code className="inline">gaps</code> array.
          </p>
          <p>
            Running it after classification rather than before is what makes it useful. Before, it would
            only be guessing at the plan; after, it can see what nine reviewers actually produced and reason
            about the shape of the hole.
          </p>
          <p>
            A gap sweep failure is reported as <code className="inline">gapSweepError</code> and does not
            invalidate the review. Gaps are a bonus pass, not a gate.
          </p>
        </section>

        <section id="failures">
          <h2><span className="anchor">#</span>Partial failure</h2>
          <p>
            Nine parallel tasks means partial failure is normal, and it is reported rather than hidden:
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th style={{ width: "26%" }}>Field</th><th>Contents</th></tr>
              </thead>
              <tbody>
                {RESULT.map(([f, c]) => (
                  <tr key={f}>
                    <td><code className="inline">{f}</code></td>
                    <td>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <code className="inline">reviewerFailures</code> names the perspective and the error, so a review
            where the security reviewer timed out is not silently a review without security coverage. Always
            read this array before treating a clean result as a clean bill of health — the most dangerous
            output is an empty findings list produced by reviewers that never ran.
          </p>
          <p>
            <code className="inline">verificationAvailable: false</code> is the same signal one level up: the
            findings are real, but nothing checked them.
          </p>
        </section>

        <section id="using">
          <h2><span className="anchor">#</span>Using it</h2>
          <CodeBlock lang="bash">{`/review                      # review the current changes
/review src/auth             # scope it to a path`}</CodeBlock>
          <p>
            Scope matters more than it seems. Nine reviewers over a large diff produce a long list where the
            important findings compete with the trivial ones; nine reviewers over one module produce a list
            you will actually read to the end.
          </p>
          <p>
            Cost is roughly nine reviewer tasks plus one verification task plus an optional gap sweep, each
            with its own context. That is real spend — see <a href="/docs/costs">Costs & usage</a> — and
            it is why this is a deliberate command rather than something that runs on every edit. For
            per-edit feedback use <a href="/docs/verification">verification</a> and{" "}
            <a href="/docs/hooks">hooks</a>; reserve multi-agent review for changes where being wrong is
            expensive.
          </p>
        </section>
      </main>

      <Toc items={TOC} />
    </>
  );
}
