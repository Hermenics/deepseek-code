import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import type { Tool } from '../types.js'
import { detectVerificationCommand, LINUX_SANDBOX_TEST_ENV, runVerification, type VerificationCommand, type VerificationProcessResult, type VerificationResult } from '../../agent/verify.js'
import type { ShellExecutionReceiptV1, TaskArtifactV1, TaskHandle, TaskRecordV1, TaskRunContext, TaskRunner, ToolExecutionContext } from '../../orchestration/types.js'
import type { ShellWorkspaceObservationV1 } from '../../orchestration/types.js'
import { captureWorkspaceVersion, diffWorkspaceFileDigests, restoreWorkspaceFileDigests, serializeWorkspaceFileDigests } from '../../agent/workspaceVersion.js'
import { TaskRuntimeError } from '../../orchestration/lifecycle.js'
import { AGGREGATE_TURN_BYTES } from '../../orchestration/aggregateBudget.js'
import { SHELL_OUTPUT_MAX_CHARS, SHELL_TIMEOUT_MS } from '../../constants.js'
import { isPathIgnored, IGNORE_FILE_NAME } from '../shared/deepseekignore.js'
import { hasBinary, isLinux, scrubbedEnv } from '../../utils/platform.js'
import { hasNetworkCapability, hasPackageLifecycleScriptExecution, packageInstallLifecyclePolicy } from '../../permissions/risk.js'
import { readShellOutput, readShellOutputProvenance, saveShellOutput, type ShellOutputMetadata } from './outputArtifact.js'
import { launchShellSupervisor, readShellSupervisorStreamPage, shellSupervisorCanReattach, waitForShellSupervisor, type ShellSupervisorRequest, type ShellSupervisorResult, type ShellSupervisorState } from './supervisor.js'
import { captureShellStreams, shellCaptureCompletionState, shellProvenanceSummary, waitForShellProcess, type ShellStreamProvenance } from './streamCapture.js'
import { isSensitiveWorkspacePath, resolvePathForContext } from '../shared/pathSafety.js'
import { safeGraphemeEnd, safeGraphemeStart } from '../../utils/textBoundaries.js'
import { formatToolError } from '../result.js'
import { maskSecretsForOffsets } from '../../orchestration/events.js'

/** Rough POSIX-style tokenizer: honors quotes and backslash escapes, splits segments on `;`, `|`, `&`, `&&`, `||` and newlines, and drops redirection operators. Only used for the ignore-path heuristic, not for execution. */
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
export function findIgnoredShellPath(command: string, cwd: string, context?: ToolExecutionContext): string | null {
  for (const segment of tokenizeShellSegments(command)) {
    for (const token of segment.slice(1)) {
      if (!token || token.startsWith('-')) continue
      const resolved = context ? resolvePathForContext(token, context) : resolve(cwd, token)
      if (existsSync(resolved) && (isSensitiveWorkspacePath(resolved) || isSensitiveWorkspacePath(realpathSync(resolved)) || isPathIgnored(resolved, cwd))) return token
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

/** Warning text when the command matches a known destructive pattern (rm -rf, hard reset, force push, DROP TABLE, mkfs, dd...), otherwise null. */
function destructiveWarning(command: string): string | null {
  return DESTRUCTIVE_PATTERNS.find(pattern => pattern.test(command)) ? `Destructive command detected: ${command}` : null
}

/** Prepended to worker output when OS-level sandboxing could not be applied. */
const SANDBOX_UNAVAILABLE_NOTICE =
  '[sandbox unavailable on this platform — contextual shell execution is blocked because cwd and a scrubbed environment are not filesystem containment]'

/** True when bubblewrap exists on Linux and can actually create a namespace here, checked by running a trivial sandboxed `true`. */
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

/** Run under bubblewrap at /mnt, with isolated env/process namespaces and bounded streaming output. */
interface CapturedOutput {
  all: string
  preview: string
  totalChars: number
  totalBytes: number
  truncated: boolean
  drainTimedOut: boolean
  processGroupSettled: 'settled' | 'unknown'
  provenance: ShellStreamProvenance
  artifact?: { id: string; metadata: ShellOutputMetadata }
}

function createShellOutputByteMeter(recordOutputBytes: (bytes: number) => boolean) {
  let accountedBytes = 0
  let exceeded = false
  const record = (bytes: number) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(accountedBytes + bytes)) {
      exceeded = true
      return
    }
    if (bytes === 0) return
    accountedBytes += bytes
    try { if (!recordOutputBytes(bytes)) exceeded = true }
    catch { exceeded = true }
  }
  return {
    recordBytes: record,
    recordTotal(totalBytes: number): boolean {
      if (Number.isSafeInteger(totalBytes) && totalBytes > accountedBytes) record(totalBytes - accountedBytes)
      return exceeded
    },
  }
}

async function registerTrackedProcess(child: ChildProcess, trackProcess?: (child: ChildProcess) => void): Promise<void> {
  try { trackProcess?.(child) } catch (error) {
    const aborted = new AbortController()
    aborted.abort()
    await waitForShellProcess(child, 1, aborted.signal).catch(() => undefined)
    throw error
  }
}

function buildSandboxArgs(command: string, cwd: string, readOnly: boolean, allowNetwork: boolean): string[] {
  const runtimeBin = dirname(realpathSync(process.execPath))
  const args = [
    '--die-with-parent', '--new-session',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/bin', '/bin', '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
    readOnly ? '--ro-bind' : '--bind', cwd, '/mnt',
  ]
  args.push('--ro-bind', runtimeBin, '/opt/bin')
  if (allowNetwork) {
    const resolvTarget = (() => { try { return realpathSync('/etc/resolv.conf') } catch { return null } })()
    if (resolvTarget) args.push('--ro-bind-try', resolvTarget, resolvTarget)
    args.push('--ro-bind-try', '/etc/resolv.conf', '/etc/resolv.conf', '--ro-bind-try', '/etc/ssl/certs', '/etc/ssl/certs')
  }
  args.push(
    '--tmpfs', '/tmp',
    // Preserve host absolute workspace arguments without exposing its parent directories.
    ...(cwd === '/mnt' ? [] : [readOnly ? '--ro-bind' : '--bind', cwd, cwd]),
    '--dev', '/dev', '--proc', '/proc', ...(allowNetwork ? [] : ['--unshare-net']), '--unshare-pid', '--unshare-ipc', '--unshare-uts',
    '--clearenv', '--setenv', 'PATH', LINUX_SANDBOX_TEST_ENV.PATH!,
    '--setenv', 'HOME', LINUX_SANDBOX_TEST_ENV.HOME!, '--setenv', 'TMPDIR', LINUX_SANDBOX_TEST_ENV.TMPDIR!, '--chdir', '/mnt',
  )
  args.push('/bin/sh', '-c', command)
  return args
}

async function runSandboxed(command: string, cwd: string, timeout: number, readOnly: boolean, allowNetwork: boolean, signal?: AbortSignal, trackProcess?: (child: ChildProcess) => void, bwrapExecutable?: string, onOutputBytes?: (bytes: number) => void): Promise<CapturedOutput> {
  const args = buildSandboxArgs(command, cwd, readOnly, allowNetwork)
  const subprocess = spawn(bwrapExecutable ?? 'bwrap', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: scrubbedEnv(),
    windowsHide: true,
  })
  await registerTrackedProcess(subprocess, trackProcess)
  const processExited = new Promise<void>(resolve => subprocess.once('exit', () => resolve()))
  const capturePromise = captureShellStreams(subprocess.stdout, subprocess.stderr, processExited, undefined, undefined, onOutputBytes)
  const [capture, result] = await Promise.allSettled([capturePromise, waitForShellProcess(subprocess, timeout, signal)])
  const output = capture.status === 'fulfilled' ? capture.value : { content: '', preview: '', totalChars: 0, totalBytes: 0, truncated: false, drainTimedOut: false, provenance: { schema: 'shell_channel_provenance_v1', ordering: 'observed-arrival', stdoutChars: 0, stderrChars: 0, retainedChars: 0, segments: [], segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: false } as ShellStreamProvenance }
  // The bwrap leader owns a new PID namespace; once it exits the namespace cannot keep descendants alive.
  const processGroupSettled = capture.status === 'fulfilled' && (subprocess.exitCode !== null || subprocess.signalCode !== null) && !output.drainTimedOut ? 'settled' : 'unknown'
  if (result.status === 'rejected') Object.assign(result.reason, { all: output.content, outputPreview: output.preview, totalChars: output.totalChars, totalBytes: output.totalBytes, outputTruncated: output.truncated, drainTimedOut: output.drainTimedOut, processGroupSettled, provenance: output.provenance })
  if (capture.status === 'rejected') {
    const error = capture.reason instanceof Error ? capture.reason : new Error('Shell output capture failed', { cause: capture.reason })
    throw Object.assign(error, { processGroupSettled })
  }
  if (result.status === 'rejected') throw result.reason
  return { all: output.content, preview: output.preview, totalChars: output.totalChars, totalBytes: output.totalBytes, truncated: output.truncated, drainTimedOut: output.drainTimedOut, processGroupSettled, provenance: output.provenance }
}

