# Commands

## Overview

Commands turn slash-prefixed terminal input into typed application intents without making parsing an authority bypass. 🟢

## Responsibilities

- Parse the current command vocabulary into discriminated values. 🟢
- Validate command arguments and preserve plain chat input when no command matches. 🟢
- Drive session, provider, config, goal, task, plugin, skill, plan, review, and diagnostic flows. 🟢

## Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| CM-RF-01 | Parsing must distinguish malformed commands from ordinary user text. 🟢 | Must |
| CM-RF-02 | Goal commands must expose bounded continuation configuration. 🟢 | Must |
| CM-RF-03 | Setup/config commands must route to scoped settings behavior. 🟢 | Must |

## Acceptance criteria

```gherkin
Given `/goal ship --turns 2`
When parsed
Then a typed goal command with objective and continuation limit is returned

Given an unknown slash token
When parsed
Then it is reported as a command error rather than executing a tool
```

## Traceability

`src/commands.ts`, `src/commands/`, `src/ui/App.tsx`. 🟢
