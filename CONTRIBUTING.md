# Contributing to DeepSeek Code

Thanks for your interest in contributing! Here's everything you need to get started.

## Development setup

```bash
git clone https://github.com/Hermenics/deepseek-code.git
cd deepseek-code
bun install
```

### Requirements

- [Bun](https://bun.sh) >= 1.4.0 (matching `package.json` and CI)
- Node.js >= 18 (for npm publishing only)

### Useful commands

```bash
bun run dev          # Dev mode with watch
bun run start        # Run from source
bun run build        # Production build
bun run typecheck    # tsc --noEmit
bun run test         # Isolated, serial test suite; same command as CI
```

## How to contribute

1. **Fork** the repo and create a branch from `main`
2. Make your changes
3. Run checks before submitting:
   ```bash
   bun run typecheck && bun run test
   ```
4. Open a PR with a clear description of what changed and why

## Guidelines

### Language

Use English for all repository content, including `docs/`, code comments, tests, fixtures, and user-facing strings. Portuguese is fine in conversations about the project; do not write it into project files.

### Code style

- TypeScript, functional where possible
- Keep files under 500 lines
- Follow existing patterns — read nearby code before writing new code

### Tests

- Tests live in `tests/`, never in `src/`
- Write tests for new features and bug fixes
- Run `bun run test` to use the same isolated, serial runner as Linux, macOS, and Windows CI.
- Focus one subsystem with `bun test tests/workflows --parallel=1 --max-concurrency=1 --timeout=15000`.
- Repeat a suspect file with `bun test tests/example.test.ts --parallel=1 --max-concurrency=1 --timeout=15000 --rerun-each=5`; failures must be fixed, not retried until green.
- The package scripts pass an explicit 15-second per-test ceiling to the worker runner. Long process/integration tests can declare their own timeout; performance assertions keep their separate thresholds.
- The test preload assigns a temporary HOME/USERPROFILE and state/history directories per isolated file, preventing tests from reading or writing personal settings, credentials, sessions, or memories.
- The test preload uses a repository-owned Git config instead of the machine's global/system config. Fixtures can still set repository-local Git options to test signing, filters, hooks, and line endings deliberately.
- Use `waitFor(condition, description)` from `tests/helpers/waitFor.ts` for readiness. Prefer explicit promise/file barriers over fixed sleeps or a fixed number of timer ticks. `waitForChildFile` also reports early child exits with stderr.
- Close sessions, databases, servers, and child processes before removing temporary directories. Restore environment variables and cwd in `finally`/cleanup hooks. Build child commands with argument arrays and use file URLs when importing fixture modules; do not assume a POSIX shell, path separator, or symlink privileges.
- Platform-specific skips must describe a real capability boundary and retain coverage on supported systems. Do not skip an assertion just because the runner is slower.
- CI uploads a JUnit report for each OS and records runtime versions. A Linux pass alone does not prove native macOS or Windows behavior.

### Commits

- One logical change per commit
- Message format: `type: short description` (e.g. `fix: handle empty response from Bedrock`)
- Common types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

### Pull requests

- One concern per PR — don't bundle unrelated changes
- Keep the title short (under 70 chars), use the description for details
- Include how to test the change

## Project structure

```
src/
├── agent/           # Core agent loop, providers (DeepSeek, Bedrock, Vertex)
├── commands/        # Slash command definitions
├── components/      # Ink/React TUI components
├── tools/           # Agent tools (file ops, shell, git, search, etc.)
├── context/         # Conversation context management
├── hooks/           # Pre/post tool execution hooks
└── index.tsx        # Entry point
tests/               # Test suite
```

## Reporting bugs

File a [GitHub issue](https://github.com/Hermenics/deepseek-code/issues) with:
- Steps to reproduce
- DeepSeek Code version (`deepseek --version`)
- OS and terminal info
- Any relevant error output

## License

By contributing, you agree that your contributions will be licensed under [Apache 2.0](./LICENSE).
