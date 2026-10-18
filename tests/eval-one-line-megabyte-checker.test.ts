import { afterEach, expect, it } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIsolatedChecker } from '../scripts/eval/checker.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const scratch: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())
const taskRoot = join(import.meta.dir, '../scripts/eval/tasks/one-line-megabyte')

interface RangeEvidence {
  path: string
  startByte: number
  endByte: number
  totalBytes: number
}

interface CallEvidence {
  callId: string
  resultCallId: string | null
  arguments: Record<string, unknown> | null
  result: string | null
  resultUtf8Bytes: number | null
  reportedRanges: RangeEvidence[]
}

interface ObservedEvidence {
  workspaceRoot: string
  limits: { responseChars: number; captureBytesPerCall: number }
  readFileEvidence: CallEvidence[]
}

async function createReferenceWorkspace(): Promise<{ root: string; observed: string; evidence: ObservedEvidence }> {
  const root = await mkdtemp(join(tmpdir(), 'eval-c25-checker-'))
  scratch.push(root)
  await cp(join(taskRoot, 'repo'), root, { recursive: true })
  const checker = join(root, '__eval_check__')
  await cp(join(taskRoot, 'check'), checker, { recursive: true })
  await writeFile(join(root, 'src/update.ts'), `export function updateTarget(json: string, value: string): string {
  const parsed = JSON.parse(json)
  parsed.settings.target.value = value
  return JSON.stringify(parsed)
}
`)
  await mkdir(join(root, 'data'), { recursive: true })
  await writeFile(join(root, 'data/other.json'), '{"other":true}')
  await writeFile(join(root, 'README.md'), 'Small synthetic fixture README.')

  const evidence: ObservedEvidence = {
    workspaceRoot: '.',
    limits: { responseChars: 20_000, captureBytesPerCall: 1_000_000 },
    readFileEvidence: [],
  }
  await setReadEvidence(root, evidence, ['data/config.json'])
  const observed = join(checker, 'observed.json')
  await writeFile(observed, JSON.stringify(evidence))
  return { root, observed, evidence }
}

async function setReadEvidence(root: string, evidence: ObservedEvidence, paths: string[]): Promise<void> {
  const outputParts: string[] = []
  const reportedRanges: RangeEvidence[] = []
  for (const path of paths) {
    const source = await readFile(join(root, path))
    const endByte = Math.min(2048, source.byteLength)
    const body = source.subarray(0, endByte).toString('utf8')
    const absolutePath = join('/mnt', path)
    const marker = endByte < source.byteLength
      ? `[continue with start_byte=${endByte}]`
      : '[end of file]'
    outputParts.push(`[${absolutePath}  ${source.byteLength} bytes total  showing bytes 0–${endByte}]\n${body}\n${marker}`)
    reportedRanges.push({ path, startByte: 0, endByte, totalBytes: source.byteLength })
  }

  const result = outputParts.join('\n\n')
  evidence.readFileEvidence = [{
    callId: 'read-1',
    resultCallId: 'read-1',
    arguments: paths.length === 1
      ? { path: paths[0], start_byte: 0 }
      : { paths, start_byte: 0 },
    result,
    resultUtf8Bytes: Buffer.byteLength(result, 'utf8'),
    reportedRanges,
  }]
}

async function setMixedReadEvidence(root: string, evidence: ObservedEvidence, paths: string[]): Promise<void> {
  const outputParts: string[] = []
  const reportedRanges: RangeEvidence[] = []
  for (const path of paths) {
    const source = await readFile(join(root, path))
    const absolutePath = join('/mnt', path)
    if (source.byteLength > 1_000_000) {
      const endByte = Math.min(2048, source.byteLength)
      const body = source.subarray(0, endByte).toString('utf8')
      outputParts.push(`[${absolutePath}  ${source.byteLength} bytes total  showing bytes 0–${endByte}]\n${body}\n[continue with start_byte=${endByte}]`)
      reportedRanges.push({ path, startByte: 0, endByte, totalBytes: source.byteLength })
      continue
    }

    const lines = source.toString('utf8').split('\n')
    const width = String(lines.length).length
    const shownLines = lines.map((line, index) => `${String(index + 1).padStart(width, ' ')}  ${line}`).join('\n')
    outputParts.push(`[${absolutePath}  ${lines.length} lines total  showing 1–${lines.length}]\n${shownLines}`)
  }

  const result = outputParts.join('\n\n')
  evidence.readFileEvidence = [{
    callId: 'read-1',
    resultCallId: 'read-1',
    arguments: { paths },
    result,
    resultUtf8Bytes: Buffer.byteLength(result, 'utf8'),
    reportedRanges,
  }]
}

