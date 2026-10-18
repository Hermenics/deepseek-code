import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { MAX_STORED_SHELL_OUTPUT_CHARS } from './outputArtifact.js'
import { signalProcessGroup } from '../../utils/processGroup.js'
import { safeGraphemeEnd, safeGraphemeStart } from '../../utils/textBoundaries.js'

/** Removes terminal control sequences while keeping parser state across chunks. */
class AnsiStripper {
  private state: 'text' | 'escape' | 'csi' | 'osc' | 'oscEscape' | 'string' | 'stringEscape' = 'text'

  push(input: string, final = false): string {
    let output = ''
    for (const char of input) {
      const code = char.codePointAt(0)!
      switch (this.state) {
        case 'text':
          if (code === 0x1b) this.state = 'escape'
          else if (code === 0x9b) this.state = 'csi'
          else if (code === 0x9d) this.state = 'osc'
          else if (code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) this.state = 'string'
          else output += char
          break
        case 'escape':
          if (char === '[') this.state = 'csi'
          else if (char === ']') this.state = 'osc'
          else if (char === 'P' || char === 'X' || char === '^' || char === '_') this.state = 'string'
          else this.state = 'text'
          break
        case 'csi':
          if (code >= 0x40 && code <= 0x7e) this.state = 'text'
          break
        case 'osc':
          if (code === 0x07) this.state = 'text'
          else if (code === 0x9c) this.state = 'text'
          else if (code === 0x1b) this.state = 'oscEscape'
          break
        case 'oscEscape':
          this.state = char === '\\' ? 'text' : char === '\x1b' ? 'oscEscape' : 'osc'
          break
        case 'string':
          if (code === 0x9c) this.state = 'text'
          else if (code === 0x1b) this.state = 'stringEscape'
          break
        case 'stringEscape':
          this.state = char === '\\' ? 'text' : char === '\x1b' ? 'stringEscape' : 'string'
          break
      }
    }
    if (final && this.state !== 'text') this.state = 'text'
    return output
  }
}

export interface CapturedShellOutput {
  content: string
  preview: string
  totalChars: number
  /** Exact raw UTF-8 stream bytes observed before terminal control stripping. */
  totalBytes: number
  truncated: boolean
  drainTimedOut: boolean
  provenance: ShellStreamProvenance
}

export function shellCaptureCompletionState(processGroupSettled: 'settled' | 'unknown', drainTimedOut: boolean): 'completed' | 'unknown' {
  return processGroupSettled === 'settled' && !drainTimedOut ? 'completed' : 'unknown'
}

export interface ShellStreamProgress {
  preview: string
  totalChars: number
  totalBytes: number
  truncated: boolean
}

export interface ShellStreamSegment {
  sequence: number
  channel: 'stdout' | 'stderr'
  offset: number
  channelOffset: number
  length: number
}

export interface ShellStreamProvenance {
  schema: 'shell_channel_provenance_v1'
  ordering: 'observed-arrival'
  stdoutChars: number
  stderrChars: number
  retainedChars: number
  segments: ShellStreamSegment[]
  segmentsOmitted: number
  contentOmitted: number
  drainTimedOut: boolean
}

const MAX_PROVENANCE_SEGMENTS = 4096
const PREVIEW_SLICE_CHARS = 8_000
const MAX_PROGRESS_LINE_CHARS = 8_000
const DIAGNOSTIC_LINE = /\b(?:error(?:\b|_[A-Z0-9_]+)|fatal|exception|traceback|fail(?:ed|ure)?|panic(?:ked)?|module not found|no module named|modulenotfounderror|cannot find symbol|unresolved (?:reference|import)|undefined reference|caused by)\b|\b[A-Za-z][A-Za-z0-9_.]*(?:Error|Exception)\b|\bundefined:|\b(?:command not found|no such file or directory)\b|\bTS\d{4,5}\b|\bERR_[A-Z0-9_]+\b|\b(?:npm|pnpm|yarn)\s+ERR!|^\s*(?:make(?:\[\d+\])?:\s+\*\*\*|ninja:\s+build stopped)/i

