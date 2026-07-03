# Architectural Proposal: `/skill install <github-repo>`

## Modules Involved

- `src/commands/skill/index.ts` — Command parser (subcommands: install, list, remove, update)
- `src/commands/types.ts` — Extended with `skill` CommandResult variants
- `src/commands/index.ts` — Register the new command
- `src/skills/installer.ts` — Core logic: clone, validate, register, remove, update
- `.claude/skills/.registry.json` — Installed skills metadata (gitignored by user choice)

---

## Contracts (Interfaces)

### CommandResult extension (`src/commands/types.ts`)

```typescript
export type CommandResult =
  | /* ...existing... */
  | { type: 'skill'; action: 'install'; repo: string }
  | { type: 'skill'; action: 'list' }
  | { type: 'skill'; action: 'remove'; name: string }
  | { type: 'skill'; action: 'update'; name: string }
```

### Skill Manifest (what a valid installable repo must have)

A repo is a valid skill if its root contains `SKILL.md` with YAML frontmatter:

```yaml
---
name: my-skill          # kebab-case, unique identifier
description: One-line description of what this skill does
metadata:
  author: owner-name
  version: "1.0.0"
---
```

Required fields: `name`, `description`.
Optional: `metadata.author`, `metadata.version`, `metadata.license`.

The repo may also contain a `references/` directory (like existing skills do).

### Registry Schema (`.claude/skills/.registry.json`)

```typescript
interface SkillRegistry {
  version: 1
  skills: Record<string, SkillEntry>
}

interface SkillEntry {
  name: string           // from SKILL.md frontmatter
  repo: string           // "owner/repo"
  installedAt: string    // ISO 8601
  updatedAt: string      // ISO 8601
  commitHash: string     // git rev-parse HEAD at install/update time
  description: string    // from SKILL.md frontmatter
}
```

Example:

```json
{
  "version": 1,
  "skills": {
    "codex-plugin": {
      "name": "codex-plugin",
      "repo": "openai/codex-plugin-cc",
      "installedAt": "2026-07-03T14:00:00Z",
      "updatedAt": "2026-07-03T14:00:00Z",
      "commitHash": "abc1234",
      "description": "Codex integration for Claude Code compatible agents"
    }
  }
}
```

### Installer Module (`src/skills/installer.ts`)

```typescript
interface InstallResult {
  ok: boolean
  name: string
  error?: string
}

export async function installSkill(repo: string): Promise<InstallResult>
export async function removeSkill(name: string): Promise<InstallResult>
export async function updateSkill(name: string): Promise<InstallResult>
export async function listSkills(): Promise<SkillEntry[]>
```

---

## Data Flow

### Install

```
User: /skill install owner/repo
  → parseCommand → { type: 'skill', action: 'install', repo: 'owner/repo' }
  → handler calls installSkill('owner/repo')
    → git clone (shallow, depth=1) to tmp dir
    → validate: SKILL.md exists + has valid frontmatter (name field present)
    → read `name` from frontmatter
    → check registry: if name already exists → error "already installed"
    → move skill dir to `.claude/skills/<name>/`
    → remove .git/ from installed dir (no nested repos)
    → read commit hash before removing .git
    → write entry to .registry.json
    → return { ok: true, name }
```

### Remove

```
User: /skill remove my-skill
  → handler calls removeSkill('my-skill')
    → check registry: exists?
    → rm -rf `.claude/skills/<name>/`
    → delete entry from .registry.json
    → return { ok: true, name }
```

### Update

```
User: /skill update my-skill
  → handler calls updateSkill('my-skill')
    → read registry entry → get repo
    → git clone (shallow) to tmp
    → validate SKILL.md (same as install)
    → rm old dir, move new dir in place
    → remove .git/
    → update registry entry (updatedAt, commitHash)
    → return { ok: true, name }
```

### List

```
User: /skill list
  → handler calls listSkills()
    → read .registry.json
    → return entries (or empty array if file missing)
```

---

## File Tree (what to create)

