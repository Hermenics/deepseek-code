# Skills, plugins, and MCP: codebase study and implementation

This note records the architecture choices behind DeepSeek Code's extension loading. It compares the source implementations, then states what was adopted here. The products have different trust and runtime models, so identical behavior across all of them is neither possible nor desirable.

## Source study

| Project | Relevant source | Useful mechanism |
| --- | --- | --- |
| Codex | [skill loading](https://github.com/openai/codex/blob/main/codex-rs/skills/src/loading.rs), [invocation](https://github.com/openai/codex/blob/main/codex-rs/skills/src/invocation.rs), [MCP exposure](https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_exposure.rs) | Ordered skill roots, lightweight discovery metadata, explicit invocation, bounded MCP exposure. |
| OpenCode | [skill discovery](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/skill/index.ts), [skill tool](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/skill.ts), [directory discovery](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/skill/discovery.ts) | Catalog first; the model requests the full skill body only when needed. |
| Kilo Code | [skills documentation](https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-docs/pages/customize/skills.md) | `SKILL.md` discovery and a reload path for changed extensions. |
| DeepSeek Harness | [skill catalog](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/api/session-controller/src/skill-catalog.ts), [MCP tools](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/mcp/mcp-client/src/tools.ts) | Compact skill descriptions and server-qualified MCP tools with structured results. |
| Reasonix | [boot skills](https://github.com/esengine/DeepSeek-Reasonix/blob/main/internal/assembly/boot/skills.go), [skill index](https://github.com/esengine/DeepSeek-Reasonix/blob/main/internal/ext/skill/index.go), [MCP registration](https://github.com/esengine/DeepSeek-Reasonix/blob/main/internal/assembly/boot/mcp_registration.go) | Index skills at boot, read their bodies on invocation, and register MCP servers separately. |
| CodeWhale | [plugin manifest](https://github.com/Hmbown/CodeWhale/blob/main/crates/tui/assets/plugins/rust-toolkit/plugin.toml), [TUI skill command](https://github.com/Hmbown/CodeWhale/blob/main/crates/tui/src/commands/groups/skills/mod.rs) | Plugins package multiple extension types; users can inspect them through TUI commands. |
| Claude Code (local extracted source) | `~/claude-code/src/utils/plugins/mcpPluginIntegration.ts`, `skillsDirPlugins.ts`, `pluginLoader.ts`, `src/utils/skills/skillChangeDetector.ts` | A plugin can contribute skills and MCP configs from manifest paths or conventional files; changed skills can be reloaded. The local extracted source was used for architectural comparison, not copied. |

## Decisions implemented in DeepSeek Code

1. **Small catalog, on-demand bodies.** `loadSkillPrompt` now sends names, origins, and descriptions. The read-only `skill` tool resolves the chosen `SKILL.md` when the model needs its instructions and can read bounded companion text files within that skill directory. This avoids adding every installed skill body to every turn. Project roots take precedence over user and plugin roots; native skills remain available.
2. **Plugin contributions are active.** Installed plugins now contribute skills, slash commands, and MCP server definitions. Plugin commands use qualified names so a plugin cannot silently shadow a project command. The loader confines manifest paths and symlinks to the plugin install root.
3. **MCP uses one trust boundary per config.** Project MCP configs require approval for their exact content hash in the current workspace. Plugin approvals also bind the installed commit, so an update requires a fresh review. Multiple pending configs are approved in sequence. Stdio servers get a minimal environment; per-server failures are reported without hiding other servers. Tool names are server-qualified, normalized, and capped at the API's 64-character limit. MCP `isError` results fail the tool call, while structured results are preserved.
4. **Changes take effect during the session.** Skill and plugin install, update, and removal refresh the agent catalog. Plugin changes also close and reload MCP clients and refresh slash-command suggestions. `/skill list` shows the actual available catalog by source.

## Scope and limits

The integration deliberately uses DeepSeek Code's existing plugin registry, skill parser, MCP SDK, workspace trust store, and TUI command handlers. Plugin agent definitions and executable hooks remain metadata reported by the installer; they are not loaded by this change because they need their own schema, precedence, and trust rules. Companion files are limited to text under 128 KiB; binary assets need a separate tool contract. MCP non-text blocks currently reach the model as serialized JSON through the agent's text-only tool contract. These are distinct follow-up capabilities, not implied by a plugin's skill/MCP support.

## Verification

The extension tests cover metadata-only skill discovery, on-demand reads, plugin roots, symlink escape rejection, plugin slash commands, MCP name/result mapping, trust invalidation, and a real stdio MCP server call. The real TUI was exercised with an isolated plugin in `/tmp`: its skill appeared in `/skill list`, its command appeared in autocomplete, MCP approval exposed its tool, and `/plugin remove` removed all three from the running session.
