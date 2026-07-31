# Terminal renderer contract

## Ownership

`src/ink/` is owned by `@Marcelo-Henry`. Changes require code-owner review
when branch protection is enabled.

## Boundary

The renderer turns a React tree into ANSI writes. It owns terminal dimensions,
focus, scroll state, Unicode cell width, frame diffs and TTY lifecycle. UI
features must use its public components and handles instead of reaching into
`react-reconciler`, screen buffers or TTY streams.

## Invariants

- A wide grapheme occupies its head cell and one spacer cell.
- Resize updates layout before the next frame is written.
- Focus only targets mounted, tabbable nodes and restores a valid prior node.
- Imperative scrolling is clamped by the renderer and does not require React
  state for each input event.
- Terminal writes go through the renderer's frame diff, never ad-hoc `stdout`
  writes from UI code.

## Regression gate

Run `bun run test:ink`. The suite mounts the real renderer against a fake TTY
and covers ANSI output, resize, Unicode cell layout, focus and scrolling.
