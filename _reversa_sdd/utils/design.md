# Utilities — technical design

Utilities are shared leaf modules, not an alternate domain layer. They normalize filesystem/terminal/environment work and keep credentials/config migration separate from Agent control flow. Update notifier exports a testable version getter. 🟢

Consumers should reuse the existing helper matching the boundary instead of duplicating local process/filesystem behavior. 🟡