interface PreparedShellExecution {
  command: string
  cwd: string
  projectRoot: string
  timeout: number
  readOnly: boolean
  allowNetwork: boolean
}

function shellSupervisorFingerprint(execution: PreparedShellExecution, sessionId: string, taskTimeoutMs: number): string {
  return createHash('sha256').update(JSON.stringify({
    sessionId, command: execution.command, cwd: execution.cwd, projectRoot: execution.projectRoot,
    timeoutMs: taskTimeoutMs, readOnly: execution.readOnly, allowNetwork: execution.allowNetwork,
  })).digest('hex')
}

function supervisorRequest(execution: PreparedShellExecution, sessionId: string, taskId: string, fingerprint: string, storageRoot?: string, recoveryRoot?: string): ShellSupervisorRequest {
  return {
    sessionId, taskId, storageRoot, recoveryRoot, fingerprint, executable: 'bwrap',
    args: buildSandboxArgs(execution.command, execution.cwd, execution.readOnly, execution.allowNetwork),
    cwd: execution.cwd, timeoutMs: Math.trunc(execution.timeout) + 1000,
  }
}

function supervisorArtifact(result: ShellSupervisorResult): CapturedOutput['artifact'] {
  return result.outputId && result.outputMetadata ? { id: result.outputId, metadata: result.outputMetadata } : undefined
}

async function runSupervisedSandboxed(
  execution: PreparedShellExecution,
  sessionId: string,
  taskId: string,
  fingerprint: string,
  storageRoot: string | undefined,
  recoveryRoot: string | undefined,
  signal?: AbortSignal,
  trackProcess?: (child: ChildProcess) => void,
  onProgress?: (state: ShellSupervisorState) => void,
  onOutputBytes?: (bytes: number) => void,
): Promise<CapturedOutput> {
  const request = supervisorRequest(execution, sessionId, taskId, fingerprint, storageRoot, recoveryRoot)
  await launchShellSupervisor(request, trackProcess)
  let lastOutputBytes = 0
  const observeOutputBytes = (state: ShellSupervisorState) => {
    const total = state.outputBytes
    if (!Number.isSafeInteger(total) || total! <= lastOutputBytes) return
    const delta = total! - lastOutputBytes
    lastOutputBytes = total!
    try { onOutputBytes?.(delta) } catch { /* Budget observation must not change command effects. */ }
  }
  let result: ShellSupervisorResult
  try {
    result = await waitForShellSupervisor(request, signal, state => {
      observeOutputBytes(state)
      onProgress?.(state)
    })
  } catch (error) {
    const state = (error as { supervisorState?: ShellSupervisorState }).supervisorState
    if (state) observeOutputBytes(state)
    throw error
  }
  observeOutputBytes(result)
  const output: CapturedOutput = {
    all: result.content, preview: result.outputPreview ?? result.content, totalChars: result.totalChars ?? result.content.length,
    totalBytes: result.outputBytes ?? AGGREGATE_TURN_BYTES,
    truncated: result.outputTruncated === true, drainTimedOut: result.drainTimedOut === true,
    processGroupSettled: result.processGroupSettled, provenance: result.provenance ?? {
      schema: 'shell_channel_provenance_v1', ordering: 'observed-arrival', stdoutChars: 0, stderrChars: 0,
      retainedChars: 0, segments: [], segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: true,
    }, artifact: supervisorArtifact(result),
  }
  if (result.state !== 'done') {
    const failure = new Error(result.state === 'timed_out' ? 'Command timed out.' : result.state === 'cancelled' ? 'Command was cancelled.' : `Command exited with code ${result.exitCode ?? 'unknown'}.`)
    throw Object.assign(failure, {
      all: output.all, outputPreview: output.preview, totalChars: output.totalChars, outputTruncated: output.truncated,
      totalBytes: output.totalBytes,
      drainTimedOut: output.drainTimedOut, processGroupSettled: output.processGroupSettled, provenance: output.provenance,
      exitCode: result.exitCode ?? undefined, signal: result.signal ?? undefined, timedOut: result.timedOut, cancelled: result.cancelled,
      artifact: output.artifact,
    })
  }
  return output
}

/** Optional host-injected root keeps shell artifacts inside isolated test/runtime storage. */
function shellOutputRoot(context?: ToolExecutionContext): string | undefined {
  return (context as (ToolExecutionContext & { shellOutputRoot?: string }) | undefined)?.shellOutputRoot
}

function shellOutputRecoveryRoot(context?: ToolExecutionContext): string | undefined {
  return (context as (ToolExecutionContext & { shellOutputRecoveryRoot?: string }) | undefined)?.shellOutputRecoveryRoot
}

function readYarnPackageManagerPin(cwd: string): string | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
    return typeof manifest === 'object' && manifest !== null && 'packageManager' in manifest && typeof manifest.packageManager === 'string'
      ? manifest.packageManager
      : undefined
  } catch {
    return undefined
  }
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
  if (!context) return 'Command blocked — shell execution requires an owning runtime context and OS sandbox.'
  if (background && (!context?.session || !context.session.registry)) {
    return 'Command blocked — background shell execution requires an active task session.'
  }

  const networkCapability = hasNetworkCapability('shell', { command })
  const packageManagerPin = /^\s*yarn(?:\s|$)/i.test(command) ? readYarnPackageManagerPin(context.workspacePath) : undefined
  if (packageInstallLifecyclePolicy(command, packageManagerPin) === 'blocked') {
    return 'Command blocked — package installs and dependency updates must use one direct supported invocation: npm, pnpm, or Bun with --ignore-scripts, or pinned Yarn 1 with --ignore-scripts. Yarn Berry, wrapped, compound, unpinned Yarn, and other package-manager install/update commands are not allowed.'
  }
  const runsLifecycleScripts = hasPackageLifecycleScriptExecution(command)
  const warning = destructiveWarning(command)
  if (context?.permissionProfile === 'writer-worktree' && context.workspaceIsolation === 'serialized-writer') {
    return 'Command blocked — shell writes require a Git worktree; serialized fallback only permits path-validated file tools.'
  }
  if (warning) {
    if (context.permissionProfile !== 'coordinator-integrator' || !context.dangerousOperationApproved) {
      return 'Command blocked — destructive commands require coordinator confirmation.'
    }
  }
  if (networkCapability && !context.dangerousOperationApproved) {
    return 'Command blocked — network access requires explicit approval.'
  }
  if (runsLifecycleScripts && !context.dangerousOperationApproved) {
    return 'Command blocked — lifecycle scripts require explicit approval.'
  }

  const cwd = context.workspacePath
  const ignoredPath = findIgnoredShellPath(command, cwd, context)
  if (ignoredPath) {
    const target = context ? resolvePathForContext(ignoredPath, context) : resolve(cwd, ignoredPath)
    if (isSensitiveWorkspacePath(target) || isSensitiveWorkspacePath(realpathSync(target))) {
      return `Command blocked — '${ignoredPath}' is a credential-like file and cannot be accessed by an agent.`
    }
    return `Command blocked — '${ignoredPath}' is excluded by ${IGNORE_FILE_NAME} (or DeepSeek Code's defaults when the file is absent). ` +
      `This is intentional and user-controlled. If access is genuinely needed, ask the user to edit ${IGNORE_FILE_NAME} at the project root.`
  }

  return {
    command,
    cwd,
    projectRoot: context.projectRoot,
    timeout,
    readOnly: context.permissionProfile === 'tester',
    allowNetwork: networkCapability && context.dangerousOperationApproved === true,
  }
}

/** Turn an execa failure into an `Error:`/`Cancelled:` message with status and captured output. */
function formatShellFailure(error: unknown, timeout: number, signal: AbortSignal | undefined): string {
  const failure = error as { all?: string; outputPreview?: string; stdout?: string; stderr?: string; message?: string; shortMessage?: string; exitCode?: number; timedOut?: boolean; signal?: string; drainTimedOut?: boolean }
  const prefix = signal?.aborted ? 'Cancelled' : 'Error'
  const notice = !sandboxAvailableForShell() ? `${SANDBOX_UNAVAILABLE_NOTICE}\n` : ''
  const status = failure.timedOut
    ? `Command timed out after ${Math.round(timeout / 1000)}s and was killed.`
    : typeof failure.exitCode === 'number'
      ? `Command exited with code ${failure.exitCode}.`
      : failure.signal ? `Command was terminated by signal ${failure.signal}.` : ''
  const detail = failure.outputPreview || failure.all || [failure.stderr, failure.stdout].filter(Boolean).join('\n') || failure.shortMessage || failure.message || 'Command failed'
  return `${prefix}: ${notice}${status ? `${status}\n` : ''}${detail}${failure.drainTimedOut ? '\n[Pipe drain deadline reached; output may be incomplete.]' : ''}`
}

