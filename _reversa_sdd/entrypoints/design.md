# Entrypoints — technical design

`src/index.tsx` dispatches invocation. Interactive CLI handles help/version/doctor/update/logout and session/setup selection before rendering TUI; pipe mode is non-interactive and installs a deny confirmation handler. Build bundles the published `deepseek` binary. Alternate-screen behavior comes from settings and is restored on clean exit. 🟢
