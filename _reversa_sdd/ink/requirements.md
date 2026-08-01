# Ink renderer

## Overview

The in-tree Ink-compatible renderer turns React terminal components into stable ANSI frames and owns layout, focus, width, scrolling, and terminal lifecycle. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| IN-RF-01 | Render React trees to ANSI without direct application stdout writes. 🟢 | Must |
| IN-RF-02 | Handle Unicode grapheme width, including wide-cell spacers. 🟢 | Must |
| IN-RF-03 | Keep focus on mounted tabbable nodes and clamp imperative scroll. 🟢 | Must |
| IN-RF-04 | Re-layout after terminal resize on a later frame. 🟢 | Must |

## Acceptance criteria

```gherkin
Given a tree containing wide Unicode text
When a frame is rendered
Then terminal columns remain aligned

Given focus moves to an unmounted node
When reconciliation completes
Then focus is restored to a valid mounted target
```

## Traceability

`src/ink/`, `src/native-ts/`, `tests/ink/`. 🟢
