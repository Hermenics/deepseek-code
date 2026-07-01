# State Machines

> Confidence: 🟢 CONFIRMED (extracted from source code)  
> Generated at: 2026-07-01

## SM-01: Interaction Mode

The system has three interaction modes that cycle via Shift+Tab. The model can only activate `plan` or `build` programmatically.

```mermaid
stateDiagram-v2
    [*] --> build : Default on session start

    build --> plan : Shift+Tab (user)
    plan --> auto : Shift+Tab (user)
    auto --> build : Shift+Tab (user)

    note right of plan
        Read-only tools only.
        Color: yellow.
    end note

    note right of build
        Read + write + shell.
        Risk gates enforced.
        Color: green.
    end note

    note right of auto
        Zero restrictions.
        Only user can activate.
        Color: red.
    end note
```

**Transitions:**
| From | To | Trigger | Guard |
|------|-----|---------|-------|
| build | plan | Shift+Tab | None |
| plan | auto | Shift+Tab | None |
| auto | build | Shift+Tab | None |
| * | plan/build | Model request | `canModelActivateMode()` — blocks `auto` |

---

## SM-02: SubAgent Lifecycle

```mermaid
stateDiagram-v2
    [*] --> running : spawn(task)

    running --> done : iterations complete / final response
    running --> error : exception / timeout / denied

    done --> [*]
    error --> [*]
```

**States:**
| State | Description | UI Representation |
|-------|-------------|-------------------|
| `running` | Agent is actively processing (spinner + tool info) | Spinner + current tool |
| `done` | Agent completed successfully (result + cost displayed) | Green check + summary |
| `error` | Agent failed (error message in red) | Red X + error text |

**Fields tracked:** `id`, `task`, `status`, `colorIndex`, `toolCount`, `lastToolInfo`, `startedAt`, `durationMs`, `result`, `error`, `tokens`, `costUsd`, `role`, `confidence`, `verified`

---

## SM-03: Tool Execution Pipeline

```mermaid
stateDiagram-v2
    [*] --> mode_check

    mode_check --> BLOCKED : tool not allowed in current mode
    mode_check --> risk_assessment : tool allowed (or auto mode → skip all)

    risk_assessment --> confirm_risk : high risk matched
    risk_assessment --> permission_rules : no risk or medium (main agent)
    confirm_risk --> permission_rules : user approved
    confirm_risk --> DENIED : user denied

    permission_rules --> BLOCKED : deny rule matched
    permission_rules --> confirm_permission : ask (rule exists but not matched)
    permission_rules --> hooks : allowed
    confirm_permission --> hooks : user approved
    confirm_permission --> DENIED : user denied

    hooks --> BLOCKED : PreToolUse hook returned block
    hooks --> execute : approved or pass

    execute --> post_hooks : tool completed
    post_hooks --> [*] : result returned

    BLOCKED --> [*] : error message returned
    DENIED --> [*] : DenyAbortError thrown
```

**Special case — Auto mode:** Jumps directly from `[*]` to `hooks`, bypassing mode_check, risk_assessment, and permission_rules entirely.

---

## SM-04: Auto-Compact Lifecycle

```mermaid
stateDiagram-v2
    [*] --> monitoring : session active

    monitoring --> triggered : contextUsage/contextLimit >= threshold (0.85)
    monitoring --> monitoring : below threshold

    triggered --> micro_compact : attempt microCompact first
    micro_compact --> monitoring : freed enough tokens
    micro_compact --> full_compact : still above threshold

    full_compact --> summarizing : LLM call to summarize
    summarizing --> monitoring : success (boundary marker inserted)
    summarizing --> backoff : failure
    backoff --> monitoring : consecutiveFailures tracked
```

**Constants:**
- `CONTEXT_COMPACT_THRESHOLD`: 0.85 (85%)
- `AUTO_COMPACT_BUFFER_TOKENS`: 13,000
- `MICRO_COMPACT_KEEP_LAST`: 5 (recent tool results preserved)

---

## SM-05: Hook Execution Decision

```mermaid
stateDiagram-v2
    [*] --> check_config

    check_config --> pass : no hooks configured
    check_config --> match_pattern : hooks exist

    match_pattern --> pass : no matcher matches tool
    match_pattern --> run_hook : matcher matches

    run_hook --> approve : hook returns approve/empty
    run_hook --> block : hook returns {decision: "block"}
    run_hook --> modify : hook returns {modified_input: {...}}

    modify --> run_next_hook : more hooks in chain
    run_next_hook --> approve
    run_next_hook --> block
    approve --> [*]
    block --> [*]
    pass --> [*]
```

---

## SM-06: Permission Resolution

```mermaid
stateDiagram-v2
    [*] --> check_defined

    check_defined --> ALLOW : no permissions defined
    check_defined --> check_deny : permissions exist

    check_deny --> DENY : deny rule matches
    check_deny --> check_allow : no deny matched

    check_allow --> ALLOW : allow rule matches
    check_allow --> ASK : allow rules exist but none match
    check_allow --> ALLOW : no allow rules defined (only deny existed)
```

---

## SM-07: Risk Assessment Flow

```mermaid
stateDiagram-v2
    [*] --> check_enabled

    check_enabled --> NULL : risk.enabled === false
    check_enabled --> merge_rules : enabled (default)

    merge_rules --> sort_by_specificity
    sort_by_specificity --> iterate_rules

    iterate_rules --> NULL : no rule matched
    iterate_rules --> matched : rule matched

    matched --> HIGH : level === 'high' → requiresConfirmation = true
    matched --> MEDIUM_CHECK : level === 'medium'
    MEDIUM_CHECK --> CONFIRM : isSubAgent === true
    MEDIUM_CHECK --> PASS : isSubAgent === false
```

---

## SM-08: Agent Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> initializing : constructor called

    initializing --> ready : initialize() completes
    initializing --> degraded : initialize() errors (fallback to defaults)

    ready --> processing : user sends message (run())
    degraded --> processing : user sends message

    processing --> tool_loop : LLM returns tool calls
    processing --> responding : LLM returns text only
    tool_loop --> processing : tool results fed back
    tool_loop --> aborted : user Ctrl+C

    responding --> idle : onDone callback
    aborted --> idle : abort handled

    idle --> processing : next user message
    idle --> compacting : auto-compact triggered
    compacting --> idle : compact complete
    idle --> [*] : session end
```
