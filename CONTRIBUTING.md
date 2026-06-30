# Contributing to DeepSeek Code

Thanks for your interest in contributing! Here's everything you need to get started.

## Development setup

```bash
git clone https://github.com/Hermenics/deepseek-code.git
cd deepseek-code
bun install
```

### Requirements

- [Bun](https://bun.sh) >= 1.1
- Node.js >= 18 (for npm publishing only)

### Useful commands

```bash
bun run dev          # Dev mode with watch
bun run start        # Run from source
bun run build        # Production build
bun run typecheck    # tsc --noEmit
bun test             # Run test suite
```

## How to contribute

1. **Fork** the repo and create a branch from `main`
2. Make your changes
3. Run checks before submitting:
   ```bash
   bun run typecheck && bun test
   ```
4. Open a PR with a clear description of what changed and why

## Guidelines

### Code style

- TypeScript, functional where possible
- Keep files under 500 lines
- Follow existing patterns — read nearby code before writing new code

### Tests

- Tests live in `tests/`, never in `src/`
- Write tests for new features and bug fixes
- Run `bun test` to verify nothing breaks

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
