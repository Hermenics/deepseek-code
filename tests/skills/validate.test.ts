import { describe, it, expect } from 'bun:test'
import { parseSkillManifest, validateSkillName } from '../../src/skills/validate.js'

describe('parseSkillManifest', () => {
  it('should parse valid SKILL.md with all fields', () => {
    const content = `---
name: my-skill
description: Does something useful
metadata:
  author: someone
  version: 1.0.0
  license: MIT
---

# My Skill

Some content here.
`
    const result = parseSkillManifest(content)
    expect(result).not.toHaveProperty('error')
    const manifest = result as { name: string; description: string; metadata?: object }
    expect(manifest.name).toBe('my-skill')
    expect(manifest.description).toBe('Does something useful')
    expect(manifest.metadata).toEqual({ author: 'someone', version: '1.0.0', license: 'MIT' })
  })

  it('should parse valid SKILL.md with only required fields', () => {
    const content = `---
name: minimal-skill
description: Minimal description
---
`
    const result = parseSkillManifest(content)
    expect(result).not.toHaveProperty('error')
    const manifest = result as { name: string; description: string }
    expect(manifest.name).toBe('minimal-skill')
    expect(manifest.description).toBe('Minimal description')
  })

  it('should return error when name is missing', () => {
    const content = `---
description: No name here
---
`
    const result = parseSkillManifest(content)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toMatch(/name/i)
  })

  it('should return error when description is missing', () => {
    const content = `---
name: some-skill
---
`
    const result = parseSkillManifest(content)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toMatch(/description/i)
  })

  it('should return error when name is invalid (uppercase)', () => {
    const content = `---
name: MySkill
description: Has uppercase
---
`
    const result = parseSkillManifest(content)
    expect(result).toHaveProperty('error')
  })

  it('should return error when name contains spaces', () => {
    const content = `---
name: my skill
description: Has spaces
---
`
    const result = parseSkillManifest(content)
    expect(result).toHaveProperty('error')
  })

  it('should return error when name contains special characters', () => {
    const content = `---
name: my_skill!
description: Has special chars
---
`
    const result = parseSkillManifest(content)
    expect(result).toHaveProperty('error')
  })

  it('should return error when there is no frontmatter', () => {
    const content = `# My Skill

Just some markdown without frontmatter.
`
    const result = parseSkillManifest(content)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toMatch(/frontmatter/i)
  })

  it('should return error for empty file', () => {
    const result = parseSkillManifest('')
    expect(result).toHaveProperty('error')
  })

  it('should return error when description is empty string', () => {
    const content = `---
name: some-skill
description: ''
---
`
    const result = parseSkillManifest(content)
    expect(result).toHaveProperty('error')
  })
})

describe('validateSkillName', () => {
  it('should accept simple lowercase name', () => {
    expect(validateSkillName('myskill')).toBe(true)
  })

  it('should accept kebab-case name', () => {
    expect(validateSkillName('my-skill')).toBe(true)
  })

  it('should accept name with numbers', () => {
    expect(validateSkillName('skill-v2')).toBe(true)
  })

  it('should accept name starting with number', () => {
    expect(validateSkillName('2fast')).toBe(true)
  })

  it('should reject uppercase letters', () => {
    expect(validateSkillName('MySkill')).toBe(false)
  })

  it('should reject underscores', () => {
    expect(validateSkillName('my_skill')).toBe(false)
  })

  it('should reject spaces', () => {
    expect(validateSkillName('my skill')).toBe(false)
  })

  it('should reject leading hyphen', () => {
    expect(validateSkillName('-skill')).toBe(false)
  })

  it('should reject trailing hyphen', () => {
    expect(validateSkillName('skill-')).toBe(false)
  })

  it('should reject double hyphen', () => {
    expect(validateSkillName('my--skill')).toBe(false)
  })

  it('should reject empty string', () => {
    expect(validateSkillName('')).toBe(false)
  })

  it('should reject special characters', () => {
    expect(validateSkillName('skill!')).toBe(false)
    expect(validateSkillName('skill@v2')).toBe(false)
  })
})