async function runChecker(root: string) {
  return runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
}

function replaceFirstBodyByte(result: string): string {
  const bodyStart = result.indexOf('\n') + 1
  const original = result[bodyStart]
  if (!original || original === '\n') throw new Error('Synthetic result has no body byte')
  const replacement = original === 'x' ? 'y' : 'x'
  return `${result.slice(0, bodyStart)}${replacement}${result.slice(bodyStart + 1)}`
}

function replaceFirstHeaderPath(result: string, path: string): string {
  const headerStart = result.indexOf('[') + 1
  const pathEnd = result.indexOf('  ', headerStart)
  if (headerStart === 0 || pathEnd < 0) throw new Error('Synthetic result has no byte-range header path')
  return `${result.slice(0, headerStart)}${path}${result.slice(pathEnd)}`
}

function withPartialEnvelope(output: string, message = '1 of 2 attempted files could not be read.'): string {
  return JSON.stringify({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'READ_FILE_PARTIAL', message, retryable: false },
    partial: { output, failures: ['Error: file not found: missing.json'] },
  })
}

function withResult(item: CallEvidence, result: string, args: Record<string, unknown> = item.arguments ?? {}): CallEvidence {
  return { ...item, arguments: args, result, resultUtf8Bytes: Buffer.byteLength(result, 'utf8') }
}

