# ADR-009: Path Sandbox with Symlink Traversal Protection

> Status: ACCEPTED  
> Date: 2026 (inferred from codebase — no single commit, built incrementally)  
> Confidence: 🟢 CONFIRMED

## Context

The agent can read and write arbitrary files via tools. Without containment:
- LLM could access system files, SSH keys, environment variables
- A prompt injection in a file could instruct the agent to exfiltrate credentials
- Symlinks could escape the working directory

## Decision

Implement a **path sandbox** (`assertSafePath`) that enforces:
1. All paths must resolve inside `process.cwd()`
2. Blocked directories list (`.git`, `.deepseek`, `node_modules`, etc.)
3. Symlink resolution — real path must also be inside cwd
4. Sensitive file pattern matching (`.env*`, `*.pem`, credentials, SSH keys)

## Rationale

Defense-in-depth approach:
- CWD containment prevents `/etc/passwd` reads
- Symlink check prevents `ln -s /etc/passwd ./innocent.txt` attack
- Blocked dirs prevent config tampering and wasted context on node_modules
- Sensitive patterns prevent credential exfiltration even within allowed dirs

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Allowlist only (explicit paths) | Too restrictive for a code assistant that explores freely |
| OS-level sandboxing (seccomp, landlock) | Platform-specific, complex, and Bun support unclear |
| No file restrictions, trust the LLM | LLMs hallucinate and can be prompt-injected — unacceptable |
| Separate process for file I/O | Over-engineering — path validation is simpler and sufficient |

## Consequences

- **Positive:** Prevents most file-based attacks (traversal, credential theft, config tampering)
- **Positive:** Parent directory check handles non-existent files correctly
- **Positive:** Sensitive file patterns cover common credential formats
- **Negative:** Cannot read legitimate `.env` files even when user wants to discuss them
- **Negative:** Blocked dirs are hardcoded — no user override mechanism
- **Gap:** 🟡 If a symlink is created AFTER the initial check but before the operation, there's a TOCTOU window (very unlikely in practice)
