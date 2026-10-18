import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as path from 'path'
import * as fs from 'fs/promises'

const tmpMd = path.join(process.cwd(), `DEEPSEEK-test-${Date.now()}.md`)

// Patch the module to use our temp file
const originalCwd = process.cwd

describe('UpdateKnowledge tool', () => {
  afterEach(async () => {
    await fs.rm(tmpMd, { force: true })
  })

  // We need to test the actual tool but it hardcodes DEEPSEEK.md path
  // So we test via the real file in cwd, cleaning up after
  const DEEPSEEK_MD = path.join(process.cwd(), 'DEEPSEEK.md')
  let originalContent: string | null = null

  beforeEach(async () => {
    try {
      originalContent = await fs.readFile(DEEPSEEK_MD, 'utf-8')
    } catch {
      originalContent = null
    }
    // Remove for clean test
    await fs.rm(DEEPSEEK_MD, { force: true })
  })

  afterEach(async () => {
    // Restore original content
    await fs.rm(DEEPSEEK_MD, { force: true })
    if (originalContent !== null) {
      await fs.writeFile(DEEPSEEK_MD, originalContent, 'utf-8')
    }
  })

  it('creates DEEPSEEK.md with a header when it does not exist', async () => {
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    await UpdateKnowledge.execute({ section: 'Architecture', content: 'Uses Ink for the UI' })
    const content = await fs.readFile(DEEPSEEK_MD, 'utf-8')
    expect(content).toContain('# DEEPSEEK.md — Project Knowledge')
    expect(content).toContain('## Architecture')
    expect(content).toContain('Uses Ink for the UI')
  })

  it('adds a new section to an existing file', async () => {
    await fs.writeFile(DEEPSEEK_MD, '# DEEPSEEK.md — Project Knowledge\n\n## Existing Section\n\ncontent\n', 'utf-8')
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    await UpdateKnowledge.execute({ section: 'New Section', content: 'new content' })
    const content = await fs.readFile(DEEPSEEK_MD, 'utf-8')
    expect(content).toContain('## Existing Section')
    expect(content).toContain('## New Section')
    expect(content).toContain('new content')
  })

  it('updates an existing section without duplicating it', async () => {
    await fs.writeFile(DEEPSEEK_MD, '# DEEPSEEK.md\n\n## Architecture\n\nold content\n', 'utf-8')
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    await UpdateKnowledge.execute({ section: 'Architecture', content: 'new content' })
    const content = await fs.readFile(DEEPSEEK_MD, 'utf-8')
    const count = (content.match(/## Architecture/g) || []).length
    expect(count).toBe(1)
    expect(content).toContain('new content')
    expect(content).not.toContain('old content')
  })

  it('returns a confirmation message with the section name', async () => {
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    const result = await UpdateKnowledge.execute({ section: 'Standards', content: 'use TDD' })
    expect(result).toContain('Knowledge updated')
    expect(result).toContain('Standards')
  })

  it('handles section names with special characters in the regex', async () => {
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    await expect(
      UpdateKnowledge.execute({ section: 'Section (with) special chars.', content: 'content' })
    ).resolves.toBeDefined()
  })
})
