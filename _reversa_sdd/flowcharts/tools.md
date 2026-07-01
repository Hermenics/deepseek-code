# Flowchart: Tools Module

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tool Execution Pipeline

```mermaid
flowchart TD
    A[Agent calls executeTool] --> B[Lookup tool in toolMap]
    B --> C{Tool found?}
    C -->|no| D[Return "Unknown tool: name"]
    C -->|yes| E[validateToolArguments]
    E --> F{Valid?}
    F -->|no| G[Return error: invalid/missing params]
    F -->|yes| H[tool.execute args]
    H --> I{Success?}
    I -->|yes| J[Return result string]
    I -->|no| K[Return "Error: message"]
```

## Shell Tool — Execution Flow

```mermaid
flowchart TD
    A[Shell.execute] --> B[isDestructive check]
    B --> C{Destructive?}
    C -->|yes| D{confirmHandler exists?}
    D -->|no| E[Return error: no handler]
    D -->|yes| F[Ask user confirmation]
    F --> G{Confirmed?}
    G -->|no| H[Return "Cancelled"]
    G -->|yes| I[Execute command]
    C -->|no| I
    I --> J[execa with timeout]
    J --> K{Exit code 0?}
    K -->|yes| L[Return stdout truncated to 50k chars]
    K -->|no| M[Return stderr + exit code]
    J -->|timeout| N[Return timeout error]
```

## pathSafety.assertSafePath()

```mermaid
flowchart TD
    A[assertSafePath filePath] --> B[path.resolve]
    B --> C{Inside cwd?}
    C -->|no| D[throw: outside working directory]
    C -->|yes| E[fs.realpath resolve symlinks]
    E --> F{Real path inside cwd?}
    F -->|no| G[throw: symlink traversal blocked]
    F -->|yes| H[Get relative path]
    E -->|ENOENT| I[Check parent dir realpath]
    I --> F2{Parent inside cwd?}
    F2 -->|no| G
    F2 -->|yes| H
    H --> J{Top dir in BLOCKED_DIRS?}
    J -->|yes| K[throw: directory off-limits]
    J -->|no| L{isSensitiveFile?}
    L -->|yes| M[throw: sensitive file blocked]
    L -->|no| N[OK - path is safe]
```

## SubAgent — Spawn and Execute

```mermaid
flowchart TD
    A[SubAgent.execute] --> B[Parse args: task, context, model]
    B --> C[inferRole from task]
    C --> D[getToolsForRole]
    D --> E[Create child LLM client]
    E --> F[Build system prompt with role + tools]
    F --> G[formatMemoryForPrompt]
    G --> H[Start agent loop max 15 iterations]
    
    H --> I[Call LLM]
    I --> J{Has tool calls?}
    J -->|no| K[Parse structured result]
    J -->|yes| L[Execute child tools]
    L --> M[Push tool results]
    M --> I
    
    K --> N{shouldVerify?}
    N -->|yes| O[buildVerifierPrompt]
    O --> P[Second LLM call]
    P --> Q[parseVerificationResult]
    Q --> R[formatResultForParent]
    N -->|no| R
    
    R --> S[cb.onDone with result]
    S --> T[addPreviousResult to memory]
```

## WriteFile — File Creation/Overwrite

```mermaid
flowchart TD
    A[WriteFile.execute] --> B[assertSafePath]
    B --> C{Safe?}
    C -->|no| D[Return path error]
    C -->|yes| E[Ensure parent dir exists]
    E --> F[writeFile content]
    F --> G{Success?}
    G -->|yes| H[Return confirmation]
    G -->|no| I[Return error message]
```

## PatchFile — LCS Diff Patching

```mermaid
flowchart TD
    A[PatchFile.execute] --> B[assertSafePath]
    B --> C[Read existing file]
    C --> D{File exists?}
    D -->|no| E[Return error: file not found]
    D -->|yes| F[Parse old_string / new_string]
    F --> G{old_string found in file?}
    G -->|no| H[Return error: string not found]
    G -->|yes| I[Replace old with new]
    I --> J[Write updated content]
    J --> K[Return diff summary]
```

## MoA — Mixture of Agents

```mermaid
flowchart TD
    A[MoA.execute] --> B[Parse config: models, aggregator]
    B --> C[Send prompt to all reference models in parallel]
    C --> D[Collect all responses]
    D --> E[Build aggregation prompt with all responses]
    E --> F[Send to aggregator model]
    F --> G[Return synthesis]
```

## WebFetch — URL Fetching

```mermaid
flowchart TD
    A[WebFetch.execute] --> B[Validate URL format]
    B --> C{Valid URL?}
    C -->|no| D[Return error]
    C -->|yes| E[SSRF check: block private IPs]
    E --> F{Safe URL?}
    F -->|no| G[Return SSRF blocked]
    F -->|yes| H[fetch URL with timeout]
    H --> I{Success?}
    I -->|yes| J[Extract text content]
    I -->|no| K[Return HTTP error]
    J --> L[Truncate to max chars]
    L --> M[Return content]
```
