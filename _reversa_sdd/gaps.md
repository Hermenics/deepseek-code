# Remaining gaps

_Review outcome: no critical unknown blocks module-level reimplementation. These items are classified by verification priority._

## Moderate

### External provider behavior

Provider adapters are source-visible, but actual Bedrock/Vertex/local endpoint responses, credentials, quotas, and evolving model capabilities are external to this repository. Keep their configuration and streaming behavior under integration tests. 🟡

### Interrupted persistence recovery

Atomic snapshot/lease logic is implemented, but filesystem/process interruption combinations are inherently environment-dependent. Exercise recovery on target operating systems before changing its guarantees. 🟡

### Git worktree integration

The code validates/worktree-integrates a binary diff, but diverse Git attributes, hooks, and unusual repository states need end-to-end verification in representative projects. 🟡

## Cosmetic/documentation precision

### Bootstrap and utilities

These modules are intentionally broad shared support code. Their unit specs identify visible contracts but do not enumerate every leaf helper; use `code-analysis.md` and source when changing a particular helper. 🟡

### Deployment artifact

There is no Docker, Compose, or cloud manifest to document. If DeepSeek Code acquires a hosted service or packaged container, add `deployment.md` then. 🟢
