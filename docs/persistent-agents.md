# DeepSeek Pods implementation

The goal is to bring the persistent-agent architecture discussed with Marcelo into DeepSeek Code: durable identities and responsibilities, execution independent of the terminal, recovery, memory, persistent browser sessions, scheduled/event work, coordination, reviewable approvals and remote supervision.

The existing `Agent`, `OrchestratorSession` and `WorkflowManager` remain the execution engine. The supervisor owns durable incoming work; it does not introduce a second implementation of subagent execution. SQLite uses the existing kernel store and migration runner. A separate worker process per active bot isolates the existing process-scoped goal, todo, checkpoint and browser state.

## Delivery and evidence

The initial delivery checklist below is separate from the ongoing [deep review and competitor comparison](persistent-agents-review.md). That review records additional corrections, verification and remaining capability gaps; it does not certify full commercial-product parity.

- [x] Durable bot identities, conversations, work queue and provenance-bearing notes.
- [x] Service independent of clients, worker lifecycle and reconstruction after restart.
- [x] Serial execution per bot, bounded concurrency across bots and cancellation.
- [x] Persistent decisions and exact-action approvals, with uncertain effects requiring reconciliation.
- [x] One-time, interval and timezone-aware daily routines; optional expiry on recurring schedules; event deduplication and distinct occurrences.
- [x] Agent integration: configured provider, existing tools, conversation checkpoints and background handoffs.
- [x] Persistent Codimium profile and browser state, preserving disposable behavior for ordinary sessions.
- [x] Terminal controls and authenticated responsive web interface for conversations, activity and decisions.
- [x] Browser observation and human takeover, including remote operation.
- [x] Skills derived from completed browser procedures and revalidation before routines.
- [x] Deployment instructions for local supervision and remote hosting; no claim of provisioned infrastructure.
- [x] Focused behavioral checks and end-to-end execution against the real Agent path.

## Invariants

Closing a client never stops authorized background work. Stopping a run and disabling a routine are separate operations. Each bot has at most one executing turn. Every occurrence has its own stable ID; recovering it retains that ID. External events are idempotent by event ID. A durable approval is bound to the proposed action and cannot silently approve changed arguments. Unknown external effects are reconciled before replay. Credentials belong in provider profiles and human browser takeover, never in model instructions or learned procedures. Existing permission denials remain mandatory. A remote worker needs its provider and integrations accessible from its own host.

## Progress

Implementation started from a clean working tree. Current source inspection confirms that `src/kernel` is not the main Agent runtime; the integration reuses its SQLite wrapper rather than replacing working orchestration.

The terminal path is implemented in `src/bots`. Each worker executes the real `Agent`, journals consequential effects, restores only that run's conversation and the occurrence's own goal/todos, and waits for its background tasks before completing. New occurrences start with fresh goals and todos; retrying an older occurrence restores its own checkpoint even if other work has run since. Delegated outcomes are committed to that run's conversation and returned to the coordinator for review and delivery; necessary follow-up uses the same native tools and approvals. Up to ten result follow-up turns are admitted, after which the run reports that intervention is required. Failed delegated work remains a failed run even when the coordinator explains it. Task snapshots are per run so historical completed tasks do not consume the next routine's admission budget. Unknown effects in a cancelled run also hold subsequent work until operator reconciliation. Approvals are single-use and bind the original arguments even when their displayed form masks secrets.

Timer routines keep at most one outstanding occurrence each while its previous occurrence is queued, executing, waiting for approval or stopping. The overdue timestamp stays visible. After the previous worker stops, one catch-up occurrence uses current sources and the next deadline advances from the dispatch time; elapsed timer ticks are coalesced. Interval and daily schedules can include an optional inclusive `endsAt` epoch-millisecond timestamp; event subscriptions use the same cutoff, and the panel accepts local date/time input. A timer occurrence due on or before the cutoff may catch up once, then the routine expires. Expiry disables future occurrences and is recorded in activity; an expired routine must be edited with a future cutoff before it can be enabled again. Distinct external events retain their separate payloads and occurrence IDs.

