# Terminal UI

## Overview

The UI presents conversation, setup, commands, approval decisions, session/goal/task state, and responsive terminal controls over the Agent. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| UI-RF-01 | Show streamed assistant/tool progress without blocking user cancellation. 🟢 | Must |
| UI-RF-02 | Present approval/plan/verification decisions before agent continuation. 🟢 | Must |
| UI-RF-03 | Support `plan`, `review`, `build`, and user-only `auto` interaction modes. 🟢 | Must |
| UI-RF-04 | Support themes, Vim-style input option, narrow layouts, and mobile QR flow. 🟢 | Should |

## Acceptance criteria

```gherkin
Given a high-risk tool request
When the agent asks for confirmation
Then the UI exposes approve/deny and no execution proceeds before a decision

Given the model requests auto mode
When mode activation is evaluated
Then auto is not activated without a user action
```

## Traceability

`src/ui/App.tsx`, `input/`, `layout/`, `setup/`, `subagent/`. 🟢
