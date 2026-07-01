# Flowchart: Permissions Module

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Permission Resolution

```mermaid
flowchart TD
    A[resolvePermission called] --> B{permissions defined?}
    B -->|no| C[Return: allow]
    B -->|yes| D[Parse deny rules]
    D --> E[Parse allow rules]
    E --> F{Both empty?}
    F -->|yes| C
    F -->|no| G[Check deny rules first]
    
    G --> H[For each deny rule]
    H --> I{matchesRule?}
    I -->|yes| J[Return: deny]
    I -->|no| H
    H -->|done| K[Check allow rules]
    
    K --> L[For each allow rule]
    L --> M{matchesRule?}
    M -->|yes| C
    M -->|no| L
    L -->|done| N{allow rules exist?}
    N -->|yes| O[Return: ask]
    N -->|no| C
```

## Risk Assessment

```mermaid
flowchart TD
    A[assessRisk called] --> B{risk.enabled == false?}
    B -->|yes| C[Return null]
    B -->|no| D[Merge default + user rules by ID]
    D --> E[Sort by specificity longer pattern first]
    E --> F[Get tool content command or path]
    
    F --> G[For each rule in sorted]
    G --> H{rule.tool matches?}
    H -->|no| G
    H -->|yes| I{Has pattern?}
    
    I -->|yes| J[globMatch pattern, content]
    I -->|no| K{Has condition?}
    
    K -->|large_overwrite| L{existingLines >= 100?}
    K -->|multi_edit_burst| M{recentWriteCount >= 3?}
    K -->|neither| N[matched = true tool-only rule]
    
    J --> O{Matched?}
    L --> O
    M --> O
    N --> O
    
    O -->|no| G
    O -->|yes| P{level == high?}
    P -->|yes| Q[requiresConfirmation = true]
    P -->|no| R[requiresConfirmation = context.isSubAgent]
    Q --> S[Return RiskAssessment]
    R --> S
    
    G -->|done| T[Return null no rule matched]
```

## Iterative Glob Matching (Anti-ReDoS)

```mermaid
flowchart TD
    A[globMatch pattern, value] --> B{wildcardCount > 10?}
    B -->|yes| C[Return false safety limit]
    B -->|no| D[Lowercase both]
    D --> E[iterativeGlob]
    
    E --> F[pi=0, si=0, starPi=-1, starSi=-1]
    F --> G{si < str.length?}
    G -->|no| H[Skip trailing stars]
    G -->|yes| I{pattern pi == str si OR pattern pi == ?}
    
    I -->|yes| J[pi++, si++]
    I -->|no| K{pattern pi == *?}
    K -->|yes| L[starPi=pi, starSi=si, pi++]
    K -->|no| M{starPi != -1?}
    M -->|yes| N[pi=starPi+1, starSi++, si=starSi]
    M -->|no| O[Return false]
    
    J --> G
    L --> G
    N --> G
    
    H --> P{pi == pattern.length?}
    P -->|yes| Q[Return true]
    P -->|no| O
```

## Interaction Mode — Tool Access Matrix

```mermaid
flowchart TD
    A[canUseTool mode, tool] --> B{mode == auto?}
    B -->|yes| C[Return true everything allowed]
    B -->|no| D{tool contains '__' MCP?}
    D -->|yes| E[Check if mode allows 'shell']
    D -->|no| F[Check TOOL_PERMISSIONS mode has tool]
    E --> G[Return result]
    F --> G
```

### Tool Permissions by Mode

```
plan:  read_file, read_folder, glob, grep, git, web_fetch, introspect, todo, subagent
build: plan tools + shell, write_file, patch_file, update_knowledge
auto:  ALL tools, zero restrictions
```