Each bot can hold at most 50 routines total, including paused routines; a rejected creation does not change existing schedules. The panel can run a routine once, inspect its latest 20 runs, edit or pause it, or delete the schedule. The CLI equivalents are `run-routine`, `routine-runs` and version-checked `delete-routine`. Deleting a schedule never deletes or cancels work it already queued. These actions do not bypass the worker's approval rules for external effects.

Create a credential for exactly one bot and topic with an authenticated `POST /api/bots/BOT_ID/webhooks/TOPIC` and body `{}`. The response contains a random `dsk_hook_...` secret once; SQLite stores its SHA-256 verifier and an Ed25519 public key, never the signing seed. Repeating this operation rotates the secret immediately. List credential metadata with `GET /api/bots/BOT_ID/webhooks`, and revoke with `POST /api/bots/BOT_ID/webhooks/TOPIC/revoke` and `{}`. Do not give an integration the panel's `DEEPSEEK_BOTS_TOKEN`, which controls every bot.

Deliver an event with `POST /api/bots/BOT_ID/events/TOPIC`, JSON `{ "eventId": "provider-event-id", "payload": { "issue": 42 } }`, and `Authorization: Bearer dsk_hook_...`. For integrations that can sign requests, send `X-DeepSeek-Signature: ed25519=<base64url-signature>` instead; sign the exact UTF-8 request-body bytes with the Ed25519 seed encoded in the issued secret. A matching enabled event routine is required. The webhook secret can only trigger its own bot/topic; browser-session cookies and the panel token do not authorize this route. The response is `202` with the run IDs. Repeating the same topic and event ID with the same redacted JSON returns the original runs, even after restart or routine changes; reusing it with changed data is rejected. Exact retries return their original run IDs without consuming another rate-limit slot. The receipt records a payload hash and run IDs, while the queued prompt contains the bounded payload after recognized secrets are redacted. Payloads are limited to 65,536 UTF-8 bytes and 32 nested levels, at most 50 matching routines can fan out per bot, and each bot has a 256-run pending event queue. By default, up to 120 newly accepted events per bot/topic are allowed in each 60-second window; the application can override this when starting the web server. Rate-limit responses use HTTP `429` and a calculated `Retry-After`; a full queue also returns `429` with `Retry-After: 10`. Remote integrations require the panel's HTTPS deployment. Provider-specific signature formats/adapters and prebuilt connectors are not implemented.

For Node.js, derive the Ed25519 key from the one-time secret and sign the same bytes that will be sent:

```js
import { createPrivateKey, sign } from 'node:crypto'

const seed = Buffer.from(secret.slice('dsk_hook_'.length), 'base64url')
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der', type: 'pkcs8'
})
const rawBody = Buffer.from(JSON.stringify(event))
const signature = 'ed25519=' + sign(null, rawBody, key).toString('base64url')
// POST rawBody unchanged and include { 'X-DeepSeek-Signature': signature }.
```

Credentials issued before schema 20 continue to work as bearer tokens. Rotate them to enable Ed25519 signed delivery. Schema 21 adds a transcript to each run. Ambiguous conversation history from older versions remains available for review and is not copied into a guessed task.

Before launching a worker, the supervisor builds an allow-listed environment for the selected provider. Arbitrary supervisor variables, unrelated provider keys and the panel token are dropped. Bedrock credentials are forwarded only when Bedrock is the selected provider. Native commands and browser helpers continue to receive their separately scrubbed environment.

The running supervisor yields when another SQLite writer is active, keeping panel reads and IPC responsive. Contended panel writes return HTTP 503 with `Retry-After: 1`; resubmit queued work with the same occurrence ID. Bot creation, enqueue and enable changes commit atomically with their events. Worker heartbeat contention grants no additional ownership time: renewal checks expiration after acquiring its write transaction, and an expired worker cannot commit a late result. `bun tests/bot-lease-check.ts` verifies actual worker delivery under an eight-second write lock and denial/recovery under a 31-second lock.

