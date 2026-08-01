# Hooks — technical design

`SessionStart`, pre-tool, and post-tool hooks run through `sh -c` with JSON input. Pre hooks chain in order, can modify/block; post output is capped; child failure/timeout becomes a blocking error response rather than silent execution. Default timeout is 30 seconds. 🟢

Dependencies: Agent authorization pipeline and user-scoped settings. 🟢
