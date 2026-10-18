import { describe, expect, it, spyOn } from 'bun:test'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { maskSecretsForOffsets, redactSecrets } from '../src/orchestration/events.js'
import { createShellToolForTesting } from '../src/tools/Shell/Shell.js'
import { captureShellStreams } from '../src/tools/Shell/streamCapture.js'
import { MAX_STORED_SHELL_OUTPUT_CHARS, readShellOutput, readShellOutputContent, readShellOutputProvenance, saveShellOutput, shellOutputDirectory, shellOutputEmergencyDirectory } from '../src/tools/Shell/outputArtifact.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const itWithSandbox = it.skipIf(!sandboxAvailable())

describe('shell output artifact privacy', () => {
  it('masks known secrets without changing UTF-16 offsets, CRLF or ordinary text', () => {
    const source = 'HEAD😀\r\napi_key="canary😀value"\nBearer header-canary\nhttps://user:pwd@host/path\npromptTokens=12\nTAIL'
    const masked = maskSecretsForOffsets(source)
    expect(masked.length).toBe(source.length)
    expect(masked).toContain('HEAD😀\r\napi_key="*************"')
    expect(masked).not.toContain('canary')
    expect(masked).not.toContain('user:pwd')
    expect(masked).toContain('promptTokens=12')
    expect(masked.indexOf('TAIL')).toBe(source.indexOf('TAIL'))
    expect([...source.matchAll(/[\r\n]/g)].map(match => match.index)).toEqual([...masked.matchAll(/[\r\n]/g)].map(match => match.index))
  })

  it('redacts incomplete private-key blocks at the capture boundary', () => {
    const source = 'HEAD\n-----BEGIN PRIVATE KEY-----\ncanary-key-material\r\npartial'
    expect(redactSecrets(source)).toBe('HEAD\n[REDACTED PRIVATE KEY]')
    const masked = maskSecretsForOffsets(source)
    expect(masked).not.toContain('canary-key-material')
    expect(masked.length).toBe(source.length)
    expect(masked.split('\n').length).toBe(source.split('\n').length)
  })

  it('masks secrets spanning stream segments before storage and retains exact channel offsets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-privacy-'))
    const recoveryRoot = join(root, '.deepseek-code', 'shell-output-recovery')
    try {
      const stdout = new PassThrough(), stderr = new PassThrough()
      const capturePromise = captureShellStreams(stdout, stderr)
      await new Promise<void>(resolve => setImmediate(resolve))
      stdout.write('HEAD\napi_key=first')
      stderr.write('secret')
      stdout.end('tail\nTAIL')
      stderr.end()
      const capture = await capturePromise
      const artifact = await saveShellOutput('privacy-session', capture.content, capture.totalChars, root, capture.provenance, recoveryRoot)
      const path = join(root, '.deepseek-code', 'shell-output', createHash('sha256').update('privacy-session').digest('hex'), artifact.id)
      const raw = await readFile(path, 'utf8')
      expect(raw).not.toContain('firstsecrettail')
      const stored = JSON.parse(raw)
      expect(stored.content).toBe(maskSecretsForOffsets(capture.content))
      expect(stored.content.length).toBe(capture.content.length)
      expect(stored.provenance).toEqual(capture.provenance)
      expect(artifact.metadata.redacted).toBe(true)
      expect(await readShellOutput('privacy-session', artifact.id, 0, 512, root, recoveryRoot)).toContain('known secrets masked, offsets preserved')
      const provenance = JSON.parse(await readShellOutputProvenance('privacy-session', artifact.id, 0, root, recoveryRoot))
      expect(provenance.contentRedacted).toBe(true)
      expect(provenance.segments).toEqual(capture.provenance.segments)
      if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('masks legacy artifact reads before paging, including a range starting within a secret', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-legacy-'))
    const recoveryRoot = join(root, '.deepseek-code', 'shell-output-recovery')
    try {
      const artifact = await saveShellOutput('legacy-session', 'placeholder', 11, root, undefined, recoveryRoot)
      const path = join(root, '.deepseek-code', 'shell-output', createHash('sha256').update('legacy-session').digest('hex'), artifact.id)
      const content = 'HEAD\npassword=legacy-private-canary\nTAIL'
      await writeFile(path, JSON.stringify({ content, totalChars: content.length, storedChars: content.length, truncated: false }))
      const response = await readShellOutput('legacy-session', artifact.id, content.indexOf('legacy-private'), 512, root, recoveryRoot)
      expect(response).not.toContain('legacy-private-canary')
      expect(response).toContain('known secrets masked, offsets preserved')
      expect(response).toContain('*********************\nTAIL')
      expect(await readFile(path, 'utf8')).toContain('legacy-private-canary')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a saved-output page offset inside a combining grapheme', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-grapheme-'))
    const recoveryRoot = join(root, '.deepseek-code', 'shell-output-recovery')
    try {
      const content = 'head e\u0301 tail'
      const artifact = await saveShellOutput('grapheme-session', content, content.length, root, undefined, recoveryRoot)
      const response = await readShellOutput('grapheme-session', artifact.id, content.lastIndexOf('e') + 1, 512, root, recoveryRoot)
      expect(response).toContain('start_char splits a Unicode grapheme cluster')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a redacted memory-only recovery artifact when disk storage fails, with bounded retention', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-memory-'))
    const unavailableStorage = join(root, 'storage-file')
    const unavailableRecovery = join(root, 'storage-file-recovery')
    const unavailableEmergency = join(root, 'emergency-file')
    await writeFile(unavailableStorage, 'not a directory')
    await writeFile(unavailableRecovery, 'not a directory')
    await writeFile(unavailableEmergency, 'not a directory')
    try {
      const first = await saveShellOutput('memory-fallback-session', 'HEAD\napi_key=memory-canary\nTAIL', 32, unavailableStorage, undefined, unavailableRecovery, unavailableEmergency)
      expect(first.metadata.storage).toBe('memory')
      const recovered = await readShellOutput('memory-fallback-session', first.id, 0, 512, unavailableStorage, unavailableRecovery, unavailableEmergency)
      expect(recovered).toContain('HEAD')
      expect(recovered).toContain('TAIL')
      expect(recovered).toContain('memory-only')
      expect(recovered).not.toContain('memory-canary')
      expect(await readShellOutput('other-session', first.id, 0, 512, unavailableStorage, unavailableRecovery, unavailableEmergency)).toContain('missing or expired')

      for (let index = 0; index < 10; index++) {
        await saveShellOutput('memory-fallback-session', `output-${index}`, 9, unavailableStorage, undefined, unavailableRecovery, unavailableEmergency)
      }
      expect(await readShellOutput('memory-fallback-session', first.id, 0, 512, unavailableStorage, unavailableRecovery, unavailableEmergency)).toContain('missing or expired')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  itWithSandbox('warns that memory-only Shell output can be evicted before process exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-memory-warning-'))
    const sessionId = `memory-warning-${process.pid}-${Date.now()}`
    const primaryFile = join(root, 'primary-file')
    const recoveryFile = join(root, 'recovery-file')
    const emergencyDirectory = shellOutputEmergencyDirectory(sessionId)
    await Promise.all([primaryFile, recoveryFile].map(path => writeFile(path, 'not a directory')))
    const originalWriteFile = fs.writeFile
    const writeSpy = spyOn(fs, 'writeFile').mockImplementation(async (path: any, data: any, options?: any) => {
      if (String(path).startsWith(emergencyDirectory)) throw Object.assign(new Error('injected emergency storage failure'), { code: 'ENOSPC' })
      return originalWriteFile(path, data, options)
    })
    try {
      const output = 'x'.repeat(50_001)
      const shell = createShellToolForTesting(async () => ({
        all: output, preview: output, totalChars: output.length, totalBytes: Buffer.byteLength(output, 'utf8'), truncated: true, drainTimedOut: false,
        processGroupSettled: 'settled',
        provenance: { schema: 'shell_channel_provenance_v1', ordering: 'observed-arrival', stdoutChars: output.length,
          stderrChars: 0, retainedChars: output.length, segments: [], segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: false },
      }))
      const result = await shell.execute({ command: 'printf fixture-output' }, {
        sessionId, workspacePath: root, projectRoot: root,
        permissionProfile: 'coordinator-integrator', dangerousOperationApproved: true,
        shellOutputRoot: primaryFile, shellOutputRecoveryRoot: recoveryFile,
      })

      expect(result).toContain('memory-only fallback may be evicted under process-wide quota pressure before this process exits')
    } finally {
      writeSpy.mockRestore()
      await Promise.all([rm(emergencyDirectory, { recursive: true, force: true }), rm(root, { recursive: true, force: true })])
    }
  })

  it('retains a maximum-size artifact with the maximum provenance in memory when all disk stores fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-max-memory-'))
    const unavailableStorage = join(root, 'storage-file')
    const unavailableRecovery = join(root, 'recovery-file')
    const unavailableEmergency = join(root, 'emergency-file')
    await Promise.all([unavailableStorage, unavailableRecovery, unavailableEmergency].map(path => writeFile(path, 'not a directory')))
    const sessionId = `max-memory-fallback-${process.pid}-${Date.now()}`
    const content = '\0'.repeat(MAX_STORED_SHELL_OUTPUT_CHARS)
    const provenance = {
      schema: 'shell_channel_provenance_v1' as const, ordering: 'observed-arrival' as const,
      stdoutChars: content.length, stderrChars: 0, retainedChars: content.length,
      segments: Array.from({ length: 4096 }, (_, sequence) => ({ sequence, channel: 'stdout' as const,
        offset: sequence, channelOffset: sequence, length: 1 })),
      segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: false,
    }
    try {
      const saved = await saveShellOutput(sessionId, content, content.length, unavailableStorage, provenance, unavailableRecovery, unavailableEmergency)
      expect(saved.metadata.storage).toBe('memory')
      const restored = await readShellOutputContent(sessionId, saved.id, unavailableStorage, unavailableRecovery, unavailableEmergency)
      expect(restored.content).toBe(content)
      expect(restored.provenance?.segments).toHaveLength(4096)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists a redacted artifact in the recovery directory when primary storage fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-recovery-'))
    const primaryStorage = join(root, 'primary-file')
    const recoveryRoot = join(root, 'recovery')
    const emergencyRoot = join(root, 'emergency')
    await writeFile(primaryStorage, 'not a directory')
    const sessionId = 'recovery-session'
    const output = 'HEAD\napi_key=recovery-canary\nTAIL'
    const provenance = { schema: 'shell_channel_provenance_v1' as const, ordering: 'observed-arrival' as const,
      stdoutChars: output.length, stderrChars: 0, retainedChars: output.length, segments: [], segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: false }
    try {
      const artifact = await saveShellOutput(sessionId, output, output.length, primaryStorage, provenance, recoveryRoot, emergencyRoot)
      expect((artifact.metadata as { storage: string }).storage).toBe('recovery-disk')
      expect(artifact.metadata.retentionWarning).toContain('primary storage failed')
      const path = join(recoveryRoot, createHash('sha256').update(sessionId).digest('hex'), artifact.id)
      expect((await stat(path)).mode & 0o777).toBe(0o600)

      const recovered = await readShellOutput(sessionId, artifact.id, 0, 512, primaryStorage, recoveryRoot, emergencyRoot)
      expect(recovered).toContain('recovery-disk fallback')
      expect(recovered).toContain('HEAD')
      expect(recovered).toContain('TAIL')
      expect(recovered).not.toContain('recovery-canary')
      const recoveredProvenance = JSON.parse(await readShellOutputProvenance(sessionId, artifact.id, 0, primaryStorage, recoveryRoot, emergencyRoot))
      expect(recoveredProvenance.storage).toBe('recovery-disk')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps failed count-based cleanup in quota accounting and reports it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-prune-count-'))
    const recoveryRoot = join(root, 'recovery')
    const emergencyRoot = join(root, 'emergency')
    const sessionId = 'prune-count-session'
    const artifacts: Awaited<ReturnType<typeof saveShellOutput>>[] = []
    try {
      for (let index = 0; index < 10; index++) {
        artifacts.push(await saveShellOutput(sessionId, `artifact-${index}`, 10, root, undefined, recoveryRoot, emergencyRoot))
      }
      const directory = shellOutputDirectory(sessionId, root)
      const paths = artifacts.map(artifact => join(directory, artifact.id))
      await Promise.all(paths.map((path, index) => {
        const time = new Date(1_000_000 + index * 1_000)
        return utimes(path, time, time)
      }))
      const failedPath = paths[0]!
      const nextPath = paths[1]!
      const originalUnlink = fs.unlink
      const attempts: string[] = []
      const unlinkSpy = spyOn(fs, 'unlink').mockImplementation(async (path: any) => {
        const candidate = String(path)
        attempts.push(candidate)
        if (candidate === failedPath) throw Object.assign(new Error('injected cleanup failure'), { code: 'EACCES' })
        return originalUnlink(path)
      })
      try {
        const saved = await saveShellOutput(sessionId, 'new-output', 10, root, undefined, recoveryRoot, emergencyRoot)
        expect(saved.metadata.retentionWarning).toContain('primary cleanup EACCES')
        expect(attempts).toContain(failedPath)
        expect(attempts).toContain(nextPath)
        await expect(readFile(failedPath)).resolves.toBeDefined()
        await expect(readFile(nextPath)).rejects.toMatchObject({ code: 'ENOENT' })
        const remaining = await readdir(directory)
        expect(remaining).toHaveLength(10)
        expect(remaining).toContain(saved.id)
        const remainingBytes = (await Promise.all(remaining.map(id => stat(join(directory, id)))))
          .reduce((total, info) => total + info.size, 0)
        expect(remainingBytes).toBe(10 * (await stat(join(directory, saved.id))).size)
      } finally {
        unlinkSpy.mockRestore()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps failed byte-based cleanup counted and prunes the next candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-prune-bytes-'))
    const recoveryRoot = join(root, 'recovery')
    const emergencyRoot = join(root, 'emergency')
    const sessionId = 'prune-byte-session'
    const artifacts: Awaited<ReturnType<typeof saveShellOutput>>[] = []
    const content = '😀'.repeat(1_000_000)
    const maxBytes = 20 * 1024 * 1024
    try {
      for (let index = 0; index < 5; index++) {
        artifacts.push(await saveShellOutput(sessionId, content, content.length, root, undefined, recoveryRoot, emergencyRoot))
      }
      const directory = shellOutputDirectory(sessionId, root)
      const paths = artifacts.map(artifact => join(directory, artifact.id))
      await Promise.all(paths.map((path, index) => {
        const time = new Date(1_000_000 + index * 1_000)
        return utimes(path, time, time)
      }))
      const initialStats = await Promise.all(paths.map(path => stat(path)))
      const initialBytes = initialStats.reduce((total, info) => total + info.size, 0)
      const artifactBytes = (await stat(paths[0]!)).size
      expect(initialBytes).toBeLessThan(maxBytes)
      expect(initialBytes + artifactBytes).toBeGreaterThan(maxBytes)

      const failedPath = paths[0]!
      const nextPath = paths[1]!
      const originalUnlink = fs.unlink
      const attempts: string[] = []
      const unlinkSpy = spyOn(fs, 'unlink').mockImplementation(async (path: any) => {
        const candidate = String(path)
        attempts.push(candidate)
        if (candidate === failedPath) throw Object.assign(new Error('injected quota cleanup failure'), { code: 'EACCES' })
        return originalUnlink(path)
      })
      try {
        const saved = await saveShellOutput(sessionId, content, content.length, root, undefined, recoveryRoot, emergencyRoot)
        expect(saved.metadata.retentionWarning).toContain('primary cleanup EACCES')
        expect(attempts).toContain(failedPath)
        expect(attempts).toContain(nextPath)
        await expect(readFile(failedPath)).resolves.toBeDefined()
        await expect(readFile(nextPath)).rejects.toMatchObject({ code: 'ENOENT' })
        const remaining = await readdir(directory)
        const remainingStats = await Promise.all(remaining.map(id => stat(join(directory, id))))
        const remainingBytes = remainingStats.reduce((total, info) => total + info.size, 0)
        expect(remaining).toHaveLength(5)
        expect(remaining).toContain(saved.id)
        expect(remainingBytes).toBeLessThanOrEqual(maxBytes)
      } finally {
        unlinkSpy.mockRestore()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists a redacted emergency artifact when both home-based stores fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-emergency-'))
    const primaryStorage = join(root, 'primary-file')
    const recoveryRoot = join(root, 'recovery-file')
    const sessionId = `emergency-session-${process.pid}-${Date.now()}`
    const emergencyDirectory = shellOutputEmergencyDirectory(sessionId)
    await writeFile(primaryStorage, 'not a directory')
    await writeFile(recoveryRoot, 'not a directory')
    try {
      const output = 'HEAD\napi_key=emergency-canary\nTAIL'
      const saved = await saveShellOutput(sessionId, output, output.length, primaryStorage, undefined, recoveryRoot)
      expect(saved.metadata.storage).toBe('emergency-disk')
      expect(saved.metadata.retentionWarning).toContain('primary storage failed')
      expect(saved.metadata.retentionWarning).toContain('recovery storage failed')
      const path = join(emergencyDirectory, saved.id)
      expect((await stat(emergencyDirectory)).mode & 0o777).toBe(0o700)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(await readFile(path, 'utf8')).not.toContain('emergency-canary')

      const recovered = await readShellOutput(sessionId, saved.id, 0, 512, primaryStorage, recoveryRoot)
      expect(recovered).toContain('emergency temporary-disk fallback')
      expect(recovered).toContain('HEAD')
      expect(recovered).toContain('TAIL')
      expect(recovered).not.toContain('emergency-canary')
      const reattached = await readShellOutputContent(sessionId, saved.id, primaryStorage, recoveryRoot)
      expect(reattached.metadata.storage).toBe('emergency-disk')
      expect(reattached.content).not.toContain('emergency-canary')
      const moduleUrl = new URL('../src/tools/Shell/outputArtifact.ts', import.meta.url).href
      const child = Bun.spawn([process.execPath, '-e', `import { readShellOutputContent } from ${JSON.stringify(moduleUrl)}; const result = await readShellOutputContent(${JSON.stringify(sessionId)}, ${JSON.stringify(saved.id)}, ${JSON.stringify(primaryStorage)}, ${JSON.stringify(recoveryRoot)}); process.stdout.write(JSON.stringify(result))`], {
        stdout: 'pipe', stderr: 'pipe',
      })
      const [exitCode, childOutput, childError] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(exitCode, childError).toBe(0)
      expect(JSON.parse(childOutput).content).toContain('HEAD')
    } finally {
      await rm(emergencyDirectory, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    }
  })

  it('tries emergency storage when the recovery path aliases the failed primary directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-aliased-recovery-'))
    const sessionId = `aliased-recovery-${process.pid}-${Date.now()}`
    const primaryDirectory = shellOutputDirectory(sessionId, root)
    const recoveryRoot = dirname(primaryDirectory)
    const emergencyRoot = join(root, 'emergency')
    await mkdir(recoveryRoot, { recursive: true })
    await writeFile(primaryDirectory, 'not a directory')
    try {
      const saved = await saveShellOutput(sessionId, 'recoverable output', 18, root, undefined, recoveryRoot, emergencyRoot)
      expect(saved.metadata.storage).toBe('emergency-disk')
      expect(await readShellOutput(sessionId, saved.id, 0, 512, root, recoveryRoot, emergencyRoot)).toContain('recoverable output')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('recovers a corrupted primary artifact from its verified secondary copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-mirror-'))
    const primaryRoot = join(root, 'primary')
    const recoveryRoot = join(root, 'recovery')
    const sessionId = 'mirrored-output-session'
    const output = 'HEAD\napi_key=mirror-canary\nTAIL'
    try {
      const saved = await saveShellOutput(sessionId, output, output.length, primaryRoot, undefined, recoveryRoot)
      const sessionKey = createHash('sha256').update(sessionId).digest('hex')
      const primary = join(shellOutputDirectory(sessionId, primaryRoot), saved.id)
      const recovery = join(recoveryRoot, sessionKey, saved.id)
      expect((await stat(primary)).mode & 0o777).toBe(0o600)
      expect((await stat(recovery)).mode & 0o777).toBe(0o600)
      expect(await readFile(recovery, 'utf8')).not.toContain('mirror-canary')

      await writeFile(primary, '{truncated')
      const recovered = await readShellOutput(sessionId, saved.id, 0, 512, primaryRoot, recoveryRoot)
      expect(recovered).toContain('recovery-disk fallback')
      expect(recovered).toContain('HEAD')
      expect(recovered).toContain('TAIL')
      expect(recovered).not.toContain('mirror-canary')

      await writeFile(recovery, '{also truncated')
      expect(await readShellOutput(sessionId, saved.id, 0, 512, primaryRoot, recoveryRoot)).toContain('failed its integrity check')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses a sibling recovery directory when the supplied primary root is not a directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-output-sibling-recovery-'))
    const primaryStorage = join(root, 'primary-file')
    await writeFile(primaryStorage, 'not a directory')
    const sessionId = 'sibling-recovery-session'
    try {
      const emergencyRoot = join(root, 'emergency')
      const output = await saveShellOutput(sessionId, 'recoverable output', 18, primaryStorage, undefined, undefined, emergencyRoot)
      expect(output.metadata.storage).toBe('recovery-disk')
      const path = join(root, 'primary-file-recovery', createHash('sha256').update(sessionId).digest('hex'), output.id)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(await readShellOutput(sessionId, output.id, 0, 512, primaryStorage, undefined, emergencyRoot)).toContain('recoverable output')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