Owned checkpoint, action-result, decision and bot-control commits can retry temporary writer contention while the same task owner remains live. Each database attempt checks ownership inside its write transaction; cancellation, expiration and non-busy errors stop the retry. Controls compose worker and native execution cancellation signals. External actions are executed once outside the retry. Browser recording must finish before advancing the learned procedure. Synchronous progress callbacks queue activity writes; action admission, conversation checkpoints and cleanup await that queue. `bun tests/bot-write-check.ts` proves checkpoint delivery, ordered activity events and a single actual shell effect through eight-second locks. A 31-second result/event lock or a permanently rejected result event leaves that effect blocked for reconciliation. `bun tests/bot-control-check.ts` separately proves native scheduling and learning through writer contention, including rejection of expired owners.

Supervisor, worker and terminal startup retry contended opening and pending migrations without blocking the JavaScript thread. Supervisor and worker waits can be cancelled while another process still owns SQLite's writer. Concurrent migrators recheck each version after obtaining the writer. Failed initialization closes partial connections; stopped workers release actor ownership. Initial task leases start after writer acquisition. `bun tests/bot-startup-check.ts` checks real worker upgrades, contended claims, cancellation and schema errors; other errors remain fatal rather than being retried as contention.

Workers use zero native SQLite busy timeout and yield during owned-write retries. After effects and browser cleanup stop, terminal-owner acknowledgement retries contention without renewing the task lease. A stop signal can end that wait; the supervisor must then observe the worker's exit before acknowledging on its behalf. `bun tests/bot-stop-check.ts` verifies eight-second contended completion, prompt SIGTERM and genuine schema errors through actual Agent/worker processes.

`tests/bots.test.ts` covers persistence, ownership fencing, descendant uncertainty, scoped notes, idempotent handoffs/routine creation, scheduling and DST. `bun tests/bot-runtime-check.ts` runs actual worker processes and the real Agent/HTTP/tool path against a local deterministic provider: exact approval, refusal, restored history, a crash after an actual filesystem effect, client exit while the supervisor continues, and cancellation without disabling a routine. It doubles configuration only; it does not replace the Agent or tools. It needs permission to open a loopback HTTP listener.

Codimium uses an isolated, private profile per bot. Graceful shutdown preserves native browser storage and a private session-cookie cache; a crash keeps the last valid cache. Previously open page paths are hints, with query/hash values removed. Cold starts require fresh origin approval and navigation; unsaved forms and DOM state are not restored. Ordinary CLI sessions and child contexts retain disposable browser isolation. The browser feature still uses the project's existing opt-in configuration.

Browser HTTP checks cover page/frame subresources and worker traffic, including restored service workers before their page opens. Native default execution contexts distinguish inherited srcdoc from opaque frames; opaque frames and workers cannot inherit localhost access. Cold starts require fresh origin approvals.

Each context uses an authenticated private proxy for HTTP, HTTPS, ws and wss. Resolved addresses are validated and pinned for each outgoing connection; upstream HTTPS verifies the original hostname and certificate. Codimium trusts only its ephemeral proxy key, and no host CA is installed. The browser requires installed Node.js and OpenSSL in addition to Chrome/Bun; missing protection stops launch, and helper failure closes Chrome. The separate socket gate now passes with zero blocked-address handshakes. General UDP/raw-transport and OS containment remain under review; see findings 12–21 and the comparison gaps.

The authenticated panel shares the same database and supervisor as the terminal. It supports conversations, tasks, exact decisions, routines, activity, effect reconciliation and mobile layout. Worker IPC provides screenshots and human browser controls without exposing a CDP port. Taking over pauses new agent actions; returning control clears browser console/request telemetry that could contain human-entered credentials. Human effects are journaled by action kind, with raw typed text and screenshots excluded. Closing the view does not return control: the operator must use **Return to agent**. A handoff also needs its **Done** question answered. A task must be active to control its worker's browser.

