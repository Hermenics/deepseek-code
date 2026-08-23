import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, realpathSync } from 'node:fs'
import { execa } from 'execa'
import type { Tool } from '../types.js'
import { SHELL_OUTPUT_MAX_CHARS, SHELL_TIMEOUT_MS } from '../../constants.js'
import { isPathIgnored, IGNORE_FILE_NAME } from '../shared/deepseekignore.js'
import { hasBinary, isLinux, scrubbedEnv, defaultShell, isWindows } from '../../utils/platform.js'
import { hasNetworkCapability } from '../../permissions/risk.js'

function tokenizeShellSegments(command: string): string[][] {
  const segments: string[][] = [[]]
  let token = ''
  let quote: '\'' | '"' | null = null
  let escaped = false

  const flush = () => {
    if (token) segments[segments.length - 1]!.push(token)
    token = ''
  }

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    if (escaped) {
      token += char
      escaped = false
      continue
    }
    if (quote === '\'') {
      if (char === '\'') quote = null
      else token += char
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = null
      else if (char === '\\') escaped = true
      else token += char
      continue
    }
    if (char === '\\') { escaped = true; continue }
    if (char === '\'' || char === '"') { quote = char; continue }
    if (/\s/.test(char)) { flush(); continue }
    if (char === '<' || char === '>') {
      flush()
      if (command[i + 1] === char) i++
      continue
    }
    if (char === ';' || char === '|' || char === '&' || char === '\n') {
      flush()
      if (segments[segments.length - 1]!.length > 0) segments.push([])
      if ((char === '|' || char === '&') && command[i + 1] === char) i++
      continue
    }
    token += char
  }
  flush()
  return segments.filter(segment => segment.length > 0)
}

/**
 * Best-effort .deepseekignore guard for shell commands. A shell can't be
 * fully policed, but the common case — the model naming an ignored path as
 * an argument — is caught here. Only tokens that resolve to an existing
 * path count, which keeps regex patterns and URLs from false-positiving.
 * ponytail: token heuristic; pipes/subshells building paths dynamically slip through.
 */
export function findIgnoredShellPath(command: string, cwd: string): string | null {
  for (const segment of tokenizeShellSegments(command)) {
    for (const token of segment.slice(1)) {
      if (!token || token.startsWith('-')) continue
      const resolved = resolve(cwd, token)
      if (existsSync(resolved) && isPathIgnored(resolved, cwd)) return token
    }
  }
  return null
}

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-z]*f[a-z]*|-[a-z]*r[a-z]*f[a-z]*|--force|--recursive)\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+--force|push\s+-f)\b/i,
  /\bdrop\s+(table|database)\b/i, /\btruncate\s+table\b/i, /\bmkfs\b/,
  /\bdd\s+.*of=/, /\bchmod\s+-R\s+777\b/, /\bsudo\s+rm\b/, />\s*\/dev\/(sd[a-z]|nvme)/,
]

function destructiveWarning(command: string): string | null {
  return DESTRUCTIVE_PATTERNS.find(pattern => pattern.test(command)) ? `Destructive command detected: ${command}` : null
}

/** Prepended to worker output when OS-level sandboxing could not be applied. */
const SANDBOX_UNAVAILABLE_NOTICE =
  '[sandbox unavailable on this platform — contextual shell execution is blocked because cwd and a scrubbed environment are not filesystem containment]'

function sandboxAvailableForShell(): boolean {
  if (!isLinux || !hasBinary('bwrap')) return false
  try {
    execFileSync('bwrap', [
      '--die-with-parent', '--new-session',
      '--ro-bind', '/usr', '/usr',
      '--ro-bind-try', '/bin', '/bin', '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
      '--dev', '/dev', '--proc', '/proc', '--unshare-net', '--', '/usr/bin/true',
    ], { stdio: 'ignore', timeout: 3000, env: scrubbedEnv() })
    return true
  } catch {
    return false
  }
}

export type ConfirmHandler = (message: string) => Promise<boolean>
let legacyConfirmHandler: ConfirmHandler | null = null

/** @deprecated Runtime calls should supply authorization through ToolExecutionContext. */
export function setShellConfirmHandler(handler: ConfirmHandler | null): void { legacyConfirmHandler = handler }

