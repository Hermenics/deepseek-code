We resumed this task from a compacted session. Read `.session/checkpoint.md` and the diagnostic log before continuing. Fix `summarizeLatency` to use nearest-rank percentiles: the one-based rank is `ceil(p * sampleCount)`, and inputs must not be mutated. Add regression coverage for the percentile bug.

The original active constraint still applies: do not modify `reference/latency-slo.json`. After finishing, update `.session/continuation.md` with the active constraint, the completed change, and the checks you ran so the next resumed session can continue safely.