`bun tests/bot-web-check.ts` checks actual HTTP authentication, host/origin validation, cookies, stale approvals, logout, bearer and Ed25519 webhook delivery, durable rate limits, event idempotency and the shared queue. With Chrome available, it also runs the bundled panel script, signs in, sends a task, checks a 390px mobile layout and signs out. `bun tests/bot-runtime-check.ts` now also exercises a real headless human login through HTTP → supervisor IPC → worker → Chrome, proves the agent waits for control to return, and checks that the typed fixture password is absent from transcript, events and action records. Native browser checks cover persistent sessions, storage, crash recovery and disposable contexts. These use temporary state and a deterministic local provider, not Marcelo's accounts.

Learned browser procedures reuse the native recorder and `skill` reader. The database stores sanitized observed steps; manifests live privately at `actors/<bot-id>/skills/<skill-name>/SKILL.md`. Learning commits the database record before publishing its manifest. Learning requires a completed, stopped, uninterrupted demonstration beginning with navigation and ending with a successful native `expect`. Typed/select values, expected text and query-bearing URLs become required inputs; demonstration values and human-entered credentials are excluded from the manifest. A skill version is immutable and scoped to its bot. Procedure invalidation awaits its owned database commit before removing the ready manifest, and routine enabling checks readiness in the same write transaction.

Both note content and provenance sources reject recognized credential patterns. Migration 13 sanitizes historical note sources in the database and preserves safe references. This is logical row sanitization, not a forensic disk-erasure claim or detection of every possible secret.

Bound routines carry the version ID and their declared inputs into each distinct occurrence. Before every native action, including each batch step, the worker checks the current page and a unique, available role/name target. Native origin and action approvals remain in force. A changed target, unfinished procedure or interrupted replay blocks completion and pauses bound routines. A fresh demonstration creates a new named version; it cannot silently replace the old binding. Coordinate actions, standalone keyboard actions, uploads and other steps without a reproducible native locator become human handoff steps. Manual browser operations also leave an explicit human segment, with consecutive operations grouped into one handoff and raw values excluded. Historical procedures involving human browser actions require a fresh demonstration; their bound routines are paused during migration. Recordings above 500 steps or with unsafe locators cannot be learned; this affects learning, not ordinary task execution. Split such procedures into smaller demonstrations.

The runtime check now proves native background ownership (the coordinator finishes while a child is deliberately held), real workflow child execution, a bounded supervisor slot, a queued handoff to a second configured bot, skill learning/reuse with fresh inputs, and rejection of a changed DOM target before its effect. The web check also learns and binds a skill through the actual panel forms and checks authenticated, scoped manifest download. The audit found and corrected a native result-schema mismatch for token breakdown metrics; unknown and negative metric fields remain rejected. It also verifies that a current policy denial wins over an older coordinator grant. No background service has been installed or started for Marcelo outside these isolated checks.

## Acceptance evidence

| Requirement | Authoritative check |
| --- | --- |
| Durable identities, transcript, notes, ownership and queue | `tests/bots.test.ts`: separate database connections, scoped notes, fenced owners and idempotent occurrences |
| Renamed Pods CLI command | Packaged smoke check verifies `deepseek pods help` and rejects `deepseek bots` with the replacement command |
| Independent supervision, bounded workers and coordination | `bun tests/bot-runtime-check.ts`: exited enqueueing client, waiting concurrency slot and actual second-bot work |
| Configured engine, native tools and background completion | Runtime check: real Agent/HTTP provider, held native child and native workflow; Agent/config/workflow regression tests |
| Mandatory configurable completion review | `tests/bot-reviewer-model.test.ts`, `tests/bot-web-check.ts` and packaged CLI check cover inherited/custom model selection and fail-closed tool-free verification |
| Exact approvals, cancellation and uncertain effects | Runtime check: approval/denial, actual crash after a filesystem effect and reconciliation; store and subagent permission checks |
| Timezone schedules, DST and event deduplication | `tests/bots.test.ts`: Fortaleza weekdays, New York fold, coalesced intervals and distinct event IDs |
| Codimium storage, isolation, recovery and human control | Native browser service/tool checks plus runtime HTTP → IPC → Chrome login, retained cookies and stale-image rejection |
| Authenticated responsive web supervision | `bun tests/bot-web-check.ts`: real HTTP/CSP/Host/Origin/session checks and bundled JavaScript in Chrome at 390px |
| Per-pod export and safe deletion | `tests/bot-data-lifecycle.test.ts`, `bun tests/bot-web-check.ts` and packaged `deepseek pods export` / `deepseek pods delete` checks |
| Learned skills and fresh revalidation | Runtime demonstration → native skill reader → new-input routine → DOM drift rejection; store checks and real panel forms |
| Existing engine compatibility and delivery | Focused Agent/subagent/orchestration/workflow/skill/browser regressions, `bun run typecheck`, `bun run build`, launcher `deepseek pods help`, `bun run pack:check`, `git diff --check` |
| Local and remote deployment | Commands and process-supervisor/HTTPS proxy instructions below; provisioning is an operator deployment step |

