import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { Shell } from '../src/tools/Shell/Shell.js'
import { captureShellStreams } from '../src/tools/Shell/streamCapture.js'
import { readShellStreamJournalPage, ShellStreamJournal, ShellStreamJournalRedactor } from '../src/tools/Shell/streamJournal.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function temporaryJournal(name: string): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), `deepseek-shell-stream-${name}-`))
  roots.push(root)
  return { root, path: join(root, 'task.stream.jsonl') }
}

describe('detached shell stream journal', () => {
  it('redacts split assignments, API tokens, and PEM blocks while preserving arrival provenance', async () => {
    const { path } = await temporaryJournal('redaction')
    const journal = new ShellStreamJournal(path)
    await journal.open()
    const expectedChannelOffsets = { stdout: 0, stderr: 0 }
    let globalOffset = 0
    const push = (channel: 'stdout' | 'stderr', text: string) => {
      journal.push({ channel, text, globalOffset, channelOffset: expectedChannelOffsets[channel] })
      globalOffset += text.length
      expectedChannelOffsets[channel] += text.length
    }

    push('stdout', 'head\napi_key="sk-abcdefghijkl')
    push('stderr', 'diagnostic\n-----BEGIN PRIVATE KEY-----\nprivate-')
    push('stdout', 'mnopqrstuvwx"\ntail\n')
    push('stderr', 'key-material\n-----END PRIVATE KEY-----\n')
    await journal.finish()

    const page = await readShellStreamJournalPage(path, 0, journal.stats().latestSequence, true,
      journal.stats().truncated, journal.stats().redactionConservative)
    const records = page.records
    const recovered = records.map(record => record.text).join('')
    const byChannel = { stdout: '', stderr: '' }
    for (const record of records) byChannel[record.channel] += record.text
    expect(recovered).toContain('head')
    expect(recovered).toContain('tail')
    expect(recovered).toContain('diagnostic')
    expect(recovered).not.toContain('sk-abcdefghijklmnopqrstuvwx')
    expect(recovered).not.toContain('private-key-material')
    expect(byChannel.stdout).toContain(`api_key="${'*'.repeat('sk-abcdefghijklmnopqrstuvwx'.length)}"`)
    expect(byChannel.stderr).not.toContain('private-')
    expect(records.map(record => record.sequence)).toEqual(records.map((_, index) => index + 1))

    let observedOffset = 0
    const observedChannelOffsets = { stdout: 0, stderr: 0 }
    for (const record of records) {
      expect(record.globalOffset).toBe(observedOffset)
      expect(record.channelOffset).toBe(observedChannelOffsets[record.channel])
      observedOffset += record.text.length
      observedChannelOffsets[record.channel] += record.text.length
    }
    expect(observedOffset).toBe(globalOffset)
    expect(observedChannelOffsets).toEqual(expectedChannelOffsets)
  })

  it('keeps masking PEM content after another key begins on the same line', () => {
    const parts: string[] = []
    const redactor = new ShellStreamJournalRedactor(part => parts.push(part.text))
    const text = '-----BEGIN PRIVATE KEY-----first-----END PRIVATE KEY----------BEGIN PRIVATE KEY-----\nsecond-secret-line\n'
    redactor.push({ channel: 'stdout', globalOffset: 0, channelOffset: 0, text })
    redactor.finish()
    expect(parts.join('')).not.toContain('second-secret-line')
    expect(parts.join('')).toHaveLength(text.length)

    const afterExistingKey: string[] = []
    const secondRedactor = new ShellStreamJournalRedactor(part => afterExistingKey.push(part.text))
    const firstLine = '-----BEGIN PRIVATE KEY-----\n'
    const secondLine = '-----END PRIVATE KEY----------BEGIN PRIVATE KEY-----\n'
    const finalLine = 'second-key-body\n'
    secondRedactor.push({ channel: 'stdout', globalOffset: 0, channelOffset: 0, text: firstLine })
    secondRedactor.push({ channel: 'stdout', globalOffset: firstLine.length, channelOffset: firstLine.length, text: secondLine })
    secondRedactor.push({ channel: 'stdout', globalOffset: firstLine.length + secondLine.length,
      channelOffset: firstLine.length + secondLine.length, text: finalLine })
    secondRedactor.finish()
    expect(afterExistingKey.join('')).not.toContain('second-key-body')
    expect(afterExistingKey.join('')).toHaveLength(firstLine.length + secondLine.length + finalLine.length)
  })

  it('redacts secrets assembled across pipe chunks and interleaved channels before persistence', async () => {
    const { path } = await temporaryJournal('capture')
    const journal = new ShellStreamJournal(path)
    await journal.open()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const captured = captureShellStreams(stdout, stderr, undefined, undefined, chunk => journal.push(chunk))
    stdout.write('api_key=first')
    stderr.write('diagnostic\n')
    stdout.end('secrettail\nordinary\n')
    stderr.end()
    const capture = await captured
    await journal.finish()

    const rawJournal = await readShellStreamJournalPage(path, 0, journal.stats().latestSequence, true,
      journal.stats().truncated, journal.stats().redactionConservative)
    const persisted = rawJournal.records.map(record => record.text).join('')
    expect(capture.content).toContain('diagnostic')
    expect(capture.content).toContain('secrettail')
    expect(persisted).not.toContain('firstsecrettail')
    expect(persisted).toContain('diagnostic')
    const outputByChannel = { stdout: '', stderr: '' }
    for (const record of rawJournal.records) outputByChannel[record.channel] += record.text
    expect(outputByChannel.stdout).not.toContain('firstsecrettail')
    expect(outputByChannel.stdout).toMatch(/api_key=\*+/)
    expect(persisted).toContain('ordinary')
    expect(rawJournal.records.every(record => record.text.length <= 512)).toBe(true)
  })

  it('keeps assignment redaction state isolated when another channel emits a newline', async () => {
    const { path } = await temporaryJournal('channel-redaction-state')
    const journal = new ShellStreamJournal(path)
    await journal.open()
    const offsets = { stdout: 0, stderr: 0 }
    let globalOffset = 0
    const push = (channel: 'stdout' | 'stderr', text: string) => {
      journal.push({ channel, text, globalOffset, channelOffset: offsets[channel] })
      globalOffset += text.length
      offsets[channel] += text.length
    }

    push('stdout', 'API_KEY=')
    push('stderr', 'diagnostic\n')
    push('stdout', 'cross-channel-canary\n')
    await journal.finish()

    const page = await readShellStreamJournalPage(path, 0, journal.stats().latestSequence, true,
      journal.stats().truncated, journal.stats().redactionConservative)
    const outputByChannel = { stdout: '', stderr: '' }
    for (const record of page.records) outputByChannel[record.channel] += record.text
    expect(outputByChannel.stdout).toBe(`API_KEY=${'*'.repeat('cross-channel-canary'.length)}\n`)
    expect(outputByChannel.stderr).toBe('diagnostic\n')
    expect(page.records.map(record => record.globalOffset + record.text.length).at(-1)).toBe(globalOffset)
  })

  it('pages by sequence cursor and reports known sequence gaps after backpressure drops', async () => {
    const { path } = await temporaryJournal('cursor')
    const journal = new ShellStreamJournal(path)
    await journal.open()
    journal.push({ channel: 'stdout', globalOffset: 0, channelOffset: 0, text: `${'a'.repeat(600)}\n` })
    journal.push({ channel: 'stderr', globalOffset: 601, channelOffset: 0, text: `${'b'.repeat(600)}\n` })
    await journal.finish()

    const first = await readShellStreamJournalPage(path, 0, journal.stats().latestSequence, true, false, false, 512)
    expect(first.records).toHaveLength(1)
    expect(first.records[0]).toMatchObject({ sequence: 1, channel: 'stdout', globalOffset: 0, channelOffset: 0 })
    expect(first.cursor).toBe(1)
    const second = await readShellStreamJournalPage(path, first.cursor, journal.stats().latestSequence, true, false, false, 512)
    expect(second.records[0]).toMatchObject({ sequence: 2, channel: 'stdout', globalOffset: 512, channelOffset: 512 })
    expect(second.cursor).toBeGreaterThan(1)
    expect((await readShellStreamJournalPage(path, 10_000, journal.stats().latestSequence, true, false, false)).error).toBe('invalid_cursor')

    const { path: droppedPath } = await temporaryJournal('dropped')
    const dropped = new ShellStreamJournal(droppedPath, { maxQueueBytes: 1 })
    await dropped.open()
    dropped.push({ channel: 'stdout', globalOffset: 0, channelOffset: 0, text: 'lost output\n' })
    await dropped.finish()
    const gap = await readShellStreamJournalPage(droppedPath, 0, dropped.stats().latestSequence, true,
      dropped.stats().truncated, dropped.stats().redactionConservative)
    expect(gap.records).toEqual([])
    expect(gap).toMatchObject({ gap: true, gaps: [{ from: 1, to: 1 }], cursor: 1, truncated: true })
  })

  it('bounds a stalled writer queue, marks unknown gaps, and returns without waiting for storage', async () => {
    const { path } = await temporaryJournal('backpressure')
    let releaseWrite!: () => void
    let startedWrite!: () => void
    const started = new Promise<void>(resolve => { startedWrite = resolve })
    const blocked = new Promise<void>(resolve => { releaseWrite = resolve })
    const journal = new ShellStreamJournal(path, { maxQueueBytes: 1_000, writeRecord: async (file, value) => {
      startedWrite()
      await blocked
      await file.write(value, undefined, 'utf8')
    } })
    await journal.open()
    journal.push({ channel: 'stdout', globalOffset: 0, channelOffset: 0, text: `${'x'.repeat(2_000)}\n` })
    await started
    expect(journal.stats().bytes).toBeLessThanOrEqual(2_000_000)
    expect(journal.stats().droppedRecords).toBeGreaterThan(0)
    const finishedWithoutStorage = await Promise.race([
      journal.finish(5).then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100)),
    ])
    expect(finishedWithoutStorage).toBe(true)
    expect(journal.stats().gapUnknown).toBe(true)
    releaseWrite()
    const page = await readShellStreamJournalPage(path, 0, journal.stats().latestSequence, true,
      journal.stats().truncated, journal.stats().redactionConservative, undefined, false, journal.stats().gapUnknown)
    expect(page.truncated).toBe(true)
    expect(page.gap).toBe(false)
    expect(page.gapUnknown).toBe(true)
  })

  it('reports expired journals rather than treating them as complete output', async () => {
    const { path } = await temporaryJournal('expired')
    const journal = new ShellStreamJournal(path)
    await journal.open()
    journal.push({ channel: 'stdout', globalOffset: 0, channelOffset: 0, text: 'done\n' })
    await journal.finish()
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000)
    await utimes(path, old, old)
    expect((await readShellStreamJournalPage(path, 0, journal.stats().latestSequence, true, false, false)).error).toBe('expired')
  })

  it('masks the remainder after an oversized unresolved line', async () => {
    const parts: string[] = []
    const redactor = new ShellStreamJournalRedactor(part => parts.push(part.text), 8)
    redactor.push({ channel: 'stdout', globalOffset: 0, channelOffset: 0, text: 'password=canary\nvisible\n' })
    redactor.finish()
    expect(parts.join('')).not.toContain('canary')
    expect(parts.join('')).not.toContain('visible')
    expect(redactor.redactionConservative).toBe(true)
  })

  it('exposes detached output through the shell cursor API without executing a command', async () => {
    const properties = (Shell.parameters as { properties: Record<string, unknown> }).properties
    expect(properties.stream_task_id).toBeDefined()
    expect(properties.stream_cursor).toBeDefined()
    expect(properties.stream_max_chars).toBeDefined()
  })
})
