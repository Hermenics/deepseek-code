# Permissions — technical design

The policy engine parses bounded glob rules, evaluates deny before allow/ask, and explains the result. Risk classification augments rule resolution with built-in/custom level and confirmation requirements. Agent execution composes these with mode, path, hooks, and session approvals. 🟢

| Stage | Result |
| --- | --- |
| interaction mode | initial capability envelope |
| safe path | workspace/external/sensitive decision |
| risk | level and confirmation requirement |
| configured rules | deny/allow/ask result |
| hooks/operator | modified/block/approval result |

The user, not the model, activates unrestricted `auto` mode. 🟢
