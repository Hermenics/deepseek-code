import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as path from 'path'
import * as fs from 'fs/promises'

// Todos os arquivos de teste ficam dentro do cwd para passar no assertSafePath
const TEST_DIR = path.join(process.cwd(), `.test-writefile-${Date.now()}`)

describe('WriteFile tool', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
  })

  it('escreve conteúdo no arquivo', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'test.txt')
    await WriteFile.execute({ path: filePath, content: 'hello world' })
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('hello world')
  })

  it('cria diretórios pai se não existirem', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'sub', 'dir', 'test.txt')
    await WriteFile.execute({ path: filePath, content: 'nested' })
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('nested')
  })

  it('retorna JSON com __diff: true', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'diff.txt')
    const result = await WriteFile.execute({ path: filePath, content: 'linha1\nlinha2' })
    const json = JSON.parse(result as string)
    expect(json.__diff).toBe(true)
  })

  it('retorna JSON com added, removed, firstChanged, lines', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'diff2.txt')
    const result = await WriteFile.execute({ path: filePath, content: 'linha1\nlinha2' })
    const json = JSON.parse(result as string)
    expect(typeof json.added).toBe('number')
    expect(typeof json.removed).toBe('number')
    expect(typeof json.firstChanged).toBe('number')
    expect(Array.isArray(json.lines)).toBe(true)
  })

  it('arquivo novo tem todas as linhas como added', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'new.txt')
    const result = await WriteFile.execute({ path: filePath, content: 'a\nb\nc' })
    const json = JSON.parse(result as string)
    // arquivo novo: oldContent='' → split('\n')=[''] → 1 linha vazia removida é esperado
    expect(json.added).toBe(3)
    expect(json.lines.filter((l: { type: string }) => l.type === 'added').length).toBe(3)
  })

  it('path fora do cwd lança erro de segurança', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const outsidePath = path.join(path.dirname(process.cwd()), 'deepseek-outside-passwd')
    await expect(
      WriteFile.execute({ path: outsidePath, content: 'hack' })
    ).rejects.toThrow('outside the working directory')
  })

  it('path dentro do cwd não lança erro', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'safe.txt')
    await expect(
      WriteFile.execute({ path: filePath, content: 'safe' })
    ).resolves.toBeDefined()
  })

  it('diff detecta linhas adicionadas ao atualizar arquivo', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'update.txt')
    await WriteFile.execute({ path: filePath, content: 'linha1' })
    const result = await WriteFile.execute({ path: filePath, content: 'linha1\nlinha2' })
    const json = JSON.parse(result as string)
    expect(json.added).toBeGreaterThan(0)
  })
})
