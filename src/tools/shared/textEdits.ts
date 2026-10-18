import { constants, type BigIntStats } from 'node:fs'
import { open, realpath, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { ToolExecutionContext } from '../../orchestration/types.js'
import { assertSafePath, assertExecutionActive } from './pathSafety.js'

export const MAX_TEXT_DOCUMENT_BYTES = 524_288
export interface TextPosition { line: number; character: number }
export interface TextEdit { range: { start: TextPosition; end: TextPosition }; newText: string }
const stamp = (value: BigIntStats) => [value.dev, value.ino, value.mode, value.size, value.mtimeNs, value.ctimeNs].join(':')

/** Read a bounded UTF-8 snapshot without stripping its BOM or following a replaced final symlink. */
export async function readTextDocument(file: string, context?: ToolExecutionContext) {
  assertExecutionActive(context)
  const path = await realpath(await assertSafePath(file, context))
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size > BigInt(MAX_TEXT_DOCUMENT_BYTES)) throw new Error('Text document exceeds supported file limits; use bounded file reads')
    const buffer = Buffer.alloc(Number(before.size) + 1)
    let count = 0
    while (count < buffer.length) {
      assertExecutionActive(context)
      const chunk = await handle.read(buffer, count, buffer.length - count, null)
      if (!chunk.bytesRead) break
      count += chunk.bytesRead
    }
    if (count !== Number(before.size) || stamp(before) !== stamp(await handle.stat({ bigint: true }))
      || await realpath(await assertSafePath(file, context)) !== path || stamp(await lstat(path, { bigint: true })) !== stamp(before)) throw new Error('Text document changed while reading; retry')
    assertExecutionActive(context)
    const bytes = buffer.subarray(0, count)
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    if (text.includes('\0')) throw new Error('Range editing requires a text document')
    return { path, text, hash: createHash('sha256').update(bytes).digest('hex') }
  } finally { await handle.close() }
}

/** All ranges refer to one original snapshot; no edit sees an intermediate document. */
export function applyTextEdits(source: string, input: unknown) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 200) throw new Error('Text edits require 1–200 ranges')
  if (Buffer.byteLength(source) > MAX_TEXT_DOCUMENT_BYTES) throw new Error('Text document exceeds supported file limits')
  const starts = [0], ends: number[] = []
  for (const match of source.matchAll(/\r\n|\r|\n/g)) { ends.push(match.index!); starts.push(match.index! + match[0].length) }
  ends.push(source.length)
  const offset = (position: TextPosition) => {
    if (!position || !Number.isInteger(position.line) || !Number.isInteger(position.character) || position.line < 0 || position.line >= starts.length || position.character < 0 || position.character > ends[position.line]! - starts[position.line]!) throw new Error('Text edit range is outside the document')
    const value = starts[position.line]! + position.character
    if (value > 0 && /[\uD800-\uDBFF]/.test(source[value - 1]!) && /[\uDC00-\uDFFF]/.test(source[value] ?? '')) throw new Error('Text edit range splits a Unicode surrogate pair')
    return value
  }
  const crlf = source.includes('\r\n') && !/(^|[^\r])\n|\r(?!\n)/.test(source)
  let normalized = false
  let replacementBytes = 0
  const entries = input.map((value: any, index) => {
    if (!value || typeof value.newText !== 'string' || !value.range || 'annotationId' in value) throw new Error('Invalid or annotated text edit')
    if (Buffer.byteLength(value.newText) > MAX_TEXT_DOCUMENT_BYTES) throw new Error('Text edit replacement exceeds supported file limits')
    if (value.newText.includes('\0') || Buffer.from(value.newText, 'utf8').toString('utf8') !== value.newText) throw new Error('Text edit replacement is not valid UTF-8 text')
    const start = offset(value.range.start), end = offset(value.range.end)
    if (end < start) throw new Error('Text edit range is reversed')
    const newText = crlf ? value.newText.replace(/\r?\n/g, '\r\n') : value.newText
    replacementBytes += Buffer.byteLength(newText)
    if (replacementBytes > MAX_TEXT_DOCUMENT_BYTES) throw new Error('Text edit replacements exceed supported file limits')
    normalized ||= newText !== value.newText
    const edit: TextEdit = { range: { start: { line: value.range.start.line, character: value.range.start.character }, end: { line: value.range.end.line, character: value.range.end.character } }, newText }
    return { index, start, end, edit }
  }).sort((a, b) => a.start - b.start || a.index - b.index)
  for (let index = 1; index < entries.length; index++) if (entries[index]!.start < entries[index - 1]!.end) throw new Error('Text edit ranges overlap')
  const parts: string[] = []
  let cursor = 0
  for (const entry of entries) { parts.push(source.slice(cursor, entry.start), entry.edit.newText); cursor = entry.end }
  parts.push(source.slice(cursor))
  const content = parts.join('')
  if (Buffer.byteLength(content) > MAX_TEXT_DOCUMENT_BYTES) throw new Error('Edited document exceeds supported file limits')
  return { content, edits: entries.map(entry => entry.edit), preview: entries.map(entry => ({ range: entry.edit.range, before: source.slice(entry.start, entry.end), newText: entry.edit.newText })), lineEndingNormalization: normalized ? 'CRLF' : null }
}