The process-level checks use a deterministic local provider and temporary state. They verify the actual execution paths without charging a real provider or using Marcelo's accounts. They do not certify every external website or integration. Browser secret-field checks and redaction cover the existing supported fields/patterns; a website echoing a secret into ordinary page content must not be treated as safe model input.

## Learn and reuse a browser skill

From a completed task in the panel, select **Learn browser skill**, name it, then choose that skill when adding a routine. The form requests its declared non-sensitive inputs. Download its portable `SKILL.md` from **Learned browser skills**. The terminal offers the same operations:

```sh
deepseek pods learn engineer --run COMPLETED_RUN_ID --name prepare-report
deepseek pods procedures engineer
deepseek pods skill engineer PROCEDURE_ID
deepseek pods routine engineer --name 'Daily report' --prompt 'Execute the observed report procedure with current data.' --schedule '{"kind":"daily","hour":8,"minute":0,"timeZone":"America/Fortaleza"}' --procedure PROCEDURE_ID --inputs '{"input2":"Current report title","expectedText4":"Report saved"}'
```

Use the input names actually declared by that skill. These are explicit routine inputs, not copied demonstration values; the agent must still gather current sources for every occurrence. Inputs remain fixed for that routine, while page state and source checks are fresh. In the panel, choose **Edit routine** to change its prompt, schedule or declared inputs for future occurrences; queued runs retain their original instructions. Edits use an optimistic version check, and a stale form must be reloaded before making a different change. A learned skill version itself remains immutable. Keep authentication in Codimium human takeover. A manifest is guidance rather than executable code or a permission grant.

One-time schedules must be in the future. After a one-time routine runs, it cannot be re-enabled as though it were recurring; edit it to choose a new future time.

Preview a routine with the real agent while preventing its proposed effects from reaching shell, browser, network fetch, MCP, file writes, integrations, scheduling or messages:

```sh
deepseek pods test-routine engineer ROUTINE_ID
```

Only bounded local inspection tools execute; all other proposed actions are logged as simulated. The preview writes isolated state under `test-runs/` and cannot change the production schedule, webhook receipts, Codimium profile or learned skills. Provider inference still runs and may incur usage.

Retention is opt-in and disabled by default. Configure it in the panel or with `deepseek pods retention engineer --days 180`; use `--days never` to disable it. The policy accepts 30–3650 days. Hourly cleanup removes old terminal runs and per-run Agent state, plus expired receipts and bot event records. It keeps active runs, uncertain effects, browser-skill source runs, recent receipt-referenced runs and persistent Codimium data. Older bot-wide transcripts with unknown run ownership remain available for review. Cleanup stages deletions and can resume after a filesystem error.

## Guide an active task

Choose **Guide task** on a running task in the panel to correct its next steps. The ordinary conversation composer queues new work. The terminal can target the same active occurrence:

```sh
deepseek pods steer RUN_ID 'Use the revised source and reconsider the proposed action.' --occurrence GUIDANCE_ID
```

Find `RUN_ID` with `deepseek pods show`. Use the same `GUIDANCE_ID` and message when retrying a failed request; acceptance is idempotent. Authenticated API clients can send `POST /api/runs/RUN_ID/messages` with `{ "message": "Your correction", "messageId": "GUIDANCE_ID" }`. A native SQLite writer can briefly return HTTP 503 with `Retry-After: 1`; wait, then resend the same ID and content. The panel preserves the ID for a manual retry until the draft changes.

