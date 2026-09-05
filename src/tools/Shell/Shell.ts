import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, realpathSync } from 'node:fs'
import { execa } from 'execa'
import type { Tool } from '../types.js'
import type { ToolExecutionContext, TaskHandle } from '../../orchestration/types.js'
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
  const subprocess = execa('bwrap', args, {
    timeout,
    cancelSignal: signal,
    env: scrubbedEnv(),
    extendEnv: false,
  })
  const stopReading = () => { subprocess.stdout?.destroy(); subprocess.stderr?.destroy() }
  signal?.addEventListener('abort', stopReading, { once: true })
  try {
    const result = await subprocess
    return { stdout: result.stdout, stderr: result.stderr }
  } finally {
    signal?.removeEventListener('abort', stopReading)
  }
}

/**
 * Fallback for platforms without bubblewrap (macOS, Windows). The OS-level
 * isolation cannot be reproduced, so this keeps what it still can: the command
 * is confined to the workspace cwd and inherits a scrubbed environment, so
 * provider keys and other secrets are not exposed. Network access IS reachable
 * here — unlike the bwrap path — which is why the caller labels the output.
 */
async function runUnsandboxed(command: string, cwd: string, timeout: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  const subprocess = execa(command, {
    shell: isWindows ? true : defaultShell(),
    cwd,
    timeout,
    cancelSignal: signal,
    env: scrubbedEnv(),
    extendEnv: false,
    windowsHide: true,
  })
  const stopReading = () => { subprocess.stdout?.destroy(); subprocess.stderr?.destroy() }
  signal?.addEventListener('abort', stopReading, { once: true })
  try {
    const result = await subprocess
    return { stdout: result.stdout, stderr: result.stderr }
  } finally {
    signal?.removeEventListener('abort', stopReading)
  }
}

interface PreparedShellExecution {
  command: string
  cwd: string
  timeout: number
  sandboxed: boolean
  readOnly: boolean
  allowNetwork: boolean
}

/**
 * Performs the checks shared by foreground and detached shell runs. Keeping
 * authorization here prevents the background path from becoming a permission
 * bypass just because it returns before the process finishes.
 */
async function prepareShellExecution(
  command: string,
  timeout: number,
  background: boolean,
  context?: ToolExecutionContext,
): Promise<PreparedShellExecution | string> {
  if (!command.trim()) return 'Error: Shell command must be a non-empty string.'
  if (background && (!context?.session || !context.session.registry)) {
    return 'Command blocked — background shell execution requires an active task session.'
  }

  const networkCapability = hasNetworkCapability('shell', { command })
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

  const cwd = context?.workspacePath ?? process.cwd()
  const ignoredPath = findIgnoredShellPath(command, cwd)
  if (ignoredPath) {
    return `Command blocked — '${ignoredPath}' is excluded by ${IGNORE_FILE_NAME} (or DeepSeek Code's defaults when the file is absent). ` +
      `This is intentional and user-controlled. If access is genuinely needed, ask the user to edit ${IGNORE_FILE_NAME} at the project root.`
  }

  return {
    command,
    cwd,
    timeout,
    sandboxed: Boolean(context),
    readOnly: context?.permissionProfile === 'tester',
    allowNetwork: networkCapability && context?.dangerousOperationApproved === true,
  }
}

function formatShellFailure(error: unknown, timeout: number, signal: AbortSignal | undefined, sandboxed: boolean): string {
  const failure = error as { stdout?: string; stderr?: string; message?: string; shortMessage?: string; exitCode?: number; timedOut?: boolean; signal?: string }
  const prefix = signal?.aborted ? 'Cancelled' : 'Error'
  const notice = sandboxed && !sandboxAvailableForShell() ? `${SANDBOX_UNAVAILABLE_NOTICE}\n` : ''
  const status = failure.timedOut
    ? `Command timed out after ${Math.round(timeout / 1000)}s and was killed.`
    : typeof failure.exitCode === 'number'
      ? `Command exited with code ${failure.exitCode}.`
      : failure.signal ? `Command was terminated by signal ${failure.signal}.` : ''
  const detail = [failure.stderr, failure.stdout].filter(Boolean).join('\n') || failure.shortMessage || failure.message || 'Command failed'
  return truncateShellOutput(`${prefix}: ${notice}${status ? `${status}\n` : ''}${detail}`)
}

