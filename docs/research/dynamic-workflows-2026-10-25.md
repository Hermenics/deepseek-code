# Dynamic Workflows: reliability and bounded execution

Research date: 2026-10-25. Scope: the production JavaScript coordination runtime in `src/workflows/`, its model-facing `workflow` tool, and its existing public contracts. The unrelated predefined kernel workflow engine is not the Dynamic Workflows implementation.

## Evidence and applicability

This review used four rounds of web searches covering durable replay, agent orchestration patterns, failure handling, idempotency, and bounded fan-out, followed by reading the primary documentation below. The implementation decisions are local engineering conclusions, not measured model-quality improvements or promises of framework equivalence.

| Primary source | Relevant evidence | Application to DeepSeek Code |
| --- | --- | --- |
| [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents), published 2024-12-19, accessed 2026-10-25 | Composable orchestration patterns include parallel workers and evaluation loops. | Keep JavaScript control flow and existing helpers; a replacement graph framework is unnecessary for the observed problems. |
| [LangGraph: Functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api), accessed 2026-10-25 | Persisted task results support replay from the entrypoint; deterministic ordering and idempotent effects matter. | Fix the meaning of a completed journal entry before extending recovery features. |
| [LangGraph: fault tolerance](https://www.langchain.com/blog/fault-tolerance-in-langgraph), published 2026-06-04, accessed 2026-10-25 | Failure recovery distinguishes retry policies, timeouts, and error handlers with failure context. | Make an agent failure available to script-level `try/catch`, rather than adding unconditional retries. |
| [AWS Step Functions: Inline Map](https://docs.aws.amazon.com/step-functions/latest/dg/state-map-inline.html), accessed 2026-10-25 | Map admission can have an explicit upper bound; concurrency one processes inputs sequentially. | Bound whole pipeline chains and parallel thunks, preserving input-indexed results. |
| [AWS Step Functions: error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html), accessed 2026-10-25 | Retry and catch are separate mechanisms with selected error categories. | Preserve explicit fallback decisions in workflow code and avoid conflating any failure with a retryable failure. |
| [AWS Durable Execution: idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/), accessed 2026-10-25 | Replay/retry may repeat effects; checkpointing alone does not make every operation exactly-once. | Document writer recovery limits and do not introduce automatic agent retries. |
| [Temporal: Workflow Execution](https://docs.temporal.io/workflow-execution), accessed 2026-10-25 | Recorded execution history is the basis for workflow replay. | Retain the existing journal architecture and execution-context checks instead of installing a separate durable runtime. |

## Findings from the current code

`runtime.ts` previously created one promise per input immediately in both helpers. Although the orchestrator already limited actual agent execution, thousands of item chains could queue RPCs, disk writes, and continuations at once. Limiting admission inside the sandbox reduces pending coordination work; it does not raise the host agent cap.

`manager.ts` converted agent failures to `null` but discarded failure metadata at the RPC boundary. `handleCall()` then wrote those responses as completed entries. A subsequent replay could reuse a failed null forever. Runner exceptions had the same problem. A genuine successful null needed to remain distinguishable and reusable.

Child workflows propagated their returned value without indicating that one of their agents failed. Their usage also computed agent counts by subtracting shared run counters, which attributes unrelated concurrent child agents to the wrong journal entry.

The existing pause, cancellation, overall timeout, optional aggregate budget serialization, approval, execution-context hashing, and worktree boundaries already provide the necessary integration points. These changes preserve those boundaries.

## Implemented contracts

`parallel(thunks, { concurrency })` admits at most that many thunks at a time. `pipeline(items, ...stages, { concurrency })` holds one slot for the entire chain of one item. Both accept integer concurrency from 1 through 16; managed runs default to configured agent concurrency capped at 16. A standalone runtime defaults to 16. The next item starts when any slot is free, without waiting for a batch or stage barrier. Returned arrays retain input order and rejected items become null.

Pools belong to individual helper invocations. Nested pools cannot deadlock by waiting for a shared helper slot, but their combined admission is not a global concurrency bound. The existing orchestrator still enforces host agent concurrency, and the existing 17-agent run cap remains unchanged. Direct `Promise.all` remains normal JavaScript and does not acquire helper slots.

`agent(prompt, { throwOnError: true })` rejects on a reported agent failure after updating script-side usage. Directly awaiting it can fail the workflow; `try/catch` can choose a fallback. The default keeps returning null. Helpers still isolate rejections to the affected item, so a strict agent inside a helper does not turn that helper into a fail-fast global barrier. Budget-skipped calls retain their existing null and `budget_exhausted` behavior.

Agent failure responses retain their error through the host/worker bridge. Their journal entries are failed, with result and usage retained for inspection. Replay continues to reuse only a matching successful prefix, and successful nulls stay replayable. Older journals are reconciled in memory against their run's recorded failures; historical files are not rewritten. Replay selection treats budget-exhausted and error-bearing entries as prefix boundaries.

Children report whether any agent failed, preventing the aggregate child result from being cached as a successful call. Each child's runtime supplies its own agent count. This does not introduce child-leaf checkpointing: a failed child reruns as a whole.

Persisted and returned run usage remains host-authoritative. A child that spends tokens and then throws must not lose its usage when the parent catches that failure and completes; successful worker replies alone are insufficient to reconstruct that total. Script-local budget accessors still reflect usage delivered through completed RPC replies, while the host admission checks use the full run accounting.

## Examples

```js
export const meta = { name: 'bounded-review', description: 'Review independent areas with limited admission' };
return pipeline(args.areas,
  area => agent('Review ' + area, { label: 'review:' + area, throwOnError: true }),
  (review, area) => ({ area, review }),
  { concurrency: 2 });
```

```js
export const meta = { name: 'review-fallback', description: 'Read-only review with an explicit fallback' };
try {
  return await agent('Review the current diff.', { label: 'primary', throwOnError: true });
} catch (error) {
  log('Primary review failed: ' + error.message);
  return await agent('Independently review the current diff.', { label: 'fallback', throwOnError: true });
}
```

## Verification and practical limits

Regression tests reproduce the original eager admission, swallowed strict failure, and failed-result replay before the implementation. Additional coverage checks pipeline argument identity and ordering, invalid concurrency before side effects, empty inputs, item bounds, independent nested pools, per-item failure isolation, usage on strict failure, successful-null replay, legacy recovery through automatic and explicit replay, child failure propagation, and concurrent child accounting.

Run `bun test tests/workflows` for the complete workflow suite. Integration validation also covers the batch command, agent authorization, and workflow-facing UI activity tests; typechecking and the application build verify callers and exports. The website workflow guide and model-facing tool description document the same API.

This work does not claim live-provider reliability or a model-quality benchmark. Tests inject agent runners to exercise orchestration behavior without paid model calls. Recovery still validates the existing workspace/execution context, invalidates the suffix after the first failed/divergent call, and can repeat already-started effects. Inspect a writer's effects before restarting it. No exactly-once guarantee, automatic retry policy, new dependencies, or replacement workflow framework is introduced.
