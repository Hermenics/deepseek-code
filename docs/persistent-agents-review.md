# DeepSeek Pods: review and comparison

Review started on 2026-10-03. **Status: in progress.** This report covers the current worktree, including the initial implementation, and distinguishes verified corrections from remaining work. It is not a certification of competitor parity or security perfection.

## Summary

The implemented engine has durable pod identities, scoped notes, queued work, process supervision, schedules, exact approvals, isolated browser profiles, learned browser procedures, outbound delivery, persistent group collaboration and bounded history search. The review corrected browser outcome reporting, recording, worker HTTP gates, private-state access, panel sign-out cleanup and routine scheduling/editing. Real Chrome reproduced a WebSocket escape despite successful CDP block configuration; an authenticated context proxy now enforces the exercised HTTP, HTTPS, ws and wss paths. Further tests reproduced opaque-frame localhost access, duplicate initial tabs, overlapping-close races, SQLite contention failures and renewal of expired task ownership. This pass also added pod-scoped signed webhooks, bounded/redacted events, per-run conversations and controls, least-privilege worker environments, plus authenticated per-pod JSON export and staged deletion that removes both SQLite records and the private actor directory. A configurable, mandatory, fail-closed completion reviewer is implemented; the wider transport and deployment boundary remains under review.

## Verified product comparison

