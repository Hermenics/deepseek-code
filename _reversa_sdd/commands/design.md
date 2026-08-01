# Commands — technical design

## Interface

The command parser returns a discriminated union for about 38 registered forms; TUI/CLI dispatches the intent to the relevant module. 🟢

## Main flow

1. Input detects command syntax and tokenizes options/arguments. 🟢
2. Parser validates command-specific form and emits typed data or error. 🟢
3. `App` dispatches it, switching mode or invoking the service. 🟢

## Dependencies

Settings, sessions, Agent, goals, orchestration, extension managers, and UI components. 🟢

## Risk

Commands route intent only; writes/process execution still meet tool/mode authorization. Exact help copy is UI policy. 🟡