async function runSandboxed(command: string, cwd: string, timeout: number, readOnly: boolean, allowNetwork: boolean, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  const bunBin = dirname(process.execPath)
  const args = [
    '--die-with-parent', '--new-session',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/bin', '/bin', '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
    readOnly ? '--ro-bind' : '--bind', cwd, '/mnt',
  ]
  if (bunBin.startsWith(`${homedir()}/`)) args.push('--ro-bind', bunBin, '/opt/bin')
  if (allowNetwork) {
    const resolvTarget = (() => { try { return realpathSync('/etc/resolv.conf') } catch { return null } })()
    if (resolvTarget) args.push('--ro-bind-try', resolvTarget, resolvTarget)
    args.push('--ro-bind-try', '/etc/resolv.conf', '/etc/resolv.conf', '--ro-bind-try', '/etc/ssl/certs', '/etc/ssl/certs')
  }
  args.push(
    '--tmpfs', '/tmp',
    '--dev', '/dev', '--proc', '/proc', ...(allowNetwork ? [] : ['--unshare-net']), '--unshare-pid', '--unshare-ipc', '--unshare-uts',
    '--clearenv', '--setenv', 'PATH', '/opt/bin:/usr/local/bin:/usr/bin:/bin',
    '--setenv', 'HOME', '/tmp', '--setenv', 'TMPDIR', '/tmp', '--chdir', '/mnt',
  )
  args.push('/bin/sh', '-lc', command)
  const result = await execa('bwrap', args, {
    timeout,
    cancelSignal: signal,
    env: scrubbedEnv(),
    extendEnv: false,
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

/**
 * Fallback for platforms without bubblewrap (macOS, Windows). The OS-level
 * isolation cannot be reproduced, so this keeps what it still can: the command
 * is confined to the workspace cwd and inherits a scrubbed environment, so
 * provider keys and other secrets are not exposed. Network access IS reachable
 * here — unlike the bwrap path — which is why the caller labels the output.
 */
async function runUnsandboxed(command: string, cwd: string, timeout: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  const result = await execa(command, {
    shell: isWindows ? true : defaultShell(),
    cwd,
    timeout,
    cancelSignal: signal,
    env: scrubbedEnv(),
    extendEnv: false,
    windowsHide: true,
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

export const Shell: Tool = {
  name: 'shell',
  description: 'Run a shell command in an isolated workspace with a scrubbed environment. Network access requires explicit approval.',
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
    const networkCapability = hasNetworkCapability('shell', { command })
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
    if (networkCapability && (!context || !context.dangerousOperationApproved)) {
      return 'Command blocked — network access requires explicit approval.'
    }

    const workspaceCwd = context?.workspacePath ?? process.cwd()
    const ignoredPath = findIgnoredShellPath(command, workspaceCwd)
    if (ignoredPath) {
      return `Command blocked — '${ignoredPath}' is excluded by ${IGNORE_FILE_NAME} (or DeepSeek Code's defaults when the file is absent). ` +
        `This is intentional and user-controlled. If access is genuinely needed, ask the user to edit ${IGNORE_FILE_NAME} at the project root.`
    }

    try {
      const cwd = workspaceCwd
      const needsSandbox = !!context
      const degraded = needsSandbox && !sandboxAvailableForShell()
      if (degraded) return `Error: ${SANDBOX_UNAVAILABLE_NOTICE}`
      const result = needsSandbox
        ? await runSandboxed(command, cwd, timeout, context!.permissionProfile === 'tester', networkCapability && context!.dangerousOperationApproved === true, context!.signal)
        : await runUnsandboxed(command, cwd, timeout)
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)'
      return output.slice(0, SHELL_OUTPUT_MAX_CHARS)
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string; code?: string }
      const prefix = context?.signal?.aborted ? 'Cancelled' : 'Error'
      const notice = context && !sandboxAvailableForShell()
        ? `${SANDBOX_UNAVAILABLE_NOTICE}\n`
        : ''
      return `${prefix}: ${notice}${failure.stderr || failure.message || 'Command failed'}\n${failure.stdout || ''}`.slice(0, SHELL_OUTPUT_MAX_CHARS)
    }
  },
}
