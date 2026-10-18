# Resumed checkpoint

The task is to repair `summarizeLatency` in `src/latency.ts`. Use nearest-rank percentiles: rank `ceil(p * n)`, one-based. Do not mutate the input array.

Active constraint carried forward from the earlier session: do not modify `reference/latency-slo.json`.

The earlier investigation established that the reference SLO is correct. The bug is in percentile selection, not in the target value.
