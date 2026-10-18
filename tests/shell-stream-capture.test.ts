import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { captureShellStreams, shellCaptureCompletionState, waitForShellProcess } from '../src/tools/Shell/streamCapture.js'
import { MAX_STORED_SHELL_OUTPUT_CHARS, readShellOutput, readShellOutputProvenance, saveShellOutput } from '../src/tools/Shell/outputArtifact.js'
import { Shell } from '../src/tools/Shell/Shell.js'
import { clearBinaryCache, sandboxAvailable } from '../src/utils/platform.js'

const itWithSandbox = it.skipIf(!sandboxAvailable())

describe('bounded shell output capture', () => {
  it('ends C1 OSC sequences on C1 ST and captures following text', async () => {
    const stream = new PassThrough()
    const capturePromise = captureShellStreams(stream)
    stream.write('\u009D0;title')
    stream.end('\u009Cvisible')

    const capture = await capturePromise
    expect(capture.content).toBe('visible')
  })

  it('strips split ANSI control sequences at every chunk boundary', async () => {
    const cases = [
      { name: '7-bit CSI', input: 'before\x1b[31mhidden\x1b[0mafter', expected: 'beforehiddenafter' },
      { name: 'C1 CSI', input: 'before\u009B31mhidden\u009B0mafter', expected: 'beforehiddenafter' },
      { name: '7-bit OSC with BEL', input: 'before\x1b]0;secret\x07after', expected: 'beforeafter' },
      { name: '7-bit OSC with ST', input: 'before\x1b]0;secret\x1b\\after', expected: 'beforeafter' },
      { name: 'C1 OSC with BEL', input: 'before\u009D0;secret\x07after', expected: 'beforeafter' },
      { name: 'C1 OSC with ST', input: 'before\u009D0;secret\u009Cafter', expected: 'beforeafter' },
      { name: '7-bit DCS', input: 'before\x1bPsecret\x1b\\after', expected: 'beforeafter' },
      { name: 'C1 DCS', input: 'before\u0090secret\u009Cafter', expected: 'beforeafter' },
      { name: '7-bit SOS', input: 'before\x1bXsecret\x1b\\after', expected: 'beforeafter' },
      { name: 'C1 SOS', input: 'before\u0098secret\u009Cafter', expected: 'beforeafter' },
      { name: '7-bit PM', input: 'before\x1b^secret\x1b\\after', expected: 'beforeafter' },
      { name: 'C1 PM', input: 'before\u009Esecret\u009Cafter', expected: 'beforeafter' },
      { name: '7-bit APC', input: 'before\x1b_secret\x1b\\after', expected: 'beforeafter' },
      { name: 'C1 APC', input: 'before\u009Fsecret\u009Cafter', expected: 'beforeafter' },
    ]
    const failures: string[] = []

    for (const sequence of cases) {
      for (let split = 1; split < sequence.input.length; split++) {
        const stream = new PassThrough()
        const capturePromise = captureShellStreams(stream)
        stream.write(sequence.input.slice(0, split))
        stream.end(sequence.input.slice(split))
        const capture = await capturePromise
        if (capture.content !== sequence.expected && !failures.some(failure => failure.startsWith(`${sequence.name}:`))) {
          failures.push(`${sequence.name}: split at ${split}/${sequence.input.length} produced ${JSON.stringify(capture.content)}`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('reports bounded live previews as output arrives', async () => {
    const stream = new PassThrough()
    const updates: Array<{ preview: string; totalChars: number; totalBytes: number; truncated: boolean }> = []
    const capturePromise = captureShellStreams(stream, undefined, undefined, progress => updates.push(progress))
    stream.write('live-preview')
    await new Promise(resolve => setTimeout(resolve, 210))
    stream.end(' complete')
    const capture = await capturePromise
    expect(updates.some(update => update.preview.includes('live-preview'))).toBe(true)
    expect(updates.at(-1)).toMatchObject({ totalChars: 'live-preview complete'.length, totalBytes: Buffer.byteLength('live-preview complete'), truncated: false })
    expect(capture.content).toBe('live-preview complete')
  })

  it('reports exact raw stream bytes incrementally without affecting draining', async () => {
    const stream = new PassThrough()
    const observed: number[] = []
    const capturePromise = captureShellStreams(undefined, stream, undefined, undefined, undefined, bytes => {
      observed.push(bytes)
    })
    stream.write(Buffer.from('\x1b[31mé'))
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(observed).toEqual([Buffer.byteLength('\x1b[31mé')])
    stream.end(Buffer.from('\x1b[0m😀'))

    const capture = await capturePromise
    expect(capture.content).toBe('é😀')
    expect(capture.totalBytes).toBe(observed.reduce((total, bytes) => total + bytes, 0))
    expect(capture.totalBytes).toBe(Buffer.byteLength('\x1b[31mé\x1b[0m😀'))
  })

  it('keeps draining all output when the aggregate budget observer reports exhaustion', async () => {
    const stream = new PassThrough()
    const observed: number[] = []
    const capturePromise = captureShellStreams(undefined, stream, undefined, undefined, undefined, bytes => {
      observed.push(bytes)
      return false
    })
    stream.write('first chunk')
    await new Promise<void>(resolve => setImmediate(resolve))
    stream.end(' and final chunk')

    const capture = await capturePromise
    expect(capture.content).toBe('first chunk and final chunk')
    expect(observed.reduce((total, bytes) => total + bytes, 0)).toBe(Buffer.byteLength(capture.content))
  })

  it('preserves interleaved stream order, split UTF-8/ANSI, and bounded channel provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-provenance-'))
    const recoveryRoot = join(root, '.deepseek-code', 'shell-output-recovery')
    try {
    const child = spawn(process.execPath, ['-e', `
      process.stdout.write(Buffer.from([0xF0, 0x9F]));
      setTimeout(() => process.stderr.write('err'), 5);
      setTimeout(() => process.stdout.write(Buffer.from([0x98, 0x80])), 10);
      setTimeout(() => process.stdout.write('\\x1b[31mred\\x1b[0m'), 12);
      setTimeout(() => process.stderr.write('last'), 15);
    `], { stdio: ['ignore', 'pipe', 'pipe'] })
    const capturePromise = captureShellStreams(child.stdout, child.stderr)
    await child
    const capture = await capturePromise
    for (const text of ['😀', 'red', 'err', 'last']) expect(capture.content).toContain(text)
    expect(capture.totalChars).toBe(capture.content.length)
    expect(capture.totalBytes).toBe(23)
    expect(capture.truncated).toBe(false)
    expect(capture.provenance.ordering).toBe('observed-arrival')
    expect(capture.provenance.stdoutChars).toBe('😀red'.length)
    expect(capture.provenance.stderrChars).toBe('errlast'.length)
    const channelContent = { stdout: '', stderr: '' }
    let offset = 0
    for (const [index, segment] of capture.provenance.segments.entries()) {
      expect(segment.sequence).toBe(index + 1)
      expect(segment.offset).toBe(offset)
      channelContent[segment.channel] += capture.content.slice(offset, offset + segment.length)
      offset += segment.length
    }
    expect(offset).toBe(capture.content.length)
    expect(channelContent).toEqual({ stdout: '😀red', stderr: 'errlast' })

    const artifact = await saveShellOutput('provenance-session', capture.content, capture.totalChars, root, capture.provenance, recoveryRoot)
    const page = JSON.parse(await readShellOutputProvenance('provenance-session', artifact.id, 0, root, recoveryRoot))
    expect(page.ordering).toBe('observed-arrival')
    expect(page.segments).toEqual(capture.provenance.segments)
    expect(await readShellOutput('provenance-session', artifact.id, 0, 512, root, recoveryRoot)).toContain(capture.content)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps original capture bounded and reports omitted output in the recoverable artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-capture-'))
    const recoveryRoot = join(root, '.deepseek-code', 'shell-output-recovery')
    try {
      const child = spawn(process.execPath, ['-e', `process.stdout.write('HEAD' + 'a'.repeat(${MAX_STORED_SHELL_OUTPUT_CHARS + 1000}) + 'FINAL-TAIL')`], { stdio: ['ignore', 'pipe', 'pipe'] })
      const capturePromise = captureShellStreams(child.stdout, child.stderr)
      await waitForShellProcess(child, 5000)
      const capture = await capturePromise
      expect(capture.content.length).toBe(MAX_STORED_SHELL_OUTPUT_CHARS)
      expect(capture.totalChars).toBe(MAX_STORED_SHELL_OUTPUT_CHARS + 1014)
      expect(capture.truncated).toBe(true)
      expect(capture.preview).toContain('FINAL-TAIL')

      const artifact = await saveShellOutput('test-session', capture.content, capture.totalChars, root, undefined, recoveryRoot)
      expect(artifact.metadata.truncated).toBe(true)
      expect(await readShellOutput('test-session', artifact.id, 0, 512, root, recoveryRoot)).toContain('storage cap: only the first')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not split a grapheme that crosses stream chunks at the storage cap', async () => {
    const stream = new PassThrough()
    const capturePromise = captureShellStreams(stream)
    stream.write(`${'a'.repeat(MAX_STORED_SHELL_OUTPUT_CHARS - 1)}e`)
    await new Promise(resolve => setImmediate(resolve))
    stream.end('\u0301z')

    const capture = await capturePromise
    expect(capture.content).toBe('a'.repeat(MAX_STORED_SHELL_OUTPUT_CHARS - 1))
    expect(capture.totalChars).toBe(MAX_STORED_SHELL_OUTPUT_CHARS + 2)
    expect(capture.truncated).toBe(true)
    expect(capture.provenance.retainedChars).toBe(capture.content.length)
  })

  it('keeps streamed graphemes intact when the bounded preview reaches its head cut', async () => {
    const stream = new PassThrough()
    const capturePromise = captureShellStreams(stream)
    stream.write(`${'x'.repeat(7_999)}e`)
    await new Promise(resolve => setImmediate(resolve))
    stream.end(`\u0301${'z'.repeat(25_000)}`)

    const capture = await capturePromise
    const previewHead = capture.preview.split('\n')[0]!
    expect(previewHead.endsWith('e')).toBe(false)
    expect(capture.content).toContain('e\u0301')
  })

  it('keeps one bounded diagnostic excerpt outside positional samples', async () => {
    const lines = Array.from({ length: 700 }, (_, index) => `line-${index} ${'x'.repeat(1_980)}`)
    lines[90] = 'ERROR_DIAGNOSTIC_SENTINEL: compiler issue in target.ts:17'
    const output = lines.join('\n')
    const stream = new PassThrough()
    const capturePromise = captureShellStreams(stream)
    stream.end(output)

    const capture = await capturePromise
    expect(capture.content).toBe(output)
    expect(capture.preview).toContain('[diagnostic excerpt (heuristic)]')
    expect(capture.preview).toContain('ERROR_DIAGNOSTIC_SENTINEL')
    expect(capture.preview.length).toBeLessThan(50_000)
  })

  it('recognizes common diagnostics from test runners, build tools, and language runtimes', async () => {
    const markers = [
      'FAIL tests/parser.test.ts > rejects invalid syntax',
      'make[1]: *** [Makefile:4: test] Error 1',
      'ModuleNotFoundError: No module named package_name',
      'undefined: missingFunction',
      "thread 'main' panicked at src/main.rs:12:4: index out of bounds",
      'TypeError: Cannot read properties of undefined',
      'java.lang.IllegalStateException: broken invariant',
      'Caused by: java.net.ConnectException: connection refused',
      'E   AssertionError: expected 2 but got 1',
      'undefined reference to `main`',
    ]
    for (const marker of markers) {
      const lines = Array.from({ length: 100 }, (_, index) => `line-${index} ${'x'.repeat(400)}`)
      lines[25] = marker
      const stream = new PassThrough()
      const capturePromise = captureShellStreams(stream)
      stream.end(lines.join('\n'))
      const capture = await capturePromise
      expect(capture.preview).toContain('[diagnostic excerpt (heuristic)]')
      expect(capture.preview).toContain(marker)
    }
  })

  it('does not accumulate output from a nonzero or timed out process into an unbounded buffer', async () => {
    const failed = spawn(process.execPath, ['-e', `process.stderr.write('failed'); process.exit(7)`], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const failedCapture = captureShellStreams(failed.stdout, failed.stderr)
    await expect(waitForShellProcess(failed, 5000)).rejects.toMatchObject({ exitCode: 7 })
    expect((await failedCapture).content).toBe('failed')

    const timed = spawn(process.execPath, ['-e', `process.stdout.write('started'); setInterval(() => process.stdout.write('x'.repeat(4096)), 1)`], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const timedCapture = captureShellStreams(timed.stdout, timed.stderr)
    await expect(waitForShellProcess(timed, 30)).rejects.toMatchObject({ timedOut: true })
    expect((await timedCapture).content.length).toBeLessThanOrEqual(MAX_STORED_SHELL_OUTPUT_CHARS)
  })

  it('cancels the full process group instead of leaving a child holding output pipes open', async () => {
    const child = spawn(process.execPath, ['-e', `const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)`], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const capturePromise = captureShellStreams(child.stdout, child.stderr)
    const controller = new AbortController()
    const result = waitForShellProcess(child, 5000, controller.signal)
    setTimeout(() => controller.abort(new Error('test stop')), 30)
    await expect(result).rejects.toMatchObject({ cancelled: true })
    expect((await capturePromise).drainTimedOut).toBe(false)
  })

  it('returns a declared incomplete result when output pipes miss the drain deadline', async () => {
    const pipe = new PassThrough()
    pipe.write('partial output')
    const result = await captureShellStreams(pipe)
    expect(result.content).toBe('partial output')
    expect(result.truncated).toBe(true)
    expect(result.drainTimedOut).toBe(true)
    expect(shellCaptureCompletionState('settled', result.drainTimedOut)).toBe('unknown')
    expect(pipe.destroyed).toBe(true)
  })

  it('requires a settled process group and completed pipe drain before declaring completion', () => {
    expect(shellCaptureCompletionState('settled', false)).toBe('completed')
    expect(shellCaptureCompletionState('unknown', false)).toBe('unknown')
    expect(shellCaptureCompletionState('settled', true)).toBe('unknown')
  })

  it('caps provenance segments and declares channel attribution loss', async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const capturePromise = captureShellStreams(stdout, stderr)
    await new Promise<void>(resolve => setImmediate(resolve))
    for (let index = 0; index < 4_200; index++) (index % 2 ? stdout : stderr).write('x')
    stdout.end()
    stderr.end()
    const result = await capturePromise
    expect(result.provenance.segments.length).toBeLessThanOrEqual(4096)
    expect(result.provenance.segmentsOmitted).toBeGreaterThan(0)
    expect(result.provenance.retainedChars + result.provenance.contentOmitted).toBeLessThanOrEqual(result.totalChars)

    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-provenance-page-'))
    const recoveryRoot = join(root, '.deepseek-code', 'shell-output-recovery')
    try {
      const artifact = await saveShellOutput('provenance-page-session', result.content, result.totalChars, root, result.provenance, recoveryRoot)
      const firstPageText = await readShellOutputProvenance('provenance-page-session', artifact.id, 0, root, recoveryRoot)
      expect(Buffer.byteLength(firstPageText, 'utf8')).toBeLessThanOrEqual(20_000)
      const firstPage = JSON.parse(firstPageText)
      expect(firstPage.segments.length).toBeGreaterThan(0)
      expect(firstPage.nextSegment).toBe(firstPage.segments.length)
      const secondPage = JSON.parse(await readShellOutputProvenance('provenance-page-session', artifact.id, firstPage.nextSegment, root, recoveryRoot))
      expect(secondPage.startSegment).toBe(firstPage.nextSegment)
      expect(secondPage.ordering).toBe('observed-arrival')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('labels a stderr-only stream as stderr in provenance', async () => {
    const stderr = new PassThrough()
    const capture = captureShellStreams(undefined, stderr)
    stderr.end('diagnostic')
    expect((await capture).provenance.segments[0]).toMatchObject({ channel: 'stderr', offset: 0, channelOffset: 0, length: 10 })
  })

  it('coalesces split progress carriage returns only in independent channel previews', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-progress-'))
    const recoveryRoot = join(root, '.deepseek-code', 'shell-output-recovery')
    try {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      const capturePromise = captureShellStreams(stdout, stderr)
      await new Promise<void>(resolve => setImmediate(resolve))
      stdout.write('10%')
      stderr.write('warning 1')
      stdout.write('\r')
      stderr.write('\r')
      stdout.write('20')
      stderr.write('warning 2')
      stdout.write('%\nDone\n')
      stderr.write('\n')
      stdout.end()
      stderr.end()
      const capture = await capturePromise
      expect(capture.content).toBe('10%warning 1\r\r20warning 2%\nDone\n\n')
      expect(capture.preview).toBe('[stdout channel preview]\n20%\nDone\n\n[stderr channel preview]\nwarning 2\n')

      const artifact = await saveShellOutput('progress-session', capture.content, capture.totalChars, root, capture.provenance, recoveryRoot)
      expect(await readShellOutput('progress-session', artifact.id, 0, 512, root, recoveryRoot)).toContain(capture.content)
      const provenance = JSON.parse(await readShellOutputProvenance('progress-session', artifact.id, 0, root, recoveryRoot))
      expect(provenance.retainedChars).toBe(capture.content.length)
      expect(provenance.segments[0].channel).toBe('stdout')
      expect(provenance.segments.some((segment: { channel: string }) => segment.channel === 'stderr')).toBe(true)
      expect(provenance.segments.reduce((sum: number, segment: { length: number }) => sum + segment.length, 0)).toBe(capture.content.length)
      expect(provenance.segments.every((segment: { offset: number }, index: number) => index === 0 || segment.offset >= provenance.segments[index - 1].offset + provenance.segments[index - 1].length)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves ordinary CRLF lines in the model preview', async () => {
    const stdout = new PassThrough()
    const capturePromise = captureShellStreams(stdout)
    await new Promise<void>(resolve => setImmediate(resolve))
    stdout.write('first line\r')
    stdout.write('\nsecond line\r\n')
    stdout.end()
    const capture = await capturePromise
    expect(capture.content).toBe('first line\r\nsecond line\r\n')
    expect(capture.preview).toBe('first line\nsecond line\n')
  })

  it('refuses command execution without an owning runtime context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-no-context-'))
    const marker = join(root, 'executed')
    try {
      const result = await Shell.execute({ command: `printf unauthorized > '${marker}'` })
      expect(result).toContain('requires an owning runtime context')
      expect(existsSync(marker)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses contextual command execution when the OS sandbox is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-no-sandbox-'))
    const marker = join(root, 'executed')
    const emptyPath = join(root, 'empty-path')
    const previousPath = process.env.PATH
    const context = { sessionId: 'no-sandbox-session', workspacePath: root, projectRoot: root, permissionProfile: 'coordinator-integrator' as const }
    try {
      await mkdir(emptyPath)
      process.env.PATH = emptyPath
      clearBinaryCache()
      const result = await Shell.execute({ command: `printf unauthorized > '${marker}'` }, context)
      expect(result).toContain('sandbox unavailable')
      expect(existsSync(marker)).toBe(false)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      clearBinaryCache()
      await rm(root, { recursive: true, force: true })
    }
  })

  itWithSandbox('shows the normalized preview in the shell tool while its archive remains raw', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-preview-'))
    const context = {
      sessionId: 'preview-session', workspacePath: root, projectRoot: root,
      permissionProfile: 'coordinator-integrator' as const, dangerousOperationApproved: true,
    }
    try {
      const result = await Shell.execute({ command: `printf '10%%\\r20%%\\n'` }, context)
      expect(result).toContain('20%\n')
      expect(result).not.toContain('10%')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  itWithSandbox('provides output_id recovery when progress normalization hides a large raw capture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-progress-recovery-'))
    try {
      const context = {
        sessionId: 'progress-recovery-session',
        workspacePath: root,
        projectRoot: root,
        permissionProfile: 'coordinator-integrator' as const,
        dangerousOperationApproved: true,
        shellOutputRoot: root,
        shellOutputRecoveryRoot: join(root, '.deepseek-code', 'shell-output-recovery'),
      }
      const result = await Shell.execute({ command: `i=0; while [ "$i" -lt 5000 ]; do printf 'progress-%05d\\r' "$i"; i=$((i+1)); done` }, context)
      expect(result).toContain('progress-04999')
      expect(result).not.toContain('progress-00000')
      expect(result).toContain('Model preview differs from the original merged capture')
      const outputId = result.match(/output_id="([0-9a-f-]{36})"/)?.[1]
      expect(outputId).toBeDefined()
      const recovered = await Shell.execute({ output_id: outputId!, max_chars: 20_000 }, context)
      expect(recovered).toContain('progress-00000\rprogress-00001\r')
      expect(recovered).toContain('continue with start_char=')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps draining long-running commands until the process exits', async () => {
    const child = spawn(process.execPath, ['-e', `process.stdout.write('started'); setTimeout(() => process.stdout.write('finished'), 3100)`], { stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    const capture = captureShellStreams(child.stdout, child.stderr, exited)
    await waitForShellProcess(child, 5000)
    const result = await capture
    expect(result.content).toBe('startedfinished')
    expect(result.drainTimedOut).toBe(false)
  })
})
