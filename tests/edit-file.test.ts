import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as path from 'path'
import * as fs from 'fs/promises'
import { tmpdir } from 'os'

const mkdtemp = (await import('fs/promises')).mkdtemp

let testDir: string
let originalCwd: string

beforeEach(async () => {
  testDir = await mkdtemp(path.join(tmpdir(), 'dsk-editfile-'))
  originalCwd = process.cwd()
  process.chdir(testDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(testDir, { recursive: true, force: true })
})

async function writeTestFile(name: string, content: string): Promise<string> {
  const filePath = path.join(testDir, name)
  await fs.writeFile(filePath, content, 'utf-8')
  return filePath
}

describe('EditFile tool', () => {
  it('should apply a simple single replacement', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = await writeTestFile('single.txt', 'hello world\n')

    const result = await EditFile.execute({
      path: filePath,
      edits: [{ line: 1, old: ['world'], new: ['earth'] }],
    })

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('hello earth\n')
    const json = JSON.parse(result as string)
    expect(json.editCount).toBe(1)
    expect(json.linesAffected).toContain(1)
  })

  it('should apply multiple edits on different lines', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = await writeTestFile('multi.txt', 'alpha\nbeta\ngamma\n')

    const result = await EditFile.execute({
      path: filePath,
      edits: [
        { line: 1, old: ['alpha'], new: ['one'] },
        { line: 2, old: ['beta'], new: ['two'] },
        { line: 3, old: ['gamma'], new: ['three'] },
      ],
    })

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('one\ntwo\nthree\n')
    const json = JSON.parse(result as string)
    expect(json.editCount).toBe(3)
  })

  it('should apply multiple replacements on the same line', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = await writeTestFile('sameline.txt', 'foo bar baz\n')

    await EditFile.execute({
      path: filePath,
      edits: [{ line: 1, old: ['foo', 'bar'], new: ['qux', 'quux'] }],
    })

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('qux quux baz\n')
  })

  it('should delete content when new is empty string', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = await writeTestFile('delete.txt', 'remove this\n')

    await EditFile.execute({
      path: filePath,
      edits: [{ line: 1, old: ['remove '], new: [''] }],
    })

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('this\n')
  })

  it('should expand a line when new contains \\n', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = await writeTestFile('expand.txt', 'one line\n')

    await EditFile.execute({
      path: filePath,
      edits: [{ line: 1, old: ['one line'], new: ['line1\nline2'] }],
    })

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('line1')
    expect(content).toContain('line2')
    const lines = content.split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
  })

  it('should return error when old is not found in line', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = await writeTestFile('notfound.txt', 'hello world\n')

    const result = await EditFile.execute({
      path: filePath,
      edits: [{ line: 1, old: ['missing'], new: ['x'] }],
    })

    const parsed = JSON.parse(result as string)
    expect(parsed.error).toContain('not found')
  })

  it('should return error when old.length !== new.length', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = await writeTestFile('mismatch.txt', 'hello world\n')

    const result = await EditFile.execute({
      path: filePath,
      edits: [{ line: 1, old: ['hello', 'world'], new: ['hi'] }],
    })

    const parsed = JSON.parse(result as string)
    expect(parsed.error).toBeDefined()
  })

  it('should return error when line number is out of range', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = await writeTestFile('range.txt', 'a\nb\nc\nd\ne\n')

    const result = await EditFile.execute({
      path: filePath,
      edits: [{ line: 999, old: ['a'], new: ['b'] }],
    })

    const parsed = JSON.parse(result as string)
    expect(parsed.error).toContain('out of range')
  })

  it('should return error when file does not exist', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = path.join(testDir, 'nonexistent.txt')

    const result = await EditFile.execute({
      path: filePath,
      edits: [{ line: 1, old: ['x'], new: ['y'] }],
    })

    const parsed = JSON.parse(result as string)
    expect(parsed.error).toBeDefined()
  })

  it('should apply edits on lines 1 and 5 without line number shifting', async () => {
    const { EditFile } = await import('../src/tools/EditFile/EditFile.js')
    const filePath = await writeTestFile('bottomtop.txt', 'first\nsecond\nthird\nfourth\nfifth\n')

    await EditFile.execute({
      path: filePath,
      edits: [
        { line: 1, old: ['first'], new: ['ONE'] },
        { line: 5, old: ['fifth'], new: ['FIVE'] },
      ],
    })

    const content = await fs.readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    expect(lines[0]).toBe('ONE')
    expect(lines[4]).toBe('FIVE')
    expect(lines[1]).toBe('second')
    expect(lines[2]).toBe('third')
    expect(lines[3]).toBe('fourth')
  })
})
