import { devNull } from 'node:os'
import { execa } from 'execa'
import { scrubbedEnv } from './platform.js'

const GIT_INSPECTION_MAX_BUFFER = 32_000

/** Inspect Git data without launching repository-configured fsmonitor, diff, textconv or signature helpers. */
export function gitInspectionArgs(args: string[]): string[] {
  const [command, ...rest] = args
  const inspectionFlags = command === 'diff' ? ['--no-ext-diff', '--no-textconv']
    : command === 'log' ? ['--no-show-signature', '--no-ext-diff', '--no-textconv'] : []
  return ['--no-pager', '-c', 'core.fsmonitor=false', ...(command ? [command] : []), ...inspectionFlags, ...rest]
}

function isIncompleteGitCapture(result: { isMaxBuffer?: boolean; timedOut?: boolean; isCanceled?: boolean; failed?: boolean; exitCode?: number }): boolean {
  return Boolean(result.isMaxBuffer || result.timedOut || result.isCanceled || result.failed && result.exitCode === 0)
}

function isIncompleteGitInventory(result: { isMaxBuffer?: boolean; timedOut?: boolean; isCanceled?: boolean; failed?: boolean; exitCode?: number; stdout: string }): boolean {
  return isIncompleteGitCapture(result) || Buffer.byteLength(result.stdout, 'utf8') >= GIT_INSPECTION_MAX_BUFFER || result.exitCode === 0 && !result.stdout.endsWith('\0')
}

export interface GitInspectionOptions {
  reject?: boolean
  timeout?: number
  cancelSignal?: AbortSignal
  maxBuffer?: number
  stripFinalNewline?: boolean
  all?: boolean
  disableHooks?: boolean
  sshAgent?: boolean
  input?: string
}

export class GitCaptureIncompleteError extends Error {
  constructor() {
    super('Git output capture is incomplete; the result cannot be trusted')
    this.name = 'GitCaptureIncompleteError'
  }
}

/** Block configured content helpers without silently substituting untransformed bytes. */
export async function runGitInspection(args: string[], cwd: string, options: GitInspectionOptions = {}) {
  const { disableHooks, sshAgent, input, ...processOptions } = options
  const env = scrubbedEnv()
  // Git commands run on the model's behalf must never wait for terminal auth input.
  env.GIT_TERMINAL_PROMPT = '0'
  if (sshAgent && process.env.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK
  const executionOptions = { cwd, env, extendEnv: false, timeout: 3_000, ...processOptions }
  const overrides = ['-c', 'credential.helper=', '-c', 'credential.interactive=false']
  if (args[0] === 'push' || args[0] === 'pull') {
    const customCommands = await execa('git', gitInspectionArgs(['config', '--null', '--name-only', '--get-regexp', '^(remote\\..*\\.(uploadpack|receivepack|vcs)|core\\.gitproxy)$']), {
      ...executionOptions, reject: false, all: false, maxBuffer: GIT_INSPECTION_MAX_BUFFER,
    })
    if (isIncompleteGitInventory(customCommands) || customCommands.exitCode !== 0 && customCommands.exitCode !== 1) {
      throw new Error('Cannot inspect Git remote transport configuration; no remote operation was started')
    }
    const unsafeCommands = customCommands.stdout.split('\0').filter(Boolean)
    if (unsafeCommands.length) {
      throw new Error(`Remote Git operations refuse configured shell transport commands (${unsafeCommands.join(', ')}); remove those settings and retry`)
    }

    const configuredProtocols = await execa('git', gitInspectionArgs(['config', '--null', '--name-only', '--get-regexp', '^protocol\\..*\\.allow$']), {
      ...executionOptions, reject: false, all: false, maxBuffer: GIT_INSPECTION_MAX_BUFFER,
    })
    if (isIncompleteGitInventory(configuredProtocols) || configuredProtocols.exitCode !== 0 && configuredProtocols.exitCode !== 1) {
      throw new Error('Cannot inspect Git protocol configuration; no remote operation was started')
    }
    const allowedProtocols = new Set(['file', 'git', 'http', 'https', 'ssh'])
    overrides.push('-c', 'core.sshCommand=ssh', '-c', 'protocol.allow=never')
    for (const key of new Set(configuredProtocols.stdout.split('\0').filter(Boolean))) {
      const protocol = key.slice('protocol.'.length, -'.allow'.length)
      if (!allowedProtocols.has(protocol)) overrides.push('-c', `${key}=never`)
    }
    for (const protocol of allowedProtocols) overrides.push('-c', `protocol.${protocol}.allow=always`)
  }
  if (args[0] === 'pull') {
    for (const key of ['core.editor', 'sequence.editor', 'gpg.program', 'gpg.openpgp.program', 'gpg.ssh.program', 'gpg.x509.program', 'gpg.ssh.defaultKeyCommand']) overrides.push('-c', `${key}=false`)
  }
  if (args[0] === 'commit') {
    const signing = await execa('git', gitInspectionArgs(['config', '--bool', '--get', 'commit.gpgsign']), { ...executionOptions, reject: false, all: false })
    if (isIncompleteGitCapture(signing) || signing.exitCode !== 0 && signing.exitCode !== 1) throw new Error('Cannot inspect Git signing configuration; no commit was started')
    if (signing.stdout.trim() === 'true') throw new Error('Automatic commit cannot invoke a configured signing program; use an explicitly authorized signing workflow')
  }
  if (['status', 'diff', 'log', 'add', 'apply', 'worktree', 'checkout', 'commit', 'stash', 'pull'].includes(args[0]!)) {
    const configured = await execa('git', gitInspectionArgs(['config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$']), {
      ...executionOptions, reject: false, all: false, maxBuffer: GIT_INSPECTION_MAX_BUFFER,
    })
    if (isIncompleteGitInventory(configured) || configured.exitCode !== 0 && configured.exitCode !== 1) throw new Error('Cannot inspect Git content-filter configuration; no operation was started')
    const drivers = new Set(configured.stdout.split('\0').filter(Boolean).map(key => key.replace(/^filter\./i, '').replace(/\.(clean|smudge|process|required)$/i, '')))
    for (const driver of drivers) {
      for (const phase of ['clean', 'smudge', 'process']) overrides.push('-c', `filter.${driver}.${phase}=`)
      overrides.push('-c', `filter.${driver}.required=true`)
    }
  }
  if (args[0] === 'pull' || args[0] === 'stash' && args[1] === 'pop') {
    const configured = await execa('git', gitInspectionArgs(['config', '--null', '--name-only', '--get-regexp', '^merge\\..*\\.driver$']), {
      ...executionOptions, reject: false, all: false, maxBuffer: GIT_INSPECTION_MAX_BUFFER,
    })
    if (isIncompleteGitInventory(configured) || configured.exitCode !== 0 && configured.exitCode !== 1) throw new Error('Cannot inspect Git merge-driver configuration; no merge operation was started')
    // Report a conflict instead of substituting built-in merge semantics for a custom driver.
    for (const key of new Set(configured.stdout.split('\0').filter(Boolean))) overrides.push('-c', `${key}=false`)
  }
  const result = await execa('git', [...(disableHooks ? ['-c', `core.hooksPath=${devNull}`] : []), ...overrides, ...gitInspectionArgs(args)], { ...executionOptions, input })
  if (isIncompleteGitCapture(result)) throw new GitCaptureIncompleteError()
  return result
}