function codePointLength(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++, count++) {
    const first = text.charCodeAt(i)
    if (first >= 0xd800 && first <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) i++
  }
  return count
}

interface BoundedShellOutput { text: string; artifact?: TaskArtifactV1 }

async function boundShellOutput(output: string, sessionId?: string, totalChars = output.length, captureTruncated = false, drainTimedOut = false, display = output, provenance?: ShellStreamProvenance, storageRoot?: string, recoveryRoot?: string, forceArtifact = false, retainedArtifact?: { id: string; metadata: ShellOutputMetadata }, outputQuotaExceeded = false): Promise<BoundedShellOutput> {
  const provenanceNote = provenance ? `\n\n[Shell channel provenance JSON: ${shellProvenanceSummary(provenance)}]` : ''
  const modelDisplay = `${display}${provenanceNote}`
  const previewChanged = display !== output
  if (!forceArtifact && !outputQuotaExceeded && !captureTruncated && !drainTimedOut && !previewChanged && codePointLength(modelDisplay) <= SHELL_OUTPUT_MAX_CHARS) return { text: modelDisplay }
  let note: string
  let taskArtifact: TaskArtifactV1 | undefined
  try {
    let metadata: ShellOutputMetadata
    if (retainedArtifact) {
      metadata = retainedArtifact.metadata
      taskArtifact = { id: retainedArtifact.id, kind: 'log', metadata: { ...metadata, storage: 'shell-output', persistence: metadata.storage } }
    } else {
      if (!sessionId) throw new Error('session unavailable')
      const artifact = await saveShellOutput(sessionId, output, totalChars, storageRoot, provenance, recoveryRoot)
      metadata = artifact.metadata
      taskArtifact = { id: artifact.id, kind: 'log', metadata: { ...metadata, storage: 'shell-output', persistence: metadata.storage } }
    }
    const reason = outputQuotaExceeded
      ? 'Captured output exceeded the shared per-turn byte budget; inspect command effects before retrying'
      : forceArtifact
      ? 'Background task output is retained'
      : captureTruncated || metadata.truncated
      ? 'Captured output is incomplete'
      : previewChanged
        ? codePointLength(modelDisplay) > SHELL_OUTPUT_MAX_CHARS
          ? 'Model preview is normalized and shortened'
          : 'Model preview differs from the original merged capture'
        : 'Model preview is shortened'
    note = `\n\n[${reason}. Retrieve retained captured output with shell output_id="${taskArtifact.id}"${metadata.truncated ? `; storage retained the first ${metadata.storedChars} of ${metadata.totalChars} UTF-16 code units` : ''}${metadata.redacted ? '; known secrets were masked without shifting offsets' : ''}${metadata.storage === 'recovery-disk' ? '; primary storage failed, saved in recovery storage' : ''}${metadata.storage === 'memory' ? '; memory-only fallback may be evicted under process-wide quota pressure before this process exits' : ''}${metadata.retentionWarning ? `; storage warning ${metadata.retentionWarning}` : ''}${drainTimedOut ? '; pipe drain deadline reached, later output may be missing' : ''}.${provenanceNote}]`
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const reason = outputQuotaExceeded ? 'Captured output exceeded the shared per-turn byte budget; the command may already have taken effect'
      : captureTruncated ? 'Captured output is incomplete' : previewChanged
      ? codePointLength(modelDisplay) > SHELL_OUTPUT_MAX_CHARS ? 'Model preview is normalized and shortened' : 'Model preview differs from original capture'
      : 'Model preview is shortened'
    note = `\n\n[${reason}; recovery artifact could not be saved${code ? ` (${code})` : ''}.]`
  }
  const previewLimit = Math.max(0, SHELL_OUTPUT_MAX_CHARS - codePointLength(note))
  return { text: truncateShellOutput(modelDisplay, previewLimit) + note, ...(taskArtifact ? { artifact: taskArtifact } : {}) }
}

const SHELL_RECEIPT_PREVIEW_MAX_CHARS = 1_000
const MAX_BUBBLEWRAP_HASH_BYTES = 16 * 1024 * 1024

