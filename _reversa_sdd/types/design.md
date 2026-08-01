# Shared types — technical design

`src/types/` contains compile-time contracts, notably provider configuration and theme names. Domain-specific runtime schemas remain in their owning modules (for example orchestration task schemas), so types alone never validate untrusted input. 🟢

Dependencies: providers, settings, UI, Agent. 🟢
