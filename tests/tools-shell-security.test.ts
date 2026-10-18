import { afterEach, describe, expect, it } from 'bun:test'
import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createShellToolForTesting, Shell } from '../src/tools/Shell/Shell.js'
import { validateToolArguments } from '../src/orchestration/schema.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const roots: string[] = []
const itWithSandbox = it.skipIf(!sandboxAvailable())

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function context(root: string, permissionProfile: 'coordinator-integrator' | 'researcher-readonly') {
  return { sessionId: 'h01-test', workspacePath: root, projectRoot: root, permissionProfile } as const
}

function nestDollarSubstitutions(command: string, depth: number): string {
  let nested = command
  for (let level = 0; level < depth; level++) nested = 'printf x "$(' + nested + ')"'
  return 'echo "$(' + nested + ')"'
}

function nestBacktickAroundDollarSubstitutions(command: string, dollarDepth: number): string {
  return 'echo `' + nestDollarSubstitutions(command, dollarDepth) + '`'
}

function nestInlineShells(command: string, depth: number): string {
  let nested = command
  for (let level = 0; level < depth; level++) nested = `bash -c ${JSON.stringify(nested)}`
  return nested
}

describe('shell security boundary', () => {
  it('keeps command execution and saved-output read modes disjoint in the schema', () => {
    expect(validateToolArguments(Shell.parameters, { command: 'true' }).valid).toBe(true)
    expect(validateToolArguments(Shell.parameters, { command: 'true', verification: true }).valid).toBe(true)
    expect(validateToolArguments(Shell.parameters, { command: 'true', background: true }).valid).toBe(true)
    expect(validateToolArguments(Shell.parameters, { output_id: 'saved-output' }).valid).toBe(true)
    expect(validateToolArguments(Shell.parameters, { output_id: 'saved-output', start_char: 10, max_chars: 512 }).valid).toBe(true)
    expect(validateToolArguments(Shell.parameters, { output_id: 'saved-output', start_char: 0, max_chars: 20_000 }).valid).toBe(true)
    expect(validateToolArguments(Shell.parameters, { output_id: 'saved-output', include_provenance: true, provenance_start: 2 }).valid).toBe(true)

    for (const args of [
      { command: 'true', output_id: 'saved-output' },
      { command: 'true', start_char: 10 },
      { command: 'true', max_chars: 512 },
      { command: 'true', include_provenance: true },
      { command: 'true', provenance_start: 2 },
      { command: 'true', verification: true, background: true },
      { output_id: 'saved-output', command: 'true' },
      { output_id: 'saved-output', timeout: 1 },
      { output_id: 'saved-output', background: true },
      { output_id: 'saved-output', verification: true },
      { output_id: 'saved-output', provenance_start: 2 },
      { output_id: 'saved-output', include_provenance: false, provenance_start: 2 },
      { output_id: 'saved-output', include_provenance: true, start_char: 10 },
      { output_id: 'saved-output', include_provenance: true, max_chars: 512 },
      { output_id: 'saved-output', start_char: -1 },
      { output_id: 'saved-output', start_char: 1.5 },
      { output_id: 'saved-output', start_char: Number.MAX_SAFE_INTEGER + 1 },
      { output_id: 'saved-output', max_chars: 511 },
      { output_id: 'saved-output', max_chars: 20_001 },
      { output_id: 'saved-output', max_chars: 512.5 },
    ]) expect(validateToolArguments(Shell.parameters, args).valid).toBe(false)
  })

  it('rejects shell mode options at runtime before executing or reading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-shell-modes-'))
    roots.push(root)
    expect(await Shell.execute({ command: 'printf must-not-run', start_char: 1 }, context(root, 'coordinator-integrator'))).toContain('saved-output options require output_id')
    expect(await Shell.execute({ output_id: 'saved-output', timeout: 1 }, context(root, 'coordinator-integrator'))).toContain('cannot be combined with a command or execution options')
    expect(await Shell.execute({ output_id: 'saved-output', include_provenance: true, start_char: 1 }, context(root, 'coordinator-integrator'))).toContain('cannot be combined with include_provenance=true')
  })

  it('scrubs inherited canary variables for coordinators and workers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-shell-'))
    roots.push(root)
    const key = 'DEEPSEEK_H01_CANARY'
    const token = 'h01-canary-must-not-escape'
    const previous = process.env[key]
    process.env[key] = token
    try {
      for (const permissionProfile of ['coordinator-integrator', 'researcher-readonly'] as const) {
        const result = await Shell.execute({ command: `printf '%s' "\${${key}:-missing}"` }, context(root, permissionProfile))
        if (sandboxAvailable()) expect(result).toContain('missing')
        else expect(result).toContain('contextual shell execution is blocked')
        expect(result).not.toContain(token)
      }
    } finally {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }
  })

  it('blocks network capability without explicit approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-network-'))
    roots.push(root)
    const result = await Shell.execute(
      { command: 'curl https://example.invalid' },
      context(root, 'coordinator-integrator'),
    )
    expect(result).toContain('network access requires explicit approval')
  })

  it('requires scripts-disabled package installs and keeps network approval separate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-package-install-'))
    roots.push(root)
    const unsafe = await Shell.execute({ command: 'bun install' }, context(root, 'coordinator-integrator'))
    expect(unsafe).toContain('package installs and dependency updates must use one direct supported invocation')

    const safe = await Shell.execute({ command: 'bun install --ignore-scripts' }, context(root, 'coordinator-integrator'))
    expect(safe).toContain('network access requires explicit approval')
  })

  it('requires disabled scripts for dependency updates before asking for network approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-package-update-'))
    roots.push(root)
    for (const command of [
      'npm update --offline',
      'pnpm update --offline',
      'pnpm up --offline',
      'yarn up --offline',
      'yarn upgrade --offline',
      'bun update --offline',
      'bun up --offline',
    ]) {
      const blocked = await Shell.execute({ command }, context(root, 'coordinator-integrator'))
      expect(blocked, command).toContain('package installs and dependency updates must use one direct supported invocation')
    }

    for (const command of [
      'npm update --ignore-scripts',
      'pnpm update --ignore-scripts',
      'pnpm up --ignore-scripts',
      'bun update --ignore-scripts',
      'bun up --ignore-scripts',
    ]) {
      const safe = await Shell.execute({ command }, context(root, 'coordinator-integrator'))
      expect(safe, command).toContain('network access requires explicit approval')
    }

    await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'yarn@1.22.22' }))
    for (const command of ['yarn up --ignore-scripts', 'yarn upgrade --ignore-scripts']) {
      const safe = await Shell.execute({ command }, context(root, 'coordinator-integrator'))
      expect(safe, command).toContain('network access requires explicit approval')
    }
  })

  it('blocks npm install-test composites despite ignored scripts or offline mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-npm-install-test-'))
    roots.push(root)
    for (const command of [
      'npm it --offline',
      'npm it --ignore-scripts --offline',
      'npm install-test --ignore-scripts --offline',
      'npm cit --offline',
      'npm cit --ignore-scripts --offline',
      'npm clean-install-test --ignore-scripts --offline',
      'npm clean-install --offline',
    ]) {
      const result = await Shell.execute({ command }, context(root, 'coordinator-integrator'))
      expect(result, command).toContain('package installs and dependency updates must use one direct supported invocation')
    }

    const safeCleanInstall = await Shell.execute(
      { command: 'npm clean-install --ignore-scripts --offline' },
      context(root, 'coordinator-integrator'),
    )
    expect(safeCleanInstall).toContain('network access requires explicit approval')
  })

  it('blocks npm installs when a later flag re-enables lifecycle scripts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-package-install-flags-'))
    roots.push(root)
    for (const command of [
      'npm install --ignore-scripts --no-ignore-scripts',
      'npm install --no-ignore-scripts --ignore-scripts',
      'npm install --ignore-scripts --ignore-scripts=false',
      'npm install --ignore-scripts=false --ignore-scripts',
    ]) {
      const result = await Shell.execute({ command }, context(root, 'coordinator-integrator'))
      expect(result, command).toContain('package installs and dependency updates must use one direct supported invocation')
    }
  })

  it('blocks Yarn Berry skip-build installs even when a packageManager pin is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-yarn-install-'))
    roots.push(root)
    const command = 'yarn install --mode=skip-build'

    const unpinned = await Shell.execute({ command }, context(root, 'coordinator-integrator'))
    expect(unpinned).toContain('package installs and dependency updates must use one direct supported invocation')

    await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.6.0' }))
    const pinned = await Shell.execute({ command }, context(root, 'coordinator-integrator'))
    expect(pinned).toContain('package installs and dependency updates must use one direct supported invocation')
  })

  it('blocks package installs hidden in shell compositions even with the safe flag', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-composed-install-'))
    roots.push(root)
    for (const command of ['cd app && npm ci --ignore-scripts', 'echo "$(pnpm install --ignore-scripts)"']) {
      const result = await Shell.execute({ command }, context(root, 'coordinator-integrator'))
      expect(result).toContain('package installs and dependency updates must use one direct supported invocation')
    }
  })

  itWithSandbox('blocks deeply nested package installs before the shell executor, even with approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-deep-install-'))
    roots.push(root)
    const executed: string[] = []
    const shell = createShellToolForTesting(async command => {
      executed.push(command)
      throw new Error('blocked package install reached the shell executor')
    })
    const approvedContext = { ...context(root, 'coordinator-integrator'), dangerousOperationApproved: true }

    for (const command of [
      nestDollarSubstitutions('npm install --ignore-scripts', 3),
      nestDollarSubstitutions('npm install --ignore-scripts', 4),
      nestInlineShells('npm install --ignore-scripts', 2),
      nestInlineShells('npm install --ignore-scripts', 4),
      "bash -c $'npm install'",
      "bash -ec $'npm install'",
      "bash --noprofile -c $'npm install'",
      nestInlineShells("eval 'npm install --ignore-scripts'", 3),
      nestInlineShells("bash -s <<< 'npm install --ignore-scripts'", 3),
      nestBacktickAroundDollarSubstitutions('pnpm install --ignore-scripts', 2),
      nestDollarSubstitutions("bash -s <<'EOF'\nnpm install --ignore-scripts\nEOF", 5),
    ]) {
      const result = await shell.execute({ command }, approvedContext)
      expect(result, command).toContain('package installs and dependency updates must use one direct supported invocation')
      expect(executed, command).toEqual([])
    }
  })

  itWithSandbox('blocks ANSI-C and depth-limited package-install wrappers before the shell executor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-opaque-install-wrappers-'))
    roots.push(root)
    const executed: string[] = []
    const shell = createShellToolForTesting(async command => {
      executed.push(command)
      const output = 'executor reached'
      return {
        all: output,
        preview: output,
        totalChars: output.length,
        totalBytes: Buffer.byteLength(output, 'utf8'),
        truncated: false,
        drainTimedOut: false,
        processGroupSettled: 'settled',
        provenance: {
          schema: 'shell_channel_provenance_v1',
          ordering: 'observed-arrival',
          stdoutChars: output.length,
          stderrChars: 0,
          retainedChars: output.length,
          segments: [{ sequence: 0, channel: 'stdout', offset: 0, channelOffset: 0, length: output.length }],
          segmentsOmitted: 0,
          contentOmitted: 0,
          drainTimedOut: false,
        },
      }
    })
    const approvedContext = { ...context(root, 'coordinator-integrator'), dangerousOperationApproved: true }
    const commands = [
      "bash -c $'npm install'",
      "bash -ec $'npm install'",
      "bash --noprofile -c $'npm install'",
      nestInlineShells("eval 'npm install --ignore-scripts'", 3),
      nestInlineShells("bash -s <<< 'npm install --ignore-scripts'", 3),
    ]
    const results: string[] = []

    for (const command of commands) results.push(await shell.execute({ command }, approvedContext) as string)

    expect({
      blocked: results.map(result => result.includes('package installs and dependency updates must use one direct supported invocation')),
      executed,
    }).toEqual({ blocked: commands.map(() => true), executed: [] })
  })

  itWithSandbox('checks adjacent quoted package command fragments before the shell executor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-adjacent-package-quotes-'))
    roots.push(root)
    const executed: string[] = []
    const shell = createShellToolForTesting(async command => {
      executed.push(command)
      throw new Error('approved lifecycle test reached the shell executor')
    })
    const install = "bash -c 'npm 'install --ignore-scripts"
    const installResult = await shell.execute(
      { command: install },
      { ...context(root, 'coordinator-integrator'), dangerousOperationApproved: true },
    )
    expect(installResult, install).toContain('package installs and dependency updates must use one direct supported invocation')
    expect(executed, install).toEqual([])

    const rebuild = "bash -c 'npm 'rebuild"
    const denied = await shell.execute({ command: rebuild }, context(root, 'coordinator-integrator'))
    expect(denied, rebuild).toContain('lifecycle scripts require explicit approval')
    expect(executed, rebuild).toEqual([])

    const approved = await shell.execute(
      { command: rebuild },
      { ...context(root, 'coordinator-integrator'), dangerousOperationApproved: true },
    )
    expect(approved, rebuild).toContain('approved lifecycle test reached the shell executor')
    expect(executed, rebuild).toEqual([rebuild])
  })

  itWithSandbox('requires approval for deeply nested lifecycle commands before the shell executor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-deep-rebuild-'))
    roots.push(root)
    const executed: string[] = []
    const shell = createShellToolForTesting(async command => {
      executed.push(command)
      throw new Error('approved lifecycle test reached the shell executor')
    })

    for (const command of [
      nestDollarSubstitutions('npm rebuild', 3),
      nestBacktickAroundDollarSubstitutions('npm rebuild', 2),
    ]) {
      const result = await shell.execute({ command }, context(root, 'coordinator-integrator'))
      expect(result, command).toContain('lifecycle scripts require explicit approval')
      expect(executed, command).toEqual([])
    }

    const approvedContext = { ...context(root, 'coordinator-integrator'), dangerousOperationApproved: true }
    for (const command of [
      nestDollarSubstitutions('pnpm rebuild', 3),
      nestDollarSubstitutions('yarn rebuild', 3),
    ]) {
      const result = await shell.execute({ command }, approvedContext)
      expect(result, command).toContain('approved lifecycle test reached the shell executor')
      expect(executed.slice(-1), command).toEqual([command])
    }
  })

  itWithSandbox('allows a plain npm rebuild to proceed after explicit approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-approved-rebuild-'))
    roots.push(root)
    const executed: string[] = []
    const shell = createShellToolForTesting(async command => {
      executed.push(command)
      const output = 'fake executor completed'
      return {
        all: output,
        preview: output,
        totalChars: output.length,
        totalBytes: Buffer.byteLength(output, 'utf8'),
        truncated: false,
        drainTimedOut: false,
        processGroupSettled: 'settled',
        provenance: {
          schema: 'shell_channel_provenance_v1',
          ordering: 'observed-arrival',
          stdoutChars: output.length,
          stderrChars: 0,
          retainedChars: output.length,
          segments: [{ sequence: 0, channel: 'stdout', offset: 0, channelOffset: 0, length: output.length }],
          segmentsOmitted: 0,
          contentOmitted: 0,
          drainTimedOut: false,
        },
      }
    })

    const denied = await shell.execute({ command: 'npm rebuild' }, context(root, 'coordinator-integrator'))
    expect(denied).toContain('lifecycle scripts require explicit approval')
    expect(executed).toEqual([])

    const approved = await shell.execute(
      { command: 'npm rebuild' },
      { ...context(root, 'coordinator-integrator'), dangerousOperationApproved: true },
    )
    expect(approved).toContain('fake executor completed')
    expect(executed).toEqual(['npm rebuild'])
  })

  it('blocks npm, pnpm, and Yarn lifecycle-script rebuilds through direct and nested commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-npm-rebuild-'))
    roots.push(root)
    for (const command of ['npm -- rebuild', 'pnpm rebuild', 'yarn rebuild', 'echo "$(npm rebuild)"', 'value="$(npm rebuild)"']) {
      const result = await Shell.execute({ command }, context(root, 'coordinator-integrator'))
      expect(result).toContain('lifecycle scripts require explicit approval')
    }

    const literal = await Shell.execute({ command: "printf '%s' '$(npm rebuild)'" }, context(root, 'coordinator-integrator'))
    expect(literal).not.toContain('lifecycle scripts require explicit approval')
    if (sandboxAvailable()) expect(literal).toContain('$(npm rebuild)')
    else expect(literal).toContain('contextual shell execution is blocked')
  })

  it('still permits ordinary isolated shell commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-h01-command-'))
    roots.push(root)
    const result = await Shell.execute(
      { command: 'printf allowed' },
      context(root, 'coordinator-integrator'),
    )
    if (sandboxAvailable()) expect(result).toContain('allowed')
    else expect(result).toContain('contextual shell execution is blocked')
  })
})
