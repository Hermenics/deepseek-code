import { expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { updateTarget } from '../src/update.js'

const expectedFixtureHash = '8d09ea84c80bb34c639a5bd1dbc9ff8a57eb0f1ba315f7b5ee741cafb43ffe43'
const targetPath = 'data/config.json'

interface ReportedRange {
  path: string
  startByte: number
  endByte: number
  totalBytes: number
}

interface ParsedRange extends ReportedRange {
  headerPath: string
  body: string
}

interface OutputHeader {
  index: number
  headerEnd: number
  path: string
  kind: 'bytes' | 'lines'
  total: number
  start: number
  end: number
}

function rangeOutput(result: string): string {
  let value: unknown
  try { value = JSON.parse(result) }
  catch { return result }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result

  const envelope = value as Record<string, unknown>
  const error = envelope.error && typeof envelope.error === 'object' && !Array.isArray(envelope.error)
    ? envelope.error as Record<string, unknown>
    : null
  if (envelope.status !== 'partial' && error?.code !== 'READ_FILE_PARTIAL') return result

  expect(envelope.schemaVersion).toBe(1)
  expect(envelope.status).toBe('partial')
  expect(error?.kind).toBe('tool')
  expect(error?.code).toBe('READ_FILE_PARTIAL')
  expect(typeof error?.message).toBe('string')
  expect(error?.retryable).toBe(false)
  const partial = envelope.partial && typeof envelope.partial === 'object' && !Array.isArray(envelope.partial)
    ? envelope.partial as Record<string, unknown>
    : null
  expect(typeof partial?.output).toBe('string')
  expect(Array.isArray(partial?.failures) && partial.failures.length > 0).toBe(true)
  return partial!.output as string
}

function relativeWorkspacePath(path: unknown, workspaceRoot: string): string | null {
  if (typeof path !== 'string' || !path.trim()) return null
  const root = resolve(process.cwd(), workspaceRoot)
  const rel = relative(root, resolve(root, path))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

function requestedPaths(args: unknown, workspaceRoot: string): { paths: string[]; startByte: number } | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  const record = args as Record<string, unknown>
  if (record.path !== undefined && record.paths !== undefined) return null
  const rawPaths = record.path !== undefined ? [record.path] : record.paths
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) return null
  const paths = rawPaths.map(path => relativeWorkspacePath(path, workspaceRoot))
  if (paths.some(path => path === null)) return null
  const startByte = record.start_byte ?? 0
  if (!Number.isSafeInteger(startByte) || (startByte as number) < 0) return null
  return { paths: paths as string[], startByte: startByte as number }
}

function parseByteRanges(result: string): ParsedRange[] {
  const bytePattern = /^\[([^\]\r\n]+?)\s+(\d+) bytes total\s+showing bytes (\d+)[–-](\d+)\]\r?$/gmu
  const linePattern = /^\[([^\]\r\n]+?)\s+(\d+) lines total\s+showing (\d+)[–-](\d+)\]\r?$/gmu
  const byteHeaders = [...result.matchAll(bytePattern)].map<OutputHeader>(match => ({
    index: match.index!,
    headerEnd: match.index! + match[0].length,
    path: match[1]!,
    kind: 'bytes',
    total: Number(match[2]),
    start: Number(match[3]),
    end: Number(match[4]),
  }))
  const lineHeaders = [...result.matchAll(linePattern)].map<OutputHeader>(match => ({
    index: match.index!,
    headerEnd: match.index! + match[0].length,
    path: match[1]!,
    kind: 'lines',
    total: Number(match[2]),
    start: Number(match[3]),
    end: Number(match[4]),
  }))
  const allHeaders = [...byteHeaders, ...lineHeaders].sort((left, right) => left.index - right.index)

  return byteHeaders.map(header => {
    const bodyStart = result[header.headerEnd] === '\n' ? header.headerEnd + 1 : -1
    if (bodyStart < 0) throw new Error('ReadFile byte-range header is not followed by a body')
    const nextHeader = allHeaders.find(candidate => candidate.index > header.index)
    let bodyEnd = nextHeader?.index ?? result.length
    if (nextHeader) {
      if (result.slice(bodyEnd - 2, bodyEnd) !== '\n\n') throw new Error('Multi-file ReadFile results are not separated correctly')
      bodyEnd -= 2
    }
    let bodyWithMarker = result.slice(bodyStart, bodyEnd)
    const limitSuffix = /\n{2,3}\[(?:response limit reached|byte capture limit reached); remaining files omitted\]$/u.exec(bodyWithMarker)
    if (limitSuffix) bodyWithMarker = bodyWithMarker.slice(0, -limitSuffix[0].length)
    const marker = /\n\[(?:continue with start_byte=\d+|end of file)\]$/u.exec(bodyWithMarker)
    if (!marker) throw new Error('ReadFile byte-range output is missing its continuation marker')
    bodyWithMarker = bodyWithMarker.slice(0, -marker[0].length)
    return {
      headerPath: header.path,
      totalBytes: header.total,
      startByte: header.start,
      endByte: header.end,
      body: bodyWithMarker,
    }
  })
}

