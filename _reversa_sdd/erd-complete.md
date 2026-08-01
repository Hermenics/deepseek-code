# Persisted-record diagram

This is an ERD-style view of operational records, not a relational database schema. Records are stored in local JSON/JSONL files and their exact serializations are versioned by TypeScript types. 🟢

```mermaid
erDiagram
  SESSION ||--o{ MESSAGE : contains
  SESSION ||--o{ TASK : coordinates
  SESSION ||--o| GOAL : carries
  TASK ||--o{ TASK : depends_on_or_parents
  TASK ||--o{ TASK_MESSAGE : sends
  TASK ||--o| TASK_RESULT : produces
  SETTINGS ||--o{ PERMISSION_RULE : configures
  SETTINGS ||--o{ RISK_RULE : configures
  SETTINGS ||--o{ HOOK : configures
  MEMORY ||--|| WORKSPACE : scoped_to

  SESSION { string sessionId PK
    string workspacePath
    datetime createdAt
    datetime updatedAt
  }
  MESSAGE { string role
    string content
    datetime timestamp
  }
  GOAL { string objective
    string status
    number tokensUsed
    number continuations
  }
  TASK { string taskId PK
    string state
    string parentTaskId
    number attempt
    datetime deadline
  }
  TASK_RESULT { string status
    json value
    json artifacts
    json metrics
  }
  TASK_MESSAGE { string messageId PK
    string type
    json payload
  }
  SETTINGS { string scope
    json values
  }
  MEMORY { string scope
    string content
    datetime updatedAt
  }
```

| Record | Canonical source | Key constraints |
| --- | --- | --- |
| Session | `agent/session.ts` | workspace-derived storage isolation; exports redact secrets. |
| Goal | `agent/goal.ts` | one current in-memory goal; bounded continuation/blocker lifecycle. |
| Task | `orchestration/types.ts` | unique id, legal state transition, valid acyclic dependencies. |
| Task result/message | orchestration schemas/types | versioned envelope, idempotent message identity. |
| Settings | `settings/types.ts` | hierarchy plus scope-specific executable restrictions. |
| Memory | `agent/memory.ts` | user/project scope, bounded content, untrusted text filtering. |
