import { open, lstat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { maskSecretsForOffsets } from '../../orchestration/events.js'

export const MAX_SHELL_STREAM_JOURNAL_BYTES = 2_000_000
export const MAX_SHELL_STREAM_JOURNAL_QUEUE_BYTES = 256_000
export const MAX_SHELL_STREAM_JOURNAL_PAGE_CHARS = 20_000
const MAX_REDACTION_LINE_CHARS = 64_000
const MAX_RECORD_CHARS = 512
const MAX_JOURNAL_AGE_MS = 7 * 24 * 60 * 60 * 1_000

export interface ShellStreamJournalInput {
  text: string
  channel: 'stdout' | 'stderr'
  globalOffset: number
  channelOffset: number
}

export interface ShellStreamJournalRecord extends ShellStreamJournalInput {
  sequence: number
}

export interface ShellStreamJournalStats {
  available: boolean
  latestSequence: number
  assignedSequence: number
  droppedRecords: number
  bytes: number
  truncated: boolean
  redactionConservative: boolean
  gapUnknown: boolean
}

export interface ShellStreamJournalPage {
  schema: 'shell_stream_journal_v1'
  records: ShellStreamJournalRecord[]
  cursor: number
  latestSequence: number
  gap: boolean
  gapStart?: number
  gapEnd?: number
  finished: boolean
  truncated: boolean
  redactionConservative: boolean
  incompleteTail: boolean
  incomplete: boolean
  gapUnknown: boolean
  gaps?: Array<{ from: number; to: number }>
  error?: 'expired' | 'unavailable' | 'invalid_cursor'
}

interface PendingPart extends ShellStreamJournalInput { redactedText?: string }
interface RedactionState {
  pem: string[]
  quote: '"' | "'" | null
  assignment: 'delimiter' | 'value' | null
  maskRest: boolean
}

function maskPreservingLines(value: string): string { return value.replace(/[^\r\n]/g, '*') }

function secretField(field: string): boolean {
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, '')
  return /(?:apikey|authorization|cookie|credentials?|password|passwd|privatekey|secret)/.test(normalized)
    || /(?:access|auth|refresh|session)?token$/.test(normalized)
}

function isEscaped(value: string, at: number): boolean {
  let slashes = 0
  for (let index = at - 1; index >= 0 && value[index] === '\\'; index--) slashes++
  return slashes % 2 === 1
}

function findUnclosedSecretQuote(line: string): '"' | "'" | null {
  const assignment = /(?:^|[^A-Za-z0-9_.-])(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,127})\1\s*[=:]\s*(["'])/g
  for (let match = assignment.exec(line); match; match = assignment.exec(line)) {
    if (!secretField(match[2]!)) continue
    const quote = match[3] as '"' | "'"
    const valueStart = match.index + match[0].length
    let close = valueStart
    while (close < line.length && (line[close] !== quote || isEscaped(line, close))) close++
    if (close === line.length) return quote
  }
  return null
}

function redactPrivateKeyContent(line: string, state: RedactionState): string {
  const marker = /-----BEGIN ([^-\r\n]*PRIVATE KEY)-----|-----END ([^-\r\n]*PRIVATE KEY)-----/g
  let output = ''
  let offset = 0
  for (let match = marker.exec(line); match; match = marker.exec(line)) {
    output += state.pem.length ? maskPreservingLines(line.slice(offset, match.index)) : line.slice(offset, match.index)
    if (match[1]) {
      state.pem.push(match[1])
      output += maskPreservingLines(match[0])
    } else if (state.pem.at(-1) === match[2]) {
      state.pem.pop()
      output += maskPreservingLines(match[0])
    } else if (state.pem.length) output += maskPreservingLines(match[0])
    else output += match[0]
    offset = match.index + match[0].length
  }
  return output + (state.pem.length ? maskPreservingLines(line.slice(offset)) : line.slice(offset))
}

function suffixSecretAssignment(line: string): 'delimiter' | 'value' | null {
  const trimmed = line.replace(/[\r\n]+$/, '')
  const key = /(?:^|[^A-Za-z0-9_.-])(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,127})\1\s*([=:])?\s*$/.exec(trimmed)
  if (!key || !secretField(key[2]!)) return null
  return key[3] ? 'value' : 'delimiter'
}