function emptyProvenance(): ShellStreamProvenance {
  return { schema: 'shell_channel_provenance_v1', ordering: 'observed-arrival', stdoutChars: 0, stderrChars: 0,
    retainedChars: 0, segments: [], segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: false }
}

/** Compact standalone JSON summary; detailed offsets remain available through the output artifact. */
export function shellProvenanceSummary(provenance: ShellStreamProvenance): string {
  return JSON.stringify({ schema: provenance.schema, ordering: provenance.ordering,
    stdoutChars: provenance.stdoutChars, stderrChars: provenance.stderrChars,
    retainedSegments: provenance.segments.length, segmentsOmitted: provenance.segmentsOmitted,
    contentOmitted: provenance.contentOmitted, drainTimedOut: provenance.drainTimedOut })
}

/** Bounded head/middle/tail sampler for normalized, channel-local preview text. */
class PreviewSampler {
  private full: string | null = ''
  private head = ''
  private middle = ''
  private tail = ''
  private total = 0

  append(text: string): void {
    if (!text) return
    if (this.full !== null && this.total + text.length <= PREVIEW_SLICE_CHARS * 3) {
      this.full += text
      this.total += text.length
      return
    }
    if (this.full !== null) {
      const previous = this.full
      this.full = null
      this.total = 0
      this.appendSample(previous)
    }
    this.appendSample(text)
  }

  private appendSample(text: string): void {
    if (!text) return
    if (this.head.length < PREVIEW_SLICE_CHARS) this.head += text.slice(0, safeGraphemeEnd(text, PREVIEW_SLICE_CHARS - this.head.length))
    if (!this.middle && this.total + text.length > 1_000_000) {
      const start = Math.max(0, 1_000_000 - this.total)
      this.middle = text.slice(safeGraphemeStart(text, start), safeGraphemeEnd(text, start + PREVIEW_SLICE_CHARS))
    }
    const combined = this.tail + text
    this.tail = combined.slice(safeGraphemeStart(combined, combined.length - PREVIEW_SLICE_CHARS))
    this.total += text.length
  }

  render(): string {
    if (this.full !== null) return this.full
    const omitted = Math.max(0, this.total - this.head.length - this.middle.length - this.tail.length)
    return `${this.head}\n…[${omitted} characters omitted from this stream preview]…${this.middle ? `\n${this.middle}\n…[continued at final stream output]…` : ''}\n${this.tail}`
  }
}

/** Coalesces bare-CR progress updates in one stream without changing archived bytes or other channels. */
class ProgressPreviewChannel {
  private readonly sampler = new PreviewSampler()
  private previousLine = ''
  private diagnosticLines?: string[]
  private diagnosticFollow = 0
  private current = ''
  private head = ''
  private tail = ''
  private currentLength = 0
  private currentOverflow = false
  private hasCurrent = false
  private pendingCR = false

  push(text: string): void {
    let index = 0
    while (index < text.length) {
      if (this.pendingCR) {
        this.pendingCR = false
        if (text[index] === '\n') {
          this.commit('\n')
          index++
          continue
        }
        this.resetLine()
      }
      const carriageReturn = text.indexOf('\r', index)
      const lineFeed = text.indexOf('\n', index)
      const next = carriageReturn < 0 ? lineFeed : lineFeed < 0 ? carriageReturn : Math.min(carriageReturn, lineFeed)
      if (next < 0) { this.appendLine(text.slice(index)); return }
      if (next > index) this.appendLine(text.slice(index, next))
      if (text[next] === '\r') this.pendingCR = true
      else this.commit('\n')
      index = next + 1
    }
  }

  finish(): void {
    if (this.hasCurrent) this.commit('')
    this.pendingCR = false
  }

  render(): string {
    const sampled = this.sampler.render()
    if (!this.diagnosticLines?.length) return sampled
    const excerpt = this.diagnosticLines.join('\n')
    return sampled.includes(excerpt) ? sampled : `${sampled}\n[diagnostic excerpt (heuristic)]\n${excerpt}`
  }

