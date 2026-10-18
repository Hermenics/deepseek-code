import type { Tool, } from '../types.js'
import { formatToolError, isToolErrorResult } from '../result.js'
import type { ToolExecutionContext } from '../../orchestration/types.js'
import { GitCaptureIncompleteError, runGitInspection } from '../../utils/gitInspection.js'
import { createHash } from 'node:crypto'

const effectfulGitCommands = new Set(['add', 'checkout', 'commit', 'pull', 'push', 'stash'])
const localEffectfulGitCommands = new Set(['add', 'checkout', 'commit', 'stash'])

function acceptedPushUpdateEvidence(stdout: string): string | undefined {
  const accepted = stdout.split(/\r?\n/).filter(line => /^[ *+-]\t[^\t]+\t/.test(line))
  return accepted.length
    ? `git-push-update-observed:${createHash('sha256').update(accepted.join('\n')).digest('hex')}`
    : undefined
}

/** Hash visible local repository state without returning potentially secret Git configuration to the caller. */
async function localGitState(cwd: string, context?: ToolExecutionContext): Promise<string> {
  const commands = [
    ['rev-parse', '--verify', 'HEAD'],
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    ['ls-files', '--stage', '-z'],
    ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)%00'],
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    ['diff', '--binary', '--no-ext-diff', '--no-textconv'],
    ['config', '--null', '--list', '--includes'],
  ]
  const results = await Promise.all(commands.map(args => runGitInspection(args, cwd, {
    reject: false, cancelSignal: context?.signal, timeout: 3_000, maxBuffer: 4 * 1024 * 1024,
  })))
  if (results.some(result => typeof result.stdout !== 'string' || result.exitCode === null)) throw new Error('Local Git state unavailable')
  return createHash('sha256').update(JSON.stringify(results.map(result => [result.exitCode, result.stdout]))).digest('hex')
}

/** Run git in the workspace without throwing on non-zero exit; stdout and stderr are merged into `out`. */
async function git(args: string[], context?: ToolExecutionContext): Promise<{ out: string; code: number; effectUnknown?: boolean; effectResolution?: 'no-effect' | 'effect-observed'; effectEvidence?: string }> {
  const command = args[0]!
  const cwd = context?.workspacePath ?? process.cwd()
  const reconcileLocal = localEffectfulGitCommands.has(command) && !!context?.effectId
  const reconcilePull = command === 'pull' && !!context?.effectId
  let localStateBefore: string | undefined
  if (reconcileLocal || reconcilePull) {
    try { localStateBefore = await localGitState(cwd, context) } catch { context?.signal?.throwIfAborted() }
  }
  let result: { out: string; code: number; effectUnknown?: boolean; effectResolution?: 'no-effect' | 'effect-observed'; effectEvidence?: string }
  try {
    const remote = command === 'push' || command === 'pull'
    if (remote && (context?.permissionProfile !== 'coordinator-integrator' || context.dangerousOperationApproved !== true)) {
      result = { out: 'Remote Git operations require confirmed coordinator authorization; no remote operation was started.', code: 1 }
    } else {
      const inspection = ['status', 'diff', 'log', 'rev-parse', 'check-ref-format'].includes(command) || command === 'branch' && args.length === 2 && args[1] === '-a'
      const options = { cancelSignal: context?.signal, reject: false, all: true } as const
      const output = await runGitInspection(args, cwd, { ...options, disableHooks: !inspection, sshAgent: remote, timeout: remote ? 120_000 : inspection ? 3_000 : 30_000 })
      const out = (output.all ?? (output.stdout + (output.stderr ? '\n' + output.stderr : ''))).trim()
      const code = output.exitCode ?? 1
      const effectEvidence = command === 'push' ? acceptedPushUpdateEvidence(output.stdout) : undefined
      result = {
        out, code,
        ...(effectEvidence ? { effectResolution: 'effect-observed' as const, effectEvidence } : {}),
        ...(effectfulGitCommands.has(command) && code !== 0 && !effectEvidence ? { effectUnknown: true } : {}),
      }
    }
  } catch (err: unknown) {
    const effectUnknown = effectfulGitCommands.has(args[0]!) && err instanceof GitCaptureIncompleteError
    result = { out: (err as Error).message ?? String(err), code: 1, ...(effectUnknown ? { effectUnknown: true } : {}) }
  }
  if (command === 'push' && result.effectResolution === 'effect-observed' && result.effectEvidence) {
    // A remote rejection does not prove no effect: remote hooks can run before rejecting the update.
    if (context?.effectId) await context.markEffectOutcome?.(context.effectId, 'effect-observed', result.effectEvidence)
    return { ...result, effectUnknown: false }
  }
  if (reconcileLocal && result.code === 0 && localStateBefore) {
    try {
      const after = await localGitState(cwd, context)
      const effectResolution = after === localStateBefore ? 'no-effect' : 'effect-observed'
      await context?.markEffectOutcome?.(context.effectId!, effectResolution, `${effectResolution}:${after}`)
    } catch {
      // Keep a successful Git result when its optional evidence snapshot or checkpoint fails.
    }
  }
  if (reconcilePull && result.code === 0 && localStateBefore) {
    try {
      const after = await localGitState(cwd, context)
      if (after !== localStateBefore) {
        await context?.markEffectOutcome?.(context.effectId!, 'effect-observed', `effect-observed:${after}`)
      }
    } catch {
      // Keep a successful Git result when its optional evidence snapshot or checkpoint fails.
    }
  }
  if ((reconcileLocal || reconcilePull) && result.code !== 0) {
    let effectResolution: 'no-effect' | 'effect-observed' | undefined
    let effectEvidence: string | undefined
    try {
      const after = await localGitState(cwd, context)
      if (localStateBefore) {
        if (reconcilePull) {
          if (after !== localStateBefore) {
            effectResolution = 'effect-observed'
            effectEvidence = `effect-observed:${after}`
          }
        } else {
          effectResolution = after === localStateBefore ? 'no-effect' : 'effect-observed'
          effectEvidence = `${effectResolution}:${after}`
        }
      }
    } catch { context?.signal?.throwIfAborted() }
    if (effectResolution && effectEvidence) {
      await context?.markEffectOutcome?.(context.effectId!, effectResolution, effectEvidence)
      return { ...result, effectUnknown: false, effectResolution, effectEvidence }
    }
  }
  return result
}

