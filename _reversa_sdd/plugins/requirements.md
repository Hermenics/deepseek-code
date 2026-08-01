# Plugins

## Overview

Plugins are managed local extensions installed from validated Git sources and recorded in a local registry. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| PL-RF-01 | Accept only safe `owner/repository` references and valid plugin manifests/layouts. 🟢 | Must |
| PL-RF-02 | Install via a bounded shallow clone and remove Git metadata before final placement. 🟢 | Must |
| PL-RF-03 | Preserve a backup and restore it if an update replacement fails. 🟢 | Must |

## Acceptance criteria

```gherkin
Given a malformed source or unsafe plugin name
When installation is requested
Then no extension is registered

Given an installed plugin and a failed update
When replacement fails
Then the previous plugin remains recoverable
```

## Traceability

`src/plugins/`, `/plugin` command paths. 🟢
