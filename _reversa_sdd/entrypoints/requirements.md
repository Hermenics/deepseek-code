# Entrypoints

## Overview

Entrypoints choose interactive CLI, headless pipe, setup/resume, diagnostics, and packaged execution behavior. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| EN-RF-01 | CLI flags/early commands must run before the TUI when applicable. 🟢 | Must |
| EN-RF-02 | Pipe mode must deny destructive shell confirmation by default. 🟢 | Must |
| EN-RF-03 | Startup must choose setup when credentials are unavailable and resume per settings when eligible. 🟢 | Must |

## Acceptance criteria

```gherkin
Given a headless piped destructive request
When shell confirmation is needed
Then it is denied rather than accepting invisible approval

Given `--version`
When CLI starts
Then the version is printed without starting the TUI
```

## Traceability

`src/index.tsx`, `src/entrypoints/cli.tsx`, `pipe.ts`, `build.ts`. 🟢
