import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as path from 'path'
import * as fs from 'fs/promises'

describe('PatchFile tool', () => {
  const cwdFile = path.join(process.cwd(), `test-patch-${Date.now()}.txt`)

  afterEach(async () => {
    await fs.rm(cwdFile, { force: true })
  })

  it('replaces old_content with new_content correctly', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'hello world', 'utf-8')
    await PatchFile.execute({ path: cwdFile, old_content: 'world', new_content: 'universe' })
    const content = await fs.readFile(cwdFile, 'utf-8')
    expect(content).toBe('hello universe')
  })

  it('returns a diff with line counts', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'line1\nline2\nline3', 'utf-8')
    const result = await PatchFile.execute({
      path: cwdFile,
      old_content: 'line2',
      new_content: 'new\nline',
    })
    expect(result).toContain('+')
    expect(result).toContain('-')
    expect(result).toContain('lines')
  })

  it('returns an error when the file does not exist', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    const result = await PatchFile.execute({
      path: path.join(process.cwd(), 'missing-patch-fixture-xyz.txt'),
      old_content: 'x',
      new_content: 'y',
    })
    expect(result).toContain('Error: file not found')
  })

  it('returns an error when old_content is not found', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'original content', 'utf-8')
    const result = await PatchFile.execute({
      path: cwdFile,
      old_content: 'text that does not exist',
      new_content: 'novo',
    })
    expect(result).toContain('Error: old_content not found')
  })

  it('returns an error when old_content appears more than once', async () => {
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

  it('rejects overlapping matches and identical repeated blocks without changing the file', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    const repeatedBlock = 'if (ready) {\n  start()\n}'
    for (const [source, oldContent] of [
      ['ababa', 'aba'],
      [`${repeatedBlock}\n\n${repeatedBlock}`, repeatedBlock],
    ]) {
      await fs.writeFile(cwdFile, source, 'utf-8')
      const result = await PatchFile.execute({ path: cwdFile, old_content: oldContent, new_content: 'replacement' })
      expect(result).toContain('Error: old_content matches 2 times')
      expect(await fs.readFile(cwdFile, 'utf-8')).toBe(source)
    }
  })

  it('accepts LF snippets in a CRLF file and preserves CRLF', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'a\r\nb\r\nc\r\n', 'utf-8')
    await PatchFile.execute({ path: cwdFile, old_content: 'a\nb', new_content: 'a\nB' })
    expect(await fs.readFile(cwdFile, 'utf-8')).toBe('a\r\nB\r\nc\r\n')
  })

  it('points to the closest lines when old_content is not found', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'function x() {\n  return 1\n}\n', 'utf-8')
    const whitespaceOnly = await PatchFile.execute({ path: cwdFile, old_content: '\treturn 1\n}', new_content: '' })
    expect(whitespaceOnly).toContain('matches at line 2 if whitespace is ignored')
    const firstLineOnly = await PatchFile.execute({ path: cwdFile, old_content: 'return 1\nreturn 2', new_content: '' })
    expect(firstLineOnly).toContain('first line appears at line 2')
  })

  it('converts multiline new_content to CRLF when old_content has one line', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'a\r\nb\r\n', 'utf-8')
    await PatchFile.execute({ path: cwdFile, old_content: 'b', new_content: 'b\nc' })
    expect(await fs.readFile(cwdFile, 'utf-8')).toBe('a\r\nb\r\nc\r\n')
  })

  it('throws a security error for paths outside the working directory', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    const outsidePath = path.join(path.dirname(process.cwd()), 'deepseek-outside-test-hosts')
    await expect(
      PatchFile.execute({ path: outsidePath, old_content: 'x', new_content: 'y' })
    ).rejects.toThrow('outside the working directory')
  })

  it('preserves LF snippets in mixed-EOL files without a final newline', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'prefix\r\na\nb\nsuffix', 'utf-8')
    const result = JSON.parse(await PatchFile.execute({ path: cwdFile, old_content: 'a\nb', new_content: 'A\nB' }))
    expect(await fs.readFile(cwdFile, 'utf-8')).toBe('prefix\r\nA\nB\nsuffix')
    expect(result.lineEndingNormalization).toBeNull()
  })

  it('preserves replacement newlines in files with CRLF and bare CR endings', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    const source = 'prefix\r\nbefore\rtarget\r\nsuffix'
    await fs.writeFile(cwdFile, source, 'utf-8')
    const result = JSON.parse(await PatchFile.execute({
      path: cwdFile,
      old_content: 'before\rtarget',
      new_content: 'BEFORE\nTARGET',
    }))

    expect(await fs.readFile(cwdFile, 'utf-8')).toBe('prefix\r\nBEFORE\nTARGET\r\nsuffix')
    expect(result.lineEndingNormalization).toBeNull()
  })

  it('requires exact EOLs in mixed files and preserves the requested replacement', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    const source = 'a\r\nb\nc\r\n'
    await fs.writeFile(cwdFile, source, 'utf-8')
    const refused = await PatchFile.execute({ path: cwdFile, old_content: 'a\nb\nc', new_content: 'changed' })
    expect(refused).toContain('old_content not found')
    expect(await fs.readFile(cwdFile, 'utf-8')).toBe(source)
    await PatchFile.execute({ path: cwdFile, old_content: 'a\r\nb\nc', new_content: 'A\r\nB\nC' })
    expect(await fs.readFile(cwdFile, 'utf-8')).toBe('A\r\nB\nC\r\n')
  })

  it('reports CRLF normalization without adding a final newline', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'a\r\nb', 'utf-8')
    const result = JSON.parse(await PatchFile.execute({ path: cwdFile, old_content: 'a\nb', new_content: 'A\nB' }))
    expect(await fs.readFile(cwdFile, 'utf-8')).toBe('A\r\nB')
    expect(result.lineEndingNormalization).toBe('CRLF')
  })

  it('rejects an empty snippet without writing, even to a one-character file', async () => {
    const { PatchFile } = await import('../src/tools/PatchFile/PatchFile.js')
    await fs.writeFile(cwdFile, 'x', 'utf-8')
    expect(await PatchFile.execute({ path: cwdFile, old_content: '', new_content: 'y' })).toContain('non-empty')
    expect(await fs.readFile(cwdFile, 'utf-8')).toBe('x')
  })
})