```
src/commands/skill/
  index.ts              # Command definition + parse (subcommands)

src/skills/
  installer.ts          # Core install/remove/update/list logic
  registry.ts           # Read/write .registry.json
  validate.ts           # Parse SKILL.md frontmatter, check required fields

tests/
  skills/
    installer.test.ts   # Unit tests for install flow (mock git)
    registry.test.ts    # Registry read/write
    validate.test.ts    # Frontmatter parsing
```

Total: 6 files. Budget: ~400 lines across all.

---

## Decision: Shallow Clone + Delete .git

**Chosen pattern:** `git clone --depth 1` to a temp dir, validate, then move to target. Remove `.git/` after capturing the commit hash.

**Justification:**
- Shallow clone is fast (single commit)
- No nested git repos inside the project
- Commit hash provides version pinning without full history
- Update = fresh clone (no merge complexity)

### Discarded Alternatives

- **git submodules:** Too complex for skill management, pollutes project git state
- **GitHub API tarball download:** Requires auth for private repos, git clone works everywhere
- **Keep .git/ for `git pull` updates:** Nested repos cause confusion; fresh clone on update is simpler and avoids merge conflicts
- **npm/registry approach:** Over-engineered for this use case; git is universal

---

## Validation Rules

A repo is a valid installable skill if:

1. Root contains `SKILL.md` (case-sensitive)
2. `SKILL.md` starts with YAML frontmatter (between `---` markers)
3. Frontmatter has a `name` field (non-empty string, kebab-case: `/^[a-z0-9]+(-[a-z0-9]+)*$/`)
4. Frontmatter has a `description` field (non-empty string)
5. `name` does not conflict with an already-installed skill

If validation fails, the temp clone is deleted and an error message is returned.

---

## Edge Cases

| Case | Handling |
|------|----------|
| Repo doesn't exist | git clone fails → "Repository not found" |
| No SKILL.md in repo | Validation fails → "Not a valid skill: missing SKILL.md" |
| SKILL.md missing `name` | Validation fails → "SKILL.md missing required 'name' field" |
| Name collision | "Skill '<name>' already installed. Use /skill update <name>" |
| No internet | git clone fails → surface git error message |
| .registry.json missing | Create it on first install |
| .registry.json corrupted | Surface error and require manual recovery — do NOT reconstruct silently from directory scan (data loss: repo, installedAt, commitHash would be lost) |
| Skill dir exists but not in registry | Warn, offer to register or skip |
| Remove non-existent skill | "Skill '<name>' not found" |
| Update non-existent skill | "Skill '<name>' not installed. Use /skill install" |
| Repo has nested directories | Only root SKILL.md is checked; entire repo becomes the skill dir |

---

## Git Operations (Bun.spawn)

```typescript
// Clone
const proc = Bun.spawn(['git', 'clone', '--depth', '1', url, tmpDir], {
  stdout: 'pipe',
  stderr: 'pipe',
})
const exitCode = await proc.exited

// Get commit hash (before removing .git)
const hashProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
  cwd: tmpDir,
  stdout: 'pipe',
})
const hash = (await new Response(hashProc.stdout).text()).trim()
```

---

## Temp Directory Strategy

Use `os.tmpdir()` + random suffix for clone target. Clean up on success (moved) or failure (deleted). Never leave orphan temp dirs.

---

## Integration with Existing Skill Loading

Skills are currently loaded by agents reading `.claude/skills/<name>/SKILL.md`. The installer just places files in the right location — no runtime registration needed. The skill becomes available the moment it exists on disk.

---

## Help Text Addition

Add to `/help` output:
```
  /skill install <owner/repo>  install a skill from GitHub
  /skill list                  list installed skills
  /skill remove <name>         remove an installed skill
  /skill update <name>         update a skill to latest
```

---

## Security Considerations

- Skills are markdown files read by the agent — they don't execute code directly
- The installer runs `git clone` only (no post-install scripts)
- No shell expansion on repo names (validated as `owner/repo` pattern: `/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/`)
- Temp dirs use random names to avoid path traversal
