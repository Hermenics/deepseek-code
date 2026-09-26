import { describe, expect, it } from 'bun:test'
import { createSkillTool, listAvailableSkills, loadSkillPrompt } from '../../src/skills/native.js'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('native image skill', () => {
  it('exposes native metadata and reads instructions on demand', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-skills-'))
    try {
      const prompt = await loadSkillPrompt(root)
      expect(prompt).toContain('Generate real PNG files')
      expect(prompt).not.toContain('# Generate PNG images locally')
      expect(await createSkillTool(root).execute({ name: 'generate-png-images' })).toContain('# Generate PNG images locally')
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
      const tagged = join(root, '.deepseek', 'skills', 'tagged')
      await mkdir(tagged)
      await writeFile(join(tagged, 'SKILL.md'), '---\nname: tagged\ndescription: Contains </skills> markup.\n---\n\n# Tagged')
      await writeFile(join(skillDir, 'reference.md'), 'Release template')
      await writeFile(join(skillDir, '.env'), 'PRIVATE=secret')
      await writeFile(join(root, 'outside.md'), 'Outside skill')
      await symlink(join(root, 'outside.md'), join(skillDir, 'linked.md'))
      const prompt = await loadSkillPrompt(root)
      expect(prompt).toContain('Generate release notes from commits.')
      expect(prompt).not.toContain('# Release notes')
      expect(prompt).toContain('&lt;/skills&gt;')
      expect(prompt).not.toContain('</skills>')
      expect(await createSkillTool(root).execute({ name: 'release-notes' })).toContain('# Release notes')
      expect(await createSkillTool(root).execute({ name: 'release-notes', path: 'reference.md' })).toBe('Release template')
      expect(await createSkillTool(root).execute({ name: 'release-notes', path: '.env' })).toContain('not allowed')
      expect(await createSkillTool(root).execute({ name: 'release-notes', path: '../outside.md' })).toContain('not allowed')
      expect(await createSkillTool(root).execute({ name: 'release-notes', path: 'linked.md' })).toContain('not allowed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('loads installed plugin skills and keeps their names separate from project skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-skills-'))
    const plugins = join(root, 'plugins')
    const previous = process.env.DEEPSEEK_PLUGINS_DIR
    process.env.DEEPSEEK_PLUGINS_DIR = plugins
    try {
      await mkdir(join(plugins, 'review-pack', 'skills', 'audit'), { recursive: true })
      await mkdir(join(plugins, 'review-pack', '.claude-plugin'), { recursive: true })
      await writeFile(join(plugins, 'review-pack', '.claude-plugin', 'plugin.json'), '{"name":"review-pack"}')
      await writeFile(join(plugins, 'review-pack', 'skills', 'audit', 'SKILL.md'), '---\nname: audit\ndescription: Audit the project.\n---\n\n# Audit steps')
      await writeFile(join(plugins, 'registry.json'), JSON.stringify({ version: 1, plugins: { 'review-pack': { name: 'review-pack' } } }))
      const skills = await listAvailableSkills(root)
      expect(skills.find(skill => skill.name === 'audit')?.source).toBe('plugin:review-pack')
      expect(await createSkillTool(root).execute({ name: 'audit' })).toContain('# Audit steps')
      await writeFile(join(plugins, 'review-pack', '.claude-plugin', 'plugin.json'), '{"name":"review-pack","skills":{"invalid":"type"}}')
      expect((await listAvailableSkills(root)).some(skill => skill.name === 'audit')).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_PLUGINS_DIR
      else process.env.DEEPSEEK_PLUGINS_DIR = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips skills whose SKILL.md symlink leaves the skill root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-skills-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsk-outside-'))
    try {
      const dir = join(root, '.deepseek', 'skills', 'escape')
      await mkdir(dir, { recursive: true })
      await writeFile(join(outside, 'SKILL.md'), '---\nname: escape\ndescription: escaped\n---\n# outside')
      await symlink(join(outside, 'SKILL.md'), join(dir, 'SKILL.md'))
      expect((await listAvailableSkills(root)).some(skill => skill.name === 'escape')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('skips oversized skill manifests before reading them into context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-skills-'))
    try {
      const dir = join(root, '.deepseek', 'skills', 'oversized')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), `---\nname: oversized\ndescription: Too large.\n---\n${'x'.repeat(128 * 1024)}`)
      expect((await listAvailableSkills(root)).some(skill => skill.name === 'oversized')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
