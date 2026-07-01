# C4 Components Diagram (Level 3)

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Agent Core — Components

```mermaid
C4Component
    title Agent Core — Internal Components

    Container_Boundary(agent_boundary, "Agent Core") {
        Component(agent_class, "Agent", "Class", "Main orchestrator: run(), runLoop(), checkAndExecuteTool()")
        Component(llm_client, "LLM Client", "Module", "Creates OpenAI SDK client per provider config")
        Component(steering, "Steering Loader", "Module", "Loads custom prompts from .deepseek/steering/ and DEEPSEEK.md")
        Component(prompt_refiner, "Prompt Refiner", "Module", "Optional LLM-based user message rewriting")
        Component(file_checkpoint, "File Checkpoint", "Module", "Before-state snapshots for undo/rollback (max 10)")
        Component(history, "History", "Module", "Saves conversation to disk per session")
        Component(checkpoint, "Session Checkpoint", "Module", "Full session state save/restore (max 20)")
        Component(compact_boundary, "Compact Boundary", "Module", "Boundary markers for compaction cut points")
        Component(cost, "Cost Estimator", "Module", "Token counting, cost formatting, context limit per model")
        Component(audit, "Audit Log", "Module", "Append-only tool call log per session")
        Component(mcp_loader, "MCP Loader", "Module", "Discovers and loads MCP server tools at init")
        Component(agent_config, "Agent Config", "Module", "Loads named agent definitions from .deepseek/agents/")
        Component(memory_mod, "Memory", "Module", "getMemorySnapshot(), addEntry(), removeEntry()")
    }

    Rel(agent_class, llm_client, "Creates client")
    Rel(agent_class, steering, "Loads system prompt parts")
    Rel(agent_class, prompt_refiner, "Refines user input")
    Rel(agent_class, file_checkpoint, "Creates before-snapshots")
    Rel(agent_class, history, "Persists conversation")
    Rel(agent_class, checkpoint, "Save/restore session")
    Rel(agent_class, compact_boundary, "Insert boundaries")
    Rel(agent_class, cost, "Track tokens and cost")
    Rel(agent_class, audit, "Log tool calls")
    Rel(agent_class, mcp_loader, "Load external tools")
    Rel(agent_class, memory_mod, "Read/write memory")
```

## Tool Registry — Components

```mermaid
C4Component
    title Tool Registry — Internal Components

    Container_Boundary(tools_boundary, "Tool Registry") {
        Component(shell_tool, "Shell", "Tool", "Execute shell commands (30s timeout, 50k char cap)")
        Component(read_file, "ReadFile", "Tool", "Read file contents with path sandbox")
        Component(write_file, "WriteFile", "Tool", "Write file with before-checkpoint")
        Component(patch_file, "PatchFile", "Tool", "Apply unified diff patches")
        Component(read_folder, "ReadFolder", "Tool", "List directory contents")
        Component(glob_tool, "Glob", "Tool", "Pattern-based file search (500 file cap)")
        Component(grep_tool, "Grep", "Tool", "Content search (200 line cap)")
        Component(git_tool, "Git", "Tool", "Git operations (status, log, diff, blame)")
        Component(web_fetch, "WebFetch", "Tool", "HTTP fetch with SSRF protection + DNS check")
        Component(subagent_tool, "SubAgent", "Tool", "Spawn child agent with role-based permissions")
        Component(todo_tool, "Todo", "Tool", "Manage visible TODO list in UI")
        Component(introspect, "Introspect", "Tool", "Query system state and capabilities")
        Component(moa_tool, "MoA", "Tool", "Mixture of Agents — multi-model synthesis")
        Component(update_knowledge, "UpdateKnowledge", "Tool", "Write to agent/user memory")
        Component(path_safety, "PathSafety", "Shared", "assertSafePath(), blocked dirs, sensitive files, symlink check")
    }

    Rel(shell_tool, path_safety, "Validates cwd")
    Rel(read_file, path_safety, "Validates path")
    Rel(write_file, path_safety, "Validates path")
    Rel(patch_file, path_safety, "Validates path")
    Rel(glob_tool, path_safety, "Uses BLOCKED_GLOB_PATTERNS")
    Rel(subagent_tool, shell_tool, "Delegates if role allows")
```

## Permission Engine — Components

```mermaid
C4Component
    title Permission Engine — Internal Components

    Container_Boundary(perm_boundary, "Permission Engine") {
        Component(interaction_mode, "InteractionMode", "Module", "plan/build/auto mode logic, tool matrix, mode cycling")
        Component(risk_assess, "Risk Assessor", "Module", "46 default rules, glob matching, condition checks")
        Component(perm_matcher, "Permission Matcher", "Module", "parseRule(), resolvePermission(), globMatch()")
        Component(perm_types, "Types", "Module", "RiskRule, RiskConfig, PermissionRule, RiskAssessment")
    }

    Rel(interaction_mode, perm_matcher, "Uses canUseTool()")
    Rel(risk_assess, perm_matcher, "Uses globMatch()")
```

## TUI Layer — Components

```mermaid
C4Component
    title TUI Layer — Internal Components

    Container_Boundary(ui_boundary, "TUI Layer") {
        Component(app, "App", "React Component", "Root: state management, mode cycling, agent callbacks")
        Component(input_box, "InputBox", "React Component", "User input with vim mode, history, ghost suggestions")
        Component(message_list, "MessageList", "React Component", "Renders conversation with markdown highlighting")
        Component(tool_display, "ToolUseDisplay", "React Component", "Expand/collapse tool calls, diff view")
        Component(subagent_list, "SubagentList", "React Component", "Multi-agent progress display")
        Component(status_bar, "StatusBar", "React Component", "Mode, model, tokens, context %, cost")
        Component(setup_screens, "Setup Screens", "React Components", "API key, model selection, theme")
        Component(theme, "Theme Manager", "Module", "6 themes: dark/light × normal/daltonized/ansi")
        Component(ink_renderer, "Ink Renderer", "Custom fork", "Layout engine, reconciler, terminal I/O, yoga")
    }

    Rel(app, input_box, "Renders")
    Rel(app, message_list, "Renders")
    Rel(app, status_bar, "Renders")
    Rel(app, subagent_list, "Renders")
    Rel(message_list, tool_display, "Renders per tool call")
    Rel(app, ink_renderer, "Renders via")
    Rel(input_box, ink_renderer, "Key events from")
```

## Browser Proxy — Components

```mermaid
C4Component
    title Browser Proxy — Internal Components

    Container_Boundary(proxy_boundary, "Browser Proxy") {
        Component(hono_server, "Hono Server", "HTTP", "OpenAI-compatible /v1/chat/completions endpoint")
        Component(orchestrator, "Orchestrator", "Service", "Request routing, session management, streaming")
        Component(deepseek_api_svc, "DeepSeek API Service", "Service", "Playwright page pool, browser automation")
        Component(robust_json, "Robust JSON Parser", "Service", "Mid-stream JSON parsing, WAF handling")
        Component(prompt_emulation, "Prompt Emulation", "Service", "Tool call parsing from <tool_call> XML in stream")
        Component(openai_routes, "OpenAI Routes", "Routes", "Translate OpenAI format ↔ DeepSeek format")
    }

    Rel(hono_server, openai_routes, "Routes requests")
    Rel(openai_routes, orchestrator, "Delegates")
    Rel(orchestrator, deepseek_api_svc, "Browser calls")
    Rel(orchestrator, robust_json, "Parse responses")
    Rel(orchestrator, prompt_emulation, "Extract tool calls")
```