async function expectReadEvidence(): Promise<void> {
  const evidence = JSON.parse(await readFile(join(import.meta.dir, 'observed.json'), 'utf8')) as Record<string, unknown>
  expect(evidence.workspaceRoot).toBe('.')
  const limits = evidence.limits as Record<string, unknown> | undefined
  expect(limits?.responseChars).toBe(20_000)
  expect(limits?.captureBytesPerCall).toBe(1_000_000)
  expect(Array.isArray(evidence.readFileEvidence) && evidence.readFileEvidence.length > 0).toBe(true)

  const source = await readFile(join(process.cwd(), 'data/config.json'))
  const fixtureBytes = source.byteLength
  const ids = new Set<string>()
  let targetRangeFound = false
  for (const raw of evidence.readFileEvidence as unknown[]) {
    expect(raw && typeof raw === 'object' && !Array.isArray(raw)).toBe(true)
    const item = raw as Record<string, unknown>
    expect(typeof item.callId === 'string' && item.callId.length > 0).toBe(true)
    expect(item.resultCallId).toBe(item.callId)
    expect(ids.has(item.callId as string)).toBe(false)
    ids.add(item.callId as string)
    expect(typeof item.result).toBe('string')
    expect(typeof item.resultUtf8Bytes).toBe('number')
    const result = item.result as string
    expect(Number.isSafeInteger(item.resultUtf8Bytes)).toBe(true)
    expect(item.resultUtf8Bytes).toBe(Buffer.byteLength(result, 'utf8'))
    expect(result.length).toBeLessThanOrEqual(limits!.responseChars as number)

    const request = requestedPaths(item.arguments, evidence.workspaceRoot as string)
    expect(request).not.toBeNull()
    const reportedRanges = item.reportedRanges
    expect(Array.isArray(reportedRanges)).toBe(true)
    const parsedRanges = parseByteRanges(rangeOutput(result))
    expect(parsedRanges).toHaveLength((reportedRanges as unknown[]).length)
    let capturedBytes = 0
    for (const [index, parsed] of parsedRanges.entries()) {
      const rangeValue = (reportedRanges as unknown[])[index]
      expect(rangeValue && typeof rangeValue === 'object' && !Array.isArray(rangeValue)).toBe(true)
      const range = rangeValue as Record<string, unknown>
      expect(typeof range.path).toBe('string')
      const normalizedPath = relativeWorkspacePath(range.path, evidence.workspaceRoot as string)
      expect(normalizedPath).not.toBeNull()
      expect(range.path).toBe(normalizedPath)
      const headerPath = relativeWorkspacePath(parsed.headerPath, evidence.workspaceRoot as string)
      expect(headerPath).not.toBeNull()
      expect(headerPath).toBe(normalizedPath)
      expect(request!.paths).toContain(normalizedPath)
      expect(range.startByte).toBe(parsed.startByte)
      expect(range.endByte).toBe(parsed.endByte)
      expect(range.totalBytes).toBe(parsed.totalBytes)
      expect(parsed.startByte).toBe(request!.startByte)
      expect(Number.isSafeInteger(parsed.totalBytes)).toBe(true)
      expect(parsed.startByte).toBeGreaterThanOrEqual(0)
      expect(parsed.endByte).toBeGreaterThanOrEqual(parsed.startByte)
      expect(parsed.endByte).toBeLessThanOrEqual(parsed.totalBytes)

      const emittedBody = Buffer.from(parsed.body, 'utf8')
      expect(emittedBody.byteLength).toBe(parsed.endByte - parsed.startByte)
      capturedBytes += emittedBody.byteLength
      if (normalizedPath === targetPath) {
        expect(request!.paths).toContain(targetPath)
        expect(parsed.totalBytes).toBe(fixtureBytes)
        expect(emittedBody).toEqual(source.subarray(parsed.startByte, parsed.endByte))
        targetRangeFound = true
      }
    }
    expect(capturedBytes).toBeLessThanOrEqual(limits!.captureBytesPerCall as number)
  }
  expect(targetRangeFound).toBe(true)
}

it('updates only the specified property in the >1 MB single-line fixture', async () => {
  const source = await readFile(join(process.cwd(), 'data/config.json'), 'utf8')
  expect(Buffer.byteLength(source)).toBeGreaterThan(1_000_000)
  expect(source).not.toMatch(/[\r\n]/)
  expect(createHash('sha256').update(source).digest('hex')).toBe(expectedFixtureHash)
  const before = JSON.parse(source)
  const after = JSON.parse(updateTarget(source, 'enabled'))
  const expected = structuredClone(before)
  expected.settings.target.value = 'enabled'
  expect(after).toEqual(expected)
})

it('updates the nested target for different input data without touching a decoy', () => {
  const source = JSON.stringify({
    decoy: { value: 'draft', note: 'preserve' },
    settings: { target: { value: 'draft', kind: 'preview' } },
    values: ['draft', { value: 'draft' }],
  })
  const expected = JSON.parse(source)
  expected.settings.target.value = 'published'
  expect(JSON.parse(updateTarget(source, 'published'))).toEqual(expected)
})

it('requires correlated C25 read evidence with matching emitted bytes and byte-range metadata', async () => {
  await expectReadEvidence()
})