const gitError = (message: string) => formatToolError('tool', 'GIT_OPERATION_FAILED', message)
const gitRemoteError = (action: string) => formatToolError('conflict', 'GIT_REMOTE_EFFECT_UNKNOWN',
  `Git ${action} did not complete successfully. Local or remote state may have changed. Inspect and reconcile the current state before retrying; do not repeat the operation blindly.`)
const gitRemoteObservedError = (action: string, evidence: string) => formatToolError('conflict', 'GIT_REMOTE_EFFECT_OBSERVED',
  action === 'push'
    ? 'Git push failed after at least one remote ref update was accepted. Other remote effects may remain unknown; inspect before retrying.'
    : 'Git pull failed after tracked local repository state changed during the operation. Other external effects may remain unknown; inspect before retrying.', false,
  { effectResolution: 'effect-observed', effectEvidence: evidence })
const gitLocalEffectError = (action: string, output: string, resolution?: 'no-effect' | 'effect-observed', evidence?: string) => {
  const code = resolution === 'no-effect' ? 'GIT_LOCAL_EFFECT_NOT_APPLIED'
    : resolution === 'effect-observed' ? 'GIT_LOCAL_EFFECT_OBSERVED' : 'GIT_LOCAL_EFFECT_UNKNOWN'
  const message = resolution === 'no-effect'
    ? `Git ${action} failed and the captured local repository state is unchanged; this command made no visible Git change.`
    : resolution === 'effect-observed'
      ? `Git ${action} failed but the captured local repository state changed; inspect and reconcile it before retrying.`
      : `Git ${action} did not complete successfully. Local repository state may have changed. Inspect and reconcile it before retrying; do not repeat the operation blindly.`
  return formatToolError('conflict', code, `${output ? `${output}\n` : ''}${message}`, false,
    resolution && evidence ? { effectResolution: resolution, effectEvidence: evidence } : undefined)
}

