import { afterEach, expect, it } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIsolatedChecker } from '../scripts/eval/checker.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const scratch: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())
const referenceOutput = `export const TRUNCATION_MARKER = '\\n…[truncated]…\\n'

function graphemes(text: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(({ segment }) => segment)
}

function takePrefix(text: string, maxBytes: number): string {
  let prefix = ''
  for (const grapheme of graphemes(text)) {
    if (Buffer.byteLength(prefix + grapheme, 'utf8') > maxBytes) break
    prefix += grapheme
  }
  return prefix
}

function takeSuffix(text: string, maxBytes: number): string {
  let suffix = ''
  for (const grapheme of graphemes(text).reverse()) {
    if (Buffer.byteLength(grapheme + suffix, 'utf8') > maxBytes) break
    suffix = grapheme + suffix
  }
  return suffix
}

export function truncateOutput(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const remaining = Math.max(0, maxBytes - Buffer.byteLength(TRUNCATION_MARKER, 'utf8'))
  const prefix = takePrefix(text, Math.floor(remaining / 2))
  const suffix = takeSuffix(text, remaining - Buffer.byteLength(prefix, 'utf8'))
  return prefix + TRUNCATION_MARKER + suffix
}
`

afterEach(async () => {
  await Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eval-c34-checker-'))
  scratch.push(root)
  const source = join(import.meta.dir, '../scripts/eval/tasks/unicode-output-boundary')
  await Promise.all([
    cp(join(source, 'repo'), join(root, 'repo'), { recursive: true }),
    cp(join(source, 'check'), join(root, '__eval_check__'), { recursive: true }),
  ])
  await writeFile(join(root, 'repo/src/output.ts'), referenceOutput)
  return root
}

async function check(root: string) {
  return runIsolatedChecker(['test', './__eval_check__'], root, { readOnlyPaths: ['__eval_check__'] })
}

sandboxTest('C34 checker accepts a grapheme-safe reference and rejects a byte-valid split-edge mutant', async () => {
  const root = await fixture()
  const reference = await check(root)
  expect(reference.exitCode).toBe(0)
  expect(reference.positiveTestEvidence).toBe(true)

  const mutant = referenceOutput.replace(
    "  const remaining = Math.max(0, maxBytes - Buffer.byteLength(TRUNCATION_MARKER, 'utf8'))",
    "  if (maxBytes === 64) return text.slice(0, 22) + TRUNCATION_MARKER + text.slice(-23)\n  const remaining = Math.max(0, maxBytes - Buffer.byteLength(TRUNCATION_MARKER, 'utf8'))",
  )
  expect(mutant).not.toBe(referenceOutput)
  await writeFile(join(root, 'repo/src/output.ts'), mutant)
  const rejected = await check(root)
  expect(rejected.positiveTestEvidence).toBe(true)
  expect(rejected.exitCode).not.toBe(0)
  expect(rejected.all).toContain('keeps retained small-cap edges on combining-grapheme boundaries')

  const markerMutant = referenceOutput
    .replace("export const TRUNCATION_MARKER = '\\n…[truncated]…\\n'", "export const TRUNCATION_MARKER = ''")
    .replace('  return prefix + TRUNCATION_MARKER + suffix', '  return suffix')
  expect(markerMutant).not.toBe(referenceOutput)
  await writeFile(join(root, 'repo/src/output.ts'), markerMutant)
  const markerRejected = await check(root)
  expect(markerRejected.positiveTestEvidence).toBe(true)
  expect(markerRejected.exitCode).not.toBe(0)
  expect(markerRejected.all).toContain('uses a UTF-8 byte budget and preserves the tail error marker')
})
