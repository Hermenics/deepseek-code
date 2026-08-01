# Core user stories

_Derived from current code paths. “Developer” is the local operator, not an application-account role._

## US-01 — Start a safe coding session

As a developer, I want to start DeepSeek Code in a project so the agent has project-isolated context and a controlled workspace. 🟢

```gherkin
Given I start the CLI in a workspace
When startup resolves settings and session state
Then the TUI runs with that workspace as its canonical project boundary
```

## US-02 — Ask the agent to inspect or change code

As a developer, I want the agent to use local tools so it can complete coding work while every operation is validated and authorized. 🟢

```gherkin
Given I submit a coding request in Build mode
When the model requests an allowed tool
Then the tool result is returned to the agent after authorization
```

## US-03 — Review before changing files

As a developer, I want Plan and Review modes so I can inspect intended work without granting write/shell capability. 🟢

```gherkin
Given I select Review mode
When the model attempts a mutation tool
Then the call is denied by the interaction mode gate
```

## US-04 — Approve an elevated operation

As a developer, I want to decide high-risk actions explicitly so an agent cannot silently perform destructive work. 🟢

```gherkin
Given a high-risk tool request
When the confirmation UI is shown
Then the operation executes only after I approve it
```

## US-05 — Pursue a bounded objective

As a developer, I want a persistent goal with continuation limits so longer work remains observable and stops responsibly. 🟢

```gherkin
Given I create a goal with a continuation limit
When turns complete while the goal remains active
Then the UI schedules at most that number of continuation turns
```

## US-06 — Delegate work safely

As a developer, I want delegated tasks to be limited and recoverable so parallel work does not corrupt my checkout. 🟢

```gherkin
Given a writer task is admitted
When a safe owned worktree is available
Then its changes are isolated and checked before integration
```

## US-07 — Opt into project integrations

As a developer, I want to explicitly enable project MCP/LSP capabilities so a checked-out repository cannot silently run arbitrary tools. 🟢

```gherkin
Given a repository declares project MCP servers
When I have not enabled MCP in user settings
Then those servers are not loaded
```

## US-08 — Install a reusable extension

As a developer, I want to manage plugins and skills from validated sources so extensions are recoverable and do not collide with legacy discovery. 🟢

```gherkin
Given I request a skill update
When the replacement fails validation or installation
Then the previous installed skill remains available
```