/** Tool exposing a fixed set of git actions. Branch names are checked with `check-ref-format`, force push is downgraded to `--force-with-lease`, and push sets the upstream when none exists. */
export const Git: Tool = {
  name: 'git',
  description: `Execute git operations in the current repository.
Read operations refuse required content transformations instead of executing configured filters.
Local writes use a scrubbed environment, skip native Git hooks and refuse configured content transformations or automatic signing.
Remote operations require confirmed coordinator authorization, skip native hooks and use an allowlisted environment with SSH-agent access. They use built-in Git transports, reset credential helpers, force the standard SSH client and refuse configured shell transport commands.
Actions:
- status: show working tree status (git status --short)
- diff: show unstaged changes. Optional: file=<path> to diff specific file, staged=true for staged changes
- log: show recent commits. Optional: n=<number> (default 20)
- batch: run multiple read-only status, diff, or log operations in one call. Requires operations=[{action, file?, staged?, n?}, ...]
- add: stage files. Requires: files=["path1","path2"] or files=["."].
- commit: create a commit. Requires: message=<string>
- branch: list branches. Optional: create=<name> to create+switch, switch=<name> to switch
- stash: stash changes. Optional: pop=true to pop stash. Configured merge programs are disabled; merges requiring them report conflicts and retain the stash.
- pull: pull from remote without an editor. Configured filters, merge programs, signing programs and interactive rebase editors cannot execute; required transformations/signing/interaction report an error.
- push: push to remote. Optional: force=true (use with caution)`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'diff', 'log', 'batch', 'add', 'commit', 'branch', 'stash', 'pull', 'push'],
        description: 'Git action to perform',
      },
      operations: {
        type: 'array',
        description: 'Read-only operations for batch; action must be status, diff, or log',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['status', 'diff', 'log'] },
            file: { type: 'string' }, staged: { type: 'boolean' }, n: { type: 'number' },
          },
          allOf: [{ if: { properties: { action: { const: 'log' } }, required: ['action'] }, then: { properties: { n: { default: 20 } } } }],
          required: ['action'],
        },
      },
      message: { type: 'string', description: 'Commit message (required for commit)' },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to stage (required for add)',
      },
      file: { type: 'string', description: 'Specific file for diff' },
      staged: { type: 'boolean', description: 'Show staged diff (for diff action)' },
      n: { type: 'number', description: 'Number of log entries (default 20)' },
      create: { type: 'string', description: 'Branch name to create and switch to' },
      switch: { type: 'string', description: 'Branch name to switch to' },
      pop: { type: 'boolean', description: 'Pop stash instead of pushing' },
      force: { type: 'boolean', description: 'Force push (dangerous)' },
    },
    allOf: [{ if: { properties: { action: { const: 'log' } }, required: ['action'] }, then: { properties: { n: { default: 20 } } } }],
    required: ['action'],
  },
  async execute(args, context) {
    const { action, message, files, file, staged, n, create, pop, force } = args as {
      action: string
      message?: string
      files?: string[]
      file?: string
      staged?: boolean
      n?: number
      create?: string
      switch?: string
      pop?: boolean
      force?: boolean
    }
    const switchBranch = (args as { switch?: string }).switch

    switch (action) {
      case 'batch': {
        const operations = (args as { operations?: Array<Record<string, unknown>> }).operations
        if (!Array.isArray(operations) || !operations.length || operations.some(operation => !operation || !['status', 'diff', 'log'].includes(String(operation.action)))) {
          return formatToolError('validation', 'INVALID_ARGUMENTS', 'batch requires a non-empty operations array containing only status, diff, or log actions')
        }
        if (operations.some(operation =>
          operation.action === 'status' && (operation.file !== undefined || operation.staged !== undefined || operation.n !== undefined) ||
          operation.action === 'diff' && operation.n !== undefined ||
          operation.action === 'log' && (operation.file !== undefined || operation.staged !== undefined),
        )) {
          return formatToolError('validation', 'INVALID_ARGUMENTS', 'batch options are action-specific (diff: file, staged; log: n; status: none)')
        }
        const results: Array<{ action: string; options: Record<string, unknown>; result: string }> = []
        for (let start = 0; start < operations.length; start += 5) {
          const batch = operations.slice(start, start + 5)
          const batchResults = await Promise.all(batch.map(async options => {
            const operation = String(options.action)
            return {
              action: operation,
              options,
              result: await Git.execute({
                action: operation,
                ...(operation === 'diff' ? { file: options.file as string | undefined, staged: options.staged as boolean | undefined } : {}),
                ...(operation === 'log' ? { n: options.n as number | undefined } : {}),
              }, context),
            }
          }))
          results.push(...batchResults)
        }
        const operationResults = results.map(({ action: operation, options, result }, index) => {
          const details = operation === 'diff'
            ? [typeof options.file === 'string' && options.file ? `file=${options.file}` : undefined,
              typeof options.staged === 'boolean' ? `staged=${options.staged}` : undefined]
            : operation === 'log' ? [`n=${typeof options.n === 'number' ? options.n : 20}`] : []
          const label = details.filter(Boolean).join(', ')
          const title = `${operation}${label ? ` (${label})` : ''}`
          const failed = isToolErrorResult(result)
          return {
            index: index + 1,
            action: operation,
            label: title,
            failed,
            result: failed ? JSON.parse(result) as unknown : result,
            formatted: `### ${title}\n${result}`,
          }
        })
        const failures = operationResults.filter(operation => operation.failed)
        if (!failures.length) return operationResults.map(operation => operation.formatted).join('\n\n')

        const allFailed = failures.length === operationResults.length
        return JSON.stringify({
          schemaVersion: 1,
          status: allFailed ? 'error' : 'partial',
          error: {
            kind: 'tool',
            code: allFailed ? 'GIT_BATCH_FAILED' : 'GIT_BATCH_PARTIAL',
            message: `${failures.length} of ${operationResults.length} Git batch operations failed.`,
            retryable: false,
          },
          partial: {
            results: operationResults.map(({ index, action: operation, label, failed, result }) => ({
              index,
              action: operation,
              label,
              status: failed ? 'error' : 'done',
              ...(failed ? { result } : { output: result }),
            })),
          },
        })
      }
      case 'status': {
        const { out, code } = await git(['status', '--short', '--branch'], context)
        return code === 0 ? out || 'Working tree clean' : gitError(out || 'Git inspection failed')
      }
      case 'diff': {
        const gitArgs = ['diff']
        if (staged) gitArgs.push('--staged')
        if (file) gitArgs.push('--', file)
        const { out, code } = await git(gitArgs, context)
        return code === 0 ? out || 'No changes' : gitError(out || 'Git inspection failed')
      }
      case 'log': {
        const count = n ?? 20
        const { out, code } = await git(['log', '--oneline', `-${count}`, '--decorate'], context)
        return code === 0 ? `Log limit: ${count}\n${out || 'No commits'}` : gitError(out || 'Git inspection failed')
      }
      case 'add': {
        if (!files?.length) return formatToolError('validation', 'INVALID_ARGUMENTS', 'files array is required for add')
        const { out, code, effectUnknown, effectResolution, effectEvidence } = await git(['add', '--', ...files], context)
        return code === 0 ? `Staged: ${files.join(', ')}${out ? '\n' + out : ''}` : effectUnknown || effectResolution ? gitLocalEffectError('add', out, effectResolution, effectEvidence) : gitError(out)
      }
      case 'commit': {
        if (!message) return formatToolError('validation', 'INVALID_ARGUMENTS', 'message is required for commit')
        const { out, code, effectUnknown, effectResolution, effectEvidence } = await git(['commit', '-m', message], context)
        return code === 0 ? out : effectUnknown || effectResolution ? gitLocalEffectError('commit', out, effectResolution, effectEvidence) : gitError(out)
      }
      case 'branch': {
        if (create) {
          const valid = await git(['check-ref-format', '--branch', create], context)
          if (valid.code !== 0) return gitError(valid.out)
          const { out, code, effectUnknown, effectResolution, effectEvidence } = await git(['checkout', '-b', create], context)
          return code === 0 ? `Created and switched to branch '${create}'` : effectUnknown || effectResolution ? gitLocalEffectError('branch creation', out, effectResolution, effectEvidence) : gitError(out)
        }
        if (switchBranch) {
          const valid = await git(['check-ref-format', '--branch', switchBranch], context)
          if (valid.code !== 0) return gitError(valid.out)
          const { out, code, effectUnknown, effectResolution, effectEvidence } = await git(['checkout', switchBranch], context)
          return code === 0 ? `Switched to branch '${switchBranch}'` : effectUnknown || effectResolution ? gitLocalEffectError('branch switch', out, effectResolution, effectEvidence) : gitError(out)
        }
        const { out, code } = await git(['branch', '-a'], context)
        return code === 0 ? out || 'No branches' : gitError(out || 'Git inspection failed')
      }
      case 'stash': {
        const { out, code, effectUnknown, effectResolution, effectEvidence } = await git(pop ? ['stash', 'pop'] : ['stash'], context)
        return code === 0 ? (out || (pop ? 'Stash popped' : 'Changes stashed')) : effectUnknown || effectResolution ? gitLocalEffectError(pop ? 'stash pop' : 'stash', out, effectResolution, effectEvidence) : gitError(out)
      }
      case 'pull': {
        const { out, code, effectUnknown, effectResolution, effectEvidence } = await git(['pull', '--no-edit'], context)
        return code === 0 ? out : effectResolution === 'effect-observed' && effectEvidence ? gitRemoteObservedError('pull', effectEvidence)
          : effectUnknown ? gitRemoteError('pull') : gitError(out)
      }
      case 'push': {
        const gitArgs = ['push']
        if (force) gitArgs.push('--force-with-lease')
        gitArgs.push('--porcelain')
        // Auto set-upstream for new branches — check exit code, not output text
        const { code: upstreamCode } = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], context)
        if (upstreamCode !== 0) {
          const { out: currentBranch } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], context)
          gitArgs.push('--set-upstream', 'origin', currentBranch.trim())
        }
        const { out, code, effectUnknown, effectResolution, effectEvidence } = await git(gitArgs, context)
        return code === 0 ? (out || 'Pushed successfully')
          : effectResolution === 'effect-observed' && effectEvidence ? gitRemoteObservedError('push', effectEvidence)
            : effectUnknown ? gitRemoteError('push') : gitError(out)
      }
      default:
        return formatToolError('validation', 'INVALID_ARGUMENTS', `Unknown action: ${action}`)
    }
  },
}