async function runPreparedShell(execution: PreparedShellExecution, signal?: AbortSignal, strict = false): Promise<string> {
  try {
    if (execution.sandboxed && !sandboxAvailableForShell()) {
      if (strict) throw new Error(SANDBOX_UNAVAILABLE_NOTICE)
      return `Error: ${SANDBOX_UNAVAILABLE_NOTICE}`
    }
    // The registry owns the lifecycle of a detached task. Give execa a small
    // grace period so its own timeout cannot race the registry's timed_out
    // transition; cancellation still travels through the shared signal.
    const processTimeout = strict ? execution.timeout + 1000 : execution.timeout
    const result = execution.sandboxed
      ? await runSandboxed(execution.command, execution.cwd, processTimeout, execution.readOnly, execution.allowNetwork, signal)
      : await runUnsandboxed(execution.command, execution.cwd, processTimeout, signal)
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)'
    return truncateShellOutput(output)
  } catch (error) {
    if (strict) throw error
    return formatShellFailure(error, execution.timeout, signal, execution.sandboxed)
  }
}

function backgroundHandle(handle: TaskHandle<string>): string {
  return JSON.stringify({
    schemaVersion: 1,
    sessionId: handle.sessionId,
    taskId: handle.taskId,
    type: 'shell',
    state: handle.status().state,
  })
}

/**
 * Keeps the head and the tail of oversized output: the tail is where a failing build or test
 * run prints its verdict, and a head-only cut used to hide exactly that.
 */
export function truncateShellOutput(output: string, maxChars = SHELL_OUTPUT_MAX_CHARS): string {
  if (output.length <= maxChars) return output
  const head = Math.floor(maxChars * 0.6)
  const tail = maxChars - head
  const dropped = output.length - head - tail
  return `${output.slice(0, head)}\n\n… [${dropped} characters truncated — rerun with a narrower command, e.g. pipe through head/tail or grep] …\n\n${output.slice(output.length - tail)}`
}

export const Shell: Tool = {
  name: 'shell',
  description: `Run a shell command in the workspace with a scrubbed environment (no provider keys) and return its output; failures include their exit status. Set background=true to detach a controllable shell task and receive a task handle. Use it for builds, tests, git, package managers and other terminal work; prefer read_file, grep, glob and the edit tools for reading, searching and editing. Output is capped at ${SHELL_OUTPUT_MAX_CHARS} characters (head and tail kept); the command is killed after the timeout (default ${SHELL_TIMEOUT_MS / 1000}s). Network access requires explicit approval.`,
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      command: { type: 'string', minLength: 1, description: 'Shell command to run' },
      timeout: { type: 'number', minimum: 0.001, description: `Timeout in seconds (default ${SHELL_TIMEOUT_MS / 1000})` },
      background: { type: 'boolean', description: 'Detach the command and return a task handle that can be inspected or cancelled.' },
    },
    required: ['command'],
  },
  async execute(args, context) {
    const command = args.command as string
    const timeoutArg = args.timeout as number | undefined
    const timeout = timeoutArg != null && Number.isFinite(timeoutArg) && timeoutArg > 0 ? timeoutArg * 1000 : SHELL_TIMEOUT_MS
    const background = args.background === true
    const prepared = await prepareShellExecution(command, timeout, background, context)
    if (typeof prepared === 'string') return prepared
    if (background) {
      // A detached shell is still a normal registry task: it inherits the
      // parent hierarchy and can be cancelled through /task or the footer.
      const session = context!.session!
      const handle = session.spawn<string>({
        parentTaskId: context!.taskId,
        type: 'shell',
        mode: 'background',
        timeoutMs: Math.max(1, Math.trunc(timeout)),
        maxRetries: 0,
        permissionProfile: context!.permissionProfile,
        allowedTools: ['shell'],
        cancellationPolicy: 'detach',
        metadata: {
          origin: 'shell',
          task: command,
          prompt: command,
          command,
          shellBackground: true,
        },
      }, runContext => runPreparedShell(prepared, runContext.signal, true))
      return backgroundHandle(handle)
    }
    return runPreparedShell(prepared, context?.signal)
  },
}
