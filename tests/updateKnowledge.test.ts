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

  it('cria DEEPSEEK.md com cabeçalho se não existir', async () => {
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    await UpdateKnowledge.execute({ section: 'Arquitetura', content: 'Usa Ink para UI' })
    const content = await fs.readFile(DEEPSEEK_MD, 'utf-8')
    expect(content).toContain('# DEEPSEEK.md — Project Knowledge')
    expect(content).toContain('## Arquitetura')
    expect(content).toContain('Usa Ink para UI')
  })

  it('adiciona nova seção ao arquivo existente', async () => {
    await fs.writeFile(DEEPSEEK_MD, '# DEEPSEEK.md — Project Knowledge\n\n## Seção Existente\n\nconteúdo\n', 'utf-8')
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    await UpdateKnowledge.execute({ section: 'Nova Seção', content: 'novo conteúdo' })
    const content = await fs.readFile(DEEPSEEK_MD, 'utf-8')
    expect(content).toContain('## Seção Existente')
    expect(content).toContain('## Nova Seção')
    expect(content).toContain('novo conteúdo')
  })

  it('atualiza seção existente sem duplicar', async () => {
    await fs.writeFile(DEEPSEEK_MD, '# DEEPSEEK.md\n\n## Arquitetura\n\nconteúdo antigo\n', 'utf-8')
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    await UpdateKnowledge.execute({ section: 'Arquitetura', content: 'conteúdo novo' })
    const content = await fs.readFile(DEEPSEEK_MD, 'utf-8')
    const count = (content.match(/## Arquitetura/g) || []).length
    expect(count).toBe(1)
    expect(content).toContain('conteúdo novo')
    expect(content).not.toContain('conteúdo antigo')
  })

  it('retorna mensagem de confirmação com nome da seção', async () => {
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    const result = await UpdateKnowledge.execute({ section: 'Padrões', content: 'usar TDD' })
    expect(result).toContain('Knowledge updated')
    expect(result).toContain('Padrões')
  })

  it('seção com caracteres especiais não quebra o regex', async () => {
    const { UpdateKnowledge } = await import('../src/tools/UpdateKnowledge/UpdateKnowledge.js')
    await expect(
      UpdateKnowledge.execute({ section: 'Seção (com) especiais.', content: 'conteúdo' })
    ).resolves.toBeDefined()
  })
})