Official product documentation was searched and opened, rather than inferred from product names. Dots describes persistent responsibility, cloud execution, conversation continuity, parallel background work and operator intervention. Grok Bot describes persistent computers, coordination between bots and skills derived from demonstrated work. Sources: [Meet dots](https://learn.chatgpt.com/docs/dots), [Grok Bot overview](https://docs.x.ai/grok-bot/overview).

| Capability | Current implementation | Remaining review or capability gap |
| --- | --- | --- |
| Durable identity and context | SQLite identity, per-run transcript, occurrence-scoped goal/todos, versioned notes, bounded full-text history search, export and staged deletion | Ambiguous legacy conversation remains review-only; historical conversations remain distinct from current saved notes |
| Work while the client is closed | Independent supervisor and workers | Work while the host is powered off requires deployment on another host; no managed cloud computer is provisioned |
| Concurrent delegated work | Existing Agent, subagents and workflows; bounded workers; coordinator reviews and delivers outcomes; group tasks; fenced retry of owned checkpoints/journals/control mutations, ordered activity writes, heartbeat renewal, cancellable startup and terminal cleanup; configurable tool-free completion reviewer using the active or a configured provider model | Reviewer configuration takes effect on new worker runs; verify model availability with the selected provider |
| Coordination between persistent pods | Idempotent queued handoffs plus persistent groups with bounded shared conversation, member-scoped versioned artifacts and automatic group-result routing | Group browser sharing is an explicit opt-in; sharing other app sessions and third-party integrations is not implemented |
| Shared computer and artifacts | Pods use the same worker host, can share configured project directories, route group artifacts, and may opt into an exclusive shared Codimium browser profile | Cookies and browser state are shared only by explicit group opt-in; no separate remote computer is provisioned |
| Continued conversation while working | Authenticated guidance targets the active occurrence; coordinator and native descendants reconsider pending proposals, stale approvals are cancelled, and accepted input survives recovery | Guidance reaches model/action boundaries; an admitted effect may finish. Native messaging channels remain a gap |
| Recurring and event work | Once, interval, daily/timezone and explicit event dispatch; optional expiry; at most 50 routines per pod including paused ones; per-run-once/history/delete controls; authenticated per-pod webhook credentials, Ed25519 raw-body signatures, durable rate limits and receipts, bounded/redacted payloads, bounded pending queue and optimistic edits; isolated safe routine previews | Provider-specific signature adapters and connectors |
| Learning a workflow | Successful native browser actions become parameterized private skills; manual operations remain explicit human steps; execution checks current targets | Refine human demonstrations and unsupported steps; review corrections and validation before enabling |
| Browser supervision | Persistent Codimium, retained human sessions, native page/frame/worker HTTP ownership and an authenticated context proxy for HTTP/HTTPS/ws/wss with validated, pinned DNS | Audit UDP/raw transports, cold service-worker sockets and third-party frame/worker compatibility; no OS network boundary is provisioned |
| Sensitive actions | Native denials, sandboxed contextual shell commands, browser proxy egress enforcement, exact durable approvals and uncertain-effect reconciliation; worker environment is allow-listed per selected provider | Review all execution paths; same-UID worker processes remain outside a separate OS principal/container boundary |
| Access from a phone | Responsive authenticated web panel | Native mobile clients, calls, Slack and Teams channels are not implemented; access is through the web panel |

## Phased completion scope

Native mobile clients and managed execution while the operator's computer is off are excluded by the user. Work continues on the local/self-hosted host while it is powered on; a remote host can be operated through the responsive web panel. The current file-based sandbox is verified for contextual shell execution and is not described as a worker container or separate OS identity.

| Phase | Scope | State |
| --- | --- | --- |
| 1. Data lifecycle | Export pod and Agent-session state; stop and reconcile before deletion; remove private actor data; make interrupted cleanup resumable; optional bounded retention | Implemented; store, real HTTP, migration and packaged CLI checks pass. |
| 2. Safe routine validation | Explicit test run executes only bounded local reads; all proposed effects are journaled as simulated, with isolated run state | Implemented and verified in store, package and actual worker checks. Provider inference still occurs; test runs can incur provider usage. |
| 3. Local integration and delivery adapters | Durable outbound webhook delivery with bounded destinations, retries, receipts and signatures | Implemented; delivery, HTTP, migration and packaged checks pass. Provider-specific adapters remain out of scope. |
| 4. Multi-agent collaboration | Group tasks and conversations, versioned artifact routing, and opt-in exclusive access to a shared browser profile | Implemented and covered by group store and HTTP checks. Other app-session sharing is not implemented. |
| 5. Recovery and review controls | Recover/deliver completed child outcomes after coordinator failure, operator intervention for blocked children, configurable reviewer model, and bounded retrieval over long histories | Implemented: review is mandatory and fail-closed; blank configuration inherits the pod model, while an explicit model is used for new runs. Store, agent, API, panel, packaged CLI and history checks cover the behavior. |
| Host hardening (separate from feature parity) | Separate worker identity and writable paths where supported; per-pod deny/ask/allow policy; verify or block non-proxied UDP/WebTransport paths | Agent-controlled shell uses the contextual sandbox and explicit network approval; the browser uses an authenticated HTTP/HTTPS/ws/wss proxy, and the real-Chrome socket gate confirms blocked-address WebSocket requests produce zero handshakes. Chromium launch also requires QUIC disablement and the non-proxied WebRTC UDP policy. A separate worker OS identity and kernel-level UDP/raw-socket isolation require host-level policy and remain an explicit deployment boundary. |

Capability phases 1–5 are closed with runtime and failure-case evidence. Host-level identity and kernel-network isolation are tracked separately as deployment hardening; this implementation does not claim a worker container or a separate OS account.

Dots documents flexible follow-up, event work and distinct scopes for conversation, notes and permissions. Grok separates reusable methods from triggers, and documents reviewing and testing learned workflows before scheduling them. Sources: [Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory), [Grok skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations).

Grok documents explicit action approvals and secure human handoff for sensitive browser steps; automatic review complements permission boundaries. Our screenshots and typed takeover values use worker IPC and do not enter the action journal as raw values. Source for the comparison: [Grok approvals, security and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy).

The documented group collaboration now supports bounded shared conversations, versioned artifacts and an opt-in exclusive Codimium browser profile. It does not provide a separately hosted computer or sharing for other app sessions. Source: [Grok Bot overview](https://docs.x.ai/grok-bot/overview).

## High severity findings

### 01 — General file tools could access runtime state inside the project

**Impact:** A custom database placement inside the project could expose another bot's private state or allow control-state edits through ordinary file tools.

Previously, workspace membership and directory grants did not distinguish application state from source files. Runtime databases, WAL/SHM files and the actors tree are now excluded at `src/bots/worker.ts:109`. Canonical exclusion enforcement is at `src/tools/shared/pathSafety.ts:61` and `src/tools/shared/pathSafety.ts:108`. Orchestrator and workflow sessions propagate the exclusions to their native contexts. Directory/glob searches omit excluded paths, and grep filters before reading rather than after receiving subprocess output.

Evidence: `tests/pathContainment.test.ts` covers existing and new paths, symlink aliases, approved directories, file reads, recursive listings, glob and grep. The real process check now places a private fixture inside the project and attempts reads, searches and writes through the actual Agent. **Corrected; focused and process checks passed.**

This is a file-tool boundary. An explicitly approved arbitrary shell, trusted plugin or malicious process with the same host user can still operate outside it. OS separation and host network controls remain part of the deployment threat model.

### 02 — Initial popup request gate covered documents only

`src/browser/tab.ts:147` previously enabled Fetch interception only for documents while a target was paused. The full origin policy was applied after resume and domain setup, leaving an initialization window for subresources. The initial gate now covers every resource before resume; the service subsequently applies the appropriate origin policy.

Evidence: `tests/browser/record.test.ts` checks initial CDP configuration; real Chrome service checks still open popups, enforce unapproved navigation and retain isolated profiles. **Corrected for this HTTP initialization window.** Findings 12–13 cover subsequent HTTP policy and workers; finding 16 covers the reproduced WebSocket escape and subsequent proxy/DNS protection, including its verification limits.

### 12 — Local pages lost private-address HTTP checks after initialization

`applyTabPolicy` switched local pages back to document-only interception. Local page scripts could then request an address classified as blocked. `src/browser/service.ts:262` now retains interception for every resource for both local and public pages; out-of-process iframes keep the initial full-resource gate too.

Evidence: `tests/browser/worker-network.e2e.test.ts` uses an isolated loopback listener. Linux routes `0.0.0.0` to that listener while the real production URL classifier rejects it. Before the correction the page probe reached the listener; after the correction it reports rejection and the listener receives zero requests. Approved localhost requests still succeed. **Corrected for HTTP.**

### 13 — Worker HTTP requests bypassed page origin policy

Dedicated, nested, shared and service workers were resumed without HTTP gates. Worker CDP sessions do not implement `Fetch.enable` in the tested Chrome; installing the same page command would fail. The browser-level Fetch gate now intercepts worker HTTP requests. Exact CDP target/network identities determine the context and creator origin at `src/browser/service.ts:714`; unknown ownership is denied. Ownership does not come from spoofable HTTP headers. Worker context ownership is established before startup resumes.

Evidence: real Chrome probes for every worker type previously reached the blocked fixture. The checks now also include same-origin blob workers, confirm zero blocked requests and successful allowed requests in disposable and persistent contexts. A separate cold-launch check installs a service worker, shuts down Chrome, starts that worker before its page with no restored approvals, and confirms its startup HTTP request is denied. A fresh approval subsequently allows its request. **Corrected for the exercised HTTP paths; no socket or DNS containment claim.** Popup/domain initialization and actual Agent/panel regressions still pass.

### 16 — CDP accepted WebSocket blocks without stopping handshakes

**Impact:** Scripts could open a socket to a blocked address despite successful CDP block configuration.

`bun tests/browser/socket-network-check.ts` first failed with one blocked-address handshake. The same gate now passes with browser rejection and zero handshakes; its reachable fixture remains the positive control. CDP socket blocks remain advisory. The [Network protocol reference](https://chromedevtools.github.io/devtools-protocol/tot/Network/) describes the command, while actual fixture traffic establishes its behavior here.

`src/browser/egress.ts:68` starts a private Node helper with separate context credentials. `src/browser/egressEngine.ts:102` validates every resolved answer and pins the outgoing socket to that literal address. CONNECT is parsed locally rather than forwarded as opaque TCP. TLS uses an ephemeral key pinned only in Codimium; outbound HTTPS verifies the original hostname and certificate. WebSocket upgrades check the immutable browser Origin, including encrypted wss. Proxy credentials are stripped before forwarding and no host CA is installed.

`src/browser/service.ts:408` verifies actual Chrome launch arguments and rejects a launcher that ignores protection. Helper death shuts Chrome down and removes the private endpoint. Chromium documents proxy routing for HTTP/HTTPS/ws/wss and loopback-bypass removal in its [proxy documentation](https://chromium.googlesource.com/chromium/src/+/main/net/docs/proxy.md); launch configuration is paired with actual traffic checks.

Evidence: `tests/browser/egress.test.ts` verifies authenticated HTTP, trusted HTTPS and wss, bad certificates/hostnames, tunnel-authority changes, per-context credentials and controlled public-to-private DNS answers. Actual Chrome checks successful ws/wss from pages, dedicated/blob/nested/shared/service workers, blocked-address rejection and opaque-worker denial. The DNS test is controlled resolver evidence, not a live internet rebinding experiment. The installed-package check starts the shipped Node helper and verifies allowed/denied traffic and credential stripping.

**Corrected for the exercised HTTP/HTTPS/ws/wss paths.** QUIC and non-proxied WebRTC UDP are disabled by checked launch arguments; UDP behavior, WebTransport and general raw-transport coverage remain unproven. An approved shell or same-UID process is outside this browser boundary.

### 19 — An opaque child frame inherited the top page's localhost privilege

**Impact:** A `data:` iframe inside an approved localhost page could send HTTP requests to localhost despite having an opaque origin.

The old gate classified the top tab URL instead of the requesting frame. `src/browser/tab.ts:167` now records native default execution contexts, and `src/browser/tab.ts:184` resolves the precise frame's origin. Context destruction, process swaps and detach remove its permission metadata. Opaque or unknown origins stay denied. Native parent frame IDs determine iframe-document navigation ownership, and OOP target IDs retain ownership before Network events are enabled. The policy uses that source at `src/browser/service.ts:670`. A native frame-tree securityOrigin alone was insufficient: the real inherited srcdoc context had a localhost origin while its frame-tree field reported `://`.

Evidence: `tests/browser/frame-network.e2e.test.ts` first reproduced the data-frame request. Native Chrome without our gate proves all ten fixture probes are reachable. The corrected service permits inherited srcdoc and genuine cross-site localhost frames; sandboxed/data frames and a reused frame navigated from local to data cause zero fixture hits. Both fetch and image requests are exercised, with an actual OOP iframe target observed. **Corrected for these frame HTTP paths.**

### 24 — A delayed heartbeat could renew ownership after expiration

**Impact:** A worker waiting for SQLite could commit a result after its task lease had expired. The renewal's predicate used the clock captured before waiting for the writer lock.

`BotStore.heartbeat` now acquires an immediate transaction before checking the current time. An expired owner cannot renew, even if the renewal started before expiration. In `executeBotRun`, a busy renewal is tolerated only within the last confirmed durable deadline; it grants no additional time. Native action/checkpoint ownership checks remain mandatory.

Evidence: `bun tests/bot-lease-check.ts` starts the real Agent/worker against a held local HTTP provider and a separate native SQLite writer. The original heartbeat failed an eight-second contention case. After tolerating busy renewals, a 31-second lock exposed the stale-clock flaw: the expired owner still delivered a completed result. With the transactional clock check, eight seconds allows delivery, while 31 seconds denies late output and leaves the original occurrence recoverable. Actual clock and the production 30-second lease are used, with no external effects in this fixture. **Corrected for heartbeat renewal and result fencing.** Finding 25 covers owned action/checkpoint commits; other contention paths remain under review.

### 31 — Bot control admission did not fence the actual mutation

The native action journal checked ownership before execution, but note edits, handoffs, scheduling and learning mutated state later without checking whether that owner was still live. The native tool context could also be cancelled while the outer worker signal remained healthy. Temporary writer contention could replace a legitimate control result with a database error.

`src/bots/control.ts` now commits every mutating control through `writeOwned`, composing the native execution signal with the worker signal. Recipient and routine-scope checks run in the same immediate transaction as the mutation. Learning separates its synchronous database record from manifest publication, which runs only after the commit and outside retry.

Evidence: `tests/bot-controls.test.ts` first reproduced stale writes for all six control actions and ignored context cancellation. It verifies expiration, both cancellation signals, short-lock delivery and idempotent mutations. `bun tests/bot-control-check.ts` uses the actual Agent, approvals, action journal and native control against separate SQLite writers: scheduling and learning survive eight seconds; 31 seconds rejects expired ownership and retains a reconciliation block. **Corrected for these control paths.**

### 34 — Note provenance retained credentials

Safe note text could have a credential-bearing source. That source persisted unchanged and was later included with the note in model context. The shared store now rejects recognized credentials in source fields, and the shared redactor masks URL passwords while retaining safe username-only SSH references and ordinary contact query values.

Migration 13 at `src/bots/store.ts:109` sanitizes actual historical note-source rows, preserving safe provenance. The kernel migration runner accepts trusted synchronous database callbacks inside the existing atomic migration transaction; callback failure rolls back both data and the recorded version. No filesystem or network effects occur in this callback.

Evidence: the original store/control check accepted credential sources, and reopening retained the original source in SQL. Both regressions now pass; the callback rollback check and safe-reference controls also pass. **Corrected for recognized patterns in note provenance.** This does not detect arbitrary opaque secrets, erase historical bytes from disk or prove cleanup of other transcripts and caches.

## Medium severity findings

### 03 — A successful expectation could be recorded as a different predicate

The native wait implementation tested URL when URL and text were both supplied, while the recorder selected text. It could report absent text as present and learn a predicate it never verified. `src/browser/actions.ts:221` now requires exactly one text/ref/URL predicate; `noErrors` must be checked separately. Ambiguous calls fail and do not produce learned steps.

Evidence: real Chrome regression in `tests/browser/tool.e2e.test.ts` failed on the previous implementation and passes after the correction. **Corrected.**

### 04 — Negative URL expectations became positive during learning/export

The URL recorder omitted `gone`, and Playwright export always emitted a positive URL assertion. The recorder now retains the negative condition at `src/browser/record.ts:40`; export preserves it at `src/browser/record.ts:96`.

Evidence: `tests/browser/record.test.ts` reproduced the missing field before the correction and now verifies both recording and exported assertion. **Corrected.**

### 05 — A continued batch could report success despite failed steps

With `stopOnError:false`, failures did not affect the batch summary. `src/tools/Browser/Browser.ts:51` now retains the first failure while continuing requested steps, and returns an error summary.

Evidence: the real Chrome regression reproduced a successful batch summary with a failed expectation, then passed after correction while confirming the later successful step still executes. **Corrected.**

### 06 — Sign-out and session expiry left private UI state behind

Expiry only hid the main panel; open dialogs and sensitive DOM values remained. Logout closed the browser dialog but not other forms. The shared cleanup at `src/bots/panel.ts:40` now clears dialogs, drafts, inputs, screenshots, cached state and rendered data. The refresh generation guard at `src/bots/panel.ts:50` rejects stale responses after sign-out. Bot selection also closes dialogs tied to the prior bot.

Evidence: `bun tests/bot-web-check.ts` uses real HTTP authentication and Chrome to expire a session with an open dialog, then checks private fields and images are cleared; login and explicit logout remain functional. **Corrected; process check passed.**

### 07 — Idle shutdown could close a human-owned browser

The browser's five-minute idle timer considered individual operations, but not the human ownership interval between them. A long login or manual form could therefore lose its page. `src/browser/service.ts:147` now provides scoped retention; remote takeover and native handoff retain the browser until control is returned or cleanup completes. Explicit cancellation and shutdown remain effective.

Evidence: the real Chrome service test observes that no idle timer exists while either human holder remains, that normal operations do not reinstall it, and that the last idempotent release restores the timer. The process-level remote takeover check also passed after integration. **Corrected.**

### 08 — Delegated outcomes were stored without a delivered coordinator response

The worker waited for background completion, appended the task records and marked the run complete, but never asked the coordinator to review those outcomes. The panel could therefore retain an interim response that said the result was pending. `src/bots/worker.ts:173` now reuses the native coordinator for outcome review; `src/bots/worker.ts:212` commits the evidence before acknowledging descendant effects. Follow-up delegation remains supervised and requires current approvals. Each new result is delivered once per live run, with ten follow-up rounds admitted before intervention is reported. This does not implement automatic routing between persistent bots or prove recovery during delivery.

Evidence: `tests/bot-runtime-check.ts` first reproduced the missing final result through the real Agent/process path. The corrected path delivered both subagent and workflow outcomes. A further check holds a second delegated task, verifies the run remains active and then observes its delivered result. A child that exhausts schema correction attempts also produces a coordinator explanation while the run remains failed. Native permission checks remain enabled. **Corrected; delivery, additional delegation and failure reporting checks passed.**

### 09 — Approval waits could accumulate stale timer occurrences

Dispatch created another queued run every interval even when the prior occurrence had not started or was awaiting approval. `src/bots/store.ts:500` now admits one outstanding timer occurrence per routine, including the interval while its worker is stopping. An overdue timestamp is preserved until admission resumes; one catch-up occurrence is dispatched with current-source instructions and missed ticks are coalesced. Distinct external events continue to produce distinct runs.

Evidence: `tests/bots.test.ts` reproduced growing timer work before the change. It now checks queued work, an actual durable approval wait, worker stop acknowledgement, catch-up admission and three independent event payloads. The existing occurrence test still checks that separate completed executions receive fresh IDs and prompts. **Corrected; 14 store/schedule checks passed.**

### 10 — An unrelated occurrence inherited the previous task's blocked goal

Restoration used the bot's latest runtime snapshot. A new task could therefore perform its request successfully but finish as blocked by an unrelated old goal; retrying an older task after another checkpoint could also restore the wrong counters and todos. Migration 11 at `src/bots/store.ts:85` adds occurrence state, and the worker restores that state at `src/bots/worker.ts:102`. Checkpoints retain each occurrence's state while the conversation remains shared.

Legacy snapshots have no provable task owner. They are preserved for inspection and require explicit operator review/reset; no latest-row inference is used. `src/bots/store.ts:253` requires stopped legacy work and recorded evidence, preserves the original snapshot and does not reconcile effects. The initialization boundary now records such failures and acknowledges cleanup instead of leaving an owned run until its lease expires.

Evidence: the store and real-process checks both reproduced the blocked-new-task failure. Store checks now verify independent goals/todos and retry after other work; an actual prior-schema database exercises migration. Real CLI inspection/reset and subsequent real Agent execution passed, including released ownership after the initialization block. A separate check confirms runtime reset cannot clear an uncertain write. **Corrected.**

### 11 — Manual browser work could disappear from a learned procedure

Human browser actions were journaled separately, so an unsolicited takeover could be omitted from the method learned from native browser steps. The learned procedure could then contain navigation and a final expectation while hiding the operator's intervening work. `src/bots/store.ts:321` now records a human segment atomically with the human action journal. Consecutive human operations and the corresponding native handoff collapse into one explicit manual step at `src/bots/store.ts:414`; typed values are not captured.

Migration 12 at `src/bots/store.ts:95` requires fresh demonstrations for historical sources involving human actions, marks their learned versions for review and pauses bound routines. The historical ledger did not prove complete segment coverage, so an existing version is not silently treated as safe. This preserves a human requirement; it does not claim to infer an autonomous login or reconstruct secret values.

Evidence: the store check first reproduced missing manual steps before an explicit native handoff. It now verifies segment retention and deduplication. Real Chrome/IPC takeover observes the new step before the native handoff returns, and confirms the recording excludes typed passwords. A reopened historical-schema check verifies invalidation and disabled routine dispatch. **Corrected.**

### 14 — An owned opaque worker could shut down the whole browser

Worker initialization treated the `null` origin of a legitimate `data:` worker as a fatal browser ownership error. The real Chrome regression first reproduced complete browser shutdown. At `src/browser/service.ts:626` an owned opaque worker now retains its null origin, can compute, and remains explicitly denied HTTP access at `src/browser/service.ts:690`; it never inherits the page's approval.

Evidence: the real worker computes `42`, observes denied HTTP access with zero fixture hits, and leaves the browser usable for a subsequent snapshot. Same-origin blob workers retain their verified origin and continue allowed HTTP work. **Corrected for availability and HTTP authorization; socket evidence is in finding 16.**

### 15 — Unneeded component extensions created unmanaged targets

A new isolated Chrome profile still started component-extension background pages/workers. The bot browser does not need those targets. `src/browser/launcher.ts:44` disables ordinary extensions and component extensions with background pages. This does not modify Marcelo's normal browser profile.

Evidence: launcher regression checks both flags; actual persistent/disposable worker traces contain no `chrome-extension:` targets. **Corrected for the observed background targets.**

### 17 — Concurrent first calls created duplicate contexts and tabs

Three native first calls returned three different tabs. Context creation at `src/browser/service.ts:499` and initial tab creation at `src/browser/service.ts:220` now share pending promises for the same live context; cancellation invalidates them. The real Chrome regression confirms one target, one context and one tab for all three calls. **Corrected.**

### 18 — A second shutdown returned before the first persistent close finished

The second call replaced the pending close promise with an already-resolved empty cleanup. `src/browser/service.ts:319` now keeps the original close in the cleanup chain and immediately stops network helpers before saving the private cookie cache and closing Chrome.

Evidence: the real Chrome test holds its actual close, confirms Chrome remains alive, and checks that a second shutdown remains pending after the helper processes exit. The historical code fails this invariant deterministically; the corrected code preserves the cookie cache and resolves both calls only after Chrome closes. **Corrected.**

### 20 — A normal iframe detach could turn initialization cancellation into browser shutdown

Removing a short-lived iframe could race domain setup, producing a native missing-session error that shut down the whole browser. `src/browser/service.ts:425` tracks attached sessions and clears frame ownership on native detach; `src/browser/service.ts:642` treats initialization of an already-detached target as cancellation. Errors on a still-live target continue to close the browser. The real frame regression removes opaque and OOP frames immediately after their result, continues further probes and confirms the browser stays running. **Corrected for the reproduced detach race.**

### 21 — SQLite writer contention terminated the running supervisor

The actual Agent/process check failed when `recover()` encountered `SQLITE_BUSY` after the database's native five-second timeout. The supervisor treated this as fatal and stopped its workers. `src/bots/service.ts:42` now yields between maintenance passes for SQLite busy errors; other errors remain fatal. Existing process handles stay in the worker map, and `src/bots/service.ts:21` retains pending start announcements so retrying maintenance cannot launch the same bot twice.

Evidence: `tests/bot-service-contention.test.ts` uses a separate real process holding `BEGIN IMMEDIATE` for eight seconds. The original supervisor exits with the observed busy error; the correction stays running and serves the authenticated panel after release. A second check removes a required table and confirms a real schema error still propagates and is journaled. The complete Agent/process check subsequently passed, including human browser handoff and cleanup. **Corrected for the running supervisor loop.** Findings 22, 24, 25 and 27 cover response latency, heartbeat, owned database commits and activity events; findings 28–30 cover startup/migration/claim contention. Other control paths remain to audit.

### 22 — SQLite's synchronous timeout froze the panel during maintenance

The surviving supervisor still blocked HTTP/IPC while synchronous SQLite waited for a writer. The actual authenticated read took 5.5 seconds during an eight-second write lock. The supervisor and web-server connections now use zero native busy timeout. The maintenance loop yields between attempts; the panel returns a generic HTTP 503 with `Retry-After: 1` for contended mutations instead of freezing or exposing database details.

Evidence: the real writer/process test now requires an authenticated read within two seconds while the lock is still held. A contended enqueue returns 503 and creates no work. After release, the same occurrence is accepted; resending it returns the same run ID and one queue event. Authentication, argument validation and real schema-error propagation remain checked. **Corrected for running maintenance and panel request handling.**

### 23 — Control mutations could commit before their durable event failed

Creating a bot, enqueueing work and changing enabled state used separate commits for the mutation and its event. Failure of the latter left a changed database despite reporting that the operation failed. These three shared `BotStore` methods now commit their state and event inside the existing immediate transaction, covering terminal, web and agent callers.

Evidence: a real SQLite trigger rejects `BotCreated`, `BotRunQueued` and `BotEnabled`. Before correction, bot creation, a queued run and disabled state survived the reported errors. The check now verifies full rollback, successful retry after the trigger is removed, and unchanged occurrence idempotency. **Corrected for these control methods.**

### 25 — Temporary journal/checkpoint contention discarded an observed result

The real worker marked an already delivered model response failed when its checkpoint hit an eight-second native write lock. A separate actual approved shell effect was performed once, but its result journal timed out and left the run blocked despite ownership remaining valid.

`BotStore.writeOwned` retries only synchronous database work on native SQLite busy errors. Each attempt obtains an immediate transaction, checks current owner/status/deadline and cancellation, then commits or rolls back the database work. External execution remains outside the retry. Worker decisions, action guards/results, conversation/background checkpoints and final completion use this path. Human browser journals and procedure cursor commits also use it. Non-busy errors propagate with rollback; busy errors grant no additional lease time.

Evidence: `bun tests/bot-write-check.ts` first reproduced both failures. Its corrected real Agent/HTTP/SQLite path delivers the checkpoint and the once-only shell result through eight-second locks. A 31-second lock rejects the late result, retains the single filesystem effect and uncertain journal, requires reconciliation and prevents admitting another task. Store checks cover wrong owner, cancellation, expiration, non-busy native errors and rollback. **Corrected for these owned database commits.** Finding 27 covers activity callbacks; findings 28–30 cover startup, and findings 31–33 cover control mutations and procedure review. This is not a general external-action retry mechanism.

### 26 — Asynchronous browser recording must finish before advancing a procedure

Introducing asynchronous database retries exposed a synchronous callback contract in the native browser tool. It advanced a procedure after calling the recording callback without awaiting its returned promise. Recording could still be pending when the cursor advanced.

The context contract now permits `Promise<void>`, and native actions and human handoff await recording before cursor commit. A rejected recording still raises the existing durable-execution error, preserving effect uncertainty rather than replaying the action.

Evidence: the real Chrome regression first observed the cursor commit while recording was held. It now checks both navigation and human-handoff paths, requiring the cursor to stay uncommitted until recording is released. Existing synchronous recording failure and actual process/browser takeover checks remain enabled. **Corrected as part of the asynchronous-write integration.**

### 27 — Activity event contention replaced the native tool outcome

Synchronous `BotToolCall` and `BotToolResult` writes could throw into the native Agent tool boundary. Under a real eight-second SQLite lock, the model received a database error instead of the source file result or the result of an already completed shell effect. The action journal alone did not prevent the callback from replacing that evidence.

The worker now keeps synchronous progress producers and queues only their owned database writes in order. Action admission and conversation checkpoints await the queued activity. Native operations and their results remain outside the retry; permanent activity failures abort the coordinator and are retained as run failures or uncertain-effect blocks. Cleanup drains pending writes before releasing ownership. This covers intermediate producers such as MoA without changing their callback contracts or granting new permissions.

Evidence: `bun tests/bot-write-check.ts activity-call` and `activity-result` both lost native evidence before the change. The fixture pauses callback delivery outside database transactions, acquires a real separate-process SQLite writer, then resumes the actual callback. Both checks now deliver native evidence with one ordered call/result event pair. A 31-second result-event lock denies expired ownership and keeps the single actual filesystem effect blocked for reconciliation. A native SQLite trigger rejecting only result events also produces a stopped, blocked run with its recorded error, without replaying the effect. **Corrected for the exercised activity paths; full comparison review remains in progress.**

### 28 — A pending migration blocked startup and could leak startup resources

A current-schema database opened successfully under a writer lock, but an actual pending migration blocked the JavaScript thread for 8.15 seconds. Startup used a synchronous constructor, so cancellation could not run while SQLite waited. A failed constructor also left its partially opened connection without explicit cleanup; a worker failure before its original `try` left actor ownership unreleased.

`BotStore.open` uses zero native timeout during opening/migration, retries only native busy errors with an abortable delay and restores the requested runtime timeout after success. Both database constructors close on initialization failure. Supervisor, worker and terminal commands use this opening path. Worker resource acquisition is inside its cleanup scope, so cancellation or a real schema error releases actor ownership and signal handlers.

Evidence: `tests/bot-service-contention.test.ts` retains the successful current-schema control, reproduces the pending-migration block, then requires responsive startup, eventual authenticated panel access, prompt cancellation and an unchanged pending migration on cancellation. The terminal command check separately reproduced a 1.14-second JavaScript stall during a one-second lock; it now yields and finishes the actual list command after release. A broken pending migration fails instead of retrying indefinitely. `bun tests/bot-startup-check.ts` runs the actual worker/Agent against an eight-second separate-process writer; upgrade delivers one provider result, cancellation exits while the writer still holds its lock, and a real schema error exits with no provider request. Both stopped workers leave no actor lease directory. **Corrected for the exercised startup paths.**

### 29 — Concurrent migrators applied the same non-idempotent schema change twice

The kernel migration runner read versions before acquiring a writer. Two processes could read the same old versions; after the first committed, the second still ran the same `CREATE` or `ALTER`, failing despite a successfully updated database.

Each migration now acquires a native immediate transaction and rechecks its recorded version inside that transaction. The existing initial read still skips completed databases efficiently. Each pending migration remains one atomic commit, and real migration failures roll back without leaving a recorded version or partial schema.

Evidence: `tests/kernel/store.test.ts` synchronizes two separate real SQLite processes after their initial version reads, outside database transactions. Before correction one process exited with `table migrated_once already exists`. Both now exit successfully, leaving one table and one version entry. Existing historical upgrade, idempotency and rollback checks also pass. **Corrected in the shared migration runner.**

### 30 — Initial task ownership lost time while waiting for the writer

`claim` sampled its default lease clock before acquiring its immediate transaction. Time spent waiting for SQLite shortened the task's initial ownership period. A busy claim could also abandon a worker before any task was acquired.

The default claim clock is now sampled after writer acquisition; explicit test clocks remain supported. Workers retry only busy claim errors while retaining their actor lease, and cancellation ends that wait. Missing-provider failure commits use the existing owned-write path.

Evidence: a real two-second writer lock requires the claimed task to retain its full fresh 30-second lease. The `claim` case in `bun tests/bot-startup-check.ts` pauses native claim delivery outside its database transaction, acquires an eight-second writer, and resumes the real worker. It subsequently completes with one attempt and one provider request. **Corrected for initial task admission.** Findings 31–33 cover subsequent control mutations and procedure review.


### 32 — Routine enabling raced procedure invalidation

The routine enable path read procedure readiness before acquiring its write transaction. A second process could invalidate the method and pause its routine, then the first process could re-enable that routine using the old readiness result.

The shared `BotStore.setRoutineEnabled` at `src/bots/store.ts:577` now reads readiness and updates state in the same immediate transaction. A two-process regression coordinates the actual readiness read and invalidation; the resulting method requires review, its routine remains disabled and event dispatch creates no occurrence. **Corrected at the shared store boundary.**

### 33 — Writer contention discarded procedure-review evidence

DOM drift correctly rejected an action, but synchronous invalidation could fail on a writer lock before persisting the method's review status and disabling its routines. Completion checking also needed to await the resulting commit.

`src/bots/procedures.ts:77` now awaits the owned database invalidation before publishing the changed manifest or rejecting with the observed reason. Interrupted-procedure handling uses the same database-only record method; filesystem publication remains outside retried transactions. Expiration and cancellation still deny stale mutation authority.

Evidence: store checks exercise both pre-action rejection and unfinished completion under a separate writer. The actual Chrome/Agent check pauses outside database transactions after native action admission, holds SQLite for eight seconds, then resumes the changed-target check. The model receives the observed DOM rejection; no extra click occurs, the method requires review and its routine is paused. **Corrected for these live-owner review paths.** Review delivery after cancellation or lost ownership remains under audit.


### 35 — Writer contention turned completed-worker cleanup into a process failure

After the real Agent finished and its output committed, terminal ownership release still used a synchronous write. A separate eight-second writer made that acknowledgement fail after the native timeout: the worker exited with a database error despite successful task completion. The same wait could delay a stop signal.

`src/bots/store.ts:415` retries only the terminal-owner acknowledgement. Its SQL predicate still requires the exact owner and terminal status; it cannot release active work or another owner. At `src/bots/worker.ts:277`, cleanup stops the heartbeat after final completion and awaits the acknowledgement. Worker connections use zero native busy timeout so their existing asynchronous retries and signal handlers remain responsive. Missing-provider cleanup also acknowledges its terminal run. Non-busy database failures remain fatal.

An aborted worker may leave a contended acknowledgement pending and exit after releasing its actor lease. The supervisor then needs an actual exited handle, or recovery needs proof the saved process no longer exists, before clearing terminal ownership. Cancellation grants no authority to release active work or replay an effect.

Evidence: `bun tests/bot-stop-check.ts complete` reproduced the actual completed worker's `SQLITE_BUSY` exit before correction. All four corrected process checks pass: completion retains one model result and releases ownership after the writer; SIGTERM exits within two seconds while the eight-second writer remains live, then recovery releases the terminal owner; a native missing-table error propagates without a retry loop; missing-provider failure retains its explanation, releases ownership and makes zero model requests. Store regressions preserve active/other owners, cancelled terminal cleanup and permanently rejected acknowledgement state. **Corrected for these exercised terminal-cleanup paths.**

### 36 — Follow-up messages became separate tasks instead of guiding current work

The original composer queued every message as a future occurrence. A user could not correct the task that was currently making proposals or waiting for approval. The panel now offers **Guide task** on active work, the terminal offers `deepseek pods steer RUN MESSAGE --occurrence MESSAGE_ID`, and authenticated HTTP accepts `POST /api/runs/RUN/messages` with `message` and `messageId`. Ordinary queued messages remain available for new work.

Migration 14 stores ordered occurrence messages and a checkpointed delivery cursor. Accepting a correction, cancelling pending or answered decisions and emitting its event are one immediate transaction. Reusing the same message ID and content is idempotent; changed content, credentials and inactive/expired targets are rejected. Conversation history and the cursor commit together. Final input sealing and action admission recheck the current revision after obtaining the writer, so accepted corrections cannot disappear during cleanup or permit a stale, not-yet-admitted action.

Both native coordinator response modes and delegated/workflow executors receive input at model boundaries. A correction arriving during inference discards the superseded proposal before effects. Approvals remain tied to the task, arguments and input revision; guidance never grants permission. Foreground workflow calls still await their native result, while their child receives the correction; a background `ask_agent` lets the coordinator receive it while that child remains active. Already admitted effects can finish and are retained as evidence. The operator can use Stop when interruption is required. This is cooperative guidance, with no claim of instantaneous cancellation of an in-flight provider request or external action.

Evidence: `bun tests/bot-steering-check.ts` passes all nine actual Agent/HTTP/worker cases: aggregated and streaming inference, approval waiting, the interval after approval but before action admission, an already started shell plus a superseded second batch action, final-answer reconsideration, native delegated work, native foreground workflow and process recovery. They preserve the same occurrence, one guidance event, one transcript delivery and once-only confirmed effects. Nine store checks (59 assertions) cover migration/reopening, checkpoint/event rollback and both real-process writer interleavings between acceptance and sealing. The real HTTP/Chrome panel check submits guidance with the bundled form, keeps it in the current task and renders hostile markup as text; missing authentication and foreign Origin are denied.

During verification, a fixture initially paused inside an owned admission transaction and blocked HTTP input. It now holds the interval after the committed approval and before the next writer. The workflow fixture now respects the actual foreground tool contract, and the panel fixture waits for the visible refreshed button. A subsequent full native run observed the documented transient HTTP 503 while a worker held SQLite; its client now verifies `database_busy` and `Retry-After: 1` and resends the same ID. No acceptance, effect or timing target was loosened. **Corrected for these exercised active-guidance paths; the full comparison remains in progress.**

### 37 — Saved memory could not be corrected in the panel and stayed frozen during work

The panel only displayed notes, and each worker appended its initial full note snapshot to the durable user turn. A correction, removal or expiry during execution did not update that snapshot. Repeated occurrences also carried repeated injected copies into history. Native descendants did not receive the same current saved-note reference.

Migration 15 preserves note IDs and adds a version and update timestamp. The shared store validates scoped edits, recognized credentials, policy overrides and expiration, then commits the edit/removal, invalidation of obsolete pending or answered decisions and a metadata-only event together. Migration 16 binds native decisions to the memory snapshot of their proposal, as detailed in finding 38. Edits and deletion require the observed version. A retry with the exact stored edit payload is a no-op; stale changed payloads cannot overwrite a newer fact. The panel now offers adding, editing and removing saved notes, with the same operations in the authenticated API and CLI. Native `bot_control` supports `update_note` and requires a current version for `forget`; both retain the existing owned-write fence and cancellation.

The coordinator and native descendant/verifier requests receive one ephemeral current-note reference. It is not added to durable history or published as a transcript delta. Input checks compare the executor's observed note fingerprint, including expiration, before admitting a proposal; the action transaction and final sealing recheck after acquiring the writer. A changed snapshot during inference causes reconsideration. Expiry while waiting for approval also discards obsolete decisions. Notes remain untrusted references and grant no permissions. Effects already admitted may finish and retain their evidence.

Removing current saved memory does not erase prior conversations, actual tool results or disk history. Those historical observations are explicitly separated from the current snapshot. Legacy embedded snapshots are historical references; this change does not pretend to securely erase their bytes. Large note sets, context-window capacity, retrieval across long histories and broader historical secret cleanup remain under review.

Evidence: `bun tests/bot-notes-check.ts` passes eleven actual Agent/HTTP/worker cases covering correction, removal, real clock expiry during inference and approval waiting, cancellation of old approvals, changed memory after approval but before action admission, native delegated work, foreground workflow, parallel observers preserving a fresh approval, streaming and process recovery. No stale source read or shell effect is admitted, no injected current snapshot persists, and no additional occurrence is created. Store checks cover stable identity, idempotency, stale edits/deletion, scope, native event rollback, admission/sealing fingerprints and actual version-15/16 upgrades/reopening. The actual Chrome form verifies hostile markup rendered as text, a stale open editor against a concurrent correction, and deletion using the refreshed version. HTTP additionally rejects unauthenticated, foreign-Origin, cross-bot and malformed-version edits. Installed commands exercise schema version 16, correction/idempotency, stale edit/deletion rejection and removal.

Verification caught an old fixture's event-index assumption after adding note events; it now queries its actual Diagnostic type and retains the redaction assertion. The deterministic main-runtime provider now identifies the actual user task before the appended reference, preserving its original effect and delivery assertions. A Chrome fixture's global `const` redeclaration was scoped, and stale-answer checks use the authenticated HTTP retry contract for native `SQLITE_BUSY`. These repairs do not loosen behavioral targets. **Corrected for the exercised memory-management and freshness paths; the full comparison remains in progress.**

### 38 — A later memory observer cancelled a fresh approval from another agent

Every executor that noticed a changed note snapshot cancelled all outstanding decisions for its run. An agent could already have requested a new approval using the corrected memory before a second agent noticed the same correction; that second observer then cancelled the fresh approval. An edit to an already expired note also cancelled approvals even though the active snapshot had not changed. Separately, consuming one of two pending decisions always marked the run running, preventing the remaining pending decision from being answered.

Migration 16 stores private `memory_revision` provenance outside the displayed decision request. Native workers persist the proposal's observed revision. Creation, answering and consumption recheck it inside their transactions. Note changes and late observers cancel only decisions whose provenance is absent or differs from the current visible snapshot, and keep the run waiting while any pending or answered decision remains. Consumption also retains that waiting state. Historic decisions keep their original displayed request and are conservatively discarded when input changes; the migration does not invent a previously observed snapshot. Expired snapshots remain fenced from action admission and final sealing.

Evidence: five new store checks initially failed against the prior implementation. The corrected store passes all eleven note tests, including late observers preserving both pending and answered fresh decisions, invisible-note changes, expiry at creation/answer/consumption, parallel decision consumption and actual migration-16 reopening. `bun tests/bot-notes-check.ts observers` runs a foreground workflow with two real native agents. Both initially observe old memory; after correction, the writer requests fresh approval while the reader's old response remains held. Releasing the reader forces a later real observer to reconsider, preserves the pending approval and waiting state, and permits exactly one authenticated, approved file mutation in the same occurrence. No old-source read or effect is admitted. Initial fixture attempts requested a shell from a reader and then from a serialized writer; native role and workspace restrictions correctly refused them. The fixture now explicitly selects the coder and uses its permitted path-validated file mutation, retaining those restrictions and the twenty-second boundary deadline. **Corrected for these decision and observer races; the full comparison remains in progress.**

### 39 — Replayed external events could gain new recipients and carried unbounded data

Before this pass, event idempotency was recorded per routine run. Replaying an old provider event after adding or enabling a matching routine could therefore queue work for that new recipient. Dispatch also accepted unbounded JSON and copied it into every matching prompt. The event feature had no authenticated HTTP ingress, and using the panel's master token for an integration would have granted that integration access to every bot.

Migration 17 records a durable receipt per topic, event ID and scope, including the original run IDs and a hash of the canonical, redacted payload. Exact retries return the original recipients, including an empty set; changed payloads collide. Payloads are capped at 65,536 UTF-8 bytes and 32 nesting levels before redaction and queueing. One event can match at most 50 enabled routines per bot; each bot can have at most 256 pending event runs. Full queues reject the whole occurrence with HTTP 429 and `Retry-After: 10`, without writing a receipt, so the provider can retry the same event later. `POST /api/bots/BOT_ID/events/TOPIC` accepts only a matching per-bot/per-topic webhook credential. Migration 18 stores only a SHA-256 verifier for a generated random secret; an authenticated administrator can rotate, list metadata or revoke it. Migration 20 additionally stores its Ed25519 public key, so the secret can sign exact request bytes without SQLite retaining a forgeable HMAC key. Credentials created before this migration keep bearer access but must be rotated to get a signing key. The secret is returned only on creation/rotation, and event credentials cannot read bot data or operate another topic. The existing panel token is not accepted for event delivery.

The event input is still untrusted model context, not proof of authorization. Recognized secret patterns are redacted; arbitrary opaque credentials cannot be guaranteed detectable. Migration 20 adds a durable fixed-window limit of 120 newly accepted events per bot/topic per minute by default. Exact receipt replays are free; a rejected queue-full or rate-limited event consumes no quota and creates no receipt. Operators can override the limit when starting the server. Provider-specific HMAC/signature adapters and provider connectors remain open. Automated retention now removes eligible event receipts, bot event rows and finished run state according to each bot's configured policy. Legacy bot-level transcripts have no trustworthy run owner and remain preserved for operator review.

Evidence at migration 18: `bun test tests/bots.test.ts` passed **28 tests and 198 assertions**, including event bounds, redaction, reordered-JSON retries, changed-payload rejection, frozen recipients, no-match receipts, old-schema upgrade, credential scope/rotation/revocation, at-rest hash checks, fan-out limit and atomic queue backpressure. `bun tests/bot-web-check.ts` exercises actual HTTP delivery, session/master-token rejection, bad Origin, per-bot/topic isolation, one-time credentials, secret rotation/revocation, payload rejection, a full queue, `Retry-After` and retry behavior. Typecheck, build and `bun run pack:check` passed; the installed package created schema version 18 and included both new tables. `git diff --check` passed. **Corrected for these event intake and replay paths; provider-level verification and the broader product comparison remain in progress.**

### 40 — Routine editing was missing and past one-time runs stayed silently inert

The panel and native tool could create or pause routines, but could not safely change an existing prompt, schedule or procedure inputs. A `once` schedule in the past passed validation, remained marked enabled, and had no next occurrence; an already-consumed one-time routine could also be re-enabled without useful effect.

Migration 19 adds an optimistic version to each routine. The scoped store, HTTP route, panel and `bot_control` now support editing future occurrences while already queued runs keep their original instructions. Same-payload retries are idempotent; stale changed edits and stale toggles are rejected. Past one-time schedules are rejected at creation and editing, and a consumed/expired one-time routine must be edited to a new future time before it can run again.

Verification at migration 19: `bun test tests/bots.test.ts` passed **30 tests and 219 assertions**. The installed package check opened schema version 19. The complete suite passed **2358, skipped 4, zero failures and 5995 assertions across 206 files**. These are the preceding routine-edit results; migration 20 verification is recorded below.

### 41 — Draft HMAC verification key was recoverable from the database

The first signature implementation derived the HMAC key directly from the webhook secret hash stored in SQLite. A database-only leak would therefore have been enough to mint valid signed requests, weakening the existing hashed-bearer credential model.

Schema 20 now stores an Ed25519 public key alongside the secret verifier. The issued random secret contains the signing seed and is returned once; only the public key is retained. Exact raw request bytes are verified with Node's Ed25519 implementation. The established bearer route remains available, including for credentials created before migration 20; those old credentials must be rotated before signature mode can be used.

The store check covers signature validity, altered body, bot/topic scope, and that SQLite does not contain the signing seed. The real HTTP check covers signature-only delivery and exact replay, plus duplicate exemption, durable 429/Retry-After and retry after the persisted window. `bun test tests/bots.test.ts` passes **31 tests and 231 assertions**; `bun tests/bot-web-check.ts`, `bun run typecheck`, and `bun run pack:check` pass, with the installed CLI creating schema 20. The complete `bun test tests` suite passes **2359, skips 4, zero failures and 6007 assertions across 206 files**; `git diff --check` is clean. **Corrected for these credential, signature and intake-rate paths.**

### 42 — Recurring routines had no end date

Interval, daily and event routines could remain enabled indefinitely. They now accept an optional inclusive `endsAt` epoch-millisecond timestamp. The panel edits this as a local date/time; the store rejects past cutoffs and timer schedules with no occurrence before the cutoff. A timer occurrence already due on or before its cutoff may catch up once, then the routine expires. Event subscriptions accept deliveries through the cutoff and are disabled after it. Expiry is versioned and recorded as `BotRoutineExpired`; users can edit an expired timer with a new schedule before enabling it. Existing schedules keep their current behavior until edited.

Focused verification: `bun test tests/bots.test.ts` passes **35 tests and 253 assertions**; `bun tests/bot-web-check.ts` passes with the real panel form round-trip, and `bun run typecheck` passes. `bun run pack:check` passes and the installed CLI preserves `endsAt` when creating and listing a routine. The full suite recorded **2362 passes, 4 skips and one failure** in `tests/browser/cdp.test.ts`, where a killed Chrome process briefly left its profile directory behind; rerunning that browser file in isolation passed **7 tests, one expected skip, zero failures**. `git diff --check` is clean. **Corrected for schedule expiry; run, event and receipt retention is now configurable per bot. Legacy bot-level transcripts remain review-only.**

### 43 — New tasks inherited another run's transcript

The worker loaded and checkpointed conversation text on the bot identity, so a fresh routine or unrelated user task could receive earlier task-specific messages. Goal and todo state had already been separated per occurrence, but conversation state was not. Migration 21 adds a transcript to each run, and worker restore/checkpoint operations now require that run's identity. The panel loads a selected run's transcript; the bot-level view uses only the latest run. A transcript from a legacy database has no reliable run owner, so it remains visible for operator review and is not injected into newly queued work.

Evidence: store coverage verifies that two runs retain separate checkpoints, a fresh run does not import the legacy transcript, the legacy bytes remain reviewable, and cross-bot/run access is rejected. The authenticated HTTP check verifies `/api/runs/:id/transcript`. Focused store, HTTP and type checks pass, and `bun tests/bot-runtime-check.ts` passed against actual Agent and worker processes after asserting that run context is isolated and sentinel supervisor secrets are absent. **Corrected for per-run isolation and eligible-run retention; ambiguous legacy history and large-history retrieval remain open.**

### 44 — Routine management lacked the documented total cap and run history

Event fan-out already had a per-event limit, but users could create an unbounded number of routines across a bot. The interface also lacked an immediate one-off run, bounded recent run history and schedule deletion. The store now caps a bot at 50 routines, counting paused routines and checking inside the creation transaction. It records up to 20 recent runs for a routine, supports an idempotent manual run without rewriting its schedule, and deletes a routine with optimistic version checking. Deletion does not cancel queued work. The panel and authenticated routes expose these controls; `bot_control` treats manual run and deletion as actions requiring exact approval.

Evidence: store/control tests cover the cap (including paused entries), repeated manual-run requests, recent history, stale delete, queued-work preservation and approval. HTTP and packaged CLI checks also verify that run history remains accessible after its schedule is deleted. **Corrected for these management paths and isolated safe previews; provider-specific delivery remains open.**

### 45 — Workers inherited unrelated supervisor secrets

The supervisor previously launched workers with the full `process.env`. That exposed unrelated provider API keys, the panel's master token and arbitrary supervisor variables inside every worker process. Worker creation now uses an explicit runtime allow-list and adds cloud credentials only when the configured provider is Bedrock. Provider configuration is loaded from the application's saved profile before spawn; shell/browser helper subprocesses retain their own scrubbed environments.

Evidence: `tests/bot-environment.test.ts` confirms arbitrary values, unrelated API keys, panel credentials and inactive cloud credentials are excluded, while selected Bedrock credentials are retained. `bun tests/bot-runtime-check.ts` launches actual Agent/worker processes and verifies the sentinel supervisor secret, panel token and unrelated API key are absent. **Corrected for the worker environment transfer; same-UID plugins/processes and OS isolation remain outside this boundary.**

## Verification so far

- Current verification after schema 21: `bun test tests/bots.test.ts tests/bot-steering.test.ts tests/bot-environment.test.ts` passed **47 tests, zero failures and 344 assertions**; `bun tests/bot-web-check.ts`, `bun tests/bot-runtime-check.ts`, `bun run typecheck`, `bun run pack:check` and `git diff --check` passed. The installed CLI creates schema 21, checks the per-run transcript column and exercises run-once/history/delete after schedule deletion; the shipped network helper also passed its authenticated relay, blocked-address and credential-stripping checks. The complete `bun test tests` suite passed **2366, skipped 4, zero failures and 6061 assertions across 207 files**. The first full-suite run exposed a stale test trigger aimed at the legacy transcript table after migration 21 moved checkpoints to `bot_runs`; isolation reproduced it, the test now targets the per-run table, and the full rerun passed. Three OAuth multi-tool cases were environment-gated and the browser Windows case is platform-specific.
  - The previous complete repository suite passed: **2359 passed, 4 skipped, zero failures, 6007 assertions across 206 files**. The latest run after schedule expiry recorded **2362 passes, 4 skips, one Chrome profile-cleanup failure and 6028 assertions across 206 files**; the failing browser file passed on isolated rerun. These runs include schema 20 signatures/rate limits, routine edits and the corrected native-tool catalog check; they confirm that `bot_control` remains contextual: allowed to persistent workers in Build/Auto, denied in Plan/Review. One skip is the expected Windows-only browser case; three OAuth multi-tool cases are environment-gated.
- The preceding pre-migration-19 complete repository suite passed **2356, skipped 4, zero failures and 5974 assertions across 206 files**; retained here only as the comparison run before routine-edit coverage was added.
- Latest completed broad kernel, workflow, subagent, orchestration, browser, file-tool, supervisor and bot-store regressions: **225 passed, one expected Windows-only skip, zero failures, 1161 assertions across 21 files** after migration-16 decision provenance. Includes version-15/16 note and decision upgrades, fresh approval preservation, scoped optimistic edits/deletion, note-event rollback and owned note controls, guidance upgrade/reopening, acceptance/sealing writer races, cursor/history rollback, concurrent real migrators, callback migration rollback, pending/cancelled startup, fresh leases, frame HTTP ownership, trusted/untrusted TLS, real ws/wss, helper crashes, concurrent first calls, overlapping closes, atomic control-event rollback, fenced control mutations and awaited browser recording/review. The first memory broad attempt hit the existing five-second completion-procedure deadline; its isolated check and the complete repeat passed without changing limits. Earlier broad timing failures also passed on unchanged repeats. The cause of those timing failures was not established.
- Active guidance: all nine real Agent/HTTP/worker cases passed, including aggregate/streaming inference, superseded approvals, admission races, retained once-only effects, delegated work, foreground workflow and recovery. The real Chrome form/authentication check passed. Separate native Agent regressions passed **45 tests and 104 assertions**; authorization/configuration/steering/descendant compatibility passed **45 tests and 111 assertions across eight files**. These suites overlap other coverage; counts are not additive.
- Current memory: all eleven actual worker cases passed after migration-16 decision provenance, including real expiry during inference and approval waiting and two parallel native observers. All nine active-guidance cases, the Chrome editor/authenticated HTTP panel, and the actual Agent/Chrome/background runtime passed again. Separate native Agent/authorization/configuration/steering/descendant regressions passed **91 tests, zero failures and 217 assertions across nine files**. The complete native control check now passes five cases: scheduling, learning, correction and deletion under eight-second separate-process SQLite locks, plus expired ownership under a 31-second lock. Store/control coverage is included in the broad counts. These counts overlap other suites and are not additive.
- Separate complete kernel suite, repeated after migration-16 decision provenance: **151 passed, zero failures, 321 assertions across six files**, including atomic callback migration, store, events, workflows and worktree ownership. This suite overlaps the broad regression run; counts are not additive.
- Separate real worker startup check: all four cases passed, covering pending migration, contended claim, cancellation and a real schema error. Provider delivery and actor ownership cleanup are checked against actual processes and SQLite state.
- Separate real Chrome socket gate: passed, zero blocked-address handshakes with a reachable positive control.
- Real HTTP/Chrome panel check: passed with the startup/migration corrections, including expiry/logout and private DOM cleanup.
- Actual Agent/process check: passed after the control/provenance corrections, including native delegated delivery, browser takeover, privacy, recovery, cancellation and contended DOM-drift review.
- Separate real Agent/worker lease check: passed for eight-second and 31-second native SQLite locks, proving short-lock delivery and rejection/recovery of expired ownership.
- Separate real Agent/effect/database write check: all seven cases passed, covering response checkpoints, once-only shell result delivery, call/result activity, expired ownership and permanent result-event failure. Expired or unrecorded effects remain blocked for reconciliation.
- Separate real Agent control check: all three cases passed after migration 13, covering scheduling, manifest publication after learning commits and expired ownership under native SQLite locks.
- Separate real Agent terminal-cleanup check: all four cases passed with the zero-timeout worker connection, covering contended completion, prompt stop, missing-provider cleanup and real schema-error propagation. Startup's four cases, control's three cases and effect/activity writes' seven cases passed again, as did the short/expired lease checks and actual Agent/Chrome/background process check. Focused store/control/kernel checks passed **67 tests and 358 assertions**; these counts overlap the broad run.
- After active-guidance integration, startup's four cases, controls' three cases, effect/activity writes' seven cases, terminal-cleanup's four cases, eight-second/31-second lease cases and the actual Agent/Chrome/background check all passed again. Prior lease, cancellation, effect uncertainty, handoff and procedure-review safeguards remain checked through actual workers and native SQLite.
  - `bun run pack:check` rebuilds before packing, installs the generated tarball and confirms schema version 21, the per-run transcript and webhook/rate-limit migrations, routine run/history/delete commands, note/guidance/terminal-fencing controls and shipped network-helper traffic.

The code and packaging checks for the completed lifecycle and safe-preview phases pass. Hosted execution while the local host is off and native mobile clients are explicitly outside this implementation scope. Provider connectors, group sessions and automatic result routing, child-task review controls, broad history retrieval, and stronger OS/network containment remain open and are tracked in the phase table.


### 44 — Safe routine previews and retention policy

Schema 23 adds a separate test-run mode for routines. It executes only bounded local inspection tools; shell, browser, network fetch, MCP, writes, integrations, scheduling, messaging and other effectful proposals are recorded as simulated and never reach their executors. Test output and Agent state use `test-runs/<run-id>`, while the persistent Codimium profile, production schedule and webhook receipts remain unchanged. Simulated browser runs cannot be learned into production skills. Model/provider inference still runs to generate the preview, so this mode is not free and does not promise zero provider-side network traffic.

Schema 24 adds an opt-in per-bot retention period (30–3650 days; disabled by default). Hourly bounded cleanup removes terminal, unowned runs and their per-run Agent data, expired event receipts and bot event records. It stages rows before filesystem deletion and resumes on a later pass if cleanup fails. Active work, uncertain consequential effects, runs used as browser-skill sources and runs referenced by unexpired receipts are retained. Persistent Codimium browser data is outside run cleanup. Ambiguous pre-migration bot-wide transcripts remain preserved because no run can safely claim them.

Evidence: `bun test tests/bot-routine-test.test.ts tests/bot-data-lifecycle.test.ts tests/bots.test.ts` passes 46 tests and 373 assertions, including simulated effects, non-learning, resumable cleanup and protection of active/uncertain/skill-source data. `bun tests/bot-runtime-check.ts` passes the actual isolated worker, browser login and profile restoration path. `bun tests/bot-web-check.ts`, `bun run typecheck`, `bun run pack:check` and `git diff --check` pass. **Phases 1 and 2 complete for the documented local execution model.**