function redactContinuation(line: string, state: RedactionState): string {
  let output = ''
  let index = 0
  const newlineAt = line.search(/[\r\n]/)
  const contentEnd = newlineAt < 0 ? line.length : newlineAt
  if (state.assignment === 'delimiter') {
    const delimiter = line.slice(index, contentEnd).search(/[=:]/)
    if (delimiter < 0) return line
    output += line.slice(0, delimiter + 1)
    index = delimiter + 1
    state.assignment = 'value'
  }
  if (state.assignment === 'value') {
    while (index < contentEnd && /\s/.test(line[index]!)) output += line[index++]
    if (index < contentEnd && (line[index] === '"' || line[index] === "'")) {
      const quote = line[index] as '"' | "'"
      output += quote
      index++
      let close = index
      while (close < contentEnd && (line[close] !== quote || isEscaped(line, close))) close++
      if (close === contentEnd) {
        output += maskPreservingLines(line.slice(index))
        state.quote = quote
        state.assignment = null
        return output + line.slice(contentEnd)
      }
      output += maskPreservingLines(line.slice(index, close)) + quote
      index = close + 1
      state.assignment = null
    } else if (index < contentEnd) {
      const end = line.slice(index, contentEnd).search(/[\s,;}"']/)
      const valueEnd = end < 0 ? contentEnd : index + end
      output += maskPreservingLines(line.slice(index, valueEnd))
      index = valueEnd
      state.assignment = null
    } else return output + line.slice(index)
  }
  return output + maskSecretsForOffsets(line.slice(index))
}

function redactLine(line: string, state: RedactionState): string {
  if (state.maskRest) return maskPreservingLines(line)
  const pemSafeLine = redactPrivateKeyContent(line, state)
  if (state.quote) {
    let close = 0
    while (close < pemSafeLine.length && (pemSafeLine[close] !== state.quote || isEscaped(pemSafeLine, close))) close++
    if (close === pemSafeLine.length) return maskPreservingLines(pemSafeLine)
    state.quote = null
    return maskPreservingLines(pemSafeLine.slice(0, close)) + pemSafeLine[close] + maskSecretsForOffsets(pemSafeLine.slice(close + 1))
  }
  if (state.assignment) return redactContinuation(pemSafeLine, state)

  const redacted = maskSecretsForOffsets(pemSafeLine)
  state.quote = findUnclosedSecretQuote(pemSafeLine)
  state.assignment = suffixSecretAssignment(pemSafeLine)
  return redacted
}

/** Redacts complete per-channel lines before persistence, then emits them in global arrival order. */
export class ShellStreamJournalRedactor {
  private readonly channels: Record<'stdout' | 'stderr', { pending: PendingPart[]; pendingChars: number; state: RedactionState }> = {
    stdout: { pending: [], pendingChars: 0, state: { pem: [], quote: null, assignment: null, maskRest: false } },
    stderr: { pending: [], pendingChars: 0, state: { pem: [], quote: null, assignment: null, maskRest: false } },
  }
  private ordered: PendingPart[] = []
  private orderedChars = 0
  private maskRest = false
  private conservative = false

  constructor(private readonly emit: (part: ShellStreamJournalInput) => void, private readonly maxLineChars = MAX_REDACTION_LINE_CHARS) {}

  get redactionConservative(): boolean { return this.conservative }

  push(input: ShellStreamJournalInput): void {
    if (!input.text) return
    let index = 0
    while (index < input.text.length) {
      const separator = input.text.slice(index).search(/[\r\n]/)
      const end = separator < 0 ? input.text.length : index + separator + 1
      const text = input.text.slice(index, end)
      const part = { ...input, text, globalOffset: input.globalOffset + index, channelOffset: input.channelOffset + index }
      const hasSeparator = separator >= 0
      const channel = this.channels[input.channel]

      if (this.maskRest) this.emitMasked(input, index, end)
      else if (text.length > this.maxLineChars || channel.pendingChars + text.length > this.maxLineChars
        || channel.pending.length >= 4096 || this.orderedChars + text.length > this.maxLineChars
        || this.ordered.length >= 4096) {
        this.maskPendingRemainder()
        this.emitMasked(input, index, end)
      } else {
        this.ordered.push(part)
        this.orderedChars += text.length
        channel.pending.push(part)
        channel.pendingChars += text.length
        if (hasSeparator) this.flushChannel(input.channel, false)
        this.drainReady()
      }
      index = end
    }
  }

  finish(): void {
    this.flushChannel('stdout', false)
    this.flushChannel('stderr', false)
    this.drainReady()
  }

  private flushChannel(channelName: 'stdout' | 'stderr', forceMask: boolean): void {
    const channel = this.channels[channelName]
    if (!channel.pendingChars) return
    const source = channel.pending.map(part => part.text).join('')
    const redacted = forceMask ? maskPreservingLines(source) : redactLine(source, channel.state)
    let globalOffset = 0
    for (const part of channel.pending) {
      part.redactedText = redacted.slice(globalOffset, globalOffset + part.text.length)
      globalOffset += part.text.length
    }
    channel.pending = []
    channel.pendingChars = 0
  }

  private appendMasked(part: PendingPart): void {
    this.ordered.push({ ...part, redactedText: maskPreservingLines(part.text) })
    this.orderedChars += part.text.length
    this.drainReady()
  }

  private emitMasked(input: ShellStreamJournalInput, start: number, end: number): void {
    for (let offset = start; offset < end;) {
      let next = Math.min(end, offset + MAX_RECORD_CHARS)
      if (next < end && /[\uD800-\uDBFF]/.test(input.text[next - 1]!) && /[\uDC00-\uDFFF]/.test(input.text[next]!)) next--
      if (next === offset) next = Math.min(end, offset + 2)
      const text = input.text.slice(offset, next)
      this.appendMasked({ ...input, text: maskPreservingLines(text), globalOffset: input.globalOffset + offset, channelOffset: input.channelOffset + offset })
      offset = next
    }
  }

  private maskPendingRemainder(): void {
    this.conservative = true
    this.maskRest = true
    for (const channelName of ['stdout', 'stderr'] as const) {
      this.channels[channelName].state.maskRest = true
      this.flushChannel(channelName, true)
    }
    for (const part of this.ordered) if (part.redactedText === undefined) part.redactedText = maskPreservingLines(part.text)
    this.drainReady()
  }

  private drainReady(): void {
    while (this.ordered.length && this.ordered[0]!.redactedText !== undefined) {
      const part = this.ordered.shift()!
      this.orderedChars -= part.text.length
      this.emit({ ...part, text: part.redactedText! })
    }
  }
}

export interface ShellStreamJournalOptions {
  maxBytes?: number
  maxQueueBytes?: number
  maxLineChars?: number
  writeRecord?: (file: FileHandle, value: string) => Promise<void>
}

/** Private append-only output journal. Pipe callbacks enqueue only bounded, already-redacted records. */
export class ShellStreamJournal {
  private file?: FileHandle
  private readonly queue: Array<{ value: string; bytes: number }> = []
  private queuedBytes = 0
  private inFlightBytes = 0
  private committedBytes = 0
  private sequence = 0
  private settledSequence = 0
  private droppedRecords = 0
  private truncated = false
  private accepting = true
  private available = false
  private writing = false
  private writerError = false
  private gapUnknown = false
  private previewFull: string | null = ''
  private previewHead = ''
  private previewTail = ''
  private previewChars = 0
  private readonly writeRecord: (file: FileHandle, value: string) => Promise<void>
  private readonly redactor: ShellStreamJournalRedactor

  constructor(private readonly path: string, private readonly options: ShellStreamJournalOptions = {}) {
    this.writeRecord = options.writeRecord ?? (async (file, value) => { await file.write(value, undefined, 'utf8') })
    this.redactor = new ShellStreamJournalRedactor(part => this.enqueue(part), options.maxLineChars)
  }

  async open(): Promise<void> {
    try {
      try {
        const info = await lstat(this.path)
        if (!info.isFile() || info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Shell stream journal is not a privately owned file')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      this.file = await open(this.path, 'a', 0o600)
      const fileInfo = await this.file.stat()
      if (!fileInfo.isFile() || (typeof process.getuid === 'function' && fileInfo.uid !== process.getuid())) throw new Error('Shell stream journal is not a privately owned file')
      this.committedBytes = fileInfo.size
      if (this.committedBytes > (this.options.maxBytes ?? MAX_SHELL_STREAM_JOURNAL_BYTES)) throw new Error('Shell stream journal exceeds its retention limit')
      this.available = true
    } catch {
      this.available = false
      await this.file?.close().catch(() => {})
      this.file = undefined
    }
  }

  disable(): void { this.available = false; this.accepting = false; this.truncated = true; this.gapUnknown = true }

  preview(): string {
    if (this.previewFull !== null) return this.previewFull
    const omitted = Math.max(0, this.previewChars - this.previewHead.length - this.previewTail.length)
    return omitted ? `${this.previewHead}\n…[${omitted} characters omitted]…\n${this.previewTail}` : this.previewHead || this.previewTail
  }

  push(input: ShellStreamJournalInput): void { this.redactor.push(input) }

  async finish(timeoutMs = 1_000): Promise<void> {
    this.redactor.finish()
    if (!await this.flush(timeoutMs)) {
      this.accepting = false
      this.truncated = true
      this.gapUnknown = true
      this.droppedRecords += this.queue.length
      this.queue.length = 0
      this.queuedBytes = 0
      this.settleDroppedTail()
      const file = this.file
      this.file = undefined
      void file?.close().catch(() => {})
      return
    }
    await this.file?.close().catch(() => {})
    this.file = undefined
  }

  async flush(timeoutMs = 250): Promise<boolean> {
    const writer = this.startWriter()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([writer.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) })])
    } finally { if (timer) clearTimeout(timer) }
  }

  stats(): ShellStreamJournalStats {
    return { available: this.available, latestSequence: this.settledSequence, assignedSequence: this.sequence, droppedRecords: this.droppedRecords,
      bytes: this.committedBytes + this.queuedBytes + this.inFlightBytes, truncated: this.truncated || this.writerError,
      redactionConservative: this.redactor.redactionConservative, gapUnknown: this.gapUnknown }
  }

  private enqueue(part: ShellStreamJournalInput): void {
    const text = part.text
    if (text) {
      if (this.previewFull !== null && this.previewFull.length + text.length <= 60_000) this.previewFull += text
      else {
        if (this.previewFull !== null) {
          this.previewHead = this.previewFull.slice(0, 20_000)
          this.previewTail = this.previewFull.slice(-40_000)
          this.previewFull = null
        }
        if (this.previewHead.length < 20_000) this.previewHead += text.slice(0, 20_000 - this.previewHead.length)
        this.previewTail = `${this.previewTail}${text}`.slice(-40_000)
      }
      this.previewChars += text.length
    }
    if (!this.available || this.writerError || !this.accepting) {
      this.truncated = true
      this.gapUnknown = true
      this.settleDroppedTail()
      return
    }
    for (let index = 0; index < text.length;) {
      let end = Math.min(text.length, index + MAX_RECORD_CHARS)
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--
      if (end === index) end = Math.min(text.length, index + 2)
      const record: ShellStreamJournalRecord = { sequence: ++this.sequence, channel: part.channel,
        globalOffset: part.globalOffset + index, channelOffset: part.channelOffset + index, text: text.slice(index, end) }
      const value = `${JSON.stringify(record)}\n`
      const bytes = Buffer.byteLength(value, 'utf8')
      if (!this.available || this.writerError || !this.accepting || this.committedBytes + this.queuedBytes + this.inFlightBytes + bytes > (this.options.maxBytes ?? MAX_SHELL_STREAM_JOURNAL_BYTES)
        || this.queuedBytes + bytes > (this.options.maxQueueBytes ?? MAX_SHELL_STREAM_JOURNAL_QUEUE_BYTES)) {
        this.droppedRecords++
        this.truncated = true
        this.accepting = false
        this.gapUnknown = true
        this.settleDroppedTail()
        return
      } else {
        this.queue.push({ value, bytes })
        this.queuedBytes += bytes
        void this.startWriter()
      }
      index = end
    }
  }

  private startWriter(): Promise<void> {
    if (this.writing || !this.queue.length || !this.file || !this.available) return this.writerPromise ?? Promise.resolve()
    this.writing = true
    this.writerPromise = (async () => {
      try {
        while (this.queue.length) {
          const item = this.queue.shift()!
          this.queuedBytes -= item.bytes
          this.inFlightBytes = item.bytes
          try {
            await this.writeRecord(this.file!, item.value)
            this.committedBytes += item.bytes
            this.inFlightBytes = 0
            this.settledSequence = itemSequence(item.value)
          } catch {
            this.inFlightBytes = 0
            this.writerError = true
            this.accepting = false
            this.truncated = true
            this.gapUnknown = true
            this.droppedRecords += 1 + this.queue.length
            this.queue.length = 0
            this.queuedBytes = 0
            this.settleDroppedTail()
            break
          }
        }
      } finally { this.writing = false; this.settleDroppedTail() }
    })()
    return this.writerPromise
  }

  private settleDroppedTail(): void {
    if (!this.writing && this.queue.length === 0 && (!this.accepting || !this.available || this.writerError)) this.settledSequence = this.sequence
  }

  private writerPromise?: Promise<void>
}

