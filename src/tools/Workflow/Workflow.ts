import type { Tool } from '../types.js'

export const WORKFLOW_TOOL_DESCRIPTION = `Execute a Dynamic Workflow: a small JavaScript program that orchestrates many subagents deterministically (fan-out, pipelines, loops, adversarial verification). The workflow runs in the background of this tool call and returns its final value when it finishes.

Use it for work that genuinely benefits from several independent agents: broad code reviews, research sweeps over many files or subsystems, migrations with one agent per site, "find then verify" loops, design panels. Do not use it for a one-file change, a short question, or anything a single focused read would settle.

Every script must begin with a PURE LITERAL meta export (no variables, calls, spreads or interpolation):
  export const meta = {
    name: 'review-changes',                       // lowercase, digits and hyphens
    description: 'Review the diff, then verify each finding',   // one line, shown in the approval prompt
    whenToUse: 'optional — when this saved workflow applies',
    phases: [{ title: 'Review' }, { title: 'Verify', detail: 'one skeptic per finding' }],   // one entry per phase() call, same titles
  }
The body is plain JavaScript (no TypeScript syntax) that runs in an async context: use await directly and return the final value.

Script API:
- agent(prompt, opts?) → Promise<any>. Spawns one subagent. Without opts.schema it resolves to the agent's final text; with opts.schema (a JSON Schema whose root is {type:'object', properties:{…}}) the agent is forced to return a validated object. Resolves to null when the agent fails, is skipped, or the budget is exhausted — filter with .filter(Boolean). opts: label (SHORT, required in practice: it is the agent's name in the monitor, e.g. "scan:auth"), phase (assign to a progress group; use inside parallel()/pipeline() stages), schema, model, effort ('low'|'medium'|'high'|'xhigh'|'max'), isolation: 'worktree' (writers only — each gets its own Git worktree, expensive), agentType (a configured agent name). Per-agent timeoutMs/maxTokens/maxCostUsd exist but a reviewing or reading agent routinely needs 5k–30k tokens, so NEVER set them unless the user asked for a budget — an agent that hits its limit fails and returns null.
- pipeline(items, ...stages) → Promise<any[]>. Runs each item through every stage independently with NO barrier between stages; wall-clock is the slowest single chain. Each stage receives (previousResult, originalItem, index). A throwing stage drops that item to null and skips its remaining stages. DEFAULT to pipeline for multi-stage work.
- parallel(thunks) → Promise<any[]>. Runs () => Promise thunks concurrently and waits for ALL (a barrier). A thunk that throws resolves to null. Use only when a later step needs every result at once (dedup across findings, early exit on zero results).
- workflow(nameOrRef, args?) → runs a saved workflow by name or { scriptPath } inline as a child (one nesting level; its agents show under a "▸ name" group and count toward this run's limits).
- log(text) shows a progress line to the user; phase(title) starts a new progress group for subsequent agent() calls.
- args: the tool's args input, verbatim and frozen. Pass arrays/objects as real JSON values, never as a JSON-encoded string.
- budget: { total (token ceiling or null), spent(), remaining() (Infinity when unbounded), maxCostUsd, spentCostUsd(), remainingCostUsd() }. total is null unless the tool call set maxTokens; once a ceiling is reached every remaining agent() resolves to null and the run ends as budget_exhausted, so do not set maxTokens unless the user asked for a budget.
- Standard JS built-ins are available EXCEPT Date.now(), Math.random() and argless new Date(), which throw because they would break resume — pass timestamps or seeds through args. No filesystem, network or Node APIs.

Limits: at most 17 agents per run, concurrency follows the agents.concurrency setting (≤16), and parallel()/pipeline() accept at most 4096 items. In Plan and Review modes every agent is read-only and isolation: 'worktree' is rejected.

Canonical shape (review → verify, verification starting per dimension as soon as its review finishes):
  export const meta = { name: 'review-changes', description: 'Review changed files across dimensions and verify each finding', phases: [{ title: 'Review' }, { title: 'Verify' }] }
  const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' } }, required: ['file', 'title'] } } }, required: ['findings'] }
  const VERDICT = { type: 'object', properties: { isReal: { type: 'boolean' }, reason: { type: 'string' } }, required: ['isReal'] }
  const DIMENSIONS = [{ key: 'bugs', prompt: 'Find correctness bugs in the current git diff. Return findings.' }, { key: 'security', prompt: 'Find security issues in the current git diff. Return findings.' }]
  const results = await pipeline(
    DIMENSIONS,
    d => agent(d.prompt, { label: 'review:' + d.key, phase: 'Review', schema: FINDINGS }),
    (review, d) => parallel((review?.findings ?? []).map(f => () =>
      agent('Adversarially verify this finding and default to isReal=false when uncertain: ' + JSON.stringify(f), { label: 'verify:' + f.file, phase: 'Verify', schema: VERDICT })
        .then(v => ({ ...f, dimension: d.key, verdict: v })))),
  )
  return results.flat().filter(Boolean).filter(f => f.verdict?.isReal)

Result: JSON with runId, status (completed|failed|cancelled|timed_out|budget_exhausted), result, usage, failures, worktrees, scriptPath and journalPath. To iterate, edit the file at scriptPath and call this tool again with { scriptPath, resumeFromRunId: runId }: agent() calls whose arguments are unchanged return their journaled results instantly and only edited or new calls run. Read journalPath before diagnosing an unexpected result — it records each agent's actual return value. Monitor and control live runs with /workflows.`

