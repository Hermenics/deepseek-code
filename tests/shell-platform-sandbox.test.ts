import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('Shell platform sandbox boundary', () => {
  it('fails closed for foreground, verification, and background routes off Linux', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-unsupported-platform-'))
    const foregroundMarker = join(root, 'foreground-ran')
    const verificationMarker = join(root, 'verification-ran')
    const backgroundMarker = join(root, 'background-ran')
    try {
      await writeFile(join(root, 'package.json'), JSON.stringify({
        scripts: { test: `node -e "require('node:fs').writeFileSync('${verificationMarker}', 'ran')"` },
      }))
      await writeFile(join(root, 'bun.lock'), '{}')

      const shellModule = new URL('../src/tools/Shell/Shell.js', import.meta.url).href
      const outputArtifactModule = new URL('../src/tools/Shell/outputArtifact.js', import.meta.url).href
      const script = `
        Object.defineProperty(process, 'platform', { value: 'darwin' })
        const { Shell, runProjectVerificationReadOnly } = await import(${JSON.stringify(shellModule)})
        const { readShellOutput } = await import(${JSON.stringify(outputArtifactModule)})
        const root = ${JSON.stringify(root)}
        const context = {
          sessionId: 'unsupported-platform-test', workspacePath: root, projectRoot: root,
          shellOutputRoot: root + '/artifacts', shellOutputRecoveryRoot: root + '/recovery',
          permissionProfile: 'coordinator-integrator', recordVerification: () => 'verification-evidence',
        }
        const foreground = await Shell.execute({ command: ${JSON.stringify(`touch '${foregroundMarker}'`)} }, context)
        const verification = JSON.parse(await Shell.execute({ command: 'bun run test', verification: true }, context))
        const readOnly = await runProjectVerificationReadOnly({ command: 'bun', args: ['run', 'test'], display: 'bun run test' }, root)

        let backgroundRunner
        const session = {
          registry: {}, flush: async () => {},
          spawn: (_input, runner) => {
            backgroundRunner = runner
            return { sessionId: context.sessionId, taskId: 'background-task', status: () => ({ state: 'queued' }) }
          },
        }
        await Shell.execute({ command: ${JSON.stringify(`touch '${backgroundMarker}'`)}, background: true }, { ...context, session })
        let backgroundError = ''
        try {
          await backgroundRunner({
            sessionId: context.sessionId, taskId: 'background-task', signal: new AbortController().signal,
            workspacePath: root, projectRoot: root, setPartial() {}, recordArtifact() {}, trackProcess() {},
            markEffectStarted: async () => 'effect', markEffectOutcome: async () => {},
          })
        } catch (error) { backgroundError = error instanceof Error ? error.message : String(error) }
        const backgroundOutputId = backgroundError.match(/shell output_id="([^"]+)"/)?.[1]
        const backgroundOutput = backgroundOutputId
          ? await readShellOutput(context.sessionId, backgroundOutputId, 0, 2048, context.shellOutputRoot, context.shellOutputRecoveryRoot)
          : ''

        process.stdout.write(JSON.stringify({ foreground, verification, readOnly, backgroundError, backgroundOutput }))
      `
      const env: NodeJS.ProcessEnv = Object.fromEntries(
        ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'PATHEXT']
          .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
      )
      const child = spawnSync(process.execPath, ['-e', script], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
      expect(child.status, child.stderr || child.error?.message).toBe(0)
      const result = JSON.parse(child.stdout) as {
        foreground: string
        verification: { ok: boolean; output: string }
        readOnly: { ok: boolean; output: string }
        backgroundError: string
        backgroundOutput: string
      }
      expect(result.foreground).toContain('sandbox unavailable')
      expect(result.verification.ok).toBe(false)
      expect(result.verification.output).toContain('sandbox unavailable')
      expect(result.readOnly.ok).toBe(false)
      expect(result.readOnly.output).toContain('sandbox unavailable')
      expect(result.backgroundError).not.toBe('')
      expect(result.backgroundOutput).toContain('sandbox unavailable')
      expect(existsSync(foregroundMarker)).toBe(false)
      expect(existsSync(verificationMarker)).toBe(false)
      expect(existsSync(backgroundMarker)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
