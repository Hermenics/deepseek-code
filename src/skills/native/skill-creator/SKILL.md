---
name: skill-creator
description: Create and validate portable SKILL.md skills for DeepSeek Code, Claude Code, or Codex when the user asks the model to create a reusable skill.
---

# Skill creator

Create a focused skill directory with a `SKILL.md` file and only the supporting resources that the workflow genuinely needs. Keep the frontmatter limited to a kebab-case `name` and a useful `description`; put operational guidance in the body.

Use the bundled validator before reporting success:

```bash
python3 scripts/validate_skill.py path/to/skill
```

The validator accepts a skill directory or a direct `SKILL.md` path and checks the portable format shared by DeepSeek Code, Claude Code, and Codex. Fix every reported error, remove scaffold placeholders, and run it again. Do not add README files, changelogs, secrets, or unrelated resources to a generated skill.