  renderLive(): string {
    const sampled = this.sampler.render()
    const line = this.hasCurrent ? this.lineText() : ''
    const content = line ? `${sampled}${sampled ? '\n' : ''}${line}` : sampled
    if (!this.diagnosticLines?.length) return content
    const excerpt = this.diagnosticLines.join('\n')
    return content.includes(excerpt) ? content : `${content}\n[diagnostic excerpt (heuristic)]\n${excerpt}`
  }

  private appendLine(text: string): void {
    if (!text) return
    this.hasCurrent = true
    this.currentLength += text.length
    if (!this.currentOverflow && this.current.length + text.length <= MAX_PROGRESS_LINE_CHARS) {
      this.current += text
      return
    }
    if (!this.currentOverflow) {
      const half = MAX_PROGRESS_LINE_CHARS / 2
      this.head = this.current.slice(0, safeGraphemeEnd(this.current, half))
      this.tail = this.current.slice(safeGraphemeStart(this.current, this.current.length - half))
      this.current = ''
      this.currentOverflow = true
    }
    const combined = this.tail + text
    const start = Math.max(0, combined.length - MAX_PROGRESS_LINE_CHARS / 2)
    this.tail = combined.slice(safeGraphemeStart(combined, start))
  }

  private commit(ending: string): void {
    const line = this.hasCurrent ? this.lineText() : ''
    if (this.hasCurrent || ending) this.sampler.append(`${line}${ending}`)
    if (this.diagnosticLines && this.diagnosticFollow > 0) {
      if (line) this.diagnosticLines.push(line)
      this.diagnosticFollow--
    } else if (DIAGNOSTIC_LINE.test(line)) {
      this.diagnosticLines = [...(this.previousLine ? [this.previousLine] : []), line]
      this.diagnosticFollow = 1
    }
    if (line) this.previousLine = line
    this.resetLine()
  }

  private lineText(): string {
    if (!this.currentOverflow) return this.current
    const omitted = Math.max(0, this.currentLength - this.head.length - this.tail.length)
    return `${this.head}…[${omitted} characters omitted from progress line]…${this.tail}`
  }

  private resetLine(): void {
    this.current = ''
    this.head = ''
    this.tail = ''
    this.currentLength = 0
    this.currentOverflow = false
    this.hasCurrent = false
  }
}

export interface ShellProcessResult { exitCode: number; signal: NodeJS.Signals | null }