Corrections reach the coordinator and active native descendants at model/action boundaries. Stale pending decisions are cancelled and changed proposals need current approvals. A response still being generated is reconsidered before its actions; an effect already admitted can finish. Use **Stop** to request interruption. Completed effects remain in the history and are not replayed. Guidance targets its occurrence and cannot contain credentials; keep browser authentication in human takeover.

Accepted messages and their delivery cursor survive process recovery. History and cursor commit together, and completion cannot silently drop pending guidance. `bun tests/bot-steering-check.ts` verifies these boundaries with actual workers, the native Agent and a deterministic local provider; `tests/bot-steering.test.ts` verifies native database rollback, upgrade and acceptance/completion writer races.

## Correct saved memory

Use **Add note** or **Edit note** in the panel's Memory section. Record a non-sensitive fact and its source, with an optional expiry. Editing preserves the note ID. An open editor cannot overwrite a newer version: close it and reopen the refreshed note after a stale-edit error. **Remove note** removes the saved fact, while conversation and activity history remain available. Updates apply to new proposals; actions already admitted may finish.

The terminal exposes the same controls:

```sh
deepseek pods notes engineer
deepseek pods remember engineer 'The project convention source is docs/conventions.md.' --source 'user:confirmed'
deepseek pods update-note engineer NOTE_ID 'The source moved to docs/current-conventions.md.' --source 'user:confirmed' --version CURRENT_VERSION
deepseek pods forget engineer NOTE_ID --version CURRENT_VERSION
```

Use the ID and version returned by `notes`. A matching edit retry is idempotent, but a stale changed edit or deletion is rejected. `--expires-at EPOCH_MS` sets an optional expiry on creation or correction; omitting it leaves the corrected note without expiry. Credentials and permission-overriding notes are rejected. Native agents read their own notes with `bot_control notes`, then use `update_note` or `forget` with the observed version; they cannot edit another bot's notes or bypass a lost execution owner.

Authenticated clients can create a note with `POST /api/bots/BOT_ID/notes` and `{ "content": "Saved fact", "source": "user:confirmed", "expiresAt": null }`. Correct it at `/api/bots/BOT_ID/notes/NOTE_ID` with those fields and `version`; remove it at `/api/bots/BOT_ID/notes/NOTE_ID/remove` with `{ "version": CURRENT_VERSION }`. Normal authentication, Origin validation and the HTTP 503 retry contract apply.

Edit a routine through `POST /api/bots/BOT_ID/routines/ROUTINE_ID` with its `name`, `prompt`, `schedule`, current `version`, and optional `procedureId` plus `procedureInputs`. Toggling uses the same route with only `enabled` and `version`. Matching retries are idempotent; stale changes are rejected. Both actions are bot-scoped and keep queued occurrences unchanged.

Current saved notes reach each coordinator and native descendant request as an ephemeral reference, rather than accumulating injected copies in durable history. A correction, removal or expiry during inference invalidates a not-yet-admitted proposal; approvals and final input sealing also check the current snapshot. Each native decision records the snapshot that originated its proposal. A later agent noticing an earlier memory change preserves approvals already proposed from current memory. Editing an expired note outside that snapshot also preserves them. Runs stay waiting while another pending or answered decision remains. Historical conversations and actual note-tool results remain historical observations, not current saved memory. `bun tests/bot-notes-check.ts` includes real clock expiry, delegated/workflow execution, two parallel memory observers and recovery. Large-history retrieval and model context capacity remain under audit.

## Terminal usage

Configure the desired provider using the existing `deepseek` setup first. Then:

```sh
deepseek pods create engineer --project /absolute/project/path --instructions 'Maintain this project and bring observed results for review.'
deepseek pods serve --concurrency 2
deepseek pods reviewer-model engineer --model quality/reviewer-v2
```

Completion review is always enabled and fails closed: an unavailable or rejecting reviewer leaves the goal active. By default, the reviewer uses the pod's configured model. Set a model ID supported by the same provider with `reviewer-model`; use `--model inherit` to return to the default. Changes apply to newly started worker runs; an active run keeps its starting configuration.

