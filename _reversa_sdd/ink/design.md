# Ink renderer — technical design

The custom reconciler translates React host elements into layout nodes, asks local Yoga for layout, then diffs ANSI output to the terminal. Input, focus, scroll, alternate screen, and resize behavior are renderer-owned. 🟢

| Component | Responsibility |
| --- | --- |
| reconciler | React commit operations into terminal host tree |
| layout | dimensions and flex layout via local Yoga |
| output | ANSI style/frame diffing and terminal writes |
| input/focus | keyboard routing and mounted focus invariant |

Failure paths preserve terminal restoration on exit and invalidate/re-render around resize. 🟢
