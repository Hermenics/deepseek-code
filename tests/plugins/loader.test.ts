import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { discoverComponents, readPluginManifest } from '../../src/plugins/loader.js'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'dsk-plugin-loader-'))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('discoverComponents', () => {
  it('should find commands/*.md files', () => {
    mkdirSync(join(testDir, 'commands'), { recursive: true })
    writeFileSync(join(testDir, 'commands', 'foo.md'), '# foo')
    writeFileSync(join(testDir, 'commands', 'bar.md'), '# bar')
    const result = discoverComponents(testDir)
    expect(result.commands.sort()).toEqual(['bar', 'foo'])
  })

  it('should find agents/*.md files', () => {
    mkdirSync(join(testDir, 'agents'), { recursive: true })
    writeFileSync(join(testDir, 'agents', 'coder.md'), '# coder')
    const result = discoverComponents(testDir)
    expect(result.agents).toEqual(['coder'])
  })

  it('should find skills/*/SKILL.md', () => {
    mkdirSync(join(testDir, 'skills', 'my-skill'), { recursive: true })
    writeFileSync(join(testDir, 'skills', 'my-skill', 'SKILL.md'), '# skill')
    const result = discoverComponents(testDir)
    expect(result.skills).toEqual(['my-skill'])
  })

  it('should ignore skill dirs without SKILL.md', () => {
    mkdirSync(join(testDir, 'skills', 'broken'), { recursive: true })
    writeFileSync(join(testDir, 'skills', 'broken', 'readme.md'), 'nope')
    const result = discoverComponents(testDir)
    expect(result.skills).toEqual([])
  })

  it('should detect hooks/hooks.json', () => {
    mkdirSync(join(testDir, 'hooks'), { recursive: true })
    writeFileSync(join(testDir, 'hooks', 'hooks.json'), '{}')
    const result = discoverComponents(testDir)
    expect(result.hasHooks).toBe(true)
  })

  it('should return hasHooks false when no hooks.json', () => {
    const result = discoverComponents(testDir)
    expect(result.hasHooks).toBe(false)
  })

  it('should return empty arrays for non-existent dirs', () => {
    const result = discoverComponents(join(testDir, 'nonexistent'))
    expect(result).toEqual({ commands: [], agents: [], skills: [], hasHooks: false })
  })
})

describe('readPluginManifest', () => {
  it('should read valid plugin.json', () => {
    writeFileSync(join(testDir, 'plugin.json'), JSON.stringify({ name: 'cool-plugin', version: '1.0.0', description: 'A plugin' }))
    const result = readPluginManifest(testDir)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('cool-plugin')
    expect(result!.version).toBe('1.0.0')
  })

  it('should return null for missing plugin.json', () => {
    const result = readPluginManifest(testDir)
    expect(result).toBeNull()
  })

  it('should return null for invalid JSON', () => {
    writeFileSync(join(testDir, 'plugin.json'), 'not json{{{')
    const result = readPluginManifest(testDir)
    expect(result).toBeNull()
  })

  it('should return null when name is not a string', () => {
    writeFileSync(join(testDir, 'plugin.json'), JSON.stringify({ name: 123 }))
    const result = readPluginManifest(testDir)
    expect(result).toBeNull()
  })
})