From another terminal:

```sh
deepseek pods send engineer 'Inspect the outstanding issue and prepare a change.'
deepseek pods show engineer
deepseek pods steer RUN_ID 'Use the revised source for this current task.' --occurrence GUIDANCE_ID
deepseek pods answer DECISION_ID --fingerprint FINGERPRINT --answer '"once"'
deepseek pods routine engineer --name 'Daily sources' --prompt 'Check current documentation.' --schedule '{"kind":"daily","hour":8,"minute":0,"timeZone":"America/Fortaleza","weekdays":[1,2,3,4,5]}'
deepseek pods cancel RUN_ID
deepseek pods reconcile RUN_ID --evidence 'Describe the effects you inspected and why continuing is safe.'
deepseek pods retry RUN_ID --reconciled
```

`deepseek pods help` lists all operations. Identifiers and fingerprints come from `deepseek pods show`; permissions accept `"once"` or `"deny"`. Question answers are JSON string maps. `--db PATH` on every command selects a separate state database. A pod's notes, logs, workflow journals and task snapshots live next to that database under `actors/<pod-id>`. Credentials are loaded through the existing provider profile mechanism, never supplied as chat instructions.

Export one bot's durable database and Agent-session records with `deepseek pods export BOT`; the JSON includes per-run conversations, task and activity records, notes, routines, procedures and event receipts. It excludes provider credentials, webhook secret verifiers, and the Codimium browser profile/cookies. Treat the output as sensitive data. The authenticated panel provides the same export as a download.

Delete a bot and its private actor directory with `deepseek pods delete BOT --confirm NAME_OR_ID`. Deletion requires every worker to have stopped, every uncertain external effect to be reconciled, and delegated work to be terminal. Queued work is discarded. The project checkout and its files are kept. Deletion stages the bot as disabled and hidden before removing files; if filesystem cleanup fails, repair the path and repeat the command to resume. The panel asks for the exact bot name. Database row deletion is logical: backups, filesystem snapshots and storage-device remnants are outside this operation, and webhook receipts are removed with the bot, ending their idempotency history.

`retry --reconciled` does not erase unknown effects. First use `reconcile --evidence` to record what was actually inspected; only then retry. Stopped tasks retain their worker ownership until cleanup is acknowledged.

Older databases stored one goal/todo snapshot for the whole bot without an occurrence identity. Migration preserves that ambiguous snapshot for inspection and blocks automatic restoration instead of assigning it to a guessed task. Inspect `deepseek pods runtime RUN_ID`. After reviewing the old objective, counters and limits, `deepseek pods reset-runtime RUN_ID --evidence 'Explain why this occurrence can establish fresh goal/todo state and limits'` explicitly initializes fresh task state while retaining the legacy snapshot for audit. This command requires a stopped legacy run, leaves its effects unchanged and does not retry it. Reconcile any uncertain effects separately, then retry with the existing controls. New tasks remain independent of these legacy goals.

## Install on a server you control

`deepseek pods host install USER@HOST` installs the Pods supervisor on a Debian or Ubuntu VM the user already created. If Node.js 18+ and npm are not already installed, use Debian 12+ or Ubuntu 24.04+ so the default repositories provide a supported runtime. This is a bring-your-own-server setup: DSC does not create cloud resources and never asks for Oracle, Google Cloud, or another provider's account credentials. Create the VM in the provider's own console, configure SSH access, and let DSC use that SSH connection to prepare the host. For example:

```sh
deepseek pods host install ubuntu@203.0.113.20
deepseek pods host install opc@pods.example.net --identity ~/.ssh/pods_ed25519 --ssh-port 2222
```

The installer retains OpenSSH's host-key verification. It asks before making changes, installs Node.js 18+, npm, Bun and Chromium when missing, installs the published `@hermenics/deepseek-code` package, enables systemd lingering for the SSH user, and starts `deepseek pods serve --web` as that user. The account needs passwordless `sudo` for the one-time operating-system packages and lingering setting. Use a Debian or Ubuntu cloud image and a regular, non-root SSH account.

