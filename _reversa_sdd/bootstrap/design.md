# Bootstrap — technical design

Bootstrap is a thin startup-support module consumed by entrypoints. It works with credential/settings/session initialization rather than creating a second runtime pipeline. Exact first-run presentation is handled by the UI/setup flow. 🟡

Dependencies: entrypoints, settings, credentials, terminal UI. 🟢
