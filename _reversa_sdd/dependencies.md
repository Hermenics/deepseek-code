# DeepSeek Code — Dependencies

> Re-extracted on 2026-08-01 from `package.json` at `v0.4.15`.
> Confidence: 🟢 **CONFIRMED**.

## Runtime

| Item | Version / role |
|---|---|
| Bun | `>=1.1`; runtime, bundler, test runner, and package manager |
| TypeScript | `^5.9.3`; strict ESM compilation with React JSX |
| React | `^19.2.0`; component model for the terminal UI |
| In-repository Ink fork | `src/ink/`; terminal renderer built on `react-reconciler` |

## Core integrations

| Dependency | Version | Purpose |
|---|---:|---|
| `openai` | `^6.34.0` | DeepSeek/OpenAI-compatible model transport |
| `@aws-sdk/client-bedrock` | `^3.1048.0` | Amazon Bedrock inference |
| `@aws-sdk/credential-providers` | `^3.1048.0` | AWS credential discovery |
| `google-auth-library` | `^10.6.2` | Vertex authentication |
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP client/server protocol support |
| `qrcode` | `^1.5.4` | Mobile-auth QR generation |
| `ajv` | `^8.20.0` | JSON-schema validation |

## CLI and terminal libraries

`chalk`, `cli-boxes`, `wrap-ansi`, `strip-ansi`, `supports-hyperlinks`, `emoji-regex`, `get-east-asian-width`, `bidi-js`, `@alcalzone/ansi-tokenize`, `code-excerpt`, and `fast-glob` provide terminal layout, ANSI handling, text measurement, globbing, and diagnostics. `execa` runs external commands; `semver` checks releases; `fuse.js` powers fuzzy matching.

## Supporting libraries

`lodash-es`, `auto-bind`, `indent-string`, `signal-exit`, `stack-utils`, `type-fest`, `usehooks-ts`, and the Smithy signing/HTTP packages support implementation details. `node-fetch` is overridden with `undici@^7.0.0`.

## Developer tooling

`@types/bun`, React, QR and stack-utils typings, plus `react-devtools-core`, support development. A Bun alias replaces `react-devtools-core` with `src/stubs/react-devtools-core.ts` in development and builds.

## Scripts

| Command | Result |
|---|---|
| `bun run start` / `bun run dev` | Run the CLI from source; `dev` watches source files |
| `bun run build` | Bundle the CLI and create the `deepseek` wrapper |
| `bun run typecheck` | `tsc --noEmit` |
| `bun test` | Run `tests/` with Bun |
| `bun run test:coverage` | Produce LCOV coverage |
| `bun run test:ink` / `bun run test:plugins` | Focused test subsets |
| `bun run pack:check` | Validate the package artifact |
