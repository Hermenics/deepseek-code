import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as path from 'path'
import * as fs from 'fs/promises'

// Keep test files inside cwd so they pass assertSafePath.
const TEST_DIR = path.join(process.cwd(), `.test-writefile-${Date.now()}`)

describe('WriteFile tool', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
  })

  it('writes content to the file', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'test.txt')
    await WriteFile.execute({ path: filePath, content: 'hello world' })
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('hello world')
  })

  it('creates parent directories when missing', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'sub', 'dir', 'test.txt')
    await WriteFile.execute({ path: filePath, content: 'nested' })
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('nested')
  })

  it('returns JSON with __diff: true', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'diff.txt')
    const result = await WriteFile.execute({ path: filePath, content: 'line1\nline2' })
    const json = JSON.parse(result as string)
    expect(json.__diff).toBe(true)
  })

  it('returns JSON with added, removed, firstChanged, and lines', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'diff2.txt')
    const result = await WriteFile.execute({ path: filePath, content: 'line1\nline2' })
    const json = JSON.parse(result as string)
    expect(typeof json.added).toBe('number')
    expect(typeof json.removed).toBe('number')
    expect(typeof json.firstChanged).toBe('number')
    expect(Array.isArray(json.lines)).toBe(true)
  })

  it('a new file has all lines marked as added', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'new.txt')
    const result = await WriteFile.execute({ path: filePath, content: 'a\nb\nc' })
    const json = JSON.parse(result as string)
    // New file: oldContent='' → split('\n')=[''] → one empty line is expected to be removed.
    expect(json.added).toBe(3)
    expect(json.lines.filter((l: { type: string }) => l.type === 'added').length).toBe(3)
  })

  it('throws a security error for a path outside cwd', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const outsidePath = path.join(path.dirname(process.cwd()), 'deepseek-outside-passwd')
    await expect(
      WriteFile.execute({ path: outsidePath, content: 'hack' })
    ).rejects.toThrow('outside the working directory')
  })

  it('does not throw for a path inside cwd', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'safe.txt')
    await expect(
      WriteFile.execute({ path: filePath, content: 'safe' })
    ).resolves.toBeDefined()
  })

  it('diff detects lines added when updating a file', async () => {
    const { WriteFile } = await import('../src/tools/WriteFile/WriteFile.js')
    const filePath = path.join(TEST_DIR, 'update.txt')
    await WriteFile.execute({ path: filePath, content: 'line1' })
    const result = await WriteFile.execute({ path: filePath, content: 'line1\nline2' })
    const json = JSON.parse(result as string)
    expect(json.added).toBeGreaterThan(0)
  })
})
