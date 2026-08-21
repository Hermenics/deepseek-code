#!/usr/bin/env python3
"""Validate the portable SKILL.md format used by common coding CLIs."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PLACEHOLDER_RE = re.compile(r"(?:TODO|FIXME|\[your [^\]]+\]|\{\{[^}]+\}\})", re.IGNORECASE)


def validate(path: Path) -> list[str]:
    errors: list[str] = []
    skill_file = path / "SKILL.md" if path.is_dir() else path
    if not skill_file.is_file():
        return [f"SKILL.md not found: {skill_file}"]

    try:
        text = skill_file.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        return [f"cannot read skill file: {exc}"]
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        errors.append("file must start with YAML frontmatter (---)")
        return errors

    try:
        end = next(i for i, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration:
        errors.append("frontmatter is missing its closing ---")
        return errors

    values: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$", line)
        if not match:
            errors.append(f"invalid frontmatter line: {line}")
            continue
        key = match.group(1)
        if key in values:
            errors.append(f"duplicate frontmatter key: {key}")
            continue
        values[key] = match.group(2).strip("'\"")

    name = values.get("name", "")
    description = values.get("description", "")
    if not name:
        errors.append("frontmatter is missing required name")
    elif not NAME_RE.fullmatch(name):
        errors.append("name must be lowercase kebab-case")
    if not description:
        errors.append("frontmatter is missing required description")

    body = "\n".join(lines[end + 1:]).strip()
    if not body:
        errors.append("skill body cannot be empty")
    if PLACEHOLDER_RE.search(text):
        errors.append("skill contains an unfinished placeholder")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill", type=Path, help="skill directory or SKILL.md path")
    args = parser.parse_args()
    errors = validate(args.skill)
    if errors:
        for error in errors:
            print(f"✗ {error}", file=sys.stderr)
        return 1
    target = args.skill / "SKILL.md" if args.skill.is_dir() else args.skill
    print(f"✓ Valid skill: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
