# Permissions Matrix

> Confidence: 🟢 CONFIRMED (extracted from source code)  
> Generated at: 2026-07-01

## Interaction Mode × Tool Access

| Tool | Plan | Build | Auto |
|------|:----:|:-----:|:----:|
| `read_file` | ✅ | ✅ | ✅ |
| `read_folder` | ✅ | ✅ | ✅ |
| `glob` | ✅ | ✅ | ✅ |
| `grep` | ✅ | ✅ | ✅ |
| `git` | ✅ | ✅ | ✅ |
| `web_fetch` | ✅ | ✅ | ✅ |
| `introspect` | ✅ | ✅ | ✅ |
| `todo` | ✅ | ✅ | ✅ |
| `subagent` | ✅ | ✅ | ✅ |
| `shell` | ❌ | ✅ | ✅ |
| `write_file` | ❌ | ✅ | ✅ |
| `patch_file` | ❌ | ✅ | ✅ |
| `update_knowledge` | ❌ | ✅ | ✅ |
| MCP tools (`*__*`) | ❌ | ✅ | ✅ |

**Note:** Auto mode bypasses the matrix entirely — `canUseTool()` returns `true` for everything when `mode === 'auto'`.

---

## SubAgent Role × Tool Access

| Tool | reader | reviewer | writer | executor | unrestricted |
|------|:------:|:--------:|:------:|:--------:|:------------:|
| `read_file` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `read_folder` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `grep` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `glob` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `introspect` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `web_fetch` | ✅ | ❌ | ❌ | ✅ | ✅ |
| `write_file` | ❌ | ❌ | ✅ | ✅ | ✅ |
| `patch_file` | ❌ | ❌ | ✅ | ✅ | ✅ |
| `shell` | ❌ | ❌ | ❌ | ✅ | ✅ |
| All others | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Risk Level Matrix

### High Risk (always requires confirmation in Build mode)

| Rule ID | Tool | Pattern/Condition | Description |
|---------|------|-------------------|-------------|
| `shell:rm` | shell | `rm *` | File deletion |
| `shell:rm-rf` | shell | `rm -rf *` | Recursive forced deletion |
| `shell:force-push` | shell | `git push *--force*` | Force push |
| `shell:reset-hard` | shell | `git reset --hard*` | Destructive git reset |
| `shell:checkout-destructive` | shell | `git checkout -- *` | Discard changes |
| `shell:clean` | shell | `git clean *` | Remove untracked files |
| `shell:npm-install` | shell | `npm install*` | Package installation |
| `shell:bun-add` | shell | `bun add*` | Package installation |
| `shell:pip-install` | shell | `pip install*` | Package installation |
| `shell:apt-install` | shell | `apt install*` | System package install |
| `shell:sudo` | shell | `sudo *` | Privilege escalation |
| `shell:systemctl` | shell | `systemctl *` | Service management |
| `shell:docker-rm` | shell | `docker *--rm*` | Container removal |
| `shell:chmod` | shell | `chmod *` | Permission change |
| `shell:deploy-*` | shell | `*deploy*` (various) | Deployment commands |
| `shell:build` | shell | `bun run build*` | Production build |
| `write:deepseek-config` | write_file | `*.deepseek/*` | Config modification |
| `patch:deepseek-config` | patch_file | `*.deepseek/*` | Config modification |
| `write:steering` | write_file | `*.deepseek/steering/*` | Steering override |
| `write:large-overwrite` | write_file | `large_overwrite` condition | File ≥ 100 existing lines |

### Medium Risk (requires confirmation only for subagents)

| Rule ID | Tool | Pattern/Condition | Description |
|---------|------|-------------------|-------------|
| `shell:git-push` | shell | `git push*` | Push to remote |
| `shell:git-commit` | shell | `git commit*` | Create commit |
| `write:config-package` | write_file | `*package.json` | Package manifest |
| `write:config-tsconfig` | write_file | `*tsconfig*` | TypeScript config |
| `write:config-dockerfile` | write_file | `*Dockerfile*` | Container config |
| `write:burst` | write_file | `multi_edit_burst` condition | ≥ 3 writes this turn |
| `patch:burst` | patch_file | `multi_edit_burst` condition | ≥ 3 patches this turn |
| `shell:npm-install-dev` | shell | `npm install --save-dev*` | Dev dependency |
| `shell:bun-add-dev` | shell | `bun add -d*` | Dev dependency |

---

## Path Sandbox — Blocked Directories

| Directory | Reason |
|-----------|--------|
| `.agent` | Agent internal config |
| `.claude` | Claude Code config |
| `.kiro` | Kiro config |
| `.github` | GitHub workflows/actions |
| `.deepseek` | DeepSeek Code config |
| `node_modules` | Dependencies (large, untrusted) |
| `dist` | Build output |
| `build` | Build output |
| `.git` | Git internals |

---

## Path Sandbox — Sensitive File Patterns

| Pattern | Examples |
|---------|----------|
| `.env*` | `.env`, `.env.local`, `.env.production` |
| `*.pem` | Private keys |
| `*.key` | Key files |
| `*.p12`, `*.pfx` | PKCS#12 certificates |
| `credentials*` | `credentials.json` |
| `secrets*` | `secrets.yaml`, `secrets.toml` |
| `.netrc`, `.npmrc`, `.pypirc` | Registry tokens |
| `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `id_dsa*` | SSH keys |
| `service*account*.json` | GCP service accounts |
| `gcloud*.json` | GCP credentials |
| `.aws/credentials`, `.aws/config` | AWS credentials |

---

## SSRF Protection — Blocked Targets

| Category | Blocked Values |
|----------|---------------|
| Loopback | `localhost`, `127.0.0.1`, `::1`, `0.0.0.0` |
| Cloud Metadata | `169.254.169.254`, `metadata.google.internal` |
| Private IPv4 | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| Link-local | `169.254.0.0/16` |
| Private IPv6 | `::1`, `fe80::/10`, `fc00::/7`, `::ffff:` mapped private |

DNS resolution is performed and the resolved IP is re-checked against the same private ranges (prevents DNS rebinding).

---

## Settings Security Model

| Setting Level | Path | Hooks Allowed | Priority |
|---------------|------|:-------------:|:--------:|
| User | `~/.deepseek/settings.json` | ✅ | Low |
| Project | `.deepseek/settings.json` | ❌ (stripped) | Medium |
| Local | `.deepseek/settings.local.json` | ❌ (stripped) | High |

**Rationale:** A cloned repository could contain a malicious `.deepseek/settings.json` with hooks that execute arbitrary commands. Stripping hooks from non-user sources prevents this attack vector.

---

## Permission Rule Syntax

```
"Shell(git *)"     → tool=shell, pattern="git *"
"WriteFile"        → tool=write_file, pattern=undefined (matches all)
"ReadFile(*.env)"  → tool=read_file, pattern="*.env"
```

Resolution: `deny` rules first → `allow` rules → fallback (`ask` if allow rules exist, `allow` if only deny rules exist).
