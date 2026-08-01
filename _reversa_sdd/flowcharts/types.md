# Shared types flow

```mermaid
flowchart LR
  A[ProviderConfig] --> B[Agent and setup]
  C[Tool permission result] --> D[UI permission prompt]
  D --> E[Agent authorization]
```
