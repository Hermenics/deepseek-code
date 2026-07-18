import { execa } from 'execa'
import type { Tool, } from '../types.js'
import type { ToolExecutionContext } from '../../orchestration/types.js'

async function git(args: string[], context?: ToolExecutionContext): Promise<{ out: string; code: number }> {
  try {
    const result = await execa('git', args, { cwd: context?.workspacePath ?? process.cwd(), cancelSignal: context?.signal, reject: false })
    const out = (result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim()
    return { out, code: result.exitCode ?? 0 }
  } catch (err: unknown) {
    return { out: (err as Error).message ?? String(err), code: 1 }
  }
}

export const Git: Tool = {
  name: 'git',
  description: `Execute git operations in the current repository.
Actions:
- status: show working tree status (git status --short)
- diff: show unstaged changes. Optional: file=<path> to diff specific file, staged=true for staged changes
- log: show recent commits. Optional: n=<number> (default 20)
- add: stage files. Requires: files=["path1","path2"] or files=["."].
- commit: create a commit. Requires: message=<string>
- branch: list branches. Optional: create=<name> to create+switch, switch=<name> to switch
- stash: stash changes. Optional: pop=true to pop stash
- pull: pull from remote
- push: push to remote. Optional: force=true (use with caution)`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'diff', 'log', 'add', 'commit', 'branch', 'stash', 'pull', 'push'],
        description: 'Git action to perform',
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
      case 'status': {
        const { out } = await git(['status', '--short', '--branch'], context)
        return out || 'Working tree clean'
      }
      case 'diff': {
        const gitArgs = ['diff']
        if (staged) gitArgs.push('--staged')
        if (file) gitArgs.push('--', file)
        const { out } = await git(gitArgs, context)
        return out || 'No changes'
      }
      case 'log': {
        const count = n ?? 20
        const { out } = await git(['log', '--oneline', `-${count}`, '--decorate'], context)
        return out || 'No commits'
      }
      case 'add': {
        if (!files?.length) return 'Error: files array is required for add'
        const { out, code } = await git(['add', '--', ...files], context)
        return code === 0 ? `Staged: ${files.join(', ')}${out ? '\n' + out : ''}` : `Error: ${out}`
      }
      case 'commit': {
        if (!message) return 'Error: message is required for commit'
        const { out, code } = await git(['commit', '-m', message], context)
        return code === 0 ? out : `Error: ${out}`
      }
      case 'branch': {
        if (create) {
          const valid = await git(['check-ref-format', '--branch', create], context)
          if (valid.code !== 0) return `Error: ${valid.out}`
          const { out, code } = await git(['checkout', '-b', create], context)
          return code === 0 ? `Created and switched to branch '${create}'` : `Error: ${out}`
        }
        if (switchBranch) {
          const valid = await git(['check-ref-format', '--branch', switchBranch], context)
          if (valid.code !== 0) return `Error: ${valid.out}`
          const { out, code } = await git(['checkout', switchBranch], context)
          return code === 0 ? `Switched to branch '${switchBranch}'` : `Error: ${out}`
        }
        const { out } = await git(['branch', '-a'], context)
        return out || 'No branches'
      }
      case 'stash': {
        const { out, code } = await git(pop ? ['stash', 'pop'] : ['stash'], context)
        return code === 0 ? (out || (pop ? 'Stash popped' : 'Changes stashed')) : `Error: ${out}`
      }
      case 'pull': {
        const { out, code } = await git(['pull'], context)
        return code === 0 ? out : `Error: ${out}`
      }
      case 'push': {
        const gitArgs = ['push']
        if (force) gitArgs.push('--force-with-lease')
        // Auto set-upstream for new branches — check exit code, not output text
        const { code: upstreamCode } = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], context)
        if (upstreamCode !== 0) {
          const { out: currentBranch } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], context)
          gitArgs.push('--set-upstream', 'origin', currentBranch.trim())
        }
        const { out, code } = await git(gitArgs, context)
        return code === 0 ? (out || 'Pushed successfully') : `Error: ${out}`
      }
      default:
        return `Unknown action: ${action}`
    }
  },
}