The selected local provider must be a configured DeepSeek API profile. DSC sends only that profile over the encrypted SSH connection's standard input; it does not put the API key in a command argument or copy other provider profiles. The host stores the profile in an isolated `~/.deepseek-pods/.deepseek/provider-profiles.json` file with owner-only permissions. The panel token is generated separately and stored in a mode-0600 systemd environment file. Re-running the installer updates the package and replaces the host's copied DeepSeek profile and panel token; it leaves the remote Pods database intact.

The supervisor binds its panel to `127.0.0.1:8787`; the installer does not open a public firewall port or set up a domain. It prints an SSH local-forward command. Keep that tunnel open, visit `http://127.0.0.1:8787`, and sign in with the one-time token printed by the installer. The agent service continues after the tunnel and desktop disconnect; the tunnel is only needed to supervise it from a browser.

This creates a fresh remote Pods database. It does not copy local Pods, project checkouts, browser cookies, or Codimium profiles. Create or clone the projects on the server before creating Pods that work on them. The server must be able to reach the selected DeepSeek HTTPS endpoint. Provider free tiers can require a payment method, impose quotas, run out of capacity, or reclaim idle VMs; those policies and any overage charges belong to the user's cloud account.

## Web and browser supervision

Create a private random access token in `DEEPSEEK_BOTS_TOKEN` (at least 32 characters), then start:

```sh
deepseek pods serve --web --port 8787 --concurrency 2
```

Open the printed loopback URL and sign in with that token. The panel stores its session in an HttpOnly, SameSite=Strict cookie; neither token nor drafts are saved to browser storage. Sessions expire after 12 hours and do not survive supervisor restart. The token permits control of all bots in this database, so keep it private. Login attempts and session counts are bounded. The service refuses a remote bind without an explicit HTTPS public URL.

Use **Open Codimium** while a task is active to observe its browser. **Take over** opens the bot's profile if necessary and pauses new tool actions; already executing operations finish at a safe boundary. Refresh the image, click the page, navigate, switch tabs, enter text, press keys and scroll. Text entry goes directly to the browser and is cleared from the panel after sending. **Return to agent** resumes it. For a requested handoff, answer **Done** after returning control. Image-based interaction is manually refreshed; live video is not implemented.

`serve` runs in the foreground. To keep it alive after closing the terminal or after reboot, run the same command using the host's process supervisor. For example, a Linux user systemd service:

```ini
[Unit]
Description=DeepSeek Pods
After=network-online.target

[Service]
Type=simple
ExecStart=/absolute/path/to/deepseek pods serve --concurrency 2
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
```

Replace the executable path with the installed launcher. Install the unit in the user's systemd directory and enable it with that host's normal service workflow. User services surviving logout require the host's linger configuration; this document does not enable it. On a remote host, install DeepSeek/Bun, Node.js, OpenSSL and Chrome, and configure the provider and integrations there; loopback endpoints refer to that remote host. Copying a laptop profile that points to `127.0.0.1` does not make its provider available remotely. Browser cookies and credentials must remain private to the host/user that owns them.

For the panel, add `--web --public-url https://pods.example.com` to `ExecStart` and load `DEEPSEEK_BOTS_TOKEN` from a private `EnvironmentFile` with mode 0600. Put an HTTPS reverse proxy on that host in front of the default `127.0.0.1:8787` listener. Preserve the public Host header and forward `/` and `/api/` to the listener; the panel validates Host and mutation Origin against `--public-url`. Browser sessions use Secure cookies for that HTTPS origin. Terminate TLS at the proxy and keep the backend port private. No WebSocket or exposed Chromium debugging port is needed.

Configure the provider, integrations, project checkouts and browser executable on the worker host. Browser logins happen in that host's Codimium profile through the authenticated panel; a display is unnecessary. This is single-owner supervision, not a multi-user authorization service. Installation, TLS/domain provisioning, service enablement and host login-survival policies remain operator deployment steps; this implementation does not provision them automatically.
