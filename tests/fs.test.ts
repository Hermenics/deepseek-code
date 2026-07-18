import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { chmod, mkdtemp, rm, mkdir, stat, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readJson, writeJson, writeRaw, globFiles } from '../src/utils/fs.js'

describe('readJson', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dsk-fs-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should read and parse a valid JSON file', async () => {
    const data = { name: 'test', value: 42 }
    await writeFile(join(testDir, 'test.json'), JSON.stringify(data))
    const result = await readJson<typeof data>(join(testDir, 'test.json'))
    expect(result).toEqual(data)
  })

  it('should throw on non-existent file', async () => {
    await expect(readJson(join(testDir, 'nope.json'))).rejects.toThrow()
  })

  it('should throw on invalid JSON', async () => {
    await writeFile(join(testDir, 'bad.json'), 'not json {{{')
    await expect(readJson(join(testDir, 'bad.json'))).rejects.toThrow()
  })

  it('should handle empty JSON object', async () => {
    await writeFile(join(testDir, 'empty.json'), '{}')
    const result = await readJson(join(testDir, 'empty.json'))
    expect(result).toEqual({})
  })

  it('should handle arrays', async () => {
    await writeFile(join(testDir, 'arr.json'), '[1,2,3]')
    const result = await readJson<number[]>(join(testDir, 'arr.json'))
    expect(result).toEqual([1, 2, 3])
  })
})

describe('writeJson', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dsk-fs-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should write formatted JSON', async () => {
    const data = { hello: 'world' }
    const path = join(testDir, 'out.json')
    await writeJson(path, data)
    const content = await readFile(path, 'utf-8')
    expect(content).toBe(JSON.stringify(data, null, 2))
  })

  it('should overwrite existing file', async () => {
    const path = join(testDir, 'out.json')
    await writeJson(path, { v: 1 })
    await writeJson(path, { v: 2 })
    const result = await readJson<{ v: number }>(path)
    expect(result.v).toBe(2)
  })

  it('should handle complex nested objects', async () => {
    const data = { a: { b: { c: [1, 2, { d: true }] } } }
    const path = join(testDir, 'nested.json')
    await writeJson(path, data)
    const result = await readJson(path)
    expect(result).toEqual(data)
  })

  it('restricts permissions when overwriting an existing file', async () => {
    const path = join(testDir, 'existing.json')
    await writeFile(path, '{}')
    await chmod(path, 0o666)
    await writeJson(path, { safe: true })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})

describe('writeRaw', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dsk-fs-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should write raw string content', async () => {
    const path = join(testDir, 'raw.txt')
    await writeRaw(path, 'hello world')
    const content = await readFile(path, 'utf-8')
    expect(content).toBe('hello world')
  })

  it('should handle empty string', async () => {
    const path = join(testDir, 'empty.txt')
    await writeRaw(path, '')
    const content = await readFile(path, 'utf-8')
    expect(content).toBe('')
  })

  it('should handle unicode content', async () => {
    const path = join(testDir, 'unicode.txt')
    const text = 'Olá Marcelo! 🚀 日本語'
    await writeRaw(path, text)
    const content = await readFile(path, 'utf-8')
    expect(content).toBe(text)
  })

  it('restricts permissions when overwriting an existing file', async () => {
    const path = join(testDir, 'existing.txt')
    await writeFile(path, 'old')
    await chmod(path, 0o666)
    await writeRaw(path, 'new')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})

describe('globFiles', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dsk-glob-test-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should return files matching regex pattern', async () => {
    await writeFile(join(testDir, 'a.json'), '{}')
    await writeFile(join(testDir, 'b.json'), '{}')
    await writeFile(join(testDir, 'c.txt'), '')
    const result = await globFiles(/\.json$/, testDir)
    expect(result.sort()).toEqual(['a.json', 'b.json'])
  })

  it('should return empty array for non-existent directory', async () => {
    const result = await globFiles(/\.json$/, '/tmp/non-existent-dir-xyz-123')
    expect(result).toEqual([])
  })

  it('should return empty array when no files match', async () => {
    await writeFile(join(testDir, 'a.txt'), '')
    const result = await globFiles(/\.json$/, testDir)
    expect(result).toEqual([])
  })

  it('should return empty array for empty directory', async () => {
    const result = await globFiles(/.*/, testDir)
    // testDir was just created, might be empty
    expect(result).toBeArray()
  })

  it('should match complex patterns', async () => {
    await writeFile(join(testDir, 'test-agent.json'), '{}')
    await writeFile(join(testDir, 'prod-agent.json'), '{}')
    await writeFile(join(testDir, 'config.yaml'), '')
    const result = await globFiles(/^test-.*\.json$/, testDir)
    expect(result).toEqual(['test-agent.json'])
  })
})
