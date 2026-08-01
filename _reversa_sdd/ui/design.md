# Terminal UI — technical design

## Interfaces

`App` owns React display state and one `Agent`; callbacks are batched on a short interval before they update messages, tool cards, permissions, goals, and task displays. 🟢

## Main flow

1. Startup loads settings/session and constructs Agent. 🟢
2. Input parses local commands or submits a message to `runAgent`. 🟢
3. Agent callbacks update UI state, and decision handlers resolve approval/plan promises. 🟢
4. A completed active goal may schedule the next bounded continuation. 🟢

## Dependencies

Ink renderer, commands, settings, Agent/session/goal APIs, orchestration UI types, and design-system theme. 🟢

## Risks

`App.tsx` is a broad integration component; change it alongside relevant command/mode/renderer tests. 🟡
