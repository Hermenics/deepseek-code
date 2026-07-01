# Tools Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Tools module provides 15 built-in tools that the Agent can invoke during conversations. Each tool has a name, description, JSON Schema parameters, and an execute function. Tools are the Agent's interface to the filesystem, shell, web, and subagents.

## Functional Requirements

### FR-01: Tool Registry 🟢
- **Must** export all tools via a single `allTools` array
- **Must** provide each tool with name, description, parameters (JSON Schema), and execute function
- **Must** support dynamic addition of MCP tools at runtime

### FR-02: Shell Tool 🟢
- **Must** execute shell commands via child_process
- **Must** enforce 30s timeout (configurable)
- **Must** truncate output at 50,000 chars
- **Must** support confirm handler for destructive operations

### FR-03: File Read Tools 🟢
- **Must** read file contents with path sandbox enforcement
- **Must** list directory contents (ReadFolder)
- **Must** support glob pattern search (max 500 files)
- **Must** support grep content search (max 200 lines)

### FR-04: File Write Tools 🟢
- **Must** write full file content (WriteFile)
- **Must** apply unified diff patches (PatchFile)
- **Must** create file checkpoint before each write
- **Must** validate path via assertSafePath() before write

### FR-05: WebFetch Tool 🟢
- **Must** fetch URL content via HTTP GET
- **Must** validate URL format (https:// or http://)
- **Must** block SSRF targets (localhost, metadata, private IPs)
- **Must** resolve DNS and re-check resolved IP against private ranges
- **Must** timeout after 15s, cap response at 20,000 chars

### FR-06: SubAgent Tool 🟢
- **Must** spawn child Agent with delegated task
- **Must** infer role from task description
- **Must** filter tools based on inferred role
- **Must** enforce 15-iteration limit
- **Must** support memory sharing within session
- **Must** track confidence score and verification status

### FR-07: MoA (Mixture of Agents) Tool 🟢
- **Must** query multiple reference models in parallel
- **Must** synthesize responses via aggregator model
- **Must** require minimum 1 successful reference response
- **Must** timeout per model at 60s

### FR-08: Todo Tool 🟢
- **Must** manage a TODO list visible in the UI
- **Must** support add, update, remove, list operations

### FR-09: Introspect Tool 🟢
- **Must** return system state information (model, mode, tools available)

### FR-10: Git Tool 🟢
- **Must** execute git commands (status, log, diff, blame, etc.)
- **Must** pass through to shell with git-specific formatting

### FR-11: UpdateKnowledge Tool 🟢
- **Must** write entries to agent or user memory
- **Must** support add, replace, remove operations
- **Must** enforce 2000 char memory cap

## Non-Functional Requirements

### NFR-01: Security 🟢
- Path sandbox on all file operations
- SSRF protection on web fetch
- Blocked glob patterns for sensitive directories

### NFR-02: Performance 🟢
- Parallel-safe tools: shell, grep, glob, read_file, read_folder, web_fetch, introspect, subagent
- Shell timeout prevents hanging
- Output truncation prevents context overflow
