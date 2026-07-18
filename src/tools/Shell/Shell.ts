import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { execa } from 'execa'
import type { Tool } from '../types.js'
import { SHELL_OUTPUT_MAX_CHARS, SHELL_TIMEOUT_MS } from '../../constants.js'

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-z]*f[a-z]*|-[a-z]*r[a-z]*f[a-z]*|--force|--recursive)\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+--force|push\s+-f)\b/i,
  /\bdrop\s+(table|database)\b/i, /\btruncate\s+table\b/i, /\bmkfs\b/,
  /\bdd\s+.*of=/, /\bchmod\s+-R\s+777\b/, /\bsudo\s+rm\b/, />\s*\/dev\/(sd[a-z]|nvme)/,
]

function destructiveWarning(command: string): string | null {
  return DESTRUCTIVE_PATTERNS.find(pattern => pattern.test(command)) ? `Destructive command detected: ${command}` : null
}

export type ConfirmHandler = (message: string) => Promise<boolean>
let legacyConfirmHandler: ConfirmHandler | null = null

/** @deprecated Runtime calls should supply authorization through ToolExecutionContext. */
export function setShellConfirmHandler(handler: ConfirmHandler | null): void { legacyConfirmHandler = handler }

async function runSandboxed(command: string, cwd: string, timeout: number, readOnly: boolean, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  const bunBin = dirname(process.execPath)
  const args = [
    '--die-with-parent', '--new-session',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/bin', '/bin', '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
    readOnly ? '--ro-bind' : '--bind', cwd, '/mnt',
  ]
  if (bunBin.startsWith(`${homedir()}/`)) args.push('--ro-bind', bunBin, '/opt/bin')
  args.push(
    '--tmpfs', '/tmp',
    '--dev', '/dev', '--proc', '/proc', '--unshare-net', '--unshare-pid', '--unshare-ipc', '--unshare-uts',
    '--clearenv', '--setenv', 'PATH', '/opt/bin:/usr/local/bin:/usr/bin:/bin',
    '--setenv', 'HOME', '/tmp', '--setenv', 'TMPDIR', '/tmp', '--chdir', '/mnt',
  )
  args.push('/bin/sh', '-lc', command)
  const result = await execa('bwrap', args, { timeout, cancelSignal: signal })
  return { stdout: result.stdout, stderr: result.stderr }
}

export const Shell: Tool = {
  name: 'shell',
  description: 'Run a shell command. Worker tasks are sandboxed to their workspace without network or inherited secrets.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      command: { type: 'string', minLength: 1, description: 'Shell command to run' },
      timeout: { type: 'number', minimum: 0.001, description: 'Timeout in seconds (default: 30)' },
    },
    required: ['command'],
  },
  async execute(args, context) {
    const command = args.command as string
    const timeoutArg = args.timeout as number | undefined
    const timeout = timeoutArg != null && Number.isFinite(timeoutArg) && timeoutArg > 0 ? timeoutArg * 1000 : SHELL_TIMEOUT_MS
    const warning = destructiveWarning(command)
    if (context?.permissionProfile === 'writer-worktree' && context.workspaceIsolation === 'serialized-writer') {
      return 'Command blocked — shell writes require a Git worktree; serialized fallback only permits path-validated file tools.'
    }
    if (warning) {
      if (context && (context.permissionProfile !== 'coordinator-integrator' || !context.dangerousOperationApproved)) {
        return 'Command blocked — destructive commands require coordinator confirmation.'
      }
      if (!context && (!legacyConfirmHandler || !await legacyConfirmHandler(warning))) return 'Command cancelled by user.'
    }

    try {
      const cwd = context?.workspacePath ?? process.cwd()
      const result = context && context.permissionProfile !== 'coordinator-integrator'
        ? await runSandboxed(command, cwd, timeout, context.permissionProfile === 'tester', context.signal)
        : await execa(command, { shell: true, cwd, timeout, cancelSignal: context?.signal })
      return [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, SHELL_OUTPUT_MAX_CHARS) || '(no output)'
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string; code?: string }
      const prefix = context?.signal?.aborted ? 'Cancelled' : 'Error'
      return `${prefix}: ${failure.stderr || failure.message || 'Command failed'}\n${failure.stdout || ''}`.slice(0, SHELL_OUTPUT_MAX_CHARS)
    }
  },
}
