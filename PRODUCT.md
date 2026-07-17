# Product

## Register

product

## Users

DeepSeek Code is for software engineers who work primarily in a terminal and want an AI coding assistant that can inspect, change, test, and explain a real codebase. They use it during focused development sessions and need configuration changes to be quick, predictable, keyboard-first, and safe at both user and project scope.

## Product Purpose

DeepSeek Code brings an agentic coding workflow into the terminal with multiple model providers, tools, permissions, persistent context, sessions, worktrees, and specialist agents. Success means users can understand what the assistant will do, control its behavior without editing JSON by hand, and trust that project configuration cannot silently weaken user security.

## Brand Personality

Precise, calm, and trustworthy. The interface should feel native to a professional terminal: dense enough for experts, legible enough for first-time users, and direct about state, risk, source, and consequences.

## Anti-references

Do not make the TUI resemble a web dashboard squeezed into a terminal. Avoid nested cards, decorative gradients, excessive icons, fixed-width layouts, mouse-only actions, hidden configuration precedence, and color used without a textual signal.

## Design Principles

1. Show effective state and origin together so users never have to guess which file won.
2. Keep expert workflows fast while preserving clear explanations and safe defaults.
3. Use progressive disclosure: categories first, details and advanced controls on demand.
4. Make security boundaries visible, especially for credentials, permissions, hooks, and automatic execution.
5. Adapt structurally to terminal size instead of truncating the desktop layout until it breaks.

## Accessibility & Inclusion

Every workflow must be keyboard-complete and usable without a mouse. Maintain readable contrast in dark, light, ANSI, and colorblind-friendly themes. Never communicate status through color alone. Respect reduced-motion preferences, handle long translated labels, and keep focus and current selection unambiguous.