export const Workflow: Tool = {
  name: 'workflow',
  description: WORKFLOW_TOOL_DESCRIPTION,
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      script: { type: 'string', minLength: 1, description: 'Complete JavaScript workflow source, starting with export const meta = {...}. Preferred for new workflows.' },
      scriptPath: { type: 'string', minLength: 1, description: 'Path of a workflow script file inside the project or a previous run\'s scriptPath. Use with resumeFromRunId to iterate on a run.' },
      name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$', description: 'Name of a saved workflow from .deepseek/workflows to run (when script and scriptPath are omitted), or the fallback name for an ad-hoc script without metadata.' },
      args: { description: 'Workflow arguments exposed to the script as `args`. Pass real JSON values, not a JSON-encoded string.' },
      resumeFromRunId: { type: 'string', minLength: 4, description: 'runId of an earlier run whose journaled agent results should be reused for every unchanged agent() call.' },
      timeoutMs: { type: 'number', minimum: 1, maximum: 3_600_000, description: 'Whole-run timeout in ms (default 120000). Raise it for runs with many or slow agents.' },
      maxTokens: { type: 'number', minimum: 1, description: 'OPTIONAL hard token ceiling for the whole run, exposed to the script as budget.total. Omit unless the user asked for a budget: one subagent commonly uses 5k–30k tokens, and once the ceiling is reached every remaining agent() resolves to null and the run ends as budget_exhausted.' },
      maxCostUsd: { type: 'number', minimum: 0, description: 'OPTIONAL hard cost ceiling for the whole run. Omit unless the user asked for one.' },
    },
  },
  async execute(args, context) {
    if (!context?.workflowManager) throw new Error('Workflow manager is unavailable')
    const manager = context.workflowManager
    // The agent harness usually resolves scriptPath/name into `script` before authorization;
    // headless callers reach this tool directly, so resolve here as well.
    const source = await manager.resolveScript({
      script: args.script as string | undefined,
      scriptPath: args.scriptPath as string | undefined,
      name: args.name as string | undefined,
    })
    const handle = await manager.start({
      script: source.script,
      name: source.name,
      args: args.args,
      timeoutMs: args.timeoutMs as number | undefined,
      maxTokens: args.maxTokens as number | undefined,
      maxCostUsd: args.maxCostUsd as number | undefined,
      resumeFromRunId: args.resumeFromRunId as string | undefined,
    })
    const onAbort = () => handle.cancel(context.signal?.reason instanceof Error ? context.signal.reason.message : undefined)
    context.signal?.addEventListener('abort', onAbort, { once: true })
    if (context.signal?.aborted) onAbort()
    try { return JSON.stringify(await handle.result) }
    finally { context.signal?.removeEventListener('abort', onAbort) }
  },
}
