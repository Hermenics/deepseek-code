import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import * as fs from 'fs/promises'
import { mkdtemp, rm, utimes, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { ReadFile } from '../src/tools/ReadFile/ReadFile.js'
import { hashFileContent } from '../src/tools/shared/pathSafety.js'
import { isGraphemeBoundary } from '../src/utils/textBoundaries.js'
import { validateSchema } from '../src/orchestration/schema.js'
import type { ToolExecutionContext, FileVersion } from '../src/orchestration/types.js'

let workspace: string
const context = (onRead?: (path: string, version: FileVersion) => void): ToolExecutionContext => ({
  sessionId: `readfile-${process.pid}`,
  workspacePath: workspace,
  projectRoot: workspace,
  permissionProfile: 'coordinator-integrator',
  onFileReadReturned: onRead,
})

beforeEach(async () => { workspace = await mkdtemp(join(tmpdir(), 'dsk-readfile-test-')) })
afterEach(async () => { await rm(workspace, { recursive: true, force: true }) })

function byteSlice(output: string): string {
  const newline = output.indexOf('\n')
  return output.slice(newline + 1).replace(/\n\[(?:continue with start_byte=\d+|end of file)\]$/, '')
}

describe('ReadFile bounds and freshness', () => {
  it('returns a typed partial failure when a multi-file read mixes content and errors', async () => {
    await writeFile(join(workspace, 'available.txt'), 'readable content\n')

    const output = await ReadFile.execute({ paths: ['available.txt', 'missing.txt'] }, context())

    const result = JSON.parse(output)
    expect(result.schemaVersion).toBe(1)
    expect(result.status).toBe('partial')
    expect(result.error).toEqual({ kind: 'tool', code: 'READ_FILE_PARTIAL', message: '1 of 2 attempted files could not be read.', retryable: false })
    expect(typeof result.partial.output).toBe('string')
    expect(result.partial.output.includes('available.txt')).toBe(true)
    expect(result.partial.failures[0].includes('Error: file not found')).toBe(true)
  })

  it('preserves readable siblings when path safety rejects one requested file', async () => {
    await writeFile(join(workspace, 'available.txt'), 'readable content\n')
    await writeFile(join(workspace, '.env'), 'SECRET_VALUE=must-not-be-returned\n')

    const output = await ReadFile.execute({ paths: ['available.txt', '.env'] }, context())
    const result = JSON.parse(output)

    expect(result).toMatchObject({ schemaVersion: 1, status: 'partial', error: { code: 'READ_FILE_PARTIAL' } })
    expect(result.partial.output).toContain('available.txt')
    expect(result.partial.output).toContain('readable content')
    expect(result.partial.output).not.toContain('SECRET_VALUE')
    expect(result.partial.failures[0]).toContain('.env')
    expect(result.partial.failures[0]).toContain('cannot be accessed by an agent')
  })

  it('propagates cancellation instead of returning a partial read result', async () => {
    await writeFile(join(workspace, 'available.txt'), 'readable content\n')
    const controller = new AbortController()
    controller.abort(new Error('read cancelled'))

    await expect(ReadFile.execute({ paths: ['available.txt', 'missing.txt'] }, {
      ...context(), signal: controller.signal,
    })).rejects.toThrow('read cancelled')
  })

  it('keeps partial multi-file errors within the response cap', async () => {
    await writeFile(join(workspace, 'large.txt'), 'x'.repeat(30_000))

    const output = await ReadFile.execute({ paths: ['large.txt', 'missing.txt'] }, context())
    const result = JSON.parse(output)

    expect(output.length).toBeLessThanOrEqual(20_000)
    expect(result).toMatchObject({ schemaVersion: 1, status: 'partial', error: { code: 'READ_FILE_PARTIAL' } })
    expect(result.partial.output.includes('large.txt')).toBe(true)
    expect(result.partial.failures[0]).toContain('missing.txt')
    expect(result.error.message).toContain('shortened')
  })

  it('refuses byte ranges beyond the bounded whole-file fingerprint size', async () => {
    const file = join(workspace, 'oversized-range.json')
    const maxFingerprintBytes = 256 * 1024 * 1024
    await writeFile(file, '')
    await fs.truncate(file, maxFingerprintBytes + 1)
    const versions: FileVersion[] = []

    const output = await ReadFile.execute({ path: file, start_byte: 0 }, context((_path, version) => versions.push(version)))

    expect(output).toContain(`exceeds the ${maxFingerprintBytes} byte whole-file fingerprint limit`)
    expect(versions).toHaveLength(0)
  })

  it('rechecks the fingerprint limit after the initial size observation', async () => {
    const file = join(workspace, 'growing-range.json')
    const maxFingerprintBytes = 256 * 1024 * 1024
    await writeFile(file, '')
    await fs.truncate(file, maxFingerprintBytes + 1)
    const realStat = fs.stat.bind(fs)
    let initialStatReturned = false
    const statSpy = spyOn(fs, 'stat').mockImplementation(async (path: any, options?: any) => {
      const info = await realStat(path, options)
      if (path === file && options?.bigint !== true && !initialStatReturned) {
        initialStatReturned = true
        return { ...info, size: 70_000 } as any
      }
      return info
    })
    try {
      const output = await ReadFile.execute({ path: file, start_byte: 0 }, context())
      expect(initialStatReturned).toBe(true)
      expect(output).toContain(`exceeds the ${maxFingerprintBytes} byte whole-file fingerprint limit`)
    } finally { statSpy.mockRestore() }
  })

  it('stops streaming hashes when the byte budget is exceeded', async () => {
    const file = join(workspace, 'hash-budget.txt')
    await writeFile(file, 'x'.repeat(32_000))

    await expect(hashFileContent(file, undefined, undefined, 16_000)).rejects.toThrow('File hash byte limit exceeded')
  })

  it('reads large minified UTF-8 files in complete byte ranges and hashes the whole file', async () => {
    const file = join(workspace, 'minified.js')
    const content = 'const data="' + '🙂é漢'.repeat(9_000) + '";'
    await writeFile(file, content)
    const bytes = Buffer.from(content)
    const expectedHash = createHash('sha256').update(bytes).digest('hex')
    const versions: FileVersion[] = []
    const chunks: string[] = []
    let offset = 0
    while (offset < bytes.length) {
      const output = await ReadFile.execute({ path: file, start_byte: offset }, context((_path, version) => versions.push(version)))
      expect(output).not.toContain('splits a UTF-8 character')
      const range = output.match(/showing bytes (\d+)–(\d+)/)
      expect(range).not.toBeNull()
      expect(Number(range![1])).toBe(offset)
      const next = Number(range![2])
      expect(next).toBeGreaterThan(offset)
      const text = byteSlice(output)
      expect(Buffer.from(text)).toEqual(bytes.subarray(offset, next))
      chunks.push(text)
      offset = next
    }
    expect(chunks.join('')).toBe(content)
    expect(versions.length).toBeGreaterThan(1)
    expect(versions.every(version => version.hash === expectedHash && version.exists)).toBe(true)
  })

  it('applies a byte offset to every file in a multi-file read', async () => {
    const firstFile = join(workspace, 'first.txt')
    const targetFile = join(workspace, 'target.txt')
    const firstContent = 'source:alpha\n'
    const targetContent = 'target:éclair\n'
    await Promise.all([
      writeFile(firstFile, firstContent),
      writeFile(targetFile, targetContent),
    ])

    const output = await ReadFile.execute({ paths: ['first.txt', 'target.txt'], start_byte: 7 }, context())
    const firstBytes = Buffer.from(firstContent)
    const targetBytes = Buffer.from(targetContent)
    const firstChunk = firstBytes.subarray(7)
    const targetChunk = targetBytes.subarray(7)

    expect(output).toBe([
      `[${firstFile}  ${firstBytes.length} bytes total  showing bytes 7–${firstBytes.length}]\n${firstChunk.toString('utf8')}\n[end of file]`,
      `[${targetFile}  ${targetBytes.length} bytes total  showing bytes 7–${targetBytes.length}]\n${targetChunk.toString('utf8')}\n[end of file]`,
    ].join('\n\n'))
    expect(Buffer.byteLength(targetChunk.toString('utf8'), 'utf8')).toBe(targetBytes.length - 7)
  })

  it('keeps large byte-slice and short line output complete in either multi-file order', async () => {
    const largeFile = join(workspace, 'large-multibyte.txt')
    const shortFile = join(workspace, 'short-lines.txt')
    const largeContent = '🙂é漢'.repeat(120_000)
    const shortContent = 'first line\nsecond line'
    await Promise.all([
      writeFile(largeFile, largeContent),
      writeFile(shortFile, shortContent),
    ])

    const largeBytes = Buffer.from(largeContent, 'utf8')
    const expectedEndByte = 15_999
    const largeBody = largeBytes.subarray(0, expectedEndByte)
    const largeOutput = `[${largeFile}  ${largeBytes.length} bytes total  showing bytes 0–${expectedEndByte}]\n${largeBody.toString('utf8')}\n[continue with start_byte=${expectedEndByte}]`
    const shortOutput = `[${shortFile}  2 lines total  showing 1–2]\n1  first line\n2  second line`

    expect(largeBytes.length).toBeGreaterThan(1_000_000)
    expect(Buffer.byteLength(largeBody.toString('utf8'), 'utf8')).toBe(expectedEndByte)
    for (const paths of [[largeFile, shortFile], [shortFile, largeFile]]) {
      const output = await ReadFile.execute({ paths: paths.map(path => path.slice(workspace.length + 1)) }, context())
      const expected = paths[0] === largeFile
        ? `${largeOutput}\n\n${shortOutput}`
        : `${shortOutput}\n\n${largeOutput}`
      expect(output).toBe(expected)
    }
  })

  it('keeps byte-range continuations on grapheme boundaries', async () => {
    const file = join(workspace, 'grapheme-boundary.js')
    const content = `${'x'.repeat(15_999)}e\u0301${'z'.repeat(70_000)}`
    await writeFile(file, content)

    const first = await ReadFile.execute({ path: file, start_byte: 0 }, context())
    expect(first.match(/showing bytes 0–(\d+)/)?.[1]).toBe('15999')
    expect(byteSlice(first)).toBe('x'.repeat(15_999))

    const continued = await ReadFile.execute({ path: file, start_byte: 15_999 }, context())
    expect(byteSlice(continued)).toContain('e\u0301')
    expect(await ReadFile.execute({ path: file, start_byte: 16_000 }, context())).toContain('start_byte=16000 splits a Unicode grapheme cluster')

    const splitChunkFile = join(workspace, 'grapheme-across-hash-chunk.js')
    const splitChunkContent = `${'x'.repeat(15_999)}e\u0301${'z'.repeat(49_533)}e\u0301${'z'.repeat(10_000)}`
    await writeFile(splitChunkFile, splitChunkContent)
    expect(await ReadFile.execute({ path: splitChunkFile, start_byte: 65_536 }, context())).toContain('start_byte=65536 splits a Unicode grapheme cluster')

    const oversizedClusterFile = join(workspace, 'oversized-grapheme.js')
    await writeFile(oversizedClusterFile, `e${'\u0301'.repeat(40_000)}${'z'.repeat(70_000)}`)
    expect(await ReadFile.execute({ path: oversizedClusterFile, start_byte: 100_000 }, context())).toContain('exceeds the bounded byte-range context')
  })

  it('rejects a large-file slice changed after hashing even when size and mtime are preserved', async () => {
    const file = join(workspace, 'raced.js')
    const original = 'a'.repeat(70_000)
    const changed = 'b'.repeat(70_000)
    const fixedTime = new Date('2000-01-01T00:00:00.000Z')
    await writeFile(file, original)
    await utimes(file, fixedTime, fixedTime)
    const versions: FileVersion[] = []
    const realOpen = fs.open.bind(fs)
    let replaced = false
    const openSpy = spyOn(fs, 'open').mockImplementation(async (path: any, flags?: any, mode?: any) => {
      if (!replaced && path === file) {
        replaced = true
        await writeFile(file, changed)
        await utimes(file, fixedTime, fixedTime)
      }
      return realOpen(path, flags, mode)
    })
    try {
      const output = await ReadFile.execute({ path: file, start_byte: 0 }, context((_path, version) => versions.push(version)))
      expect(replaced).toBe(true)
      expect(output).toContain('file changed while reading')
      expect(versions).toHaveLength(0)
    } finally { openSpy.mockRestore() }
  })

  it('rejects a byte offset in the middle of a UTF-8 character', async () => {
    const file = join(workspace, 'unicode.txt')
    await writeFile(file, 'a€b'.repeat(30_000))
    const output = await ReadFile.execute({ path: file, start_byte: 2 }, context())
    expect(output).toContain('start_byte=2 splits a UTF-8 character')
  })

  it('rejects binary and invalid UTF-8 content', async () => {
    const binary = join(workspace, 'binary.dat')
    const invalid = join(workspace, 'invalid.dat')
    const largeBinary = join(workspace, 'large-binary.dat')
    const largeInvalid = join(workspace, 'large-invalid.dat')
    await writeFile(binary, Buffer.from([0x41, 0x00, 0x42]))
    await writeFile(invalid, Buffer.from([0x61, 0xc3, 0x28]))
    await writeFile(largeBinary, Buffer.concat([Buffer.alloc(70_000, 0x41), Buffer.from([0])]))
    await writeFile(largeInvalid, Buffer.concat([Buffer.alloc(70_000, 0x61), Buffer.from([0xf0, 0x28, 0x8c, 0x28])]))
    expect(await ReadFile.execute({ path: binary }, context())).toContain('appears to be a binary file')
    expect(await ReadFile.execute({ path: invalid }, context())).toContain('not valid UTF-8')
    expect(await ReadFile.execute({ path: largeBinary, start_byte: 0 }, context())).toContain('appears to be a binary file')
    expect(await ReadFile.execute({ path: largeInvalid, start_byte: 0 }, context())).toContain('not valid UTF-8')
  })

  it('caps a multi-file response in aggregate and marks truncated content', async () => {
    const paths = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const path = join(workspace, `part-${index}.txt`)
      await writeFile(path, `${index}:` + 'x'.repeat(8_000))
      return path
    }))
    const returned: string[] = []
    const output = await ReadFile.execute({ paths }, context(path => returned.push(path)))
    expect(output.length).toBeLessThanOrEqual(20_000)
    expect(output).toMatch(/truncated at start_char=|not enough response space/)
    expect(returned.length).toBeGreaterThan(0)
  })

  it('bounds a one-million-character single-line file and returns a byte continuation', async () => {
    const file = join(workspace, 'single-line.json')
    await writeFile(file, 'x'.repeat(1_000_000))
    const versions: FileVersion[] = []
    const output = await ReadFile.execute({ path: file }, context((_path, version) => versions.push(version)))

    expect(output.length).toBeLessThanOrEqual(20_000)
    expect(output).toContain('showing bytes 0–')
    expect(output).toContain('continue with start_byte=')
    expect(versions).toHaveLength(1)
    expect(versions[0]).toEqual({ exists: true, hash: createHash('sha256').update('x'.repeat(1_000_000)).digest('hex') })
  })

  it('rejects ambiguous and oversized read requests before touching the filesystem', async () => {
    const ambiguous = await ReadFile.execute({ path: 'one.txt', paths: ['two.txt'] }, context())
    const tooManyPaths = await ReadFile.execute({ paths: Array.from({ length: 33 }, (_, index) => `missing-${index}.txt`) }, context())
    const longPath = await ReadFile.execute({ path: 'x'.repeat(4097) }, context())
    const tooManyPathBytes = await ReadFile.execute({ paths: Array.from({ length: 24 }, (_, index) => `${'x'.repeat(3000)}-${index}`) }, context())
    const multibytePath = '界'.repeat(1366)
    const multibytePaths = Array.from({ length: 17 }, () => '界'.repeat(1360))
    const multibyteLongPath = await ReadFile.execute({ path: multibytePath }, context())
    const multibyteTooManyPathBytes = await ReadFile.execute({ paths: multibytePaths }, context())

    expect(ambiguous).toContain('cannot include both path and paths')
    expect(tooManyPaths).toContain('between 1 and 32')
    expect(longPath).toContain('path exceeds 4096 UTF-8 bytes')
    expect(tooManyPathBytes).toContain('combined paths exceed 65536 UTF-8 bytes')
    expect(validateSchema(ReadFile.parameters, { path: multibytePath }).valid).toBe(true)
    expect(validateSchema(ReadFile.parameters, { paths: multibytePaths }).valid).toBe(true)
    expect(multibyteLongPath).toContain('path exceeds 4096 UTF-8 bytes')
    expect(multibyteTooManyPathBytes).toContain('combined paths exceed 65536 UTF-8 bytes')
  })

  it('rejects reversed and unsafe line ranges', async () => {
    const reversed = await ReadFile.execute({ path: 'missing.txt', start_line: 10, end_line: 2 }, context())
    const unsafe = await ReadFile.execute({ path: 'missing.txt', start_line: Number.MAX_SAFE_INTEGER + 1 }, context())

    expect(reversed).toContain('end_line must be greater than or equal to start_line')
    expect(unsafe).toContain('start_line must be a positive safe integer')
  })

  it('publishes batch and property limits in the tool schema', () => {
    expect(validateSchema(ReadFile.parameters, { path: 'one.txt', unexpected: true }).valid).toBe(false)
    expect(validateSchema(ReadFile.parameters, { paths: Array.from({ length: 33 }, () => 'file.txt') }).valid).toBe(false)
  })

  it('publishes mutually exclusive path and offset combinations in the tool schema', () => {
    for (const args of [
      { path: 'one.txt', paths: ['two.txt'] },
      { path: 'one.txt', start_line: 1.5 },
      { path: 'one.txt', end_line: 2.5 },
      { path: 'one.txt', start_char: 2.5 },
      { path: 'one.txt', start_byte: 2.5 },
      { path: 'one.txt', start_char: 10, start_line: 2 },
      { path: 'one.txt', start_char: 10, end_line: 2 },
      { path: 'one.txt', start_byte: 10, start_line: 2 },
      { path: 'one.txt', start_byte: 10, end_line: 2 },
      { path: 'one.txt', start_byte: 10, start_char: 2 },
    ]) expect(validateSchema(ReadFile.parameters, args).valid).toBe(false)

    for (const args of [
      { path: 'one.txt' },
      { paths: ['one.txt', 'two.txt'] },
      { path: 'one.txt', start_line: 1 },
      { path: 'one.txt', end_line: 2 },
      { path: 'one.txt', start_char: 10 },
      { path: 'one.txt', start_byte: 10 },
    ]) expect(validateSchema(ReadFile.parameters, args).valid).toBe(true)
  })

  it('returns a whole-content hash and continues safely at a surrogate boundary', async () => {
    const file = join(workspace, 'long-line.txt')
    const content = 'a'.repeat(19_900) + '😀' + 'z'.repeat(10_000)
    await writeFile(file, content)
    const versions: FileVersion[] = []
    const first = await ReadFile.execute({ path: file }, context((_path, value) => versions.push(value)))
    const next = Number(first.match(/continue with start_char=(\d+)/)?.[1])
    expect(Number.isInteger(next)).toBe(true)
    const before = content.charCodeAt(next - 1)
    const after = content.charCodeAt(next)
    expect(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff).toBe(false)
    const continued = await ReadFile.execute({ path: file, start_char: next }, context((_path, value) => versions.push(value)))
    expect(continued).toContain('😀')
    const split = await ReadFile.execute({ path: file, start_char: content.indexOf('😀') + 1 }, context())
    expect(split).toContain('start_char splits a Unicode grapheme cluster')
    const expectedHash = createHash('sha256').update(content).digest('hex')
    expect(versions.every(value => value.hash === expectedHash)).toBe(true)
  })

  it('does not split a combining grapheme at a response cut or continuation offset', async () => {
    const file = join(workspace, 'combining-cut.txt')
    const header = `[${file}  1 lines total  showing 1–1]\n`
    const available = 20_000 - header.length - '1  '.length - 100
    const content = `${'x'.repeat(available - 1)}e\u0301${'z'.repeat(5_000)}`
    await writeFile(file, content)

    const first = await ReadFile.execute({ path: file }, context())
    const next = Number(first.match(/continue with start_char=(\d+)/)?.[1])
    expect(Number.isInteger(next)).toBe(true)
    expect(isGraphemeBoundary(content, next)).toBe(true)
    expect(first).not.toContain(`${'x'.repeat(available - 1)}e\n[truncated`)

    const split = await ReadFile.execute({ path: file, start_char: available }, context())
    expect(split).toContain('start_char splits a Unicode grapheme cluster')
  })
})
