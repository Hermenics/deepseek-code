# Flowchart: Agent Module

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Agent.run() — Main Entry Point

```mermaid
flowchart TD
    A[User message] --> B[resetMemory + turnWriteCount=0]
    B --> C[await readyPromise]
    C --> D[microCompact old tool results]
    D --> E{contextUsage > 85%?}
    E -->|yes| F[auto-compact via LLM]
    E -->|no| G[promptRefiner enabled?]
    F --> G
    G -->|yes, msg >= 30 chars| H[refinePrompt via LLM]
    G -->|no| I[effectiveMessage = userMessage]
    H --> I
    I --> J[Inject pending /msg notes]
    J --> K[Push user message to history]
    K --> L[call loop]
```

## Agent.runLoop() — Core Agent Loop

```mermaid
flowchart TD
    START[Start loop] --> CHECK{iterations > 100?}
    CHECK -->|yes| STOP[Push warning, break]
    CHECK -->|no| STREAM{useStreaming?}
    
    STREAM -->|no| NON_STREAM[Non-streaming: Bedrock/Vertex]
    STREAM -->|yes| STREAMING[Streaming: DeepSeek/Local]
    
    NON_STREAM --> NS_CALL[client.chat.completions.create stream:false]
    NS_CALL --> NS_USAGE[Track token usage]
    NS_USAGE --> NS_BEDROCK{Bedrock R1?}
    NS_BEDROCK -->|yes| NS_PARSE_XML[parseBedrockToolCalls from XML]
    NS_BEDROCK -->|no| NS_NATIVE[Native tool_calls from response]
    
    NS_PARSE_XML --> NS_HAS_TC{Has tool calls?}
    NS_HAS_TC -->|yes| NS_EXEC[Execute tools, push results]
    NS_HAS_TC -->|no| NS_DONE[Push assistant msg, save, done]
    NS_EXEC --> START
    
    NS_NATIVE --> NAT_TC{Has tool_calls?}
    NAT_TC -->|yes| NAT_EXEC[Execute tools sequentially]
    NAT_TC -->|no| NAT_DONE[Push assistant msg, save, done]
    NAT_EXEC --> START
    
    STREAMING --> S_CALL[client.chat.completions.create stream:true]
    S_CALL --> S_LOOP[for await chunk of stream]
    S_LOOP --> S_DELTA{chunk has delta?}
    S_DELTA -->|reasoning| S_THINK[cb.onThinking]
    S_DELTA -->|content| S_TOKEN[cb.onToken, accumulate]
    S_DELTA -->|tool_calls| S_TC_BUF[Buffer tool call by index]
    S_DELTA -->|usage| S_USAGE[Update token counts]
    
    S_LOOP --> S_END[Stream ended]
    S_END --> S_COMPACT{Mid-turn compact needed?}
    S_COMPACT -->|yes| S_DO_COMPACT[compact]
    S_COMPACT -->|no| S_CHECK_TC{toolCalls.size > 0?}
    S_DO_COMPACT --> S_CHECK_TC
    
    S_CHECK_TC -->|no| S_FINAL[Push msg, saveHistory, syncTurn, done]
    S_CHECK_TC -->|yes| S_PARTITION{All parallel-safe?}
    S_PARTITION -->|yes, > 1| S_PARALLEL[Promise.allSettled]
    S_PARTITION -->|no| S_SEQUENTIAL[Execute sequentially]
    S_PARALLEL --> START
    S_SEQUENTIAL --> START
```

## Agent.checkAndExecuteTool() — Permission Pipeline

```mermaid
flowchart TD
    IN[Tool call received] --> AUTO{Auto mode?}
    AUTO -->|yes| HOOKS[Skip to PreToolUse hooks]
    AUTO -->|no| MODE{Mode allows tool?}
    
    MODE -->|no| BLOCK_MODE[Return: blocked by mode]
    MODE -->|yes| BUILD{Build mode?}
    
    BUILD -->|yes| RISK[assessRisk]
    BUILD -->|no| PERM_RULES[Check permission rules]
    
    RISK --> RISK_HIGH{requiresConfirmation?}
    RISK_HIGH -->|yes| RISK_ASK[toolPermissionHandler]
    RISK_HIGH -->|no| PERM_RULES
    RISK_ASK -->|deny| DENY_ABORT[throw DenyAbortError]
    RISK_ASK -->|session| RISK_APPROVE[Add to sessionApproved]
    RISK_APPROVE --> PERM_RULES
    
    PERM_RULES --> RULE_D{resolvePermission}
    RULE_D -->|deny| BLOCK_RULE[Return: blocked by rule]
    RULE_D -->|ask| ASK_USER[toolPermissionHandler]
    RULE_D -->|allow| LEGACY
    ASK_USER -->|deny| DENY_ABORT
    ASK_USER -->|session/always| LEGACY
    
    LEGACY --> ALLOW_CHECK{allowedTools whitelist?}
    ALLOW_CHECK -->|blocked| BLOCK_ALLOW[Return: blocked by agent config]
    ALLOW_CHECK -->|pass| HOOKS
    
    HOOKS --> PRE_HOOK[runPreToolHooks]
    PRE_HOOK -->|block| BLOCK_HOOK[Return: blocked by hook]
    PRE_HOOK -->|approve/pass| UNDO{Is write tool?}
    
    UNDO -->|yes| SNAPSHOT[Save file content to undoStack]
    UNDO -->|no| EXEC
    SNAPSHOT --> EXEC[Execute tool]
    
    EXEC --> POST_HOOK[runPostToolHooks fire-and-forget]
    POST_HOOK --> RETURN[Return result]
```

## Agent.compact() — Context Compaction

```mermaid
flowchart TD
    A[compact called] --> B[Get active messages after boundary]
    B --> C[Filter non-system messages]
    C --> D{Any messages?}
    D -->|no| E[Return 'Nothing to compact']
    D -->|yes| F[Send to LLM with COMPACT_SYSTEM_PROMPT]
    F --> G[Get summary response]
    G --> H[Reset messages: system + boundary + summary]
    H --> I[Re-inject DEEPSEEK.md context]
    I --> J[Save history]
    J --> K[Return summary]
```

## Agent.initialize() — Async Initialization

```mermaid
flowchart TD
    A[initialize] --> B[Promise.all]
    B --> C[loadSteering]
    B --> D[loadDeepSeekMd]
    B --> E[loadMergedSettings]
    B --> F[loadMcpTools]
    
    C --> G[Build system prompt]
    D --> G
    E --> H[Apply settings overrides]
    F --> I[Merge MCP tools into toolMap]
    
    G --> J{Bedrock R1?}
    J -->|yes| K[Inject tool defs into system prompt]
    J -->|no| L[Done]
    K --> L
    
    H --> M[Configure autoCompact]
    I --> N[Update openaiTools]
    
    L --> O[runSessionStartHooks]
    O --> P[Ready]
```
