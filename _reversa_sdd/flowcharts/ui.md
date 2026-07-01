# Flowchart: UI Module

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## App.tsx — Main Application Flow

```mermaid
flowchart TD
    A[CLI Entry: src/entrypoints/cli.tsx] --> B[Parse args: provider, model, agent]
    B --> C[Render App component via Ink]
    C --> D{First run?}
    D -->|yes| E[Show Setup screen: API key, model, theme]
    D -->|no| F[Show REPL screen]
    
    F --> G[Initialize Agent with provider config]
    G --> H[Display WelcomeScreen]
    H --> I[Wait for user input via InputBox]
    
    I --> J{Input starts with /?}
    J -->|yes| K[Parse and execute command]
    J -->|no| L{Input starts with !?}
    L -->|yes| M[Execute shell directly]
    L -->|no| N[Send to agent.run]
    
    N --> O[Show loading spinner]
    O --> P[Stream tokens to MessageList]
    P --> Q[Show tool calls in ToolUseDisplay]
    Q --> R[Agent done]
    R --> I
```

## InputBox Component

```mermaid
flowchart TD
    A[InputBox receives keypress] --> B{Vim mode?}
    B -->|yes| C[Process via useVimMode]
    B -->|no| D[Process via useTextInput]
    
    D --> E{Key type?}
    E -->|Enter| F[Submit input]
    E -->|Tab| G[Command autocomplete ghost]
    E -->|Up/Down| H[useInputHistory navigate]
    E -->|Ctrl+C| I{Processing?}
    I -->|yes| J[agent.abort]
    I -->|no| K[Clear input or quit]
    E -->|Shift+Tab| L[Cycle interaction mode]
    E -->|Ctrl+L| M[Clear screen]
    E -->|printable| N[Insert character at cursor]
    
    F --> O[Append to input history]
    O --> P[Emit onSubmit callback]
```

## Message Rendering Pipeline

```mermaid
flowchart TD
    A[Agent callback] --> B{Event type?}
    B -->|onToken| C[Append to current message]
    B -->|onThinking| D[Show in thinking panel]
    B -->|onToolCall| E[Show tool name + args]
    B -->|onToolResult| F[Show result or diff]
    B -->|onDone| G[Finalize message]
    B -->|onAutoCompact| H[Show compact notification]
    
    C --> I[MarkdownText renders with syntax highlighting]
    E --> J[ToolUseDisplay with expand/collapse]
    F --> K{Is file write?}
    K -->|yes| L[DiffView component]
    K -->|no| M[Plain text result]
```

## Interaction Mode Cycling

```mermaid
flowchart LR
    PLAN[Plan<br/>Yellow<br/>Read-only] -->|Shift+Tab| BUILD[Build<br/>Green<br/>Default]
    BUILD -->|Shift+Tab| AUTO[Auto<br/>Red<br/>No restrictions]
    AUTO -->|Shift+Tab| PLAN
```

## SubagentList — Multi-Agent Display

```mermaid
flowchart TD
    A[SubAgent spawned] --> B[useSubagents hook registers]
    B --> C[SubagentLine renders: id, task, status]
    C --> D{Status?}
    D -->|running| E[Show spinner + tool use]
    D -->|done| F[Show result summary + cost]
    D -->|error| G[Show error in red]
    
    H[colorManager] --> I[Assign unique color per agent]
    I --> C
```

## StatusBar Layout

```mermaid
flowchart LR
    A[Mode badge] --> B[Model name]
    B --> C[Token count]
    C --> D[Context usage %]
    D --> E[Cost estimate]
    E --> F[Active agent name]
```