/** Waits on a streaming child and terminates its process group on timeout or cancellation. */
export function waitForShellProcess(child: ChildProcess, timeoutMs: number, signal?: AbortSignal): Promise<ShellProcessResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    let stopped = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const killGroup = (killSignal: NodeJS.Signals) => signalProcessGroup(child, killSignal)
    const cleanup = () => {
      clearTimeout(timeoutTimer)
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener('abort', onAbort)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const stop = (isTimeout: boolean) => {
      if (stopped || settled) return
      timedOut = isTimeout
      stopped = true
      killGroup('SIGTERM')
      killTimer = setTimeout(() => killGroup('SIGKILL'), 1000)
    }
    const onAbort = () => stop(false)
    const timeoutTimer = setTimeout(() => stop(true), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.once('spawn', () => { if (stopped) killGroup('SIGTERM') })
    child.once('error', error => fail(error))
    child.once('close', (code, childSignal) => {
      if (settled) return
      settled = true
      cleanup()
      if (timedOut) return reject(Object.assign(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s and was killed.`), { timedOut: true, signal: childSignal }))
      if (signal?.aborted) return reject(Object.assign(new Error('Command was cancelled.'), { cancelled: true, signal: childSignal }))
      if (code !== 0) return reject(Object.assign(new Error(`Command exited with code ${code ?? 'unknown'}.`), { exitCode: code ?? undefined, signal: childSignal }))
      resolve({ exitCode: 0, signal: childSignal })
    })
  })
}

/** Drains stdout/stderr incrementally; each channel keeps independent UTF-8 and ANSI decoder state. */
export async function captureShellStreams(
  stdout?: Readable | null,
  stderr?: Readable | null,
  processExited?: Promise<unknown>,
  onProgress?: (progress: ShellStreamProgress) => void,
  onStreamChunk?: (chunk: { text: string; channel: 'stdout' | 'stderr'; globalOffset: number; channelOffset: number }) => void,
  onOutputBytes?: (bytes: number) => void,
): Promise<CapturedShellOutput> {
  const streams = [
    { channel: 'stdout' as const, stream: stdout },
    { channel: 'stderr' as const, stream: stderr },
  ].filter((item): item is { channel: 'stdout' | 'stderr'; stream: Readable } => Boolean(item.stream))
  if (!streams.length) return { content: '', preview: '', totalChars: 0, totalBytes: 0, truncated: false, drainTimedOut: false, provenance: emptyProvenance() }
  const chunks: string[] = []
  const previewChannels = { stdout: new ProgressPreviewChannel(), stderr: new ProgressPreviewChannel() }
  const previewPending = { stdout: '', stderr: '' }
  const previewDisabled = { stdout: false, stderr: false }
  let pending: string[] = []
  let pendingChars = 0
  let storedChars = 0
  let totalChars = 0
  let totalBytes = 0
  let storageFull = false
  let graphemePending: Array<{ text: string; channel: 'stdout' | 'stderr'; globalOffset: number; channelOffset: number }> = []
  let graphemePendingChars = 0
  let lastProgressAt = 0
  const provenance = emptyProvenance()

  const renderProgress = () => {
    const stdoutPreview = `${previewChannels.stdout.renderLive()}${previewDisabled.stdout ? '\n[preview omitted after an oversized grapheme cluster]' : ''}`
    const stderrPreview = `${previewChannels.stderr.renderLive()}${previewDisabled.stderr ? '\n[preview omitted after an oversized grapheme cluster]' : ''}`
    const preview = stdoutPreview && stderrPreview
      ? `[stdout channel preview]\n${stdoutPreview}${stdoutPreview.endsWith('\n') ? '\n' : '\n\n'}[stderr channel preview]\n${stderrPreview}`
      : stdoutPreview || stderrPreview
    return { preview, totalChars, totalBytes, truncated: totalChars > storedChars + (storageFull ? 0 : graphemePendingChars) }
  }

  const recordSegment = (channel: 'stdout' | 'stderr', globalOffset: number, channelOffset: number, length: number) => {
    if (!length) return
    const previous = provenance.segments[provenance.segments.length - 1]
    if (previous && previous.channel === channel && previous.offset + previous.length === globalOffset &&
      previous.channelOffset + previous.length === channelOffset) {
      previous.length += length
      provenance.retainedChars += length
      return
    }
    if (provenance.segments.length >= MAX_PROVENANCE_SEGMENTS) {
      provenance.segmentsOmitted++
      return
    }
    provenance.segments.push({ sequence: provenance.segments.length + 1, channel, offset: globalOffset, channelOffset, length })
    provenance.retainedChars += length
  }

  const flush = () => {
    if (!pendingChars) return
    chunks.push(pending.join(''))
    pending = []
    pendingChars = 0
  }

  const retainPreview = (text: string, channel: 'stdout' | 'stderr') => {
    if (previewDisabled[channel]) return
    const combined = previewPending[channel] + text
    const complete = combined.length ? safeGraphemeEnd(combined, combined.length - 1) : 0
    if (complete) previewChannels[channel].push(combined.slice(0, complete))
    previewPending[channel] = combined.slice(complete)
    if (previewPending[channel].length > MAX_PROGRESS_LINE_CHARS) {
      previewPending[channel] = ''
      previewDisabled[channel] = true
    }
  }

  const commitCaptureParts = (parts: typeof graphemePending) => {
    for (const part of parts) {
      recordSegment(part.channel, part.globalOffset, part.channelOffset, part.text.length)
      pending.push(part.text)
      pendingChars += part.text.length
      storedChars += part.text.length
      if (pendingChars >= 65_536) flush()
    }
  }

  const splitCaptureParts = (parts: typeof graphemePending, offset: number): [typeof graphemePending, typeof graphemePending] => {
    const prefix: typeof graphemePending = []
    const suffix: typeof graphemePending = []
    let remaining = offset
    for (const part of parts) {
      if (remaining >= part.text.length) {
        prefix.push(part)
        remaining -= part.text.length
      } else if (remaining > 0) {
        prefix.push({ ...part, text: part.text.slice(0, remaining) })
        suffix.push({ ...part, text: part.text.slice(remaining), globalOffset: part.globalOffset + remaining, channelOffset: part.channelOffset + remaining })
        remaining = 0
      } else suffix.push(part)
    }
    return [prefix, suffix]
  }

  const retainCapture = (part: (typeof graphemePending)[number]) => {
    if (storageFull) return
    const parts = [...graphemePending, part]
    const combined = parts.map(value => value.text).join('')
    const completePrefix = combined.length ? safeGraphemeEnd(combined, combined.length - 1) : 0
    const capacity = MAX_STORED_SHELL_OUTPUT_CHARS - storedChars
    const commitLength = safeGraphemeEnd(combined, Math.min(completePrefix, capacity))
    const [complete, remainder] = splitCaptureParts(parts, commitLength)
    commitCaptureParts(complete)
    graphemePending = remainder
    graphemePendingChars = remainder.reduce((total, value) => total + value.text.length, 0)
    if (commitLength < completePrefix || storedChars + graphemePendingChars > MAX_STORED_SHELL_OUTPUT_CHARS) {
      storageFull = true
      graphemePending = []
      graphemePendingChars = 0
    }
  }

  const retain = (text: string, channel: 'stdout' | 'stderr') => {
    if (!text) return
    retainPreview(text, channel)
    const channelOffset = provenance[`${channel}Chars`]
    const globalOffset = totalChars
    totalChars += text.length
    provenance[`${channel}Chars`] += text.length
    retainCapture({ text, channel, globalOffset, channelOffset })
    try { onStreamChunk?.({ text, channel, globalOffset, channelOffset }) } catch { /* Journal failure must never stop draining a child pipe. */ }
    if (onProgress && Date.now() - lastProgressAt >= 200) {
      lastProgressAt = Date.now()
      onProgress(renderProgress())
    }
  }

  const drains = streams.map(async ({ stream, channel }) => {
    const decoder = new StringDecoder('utf8')
    const ansi = new AnsiStripper()
    stream.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length
      try { onOutputBytes?.(buffer.length) } catch { /* A quota observer must never stop draining a child pipe. */ }
      retain(ansi.push(decoder.write(buffer)), channel)
    })
    stream.on('end', () => retain(ansi.push(decoder.end(), true), channel))
    const ended = new Promise<void>((resolve, reject) => {
      const finish = () => { stream.removeListener('error', reject); resolve() }
      stream.once('end', finish)
      stream.once('close', finish)
      stream.once('error', reject)
    })
    stream.resume()
    await ended
  })
  let drainTimedOut = false
  const drained = Promise.all(drains).then(() => true, () => false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = async () => {
    if (processExited) await processExited
    return Promise.race([drained, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 3000) })])
  }
  const drainResult = await Promise.race([drained, deadline()])
  if (timer) clearTimeout(timer)
  if (!drainResult) {
    drainTimedOut = true
    for (const { stream } of streams) stream.destroy()
  }
  if (!storageFull && graphemePending.length) {
    if (storedChars + graphemePendingChars <= MAX_STORED_SHELL_OUTPUT_CHARS) commitCaptureParts(graphemePending)
    else storageFull = true
  }
  graphemePending = []
  graphemePendingChars = 0
  for (const channel of ['stdout', 'stderr'] as const) {
    if (!previewDisabled[channel] && previewPending[channel]) previewChannels[channel].push(previewPending[channel])
    previewPending[channel] = ''
  }
  provenance.contentOmitted = Math.max(0, totalChars - storedChars)
  provenance.drainTimedOut = drainTimedOut
  flush()
  previewChannels.stdout.finish()
  previewChannels.stderr.finish()
  const truncated = totalChars > storedChars || drainTimedOut
  const preview = renderProgress().preview
  return { content: chunks.join(''), preview, totalChars, totalBytes, truncated, drainTimedOut, provenance }
}

