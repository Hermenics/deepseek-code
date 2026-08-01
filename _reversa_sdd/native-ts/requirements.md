# Native TypeScript support

## Overview

The native TypeScript module supplies the local Yoga-compatible layout behavior required by the in-tree terminal renderer. 🟢

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| NT-RF-01 | Layout must propagate dirtiness through affected ancestors. 🟢 | Must |
| NT-RF-02 | Measurement caching must preserve correct render layout behavior. 🟢 | Must |
| NT-RF-03 | The API must support the renderer's flex/layout contract. 🟢 | Must |

## Acceptance criteria

```gherkin
Given a child layout/input changes
When it is marked dirty
Then necessary ancestor layout is recomputed on the next render

Given unchanged measured content
When it is laid out again
Then the cached measurement can be reused without changing frame geometry
```

## Traceability

`src/native-ts/`, `src/ink/`. 🟢
