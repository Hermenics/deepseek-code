export interface SkillManifest {
  name: string
  description: string
  metadata?: { author?: string; version?: string; license?: string }
}

/** Skill names must be kebab-case: lowercase alphanumerics separated by single hyphens. */
export function validateSkillName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)
}

/** Parses SKILL.md frontmatter into a manifest, requiring kebab-case `name` and non-empty `description`. Returns `{ error }` instead of throwing. */
export function parseSkillManifest(content: string): SkillManifest | { error: string } {
  if (!content || !content.trim()) {
    return { error: 'Empty file: no frontmatter found' }
  }

  if (!content.startsWith('---')) {
    return { error: 'No frontmatter found: file must start with ---' }
  }

  // Find closing --- on its own line (not inside a value)
  const lines = content.split('\n')
  let endLineIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endLineIdx = i
      break
    }
  }
  if (endLineIdx === -1) {
    return { error: 'No frontmatter found: missing closing ---' }
  }

  const frontmatter = lines.slice(1, endLineIdx).join('\n').trim()
  if (!frontmatter) {
    return { error: 'Empty frontmatter' }
  }

  const parsed = parseYaml(frontmatter)

  if (!parsed.name) {
    return { error: 'SKILL.md missing required \'name\' field' }
  }

  if (!parsed.description || parsed.description === '\'\'' || parsed.description === '""') {
    return { error: 'SKILL.md missing required \'description\' field' }
  }

  if (!validateSkillName(parsed.name)) {
    return { error: `Invalid skill name '${parsed.name}': must be kebab-case (lowercase letters, numbers, hyphens)` }
  }

  const manifest: SkillManifest = {
    name: parsed.name,
    description: parsed.description,
  }

  if (parsed.metadata) {
    manifest.metadata = parsed.metadata
  }

  return manifest
}

/** Rejects keys that could pollute object prototypes when copied into parsed results. */
function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'prototype' && key !== 'constructor'
}

/** Minimal frontmatter parser: flat `key: value` pairs plus one level of indented nested blocks. Not a full YAML implementation (no lists, multi-line strings or deeper nesting). */
function parseYaml(text: string): Record<string, any> {
  const result: Record<string, any> = {}
  const lines = text.split('\n')
  let currentBlock: string | null = null
  let blockData: Record<string, string> = {}

  for (const line of lines) {
    if (!line.trim()) continue

    // Nested block value (indented with spaces)
    if (currentBlock && (line.startsWith('  ') || line.startsWith('\t'))) {
      const trimmed = line.trim()
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim()
        const val = trimmed.slice(colonIdx + 1).trim()
        if (isSafeKey(key)) blockData[key] = stripQuotes(val)
      }
      continue
    }

    // Flush previous block
    if (currentBlock) {
      result[currentBlock] = { ...blockData }
      currentBlock = null
      blockData = {}
    }

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()

    if (!isSafeKey(key)) continue

    if (!val) {
      // Start of a nested block
      currentBlock = key
      blockData = {}
    } else {
      result[key] = stripQuotes(val)
    }
  }

  // Flush last block
  if (currentBlock) {
    result[currentBlock] = { ...blockData }
  }

  return result
}

function stripQuotes(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1)
  }
  return s
}
