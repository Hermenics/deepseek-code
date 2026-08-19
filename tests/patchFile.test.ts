import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as path from 'path'
import * as fs from 'fs/promises'

describe('PatchFile tool', () => {
  const cwdFile = path.join(process.cwd(), `test-patch-${Date.now()}.txt`)

  afterEach(async () => {
    await fs.rm(cwdFile, { force: true })
  })

  it('substitui old_content por new_content corretamente', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'hello world', 'utf-8')
    await PatchFile.execute({ path: cwdFile, old_content: 'world', new_content: 'marcelo' })
    const content = await fs.readFile(cwdFile, 'utf-8')
    expect(content).toBe('hello marcelo')
  })

  it('retorna string com contagem de linhas', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'linha1\nlinha2\nlinha3', 'utf-8')
    const result = await PatchFile.execute({
      path: cwdFile,
      old_content: 'linha2',
      new_content: 'nova\nlinha',
    })
    expect(result).toContain('+')
    expect(result).toContain('-')
    expect(result).toContain('lines')
  })

  it('arquivo não existe retorna mensagem de erro', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    const result = await PatchFile.execute({
      path: path.join(process.cwd(), 'nao-existe-xyz.txt'),
      old_content: 'x',
      new_content: 'y',
    })
    expect(result).toContain('Error: file not found')
  })

  it('old_content não encontrado retorna erro', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'conteúdo original', 'utf-8')
    const result = await PatchFile.execute({
      path: cwdFile,
      old_content: 'texto que não existe',
      new_content: 'novo',
    })
    expect(result).toContain('Error: old_content not found')
  })

  it('old_content encontrado mais de uma vez retorna erro', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'abc abc abc', 'utf-8')
    const result = await PatchFile.execute({
      path: cwdFile,
      old_content: 'abc',
      new_content: 'xyz',
    })
    expect(result).toContain('Error: old_content matches')
    expect(result).toContain('be more specific')
  })

  it('path fora do cwd lança erro de segurança', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    const outsidePath = path.join(path.dirname(process.cwd()), 'deepseek-outside-hosts')
    await expect(
      PatchFile.execute({ path: outsidePath, old_content: 'x', new_content: 'y' })
    ).rejects.toThrow('outside the working directory')
  })
})