sandboxTest('C25 checker validates exact bytes, requested offsets, and every path in multi-file reads', async () => {
  const { root, observed, evidence } = await createReferenceWorkspace()

  const validSingleFile = await runChecker(root)
  expect(validSingleFile.exitCode).toBe(0)
  expect(validSingleFile.positiveTestEvidence).toBe(true)

  const item = evidence.readFileEvidence[0]!
  const sameLengthWrongBytes = {
    ...item,
    result: replaceFirstBodyByte(item.result!),
  }
  sameLengthWrongBytes.resultUtf8Bytes = Buffer.byteLength(sameLengthWrongBytes.result!, 'utf8')

  await mkdir(join(root, 'backup/data'), { recursive: true })
  await cp(join(root, 'data/config.json'), join(root, 'backup/data/config.json'))
  const pathDecoyEvidence = structuredClone(evidence)
  await setReadEvidence(root, pathDecoyEvidence, ['backup/data/config.json'])
  const pathDecoy = pathDecoyEvidence.readFileEvidence[0]!

  const reportedPathMismatch = structuredClone(item)
  reportedPathMismatch.reportedRanges[0]!.path = 'backup/data/config.json'

  const headerPathMismatch = structuredClone(item)
  headerPathMismatch.result = replaceFirstHeaderPath(item.result!, '/mnt/backup/data/config.json')
  headerPathMismatch.resultUtf8Bytes = Buffer.byteLength(headerPathMismatch.result!, 'utf8')

  const offsetMismatch = structuredClone(item)
  offsetMismatch.arguments = { path: 'data/config.json', start_byte: 1 }

  const contradictoryRange = structuredClone(item)
  contradictoryRange.reportedRanges[0]!.endByte += 1

  const unsupportedSuffix = withResult(
    item,
    `${item.result!}\n\n[another file was omitted]`,
    { paths: ['data/config.json', 'README.md'] },
  )

  const invalidEvidence: ObservedEvidence[] = [
    { ...evidence, readFileEvidence: [] },
    { ...evidence, readFileEvidence: [{ ...item, resultCallId: 'different-call' }] },
    { ...evidence, readFileEvidence: [{ ...item, arguments: null }] },
    { ...evidence, readFileEvidence: [sameLengthWrongBytes] },
    { ...evidence, readFileEvidence: [pathDecoy] },
    { ...evidence, readFileEvidence: [reportedPathMismatch] },
    { ...evidence, readFileEvidence: [headerPathMismatch] },
    { ...evidence, readFileEvidence: [offsetMismatch] },
    { ...evidence, readFileEvidence: [contradictoryRange] },
    { ...evidence, readFileEvidence: [unsupportedSuffix] },
    { ...evidence, readFileEvidence: [{ ...item, resultUtf8Bytes: item.resultUtf8Bytes! + 1 }] },
    { ...evidence, limits: { responseChars: 1, captureBytesPerCall: 1_000_000 } },
    { ...evidence, limits: { responseChars: 20_000, captureBytesPerCall: 1 } },
    { ...evidence, limits: { responseChars: 40_000, captureBytesPerCall: 1_000_000 } },
    { ...evidence, limits: { responseChars: 20_000, captureBytesPerCall: 2_000_000 } },
  ]
  for (const invalid of invalidEvidence) {
    await writeFile(observed, JSON.stringify(invalid))
    expect((await runChecker(root)).exitCode).not.toBe(0)
  }

  for (const [separator, note] of [
    ['\n\n', '[byte capture limit reached; remaining files omitted]'],
    ['\n\n\n', '[response limit reached; remaining files omitted]'],
  ]) {
    const withLimitNote = withResult(item, `${item.result!}${separator}${note}`, { paths: ['data/config.json', 'README.md'] })
    await writeFile(observed, JSON.stringify({ ...evidence, readFileEvidence: [withLimitNote] }))
    const validLimitNote = await runChecker(root)
    expect(validLimitNote.exitCode).toBe(0)
    expect(validLimitNote.positiveTestEvidence).toBe(true)
  }

  const partialItem = withResult(item, withPartialEnvelope(item.result!), { paths: ['data/config.json', 'missing.json'] })
  await writeFile(observed, JSON.stringify({ ...evidence, readFileEvidence: [partialItem] }))
  const validPartial = await runChecker(root)
  expect(validPartial.exitCode).toBe(0)
  expect(validPartial.positiveTestEvidence).toBe(true)

  const partialWrongBytes = withResult(item, withPartialEnvelope(replaceFirstBodyByte(item.result!)), { paths: ['data/config.json', 'missing.json'] })
  await writeFile(observed, JSON.stringify({ ...evidence, readFileEvidence: [partialWrongBytes] }))
  expect((await runChecker(root)).exitCode).not.toBe(0)

  const malformedPartial = withResult(item, JSON.stringify({
    schemaVersion: 1,
    status: 'partial',
    error: { kind: 'tool', code: 'READ_FILE_PARTIAL', message: 'A file failed.', retryable: false },
    partial: { failures: ['Error: file not found: missing.json'] },
  }), { paths: ['data/config.json', 'missing.json'] })
  await writeFile(observed, JSON.stringify({ ...evidence, readFileEvidence: [malformedPartial] }))
  expect((await runChecker(root)).exitCode).not.toBe(0)

  for (const paths of [
    ['data/config.json', 'data/other.json'],
    ['data/other.json', 'data/config.json'],
  ]) {
    await setReadEvidence(root, evidence, paths)
    await writeFile(observed, JSON.stringify(evidence))
    const validMultiFile = await runChecker(root)
    expect(validMultiFile.exitCode).toBe(0)
    expect(validMultiFile.positiveTestEvidence).toBe(true)
  }

  for (const paths of [
    ['data/config.json', 'README.md'],
    ['README.md', 'data/config.json'],
  ]) {
    await setMixedReadEvidence(root, evidence, paths)
    await writeFile(observed, JSON.stringify(evidence))
    const validMixedRead = await runChecker(root)
    expect(validMixedRead.exitCode).toBe(0)
    expect(validMixedRead.positiveTestEvidence).toBe(true)
  }

  await rm(observed)
  expect((await runChecker(root)).exitCode).not.toBe(0)
})
