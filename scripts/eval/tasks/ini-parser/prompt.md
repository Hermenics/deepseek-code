Create `src/ini.ts` exporting `parseIni(text: string): Record<string, Record<string, string>>`:

- Lines are separated by `\n` or `\r\n`.
- Blank lines, and lines whose first non-space character is `;` or `#`, are ignored.
- `[name]` starts a section; the name is trimmed. A section with no keys still appears as an empty object, and a section that appears twice is merged.
- Keys that come before any section go into the `""` section. Leave the `""` section out when it has no keys.
- `key = value` lines: the first `=` splits the line, so values may contain `=`. Key and value are trimmed. If a key repeats in a section, the last value wins.
- A value wrapped in double quotes keeps the text inside the quotes exactly, including spaces, `;` and `#`. Inside quotes, `\"` becomes `"` and `\\` becomes `\`.
- An unquoted value ends at an inline comment, which starts at a space followed by `;` or `#`. A `;` or `#` without a space before it is part of the value.
- Any other non-empty line throws an `Error` whose message contains `Invalid line N`, where N is the 1-based line number.

Add tests for it.