function shellExecutorProvenance(): ShellExecutionReceiptV1['executor'] {
  const base: ShellExecutionReceiptV1['executor'] = { kind: 'bubblewrap', commandExecutable: 'unknown' }
  try {
    const selected = Bun.which('bwrap')
    if (!selected) return base
    const path = realpathSync(selected)
    const info = statSync(path)
    if (!info.isFile()) return base
    if (info.size > MAX_BUBBLEWRAP_HASH_BYTES) return { ...base, path }
    return { ...base, path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
  } catch {
    return base
  }
}

function shellArtifactReceipt(artifact?: TaskArtifactV1): ShellExecutionReceiptV1['outputArtifact'] | undefined {
  if (!artifact || artifact.kind !== 'log' || !artifact.metadata) return undefined
  const metadata = artifact.metadata
  const totalChars = metadata.totalChars
  const storedChars = metadata.storedChars
  const storage = metadata.storage === 'shell-output' ? metadata.persistence : metadata.storage
  if (!Number.isSafeInteger(totalChars) || !Number.isSafeInteger(storedChars)
    || typeof metadata.truncated !== 'boolean'
    || !['disk', 'recovery-disk', 'emergency-disk', 'memory'].includes(String(storage))) return undefined
  return {
    kind: 'log',
    totalChars: totalChars as number,
    storedChars: storedChars as number,
    truncated: metadata.truncated,
    redacted: metadata.redacted === true,
    storage: storage as NonNullable<ShellExecutionReceiptV1['outputArtifact']>['storage'],
  }
}

function makeShellExecutionReceipt(
  execution: PreparedShellExecution,
  executor: ShellExecutionReceiptV1['executor'],
  state: ShellExecutionReceiptV1['state'],
  workspaceObservation: ShellWorkspaceObservationV1,
  details: {
    exitCode?: number | null
    signal?: string | null
    timedOut?: boolean
    cancelled?: boolean
    outputPreview?: string
    outputChars?: number
    outputTruncated?: boolean
    drainTimedOut?: boolean
    artifact?: TaskArtifactV1
  } = {},
): ShellExecutionReceiptV1 {
  const artifact = details.artifact
  const outputArtifact = shellArtifactReceipt(artifact)
  const outputPreview = details.outputPreview === undefined
    ? undefined
    : truncateShellOutput(maskSecretsForOffsets(details.outputPreview), SHELL_RECEIPT_PREVIEW_MAX_CHARS)
  return {
    schema: 'shell_execution_v1',
    state,
    exitCode: details.exitCode ?? null,
    signal: details.signal?.slice(0, 64) ?? null,
    timedOut: details.timedOut === true,
    cancelled: details.cancelled === true,
    cwd: execution.cwd,
    projectRoot: execution.projectRoot,
    workspaceObservation,
    executor,
    ...(outputPreview !== undefined ? { outputPreview } : {}),
    outputChars: Number.isFinite(details.outputChars) ? Math.max(0, Math.trunc(details.outputChars!)) : 0,
    outputTruncated: details.outputTruncated === true,
    drainTimedOut: details.drainTimedOut === true,
    ...(artifact?.id ? { outputId: artifact.id.slice(0, 128) } : {}),
    ...(outputArtifact ? { outputArtifact } : {}),
  }
}

async function persistForegroundShellReceipt(
  record: ToolExecutionContext['recordShellExecution'],
  receipt: ShellExecutionReceiptV1,
  commandMayHaveStarted: boolean,
): Promise<void> {
  if (!record) return
  try {
    await record(receipt)
  } catch (error) {
    if ((error as { code?: unknown } | undefined)?.code === 'SHELL_EVIDENCE_CHECKPOINT_FAILED') throw error
    const message = commandMayHaveStarted
      ? 'Shell may already have run, but its execution receipt could not be recorded. Inspect current effects before retrying.'
      : 'Shell was not started because its running receipt could not be recorded. Inspect session evidence before retrying.'
    throw new TaskRuntimeError('SHELL_EVIDENCE_CHECKPOINT_FAILED', message, false)
  }
}

function shellReceiptOutcomeUnknown(details: { processGroupSettled?: 'settled' | 'unknown'; drainTimedOut?: boolean }): boolean {
  return details.processGroupSettled === 'unknown' || details.drainTimedOut === true
}

interface ShellExecutionSummary {
  schema: 'shell_execution_v1'
  state: 'running' | 'exited' | 'unknown' | 'failed' | 'cancelled' | 'timed_out'
  exitCode: number | null
  signal: string | null
  effects: 'not-reconciled'
  workspaceObservation: ShellWorkspaceObservationV1
  workspaceBaselineFileDigests?: Array<[string, string]>
  outputId?: string
  outputChars: number
  outputPreview?: string
  outputTruncated: boolean
  drainTimedOut: boolean
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function unknownShellWorkspaceObservation(): ShellWorkspaceObservationV1 {
  return {
    schema: 'shell_workspace_observation_v1', scope: 'workspace-source-inputs', status: 'unknown',
    cwdRelative: '', processGroupSettled: 'unknown',
  }
}

async function captureShellWorkspaceBaseline(execution: PreparedShellExecution): Promise<{ observation: ShellWorkspaceObservationV1; fileDigests?: ReadonlyMap<string, string> }> {
  const unknown = unknownShellWorkspaceObservation()
  try {
    const root = realpathSync(execution.projectRoot)
    const cwd = realpathSync(execution.cwd)
    if (!inside(root, cwd)) return { observation: unknown }
    const version = await captureWorkspaceVersion(cwd, undefined, [], { includeFileDigests: true })
    return {
      observation: {
        ...unknown, status: 'pending', cwdRelative: relative(root, cwd),
        baselineDigest: version.digest, capturedAt: new Date().toISOString(),
      },
      fileDigests: version.fileDigests,
    }
  } catch {
    return { observation: unknown }
  }
}

async function observeShellWorkspace(execution: PreparedShellExecution, observation: ShellWorkspaceObservationV1, processGroupSettled: 'settled' | 'unknown' = 'unknown', baselineFileDigests?: ReadonlyMap<string, string>): Promise<ShellWorkspaceObservationV1> {
  const observedAt = new Date().toISOString()
  if (observation.status !== 'pending' || !observation.baselineDigest) return { ...observation, status: 'unknown', observedAt, processGroupSettled, fileChangesStatus: 'unknown' }
  if (processGroupSettled === 'unknown') return { ...observation, status: 'unknown', observedAt, processGroupSettled, fileChangesStatus: 'unknown' }
  try {
    const root = realpathSync(execution.projectRoot)
    const cwd = realpathSync(execution.cwd)
    if (!inside(root, cwd) || relative(root, cwd) !== observation.cwdRelative) throw new Error('Workspace path changed')
    const version = await captureWorkspaceVersion(cwd, undefined, [], { includeFileDigests: baselineFileDigests !== undefined })
    const observedDigest = version.digest
    if (observedDigest === observation.baselineDigest) {
      return {
        ...observation, status: 'no-change-observed', observedDigest, observedAt, processGroupSettled,
        fileChangesStatus: 'complete', fileChangesRootRelative: relative(root, version.root) || '.', fileChanges: [], omittedFileChanges: 0,
      }
    }
    const changes = baselineFileDigests && version.fileDigests ? diffWorkspaceFileDigests(baselineFileDigests, version.fileDigests) : undefined
    return {
      ...observation, status: 'changed', observedDigest, observedAt, processGroupSettled,
      fileChangesStatus: changes ? 'complete' : 'unknown',
      ...(changes ? {
        fileChangesRootRelative: relative(root, version.root) || '.',
        fileChanges: changes.changes,
        omittedFileChanges: changes.omitted,
      } : {}),
    }
  } catch {
    return { ...observation, status: 'unknown', observedAt, processGroupSettled, fileChangesStatus: 'unknown' }
  }
}

async function recordObservedShellWorkspaceEffect(effectId: string | undefined, markEffectOutcome: ToolExecutionContext['markEffectOutcome'], observation?: ShellWorkspaceObservationV1): Promise<void> {
  if (!effectId || !markEffectOutcome || observation?.status !== 'changed' || !observation.observedDigest) return
  try { await markEffectOutcome(effectId, 'effect-observed', `shell-workspace-changed:${observation.observedDigest}`) }
  catch { /* Keep the already-persisted effect marker unknown if recording the observation fails. */ }
}

/**
 * Run a prepared command (sandboxed whenever a task context exists, and refused if the sandbox is unavailable) and return truncated output.
 * In `strict` mode (background tasks) failures are thrown so the registry records them, and the process timeout gets a 1s grace so the registry's own timeout wins.
 */
async function runPreparedShell(execution: PreparedShellExecution, signal?: AbortSignal, strict = false, sessionId?: string, storageRoot?: string, recoveryRoot?: string, trackProcess?: (child: ChildProcess) => void, observe?: (summary: ShellExecutionSummary, artifact?: TaskArtifactV1) => void, persist?: () => Promise<void>, taskId?: string, fingerprint?: string, effectId?: string, markEffectOutcome?: ToolExecutionContext['markEffectOutcome'], recordShellExecution?: ToolExecutionContext['recordShellExecution'], foregroundRunner: typeof runSandboxed = runSandboxed, recordOutputBytes: (bytes: number) => boolean = () => true): Promise<string> {
  let workspaceObservation: ShellWorkspaceObservationV1 | undefined
  let workspaceFileDigests: ReadonlyMap<string, string> | undefined
  let workspaceBaselineFileDigests: Array<[string, string]> | undefined
  const receiptRecorder = strict ? undefined : recordShellExecution
  const executor = receiptRecorder ? shellExecutorProvenance() : undefined
  const outputByteMeter = createShellOutputByteMeter(recordOutputBytes)
  let commandMayHaveStarted = false
  try {
    if (!sandboxAvailableForShell()) {
      if (strict) throw new Error(SANDBOX_UNAVAILABLE_NOTICE)
      if (receiptRecorder) {
        await persistForegroundShellReceipt(receiptRecorder, makeShellExecutionReceipt(
          execution, executor!, 'failure', unknownShellWorkspaceObservation(),
          { outputPreview: SANDBOX_UNAVAILABLE_NOTICE },
        ), false)
      }
      return `Error: ${SANDBOX_UNAVAILABLE_NOTICE}`
    }
    if (strict || effectId && markEffectOutcome || receiptRecorder) {
      const baseline = await captureShellWorkspaceBaseline(execution)
      workspaceObservation = baseline.observation
      workspaceFileDigests = baseline.fileDigests
      workspaceBaselineFileDigests = serializeWorkspaceFileDigests(workspaceFileDigests)
      if (strict) {
        observe?.({
          schema: 'shell_execution_v1', state: 'running', exitCode: null, signal: null, effects: 'not-reconciled',
          workspaceObservation, ...(workspaceBaselineFileDigests ? { workspaceBaselineFileDigests } : {}),
          outputChars: 0, outputTruncated: false, drainTimedOut: false,
        })
        await persist?.()
        signal?.throwIfAborted()
      }
    }
    if (receiptRecorder) {
      await persistForegroundShellReceipt(receiptRecorder, makeShellExecutionReceipt(
        execution, executor!, 'running', workspaceObservation ?? unknownShellWorkspaceObservation(),
      ), false)
    }
    // Give the registry timeout a small lead so its timed_out state wins over the shell's own timeout.
    const processTimeout = strict ? execution.timeout + 1000 : execution.timeout
    commandMayHaveStarted = true
    const result = strict && sessionId && taskId && fingerprint
      ? await runSupervisedSandboxed(execution, sessionId, taskId, fingerprint, storageRoot, recoveryRoot, signal, trackProcess, state => observe?.({
        schema: 'shell_execution_v1', state: 'running', exitCode: null, signal: null, effects: 'not-reconciled',
        workspaceObservation: workspaceObservation ?? unknownShellWorkspaceObservation(),
        ...(workspaceBaselineFileDigests ? { workspaceBaselineFileDigests } : {}), outputChars: state.totalChars ?? 0,
        outputPreview: state.outputPreview, outputTruncated: state.outputTruncated === true, drainTimedOut: false,
      }), outputByteMeter.recordBytes)
      : await (strict ? runSandboxed : foregroundRunner)(execution.command, execution.cwd, processTimeout, execution.readOnly, execution.allowNetwork, signal, trackProcess, receiptRecorder ? executor?.path : undefined, outputByteMeter.recordBytes)
    const outputQuotaExceeded = outputByteMeter.recordTotal(result.totalBytes)
    const outcome = shellCaptureCompletionState(result.processGroupSettled, result.drainTimedOut === true)
    const output = result.all || '(no output)'
    const silentSuccess = result.all.length === 0 && !result.truncated && !result.drainTimedOut && result.processGroupSettled === 'settled'
    const display = silentSuccess
      ? 'Command completed with exit code 0 and no output; output capture completed.'
      : result.preview || output
    const bounded = silentSuccess
      ? { text: display }
      : await boundShellOutput(output, sessionId, result.totalChars, result.truncated, result.drainTimedOut, display, result.provenance, storageRoot, recoveryRoot, strict, result.artifact, outputQuotaExceeded)
    const observedWorkspace = strict || effectId && markEffectOutcome || receiptRecorder
      ? await observeShellWorkspace(execution, workspaceObservation!, result.processGroupSettled, workspaceFileDigests) : undefined
    await recordObservedShellWorkspaceEffect(effectId, markEffectOutcome, observedWorkspace)
    if (receiptRecorder) {
      await persistForegroundShellReceipt(receiptRecorder, makeShellExecutionReceipt(
        execution, executor!, outcome === 'unknown' ? 'unknown' : 'completed',
        observedWorkspace ?? unknownShellWorkspaceObservation(),
        {
          exitCode: 0, outputPreview: result.preview, outputChars: result.totalChars,
          outputTruncated: result.truncated, drainTimedOut: result.drainTimedOut, artifact: bounded.artifact,
        },
      ), true)
    }
    if (strict) observe?.({
      schema: 'shell_execution_v1', state: outcome === 'unknown' ? 'unknown' : 'exited', exitCode: 0, signal: null, effects: 'not-reconciled',
      workspaceObservation: observedWorkspace!,
      ...(bounded.artifact ? { outputId: bounded.artifact.id } : {}), outputChars: result.totalChars, outputPreview: result.preview,
      outputTruncated: result.truncated, drainTimedOut: result.drainTimedOut,
    }, bounded.artifact)
    if (outputQuotaExceeded) {
      const message = `Captured Shell output exceeded the shared ${AGGREGATE_TURN_BYTES / (1024 * 1024)} MiB turn byte budget. The command may already have taken effect; inspect the workspace and retained output before retrying.${bounded.artifact ? ` Recover output with shell output_id="${bounded.artifact.id}".` : ''}`
      if (strict) throw new TaskRuntimeError('AGGREGATE_OUTPUT_BYTES_EXCEEDED', message, false)
      return formatToolError('tool', 'AGGREGATE_OUTPUT_BYTES_EXCEEDED', message, false, {
        state: outcome === 'unknown' ? 'unknown' : 'completed', outputIncomplete: result.truncated || result.drainTimedOut,
        outputBytes: result.totalBytes, ...(bounded.artifact ? { outputId: bounded.artifact.id } : {}),
      })
    }
    if (outcome === 'unknown') {
      const message = 'Shell process completion or output capture is unknown; do not treat this command as successful or replay it automatically.'
      if (strict) throw new TaskRuntimeError('SHELL_OUTCOME_UNKNOWN', `${message}${bounded.artifact ? ` Recover output with shell output_id="${bounded.artifact.id}".` : ''}`, false)
      return formatToolError('tool', 'SHELL_OUTCOME_UNKNOWN', message, false, {
        state: 'unknown', exitCode: 0, signal: null, output: truncateShellOutput(result.preview, 1_000),
        outputIncomplete: true, processGroupSettled: result.processGroupSettled, drainTimedOut: result.drainTimedOut,
        ...(bounded.artifact ? { outputId: bounded.artifact.id } : {}),
      })
    }
    return bounded.text
  } catch (error) {
    if ((error as { code?: unknown } | undefined)?.code === 'SHELL_EVIDENCE_CHECKPOINT_FAILED') throw error
    if (error instanceof TaskRuntimeError && error.code === 'SHELL_OUTCOME_UNKNOWN') throw error
    if (error instanceof TaskRuntimeError && error.code === 'AGGREGATE_OUTPUT_BYTES_EXCEEDED') throw error
    const details = error as { all?: string; outputPreview?: string; totalChars?: number; totalBytes?: number; outputTruncated?: boolean; drainTimedOut?: boolean; processGroupSettled?: 'settled' | 'unknown'; provenance?: ShellStreamProvenance; exitCode?: number; timedOut?: boolean; signal?: string; cancelled?: boolean; artifact?: { id: string; metadata: ShellOutputMetadata }; supervisorState?: ShellSupervisorState }
    if (strict && details.supervisorState) {
      const preview = details.supervisorState.outputPreview ?? ''
      const previewArtifact = preview && sessionId
        ? await saveShellOutput(sessionId, `${preview}\n\n[Only the last redacted progress preview was retained; the full output is unavailable.]`, undefined, storageRoot, undefined, recoveryRoot)
          .then(saved => ({ id: saved.id, kind: 'log' as const, metadata: { ...saved.metadata, storage: 'shell-output', persistence: saved.metadata.storage } }))
          .catch(() => undefined)
        : undefined
      const reasonCode = (signal?.reason as { code?: string } | undefined)?.code
      const state = details.supervisorState.state === 'timed_out' || details.timedOut || reasonCode === 'TIMED_OUT' ? 'timed_out'
        : details.supervisorState.state === 'cancelled' || details.cancelled || signal?.aborted ? 'cancelled' : 'failed'
      const partialWorkspace = await observeShellWorkspace(execution, workspaceObservation ?? unknownShellWorkspaceObservation(), 'unknown', workspaceFileDigests)
      observe?.({
        schema: 'shell_execution_v1', state, exitCode: null, signal: null, effects: 'not-reconciled',
        workspaceObservation: partialWorkspace, ...(workspaceBaselineFileDigests ? { workspaceBaselineFileDigests } : {}),
        ...(previewArtifact ? { outputId: previewArtifact.id } : {}),
        outputChars: details.supervisorState.totalChars ?? 0,
        ...(preview ? { outputPreview: preview } : {}), outputTruncated: true, drainTimedOut: false,
      }, previewArtifact)
      await persist?.()
      const previewNote = preview ? `\n\nLast redacted progress preview (incomplete):\n${preview}` : ''
      const recoveryNote = previewArtifact
        ? ` Recover the retained preview with shell output_id="${previewArtifact.id}"; the full output was not saved.`
        : preview ? ' The preview could not be saved as a recoverable output artifact.' : ''
      const code = state === 'timed_out' ? 'TIMED_OUT' : state === 'cancelled' ? 'CANCELLED' : 'SHELL_SUPERVISOR_LOST'
      const reason = state === 'timed_out' ? 'Shell supervisor timed out before saving its final output'
        : state === 'cancelled' ? 'Shell supervisor was cancelled before saving its final output'
          : 'Shell supervisor exited before saving its final output'
      throw new TaskRuntimeError(code, `${reason}. Job status and external effects remain unresolved; do not replay it automatically.${recoveryNote}${previewNote}`, false)
    }
    const formatted = formatShellFailure(error, execution.timeout, signal)
    const display = details.outputTruncated
      ? formatShellFailure({ ...details, outputPreview: details.outputPreview }, execution.timeout, signal)
      : formatted
    // Artifact offsets describe the captured stdout/stderr stream, so keep status framing in the preview only.
    const capturedOutput = details.all ?? formatted
    const observedOutput = details.all ?? details.outputPreview ?? ''
    const observedBytes = Number.isSafeInteger(details.totalBytes) && details.totalBytes! >= 0
      ? details.totalBytes! : Buffer.byteLength(observedOutput, 'utf8')
    const outputQuotaExceeded = commandMayHaveStarted && outputByteMeter.recordTotal(observedBytes)
    const bounded = await boundShellOutput(capturedOutput, sessionId, details.totalChars ?? formatted.length, details.outputTruncated, details.drainTimedOut, display, details.provenance, storageRoot, recoveryRoot, strict || outputQuotaExceeded, details.artifact, outputQuotaExceeded)
    if (strict || effectId && markEffectOutcome || receiptRecorder) {
      workspaceObservation ??= unknownShellWorkspaceObservation()
      const observedWorkspace = await observeShellWorkspace(execution, workspaceObservation, details.processGroupSettled, workspaceFileDigests)
      await recordObservedShellWorkspaceEffect(effectId, markEffectOutcome, observedWorkspace)
      if (receiptRecorder) {
        const state = shellReceiptOutcomeUnknown(details) ? 'unknown' : 'failure'
        const signalReasonCode = (signal?.reason as { code?: string } | undefined)?.code
        await persistForegroundShellReceipt(receiptRecorder, makeShellExecutionReceipt(
          execution, executor!, state, observedWorkspace,
          {
            exitCode: details.exitCode ?? null,
            signal: details.signal ?? null,
            timedOut: details.timedOut === true || signalReasonCode === 'TIMED_OUT',
            cancelled: signalReasonCode !== 'TIMED_OUT' && (details.cancelled === true || signal?.aborted === true),
            outputPreview: details.outputPreview ?? details.all ?? formatted,
            outputChars: details.totalChars ?? formatted.length,
            outputTruncated: details.outputTruncated === true,
            drainTimedOut: details.drainTimedOut === true,
            artifact: bounded.artifact,
          },
        ), commandMayHaveStarted)
      }
      if (strict) {
        const reason = signal?.reason as { code?: string } | undefined
        const state = details.timedOut || reason?.code === 'TIMED_OUT' ? 'timed_out'
          : signal?.aborted || reason?.code === 'CANCELLED' ? 'cancelled' : 'failed'
        observe?.({
          schema: 'shell_execution_v1', state, exitCode: details.exitCode ?? null, signal: details.signal ?? null,
          effects: 'not-reconciled', workspaceObservation: observedWorkspace,
          ...(workspaceBaselineFileDigests ? { workspaceBaselineFileDigests } : {}),
          ...(bounded.artifact ? { outputId: bounded.artifact.id } : {}),
          outputChars: details.totalChars ?? formatted.length, outputTruncated: details.outputTruncated === true,
          drainTimedOut: details.drainTimedOut === true,
        }, bounded.artifact)
        if (outputQuotaExceeded) {
          throw new TaskRuntimeError('AGGREGATE_OUTPUT_BYTES_EXCEEDED', `Captured Shell output exceeded the shared ${AGGREGATE_TURN_BYTES / (1024 * 1024)} MiB turn byte budget. The command may already have taken effect; inspect its state and retained output before retrying.${bounded.artifact ? ` Recover output with shell output_id="${bounded.artifact.id}".` : ''}`, false)
        }
        const code = state === 'timed_out' ? 'TIMED_OUT' : state === 'cancelled' ? 'CANCELLED' : details.exitCode === undefined ? 'SHELL_FAILED' : 'SHELL_EXIT'
        const status = details.timedOut ? `Command timed out after ${Math.round(execution.timeout / 1000)}s.`
          : typeof details.exitCode === 'number' ? `Command exited with code ${details.exitCode}.`
            : details.signal ? `Command was terminated by signal ${details.signal}.` : 'Command failed.'
        const recovery = bounded.artifact ? ` Recover output with shell output_id="${bounded.artifact.id}".` : ' No recoverable output artifact was saved.'
        throw new TaskRuntimeError(code, `${status}${recovery}`, false)
      }
    }
    if (outputQuotaExceeded) {
      return formatToolError('tool', 'AGGREGATE_OUTPUT_BYTES_EXCEEDED', `Captured Shell output exceeded the shared ${AGGREGATE_TURN_BYTES / (1024 * 1024)} MiB turn byte budget. The command may already have taken effect; inspect its state and retained output before retrying.${bounded.artifact ? ` Recover output with shell output_id="${bounded.artifact.id}".` : ''}`, false, {
        state: details.processGroupSettled === 'unknown' ? 'unknown' : 'failure', outputIncomplete: true,
        outputBytes: observedBytes, ...(bounded.artifact ? { outputId: bounded.artifact.id } : {}),
      })
    }
    return bounded.text
  }
}

function supervisorTaskRecord(record: TaskRecordV1): { execution: PreparedShellExecution; fingerprint: string; request: ShellSupervisorRequest } | undefined {
  const metadata = record.metadata
  const command = metadata.command
  const cwd = metadata.shellExecutionCwd
  const projectRoot = metadata.shellProjectRoot
  const readOnly = metadata.shellReadOnly
  const allowNetwork = metadata.shellNetworkApproved
  const fingerprint = metadata.shellSupervisorFingerprint
  if (record.type !== 'shell' || metadata.shellBackground !== true || typeof command !== 'string'
    || typeof cwd !== 'string' || typeof projectRoot !== 'string' || typeof readOnly !== 'boolean'
    || typeof allowNetwork !== 'boolean' || typeof fingerprint !== 'string') return undefined
  const execution = { command, cwd, projectRoot, timeout: record.timeoutMs, readOnly, allowNetwork }
  if (shellSupervisorFingerprint(execution, record.sessionId, record.timeoutMs) !== fingerprint) return undefined
  return { execution, fingerprint, request: { sessionId: record.sessionId, taskId: record.taskId, fingerprint, executable: 'bwrap', args: [], cwd, timeoutMs: record.timeoutMs + 1000 } }
}

/** Restore only the observer for an already-running Shell supervisor; never constructs a command to execute. */
export function resolveShellBackgroundRunner(record: TaskRecordV1, storageRoot?: string, recoveryRoot?: string, recordOutputBytes?: (bytes: number) => boolean): TaskRunner | undefined {
  const resolved = supervisorTaskRecord(record)
  if (!resolved || !shellSupervisorCanReattach({ ...resolved.request, storageRoot, recoveryRoot }, record.process)) return undefined
  return async context => {
    const previous = record.partial as ShellExecutionSummary | undefined
    const workspaceFileDigests = previous?.schema === 'shell_execution_v1'
      ? restoreWorkspaceFileDigests(previous.workspaceBaselineFileDigests) : undefined
    const workspaceBaselineFileDigests = serializeWorkspaceFileDigests(workspaceFileDigests)
    const outputByteMeter = createShellOutputByteMeter(recordOutputBytes ?? (() => true))
    let result: ShellSupervisorResult
    try {
      result = await waitForShellSupervisor({ ...resolved.request, storageRoot, recoveryRoot }, context.signal, state => {
        if (Number.isSafeInteger(state.outputBytes)) outputByteMeter.recordTotal(state.outputBytes!)
        context.setPartial({
          schema: 'shell_execution_v1', state: 'running', exitCode: null, signal: null, effects: 'not-reconciled',
          workspaceObservation: previous?.schema === 'shell_execution_v1' ? previous.workspaceObservation : unknownShellWorkspaceObservation(),
          ...(workspaceBaselineFileDigests ? { workspaceBaselineFileDigests } : {}),
          outputChars: state.totalChars ?? previous?.outputChars ?? 0, outputPreview: state.outputPreview,
          outputTruncated: state.outputTruncated === true, drainTimedOut: false,
        })
      })
    } catch (error) {
      const state = (error as { supervisorState?: ShellSupervisorState }).supervisorState
      if (state && Number.isSafeInteger(state.outputBytes)) outputByteMeter.recordTotal(state.outputBytes!)
      throw error
    }
    const workspaceObservation = previous?.schema === 'shell_execution_v1'
      ? await observeShellWorkspace(resolved.execution, previous.workspaceObservation, result.processGroupSettled, workspaceFileDigests)
      : unknownShellWorkspaceObservation()
    await recordObservedShellWorkspaceEffect(context.runnerEffectId, context.markEffectOutcome, workspaceObservation)
    const retainedArtifact = result.outputId && result.outputMetadata ? { id: result.outputId, metadata: result.outputMetadata } : undefined
    const outputBytes = Number.isSafeInteger(result.outputBytes) && result.outputBytes! >= 0 ? result.outputBytes! : AGGREGATE_TURN_BYTES
    const outputQuotaExceeded = outputByteMeter.recordTotal(outputBytes)
    const outcome = shellCaptureCompletionState(result.processGroupSettled, result.drainTimedOut === true)
    const output = result.content || '(no output)'
    const failed = result.state !== 'done'
    const outcomeUnknown = !failed && outcome === 'unknown'
    const display = failed
      ? formatShellFailure({ all: result.content, outputPreview: result.outputPreview, exitCode: result.exitCode ?? undefined,
        timedOut: result.timedOut, signal: result.signal ?? undefined, drainTimedOut: result.drainTimedOut }, record.timeoutMs, context.signal)
      : output
    const bounded = await boundShellOutput(output, context.sessionId, result.totalChars, result.outputTruncated, result.drainTimedOut,
      display, result.provenance, storageRoot, recoveryRoot, true, retainedArtifact, outputQuotaExceeded)
    const summary: ShellExecutionSummary = {
      schema: 'shell_execution_v1', state: outcomeUnknown ? 'unknown' : result.state === 'done' ? 'exited' : result.state,
      exitCode: result.exitCode ?? null, signal: result.signal ?? null, effects: 'not-reconciled', workspaceObservation,
      ...(bounded.artifact ? { outputId: bounded.artifact.id } : {}), outputChars: result.totalChars ?? result.content.length,
      outputPreview: result.outputPreview, outputTruncated: result.outputTruncated === true, drainTimedOut: result.drainTimedOut === true,
    }
    context.setPartial(summary)
    if (bounded.artifact) context.recordArtifact(bounded.artifact)
    if (outputQuotaExceeded) {
      throw new TaskRuntimeError('AGGREGATE_OUTPUT_BYTES_EXCEEDED', `Captured Shell output exceeded the shared ${AGGREGATE_TURN_BYTES / (1024 * 1024)} MiB turn byte budget. The command may already have taken effect; inspect its state and retained output before retrying.${bounded.artifact ? ` Recover output with shell output_id="${bounded.artifact.id}".` : ''}`, false)
    }
    if (failed || outcomeUnknown) {
      const code = outcomeUnknown ? 'SHELL_OUTCOME_UNKNOWN' : result.state === 'timed_out' ? 'TIMED_OUT' : result.state === 'cancelled' ? 'CANCELLED'
        : typeof result.exitCode === 'number' ? 'SHELL_EXIT' : 'SHELL_FAILED'
      const message = outcomeUnknown
        ? `Shell process completion or output capture is unknown; do not treat this command as successful or replay it automatically.${bounded.artifact ? ` Recover output with shell output_id="${bounded.artifact.id}".` : ''}`
        : `${display}${bounded.artifact ? ` Recover output with shell output_id="${bounded.artifact.id}".` : ''}`
      throw new TaskRuntimeError(code, message, false)
    }
    return bounded.text
  }
}

async function executeDetectedVerification(
  approvedCommand: VerificationCommand,
  shellCommand: string,
  cwd: string,
  timeoutMs: number | undefined,
  allowNetwork: boolean,
  signal?: AbortSignal,
  trackProcess?: (child: ChildProcess) => void,
  onOutputBytes?: (bytes: number) => void,
): Promise<VerificationResult> {
  const detected = await detectVerificationCommand(cwd)
  const approvedCommandIsCurrent = Boolean(detected
    && shellCommand === detected.display
    && JSON.stringify(approvedCommand) === JSON.stringify(detected))
  const command = approvedCommandIsCurrent
    ? detected!
    : { command: '/bin/sh', args: ['-c', shellCommand], display: shellCommand }
  return runVerification(command, cwd, {
    signal,
    timeoutMs,
    executionEnvironment: 'linux-bwrap',
    allowNetwork,
    execute: async (): Promise<VerificationProcessResult> => {
      const current = await detectVerificationCommand(cwd)
      if (!approvedCommandIsCurrent || !current || shellCommand !== detected!.display || JSON.stringify(current) !== JSON.stringify(detected)) {
        throw new Error('Verification must use the exact detected project test command; arbitrary commands cannot produce verification receipts')
      }
      if (!sandboxAvailableForShell()) throw new Error(SANDBOX_UNAVAILABLE_NOTICE)
      signal?.throwIfAborted()
      try {
        // Receipt-producing runs use immutable project inputs. Network is separately authorized by the caller.
        const output = await runSandboxed(shellCommand, cwd, timeoutMs ?? SHELL_TIMEOUT_MS, true, allowNetwork, signal, trackProcess, undefined, onOutputBytes)
        return { all: output.all, outputBytes: output.totalBytes, exitCode: 0, captureTruncated: output.truncated, drainTimedOut: output.drainTimedOut }
      } catch (error) {
        const failure = error as { all?: string; totalBytes?: number; exitCode?: number; timedOut?: boolean; cancelled?: boolean; outputTruncated?: boolean; drainTimedOut?: boolean }
        if (failure.exitCode === undefined && !failure.timedOut && !failure.cancelled) throw error
        return { all: failure.all, outputBytes: failure.totalBytes, exitCode: failure.exitCode ?? null, timedOut: failure.timedOut, isCanceled: failure.cancelled || signal?.aborted,
          captureTruncated: failure.outputTruncated, drainTimedOut: failure.drainTimedOut }
      }
    },
  })
}

/** Run the exact detected project test command read-only with network disabled; callers decide whether to record the result. */
export async function runProjectVerificationReadOnly(
  command: VerificationCommand,
  cwd = process.cwd(),
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<VerificationResult> {
  return executeDetectedVerification(command, command.display, cwd, options.timeoutMs ?? 120_000, false, options.signal)
}

/** Verification uses the authorized shell executor; it never falls back to the host verification runner. */
async function runPreparedVerification(execution: PreparedShellExecution, context: ToolExecutionContext): Promise<string> {
  const detected = await detectVerificationCommand(execution.cwd)
  const approvedCommand = detected ?? { command: '/bin/sh', args: ['-c', execution.command], display: execution.command }
  const outputByteMeter = createShellOutputByteMeter(bytes => !context.budgetGroupId
    || context.session?.registry.recordAggregateOutputBytes(context.budgetGroupId, bytes) === true)
  const result = await executeDetectedVerification(approvedCommand, execution.command, execution.cwd, execution.timeout,
    execution.allowNetwork, context.signal, context.trackProcess, outputByteMeter.recordBytes)
  const evidenceId = context.recordVerification!(result)
  const outputBytes = result.outputBytes ?? Buffer.byteLength(result.output, 'utf8')
  const withinAggregateBudget = !outputByteMeter.recordTotal(outputBytes)
  const preview = truncateShellOutput(result.output, 2_000)
  const receipt = { ...result, output: preview, previewComplete: preview === result.output, evidenceId }
  if (!withinAggregateBudget) {
    return formatToolError('tool', 'AGGREGATE_OUTPUT_BYTES_EXCEEDED',
      `Captured Shell output exceeded the shared ${AGGREGATE_TURN_BYTES / (1024 * 1024)} MiB turn byte budget. Recover the verification receipt with session_evidence id="${evidenceId}".`,
      false, { outputBytes, evidenceId, verification: receipt })
  }
  return JSON.stringify(receipt)
}

/** JSON task handle returned to the model for a detached shell task. */
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
 * Keeps samples from the beginning, middle, and end so diagnostics from long runs survive.
 */
export function truncateShellOutput(output: string, maxChars = SHELL_OUTPUT_MAX_CHARS): string {
  maxChars = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : SHELL_OUTPUT_MAX_CHARS
  const total = codePointLength(output)
  if (total <= maxChars) return output
  if (maxChars <= 0) return ''
  let marker = '…'
  let head = 0
  let middle = 0
  let tail = 0
  for (let i = 0; i < 10; i++) {
    const available = Math.max(0, maxChars - codePointLength(marker))
    head = Math.floor(available / 4)
    middle = Math.floor(available / 2)
    tail = available - head - middle
    const next = `…[${total - head - middle - tail} characters truncated]…`
    if (next === marker) break
    marker = next
  }
  if (codePointLength(marker) >= maxChars) return marker.slice(0, safeCodeUnitEnd(marker, maxChars))
  const available = Math.max(0, maxChars - codePointLength(marker))
  head = Math.floor(available / 4)
  middle = Math.floor(available / 2)
  tail = available - head - middle
  const middleStart = Math.floor((total - middle) / 2)
  return codePointSlice(output, 0, head) + marker + codePointSlice(output, middleStart, middle) + (tail ? codePointSlice(output, total - tail, tail) : '')
}

function codePointOffset(text: string, points: number): number {
  let offset = 0
  let count = 0
  while (offset < text.length && count < points) {
    const first = text.charCodeAt(offset++)
    if (first >= 0xd800 && first <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff) offset++
    count++
  }
  return offset
}

function codePointSlice(text: string, start: number, count: number): string {
  const startOffset = safeGraphemeStart(text, codePointOffset(text, start))
  const endOffset = safeGraphemeEnd(text, codePointOffset(text, start + count))
  return text.slice(startOffset, Math.max(startOffset, endOffset))
}

function safeCodeUnitEnd(text: string, end: number): number {
  return safeGraphemeEnd(text, end)
}

/** Test seam replaces only the foreground runner result; normal auth and sandbox preflight still run. */
export type ShellForegroundRunnerForTesting = typeof runSandboxed

function createShellTool(foregroundRunner: ShellForegroundRunnerForTesting = runSandboxed): Tool {
  return {
  name: 'shell',
  description: `Run one isolated, non-login shell command in the workspace cwd with a scrubbed environment (no provider keys); cwd and shell state do not persist between calls. In the Linux sandbox the workspace appears at /mnt and its host absolute path; file tools translate /mnt paths back into the active workspace before validating access. Shell execution is refused unless an owning runtime context and working Linux bubblewrap sandbox are available. Failures include their exit status. Set background=true to detach a controllable shell task and receive a task handle. Eligible Linux background shells can survive a CLI restart and reattach to the same supervisor from the persisted task snapshot; bounded, secret-masked live previews are available in task partials, and restoration never replays the command. If a detached supervisor exits before saving its final output, the last redacted preview is retained as a recoverable output_id artifact when storage succeeds; it is explicitly marked incomplete, and the full output remains unavailable. Use stream_task_id with the taskId from the background handle to page through persisted, secret-redacted stdout/stderr records; pass the returned cursor as stream_cursor. Pages report sequence gaps, retention expiry, truncation, and unknown interruption explicitly. This reads only already-captured records and never replays the command. Task status revalidates recorded Linux process identity and, for a detached process that owns its group, checks whether group members remain; alive means liveness only, not useful progress or completed effects. Unknown group state fails closed at task completion. Background tasks record a source-input workspace fingerprint before and after execution, including after snapshot restore. That scope excludes ignored, generated, and dependency paths and does not reconcile network, database, or other external effects; escaped or unregistered processes remain unknown. Interrupted process commands require effect reconciliation and fresh authorization before replay. Use output_id to read a truncated command's saved output in bounded chunks with start_char; set include_provenance=true to recover bounded stdout/stderr channel offsets and observed-arrival ordering. Use verification=true with the exact detected project test command (such as bun run test or the absolute interpreter from a configured project's .venv) to record a foreground verification receipt through the same permissions and sandbox; command must still be supplied. This never runs automatically or outside the sandbox. Empty, changing, incomplete, timed-out, or failed tests are not verified. The bounded JSON result includes evidenceId for full receipt recovery with session_evidence. Use it for builds, tests, git, package managers and other terminal work; prefer read_file, grep, glob and the edit tools for reading, searching and editing. Output is streamed into bounded capture, ANSI controls are removed, and the preview is capped at ${SHELL_OUTPUT_MAX_CHARS} Unicode characters with beginning, middle, end, and one bounded heuristic diagnostic excerpt when detected. Preview progress updates use carriage returns to replace the current line independently in each channel; when both channels write, preview groups stdout and stderr separately and does not preserve their relative order. Saved output masks known secret patterns while preserving UTF-16 offsets and line boundaries from the original merged arrival stream, with output capped at 2,000,000 UTF-16 code units. Artifacts and provenance reads report whether content was masked. The command is killed after the timeout (default ${SHELL_TIMEOUT_MS / 1000}s). Network access requires explicit approval.`,
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      command: { type: 'string', minLength: 1, description: 'Shell command to run' },
      timeout: { type: 'number', minimum: 0.001, description: `Timeout in seconds (default ${SHELL_TIMEOUT_MS / 1000})` },
      verification: { type: 'boolean', description: 'Record a foreground verification receipt for the exact detected project test command. Requires an owning runtime ledger and the normal shell authorization/sandbox.' },
      background: { type: 'boolean', description: 'Detach the command and return a task handle that can be inspected or cancelled.' },
      output_id: { type: 'string', description: 'Read a saved oversized command output returned by an earlier shell call.' },
      stream_task_id: { type: 'string', description: 'Read persisted output records for a detached shell taskId returned in its background handle.' },
      stream_cursor: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Continue a detached output read using the cursor returned by the previous page.' },
      stream_max_chars: { type: 'integer', minimum: 512, maximum: 20_000, description: 'Maximum detached output characters to return (512–20000).' },
      start_char: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'UTF-16 code-unit offset for continuing a saved output read.' },
      max_chars: { type: 'integer', minimum: 512, maximum: 20_000, description: 'Maximum saved-output characters to return (512–20000).' },
      include_provenance: { type: 'boolean', description: 'Return bounded channel/offset metadata for output_id instead of its legacy plain-text page.' },
      provenance_start: { type: 'integer', minimum: 0, description: 'Segment index for continuing an include_provenance page.' },
    },
    allOf: [{
      if: { required: ['command'], not: { required: ['output_id'] } },
      then: { properties: { timeout: { default: SHELL_TIMEOUT_MS / 1000 } } },
    }, {
      if: { required: ['provenance_start'] },
      then: { required: ['include_provenance'], properties: { include_provenance: { const: true } } },
    }, {
      if: { required: ['include_provenance'], properties: { include_provenance: { const: true } } },
      then: { not: { anyOf: [{ required: ['start_char'] }, { required: ['max_chars'] }] } },
    }, {
      if: { required: ['verification'], properties: { verification: { const: true } } },
      then: { not: { required: ['background'], properties: { background: { const: true } } } },
    }],
    oneOf: [
      { required: ['command'], not: { anyOf: [
        { required: ['output_id'] }, { required: ['start_char'] }, { required: ['max_chars'] },
        { required: ['include_provenance'] }, { required: ['provenance_start'] }, { required: ['stream_task_id'] },
        { required: ['stream_cursor'] }, { required: ['stream_max_chars'] },
      ] } },
      { required: ['output_id'], not: { anyOf: [
        { required: ['command'] }, { required: ['timeout'] }, { required: ['background'] }, { required: ['verification'] },
        { required: ['stream_task_id'] }, { required: ['stream_cursor'] }, { required: ['stream_max_chars'] },
      ] } },
      { required: ['stream_task_id'], not: { anyOf: [
        { required: ['command'] }, { required: ['timeout'] }, { required: ['background'] }, { required: ['verification'] },
        { required: ['output_id'] }, { required: ['start_char'] }, { required: ['max_chars'] },
        { required: ['include_provenance'] }, { required: ['provenance_start'] },
      ] } },
    ],
  },
  async execute(args, context) {
    const artifactRoot = shellOutputRoot(context)
    const recoveryRoot = shellOutputRecoveryRoot(context)
    if (args.stream_task_id !== undefined) {
      if (args.command !== undefined || args.output_id !== undefined || args.timeout !== undefined || args.background !== undefined || args.verification !== undefined
        || args.start_char !== undefined || args.max_chars !== undefined || args.include_provenance !== undefined || args.provenance_start !== undefined) {
        return 'Error: stream_task_id reads saved detached output and cannot be combined with commands or other output options'
      }
      if (typeof args.stream_task_id !== 'string' || !context?.sessionId) return 'Error: a valid session and stream_task_id are required'
      const cursor = args.stream_cursor as number | undefined
      const maxChars = args.stream_max_chars as number | undefined
      return JSON.stringify(await readShellSupervisorStreamPage(context.sessionId, args.stream_task_id, cursor, maxChars, artifactRoot))
    }
    if (args.stream_cursor !== undefined || args.stream_max_chars !== undefined) return 'Error: detached stream options require stream_task_id'
    if (args.output_id !== undefined) {
      if (args.command !== undefined || args.timeout !== undefined || args.background !== undefined || args.verification !== undefined) return 'Error: output_id reads a saved result and cannot be combined with a command or execution options'
      if (typeof args.output_id !== 'string' || !context?.sessionId) return 'Error: a valid session and output_id are required'
      if (args.include_provenance === true) {
        if (args.start_char !== undefined || args.max_chars !== undefined) return 'Error: start_char and max_chars cannot be combined with include_provenance=true'
        return readShellOutputProvenance(context.sessionId, args.output_id, args.provenance_start as number | undefined, artifactRoot, recoveryRoot)
      }
      if (args.provenance_start !== undefined) return 'Error: provenance_start requires include_provenance=true'
      return readShellOutput(context.sessionId, args.output_id, args.start_char as number | undefined, args.max_chars as number | undefined, artifactRoot, recoveryRoot)
    }
    if (args.start_char !== undefined || args.max_chars !== undefined || args.include_provenance !== undefined || args.provenance_start !== undefined) return 'Error: saved-output options require output_id'
    const command = args.command as string
    const timeoutArg = args.timeout as number | undefined
    const timeout = timeoutArg != null && Number.isFinite(timeoutArg) && timeoutArg > 0 ? timeoutArg * 1000 : SHELL_TIMEOUT_MS
    const background = args.background === true
    if (args.verification === true && background) return 'Error: verification requires foreground execution; background jobs do not produce synchronous verification receipts'
    if (args.verification === true && !context?.recordVerification) return 'Error: verification requires an owning runtime verification ledger'
    const prepared = await prepareShellExecution(command, timeout, background, context)
    if (typeof prepared === 'string') return prepared
    if (args.verification === true) return runPreparedVerification(prepared, context!)
    if (background) {
      // A detached shell is still a normal registry task: it inherits the
      // parent hierarchy and can be cancelled through /task or the footer.
      const session = context!.session!
      const taskTimeoutMs = Math.max(1, Math.trunc(prepared.timeout))
      const fingerprint = shellSupervisorFingerprint(prepared, context!.sessionId!, taskTimeoutMs)
      const recordOutputBytes = (bytes: number) => session.registry.recordAggregateOutputBytes(context!.budgetGroupId, bytes)
      const handle = session.spawn<string>({
        parentTaskId: context!.taskId,
        budgetGroupId: context!.budgetGroupId,
        type: 'shell',
        mode: 'background',
        timeoutMs: taskTimeoutMs,
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
          shellSupervisorFingerprint: fingerprint,
          shellExecutionCwd: prepared.cwd,
          shellProjectRoot: prepared.projectRoot,
          shellReadOnly: prepared.readOnly,
          shellNetworkApproved: prepared.allowNetwork,
        },
      }, runContext => runPreparedShell(prepared, runContext.signal, true, runContext.sessionId, artifactRoot, recoveryRoot, runContext.trackProcess, (summary, artifact) => {
        runContext.setPartial(summary)
        if (artifact) runContext.recordArtifact(artifact)
      }, () => session.flush(), runContext.taskId, fingerprint, runContext.runnerEffectId, runContext.markEffectOutcome,
      undefined, undefined, recordOutputBytes))
      return backgroundHandle(handle)
    }
    const recordOutputBytes = (bytes: number) => {
      if (!context?.budgetGroupId) return true
      if (!context.session) return false
      return context.session.registry.recordAggregateOutputBytes(context.budgetGroupId, bytes)
    }
    return runPreparedShell(prepared, context?.signal, false, context?.sessionId, artifactRoot, recoveryRoot, context?.trackProcess,
      undefined, undefined, undefined, undefined, context?.effectId, context?.markEffectOutcome, context?.recordShellExecution, foregroundRunner, recordOutputBytes)
  },
  }
}

/** Shell tool. Commands pass the checks in `prepareShellExecution` (destructive commands need coordinator approval, network needs explicit approval, .deepseekignore paths are refused), then run in a bubblewrap sandbox with a scrubbed env, in the foreground or as a cancellable background task. */
export const Shell: Tool = createShellTool()

/** Internal test factory; not re-exported by the public tools index. */
export function createShellToolForTesting(foregroundRunner: ShellForegroundRunnerForTesting): Tool {
  return createShellTool(foregroundRunner)
}
