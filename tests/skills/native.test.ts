import { describe, expect, it } from 'bun:test'
import { loadSkillPrompt } from '../../src/skills/native.js'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('native image skill', () => {
  it('exposes native skill descriptions and instructions to the agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-skills-'))
    try {
      const prompt = await loadSkillPrompt(root)
      expect(prompt).toContain('Description: Generate real PNG files')
      expect(prompt).toContain('# Generate PNG images locally')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('loads project skills through their SKILL.md description', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-skills-'))
    const skillDir = join(root, '.deepseek', 'skills', 'release-notes')
    try {
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), '---\nname: release-notes\ndescription: Generate release notes from commits.\n---\n\n# Release notes\nUse git history.')
      const prompt = await loadSkillPrompt(root)
      expect(prompt).toContain('Description: Generate release notes from commits.')
      expect(prompt).toContain('# Release notes')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
