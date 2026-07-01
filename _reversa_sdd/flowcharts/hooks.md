# Flowchart: Hooks Module

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## PreToolUse Hook Execution

```mermaid
flowchart TD
    A[runPreToolHooks called] --> B{config.PreToolUse defined?}
    B -->|no| C[Return: decision=pass]
    B -->|yes| D[For each matcher in PreToolUse]
    
    D --> E{matchesHookPattern tool?}
    E -->|no| D
    E -->|yes| F[matched = true]
    F --> G[For each hook in matcher.hooks]
    
    G --> H[Spawn shell: sh -c command]
    H --> I[Send JSON to stdin]
    I --> J[Wait for stdout timeout=30s]
    
    J --> K{Exit code 0?}
    K -->|no| L[Log error, return block with reason]
    K -->|yes| M[Parse stdout as JSON]
    
    M --> N{decision == block?}
    N -->|yes| O[Return: decision=block, reason]
    N -->|no| P{Has modified_input?}
    P -->|yes| Q[currentInput = modified_input]
    P -->|no| R[Continue to next hook]
    Q --> R
    R --> G
    
    G -->|done| D
    D -->|done| S{Any matcher matched?}
    S -->|no| C
    S -->|yes| T[Return: decision=approve, modifiedInput?]
```

## PostToolUse Hook Execution

```mermaid
flowchart TD
    A[runPostToolHooks called] --> B{config.PostToolUse defined?}
    B -->|no| C[Return immediately]
    B -->|yes| D[For each matcher in PostToolUse]
    
    D --> E{matchesHookPattern tool?}
    E -->|no| D
    E -->|yes| F[For each hook in matcher.hooks]
    
    F --> G[Spawn shell: sh -c command]
    G --> H[Send JSON to stdin incl tool_result max 10k]
    H --> I[Await completion catch errors silently]
    I --> F
    F -->|done| D
    D -->|done| C
```

## SessionStart Hook Execution

```mermaid
flowchart TD
    A[runSessionStartHooks called] --> B{config.SessionStart defined?}
    B -->|no| C[Return]
    B -->|yes| D[For each hook in SessionStart]
    D --> E[Spawn shell: sh -c command]
    E --> F[Send JSON: event + session_id]
    F --> G[Await catch errors silently]
    G --> D
    D -->|done| C
```

## Hook Pattern Matching

```mermaid
flowchart TD
    A[matchesHookPattern pattern, toolName] --> B{pattern empty or '*'?}
    B -->|yes| C[Return true]
    B -->|no| D[Split pattern by pipe]
    D --> E[Lowercase all parts]
    E --> F{toolName lowercase in parts?}
    F -->|yes| C
    F -->|no| G[Return false]
```