function itemSequence(value: string): number {
  try { return (JSON.parse(value) as { sequence: number }).sequence } catch { return 0 }
}

export async function readShellStreamJournalPage(
  path: string,
  afterSequence: number,
  latestSequence: number,
  finished: boolean,
  truncated: boolean,
  redactionConservative: boolean,
  maxChars = MAX_SHELL_STREAM_JOURNAL_PAGE_CHARS,
  incomplete = false,
  gapUnknown = false,
): Promise<ShellStreamJournalPage> {
  const empty = (error?: ShellStreamJournalPage['error']): ShellStreamJournalPage => ({ schema: 'shell_stream_journal_v1', records: [], cursor: afterSequence,
    latestSequence, gap: false, finished, truncated, redactionConservative, incompleteTail: false, incomplete, gapUnknown: incomplete || gapUnknown, ...(error ? { error } : {}) })
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(latestSequence) || latestSequence < 0
    || !Number.isSafeInteger(maxChars) || maxChars < 512 || maxChars > MAX_SHELL_STREAM_JOURNAL_PAGE_CHARS) return empty('invalid_cursor')
  let raw: string
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || info.size > MAX_SHELL_STREAM_JOURNAL_BYTES) return empty('unavailable')
    if (Date.now() - info.mtimeMs > MAX_JOURNAL_AGE_MS) return empty('expired')
    const file = await open(path, 'r')
    try {
      const openedInfo = await file.stat()
      if (!openedInfo.isFile() || (typeof process.getuid === 'function' && openedInfo.uid !== process.getuid())
        || openedInfo.size > MAX_SHELL_STREAM_JOURNAL_BYTES) return empty('unavailable')
      raw = await file.readFile({ encoding: 'utf8' })
      if (Buffer.byteLength(raw, 'utf8') > MAX_SHELL_STREAM_JOURNAL_BYTES) return empty('unavailable')
    } finally { await file.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty('expired')
    return empty('unavailable')
  }
  const completeEnd = raw.lastIndexOf('\n') + 1
  const incompleteTail = completeEnd !== raw.length
  const records: ShellStreamJournalRecord[] = []
  let cursor = afterSequence
  let pageChars = 0
  const parsedRecords: ShellStreamJournalRecord[] = []
  let effectiveLatest = latestSequence
  let expectedRecordSequence = 1
  let expectedGlobalOffset = 0
  const expectedChannelOffsets = { stdout: 0, stderr: 0 }
  for (const line of raw.slice(0, completeEnd).split('\n')) {
    if (!line) continue
    let record: ShellStreamJournalRecord
    try { record = JSON.parse(line) as ShellStreamJournalRecord } catch { return empty('unavailable') }
    if (!Number.isSafeInteger(record.sequence) || record.sequence !== expectedRecordSequence || !['stdout', 'stderr'].includes(record.channel)
      || !Number.isSafeInteger(record.globalOffset) || record.globalOffset < 0 || !Number.isSafeInteger(record.channelOffset) || record.channelOffset < 0
      || record.globalOffset !== expectedGlobalOffset || record.channelOffset !== expectedChannelOffsets[record.channel]
      || typeof record.text !== 'string' || record.text.length > MAX_RECORD_CHARS || record.text.length === 0) return empty('unavailable')
    effectiveLatest = Math.max(effectiveLatest, record.sequence)
    parsedRecords.push(record)
    expectedRecordSequence++
    expectedGlobalOffset += record.text.length
    expectedChannelOffsets[record.channel] += record.text.length
  }
  if (afterSequence > effectiveLatest) return empty('invalid_cursor')
  const gaps: Array<{ from: number; to: number }> = []
  let expectedSequence = afterSequence + 1
  let stoppedForPage = false
  for (const record of parsedRecords) {
    if (record.sequence <= afterSequence) continue
    if (pageChars + record.text.length > maxChars) { stoppedForPage = true; break }
    if (record.sequence > expectedSequence) gaps.push({ from: expectedSequence, to: record.sequence - 1 })
    records.push(record)
    pageChars += record.text.length
    cursor = record.sequence
    expectedSequence = record.sequence + 1
  }
  if (!stoppedForPage && effectiveLatest >= expectedSequence) gaps.push({ from: expectedSequence, to: effectiveLatest })
  const nextCursor = !records.length && gaps.length ? gaps[gaps.length - 1]!.to : cursor
  return { schema: 'shell_stream_journal_v1', records, cursor: nextCursor, latestSequence: effectiveLatest, gap: gaps.length > 0,
    ...(gaps.length ? { gaps, gapStart: gaps[0]!.from, gapEnd: gaps[gaps.length - 1]!.to } : {}), finished, truncated,
    redactionConservative, incompleteTail, incomplete: incomplete || incompleteTail, gapUnknown: incomplete || incompleteTail || gapUnknown }
}
