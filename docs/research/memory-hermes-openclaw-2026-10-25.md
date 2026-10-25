# Memory comparison and implementation

Reviewed on 2026-10-25 against the current primary documentation and the local DeepSeek Code implementation. Remote repository inspection used the GitHub MCP tree/file tools.

## Sources and conclusions

[Hermes Agent memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) combines a small curated core with historical conversation retrieval. Its documentation describes span patches, explicit capacity management, and approval-aware edits. The useful distinction for DeepSeek Code is between keeping a short prompt and retaining information that can be recovered later.

[OpenClaw memory](https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory.md) separates profile/core notes, dated working notes, and search. It also describes a pre-compaction persistence step and optional semantic providers. This implementation adopts local recovery boundaries and bounded recall without silently configuring an external embedding service.

| Capability | Previous DeepSeek Code | Implemented behavior |
| --- | --- | --- |
| Curated core | Agent/user stores capped at 2,000 characters | Preserved; active core notes remain in project context |
| Larger recoverable notes | Core overflow rejected with no second tier | Separate 200,000-character archive per target; no automatic eviction of durable entries |
| Ranked retrieval | List all notes | Local Unicode-aware BM25 search across current-scope notes |
| Stable retrieval references | Substring mutations only | Persistent entry IDs, bounded search previews and paged get |
| Partial edits | Replace entire entry | Unique-span patch preserves surrounding facts and invalidates outdated review |
| Consent and concurrent changes | User saves require interactive confirmation | User edits show the resulting text; changed underlying content invalidates approval |
| Historical conversation recall | Saved sessions available through UI/session internals | Read-only `session_search` over current-project saved sessions and compaction episodes |
| Preservation before compaction | Summary and evidence ledger only | Bounded visible conversation capture completes before summarization discards original context |
| Relevant archive context | No archive | Up to three active, verified archive previews selected per user turn |
| Background extraction | Inferred project facts competed with core capacity | Inferences go to archive as needs-review; skipped in read-only modes and after a project switch |
| Inspection | List or clear | `/memory search`, `/memory status`, tier/status/ID previews, tool search/get/review |

## Data and trust contracts

Existing v1 sidecars remain readable: entries without a tier are core. Source hashes, project partitioning, expiry, secret redaction, override filtering, cross-process leases, and explicit review continue to apply. Replacement and patch preserve entry identity. A patch does not preserve an obsolete source claim or a previous review of different text. User preferences retain interactive consent.

Archive retrieval is lexical BM25, not semantic embedding search. It does not send memory to a remote provider or infer similarity that the local tokenizer cannot represent. The source JSON remains authoritative; ranking is derived at query time, so deleting an entry leaves no stale search index. Source-changed, expired and unreviewed notes are excluded by default and from automatic recall.

Conversation capture excludes system messages, tool bodies, reasoning fields and images; it redacts secrets before persistence and again before retrieval. Episodes are partitioned by canonical project directory even if several projects share a configured memory directory. Saved-session lookup also supports canonical/original project-path aliases, relevant to macOS temporary paths.

Each episode retains at most 100 visible messages, 8,000 characters per message and 32,000 characters total. The local conversation archive retains at most 128 episodes and 4 MB, pruning oldest episodes when necessary. Search considers up to 100 retained project sessions plus those episodes. Results report truncation and corpus limits; no match does not establish that something was never discussed. A returned reference reads at most three neighboring messages with 2,000 characters each.

Compaction capture requires writable mode and enabled memory. It makes no additional model request. A persistence failure stops compaction before active history is discarded. Disabling memory disables capture and retrieval. Clearing agent memory clears the current project's captured episodes, while original saved sessions remain subject to their existing retention/deletion controls. Deleting durable memory is not deletion of the original conversation history.

Conversation excerpts and recalled facts are untrusted references, never permission grants, instruction overrides, or proof of current workspace state. Current user corrections and direct project evidence take precedence. The implementation does not automatically promote raw dialogue into verified facts.

## Validation scope

Tests cover archive/core capacity separation, persistence after restart, stale/expired/inferred-note filtering, scoped recall, source invalidation, stable IDs, span preservation and ambiguity, paged reads, consent invalidation during concurrent edits, visible-text capture, secret redaction, omission of private/system/tool content, duplicate capture, cross-project isolation, archive clearing, actual saved-session retrieval, disable behavior, automatic recall before dispatch, stale-reference removal, and pre-compaction preservation with read-only skips.

This is a local implementation of the core recall/curation workflow, not a claim of complete plugin or infrastructure parity. Vector providers, external knowledge graphs, background wiki/dreaming services, and remote memory synchronization are not implemented. No live embedding or provider-quality benchmark is claimed.

Final local gate: Bun 1.4.0 coverage run completed with 3,657 passed, 5 skipped, 0 failed across 316 files (12,473 assertions). Typechecking, CLI/site builds, website lint, and whitespace validation passed. Native macOS and Windows execution remains for the configured CI matrix.
