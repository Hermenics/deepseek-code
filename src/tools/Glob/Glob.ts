import { Tool } from '../types.js'
import fg from 'fast-glob'
import { realpath } from 'node:fs/promises'
import * as path from 'node:path'
import { GLOB_MAX_FILES } from '../../constants.js'
import { assertSafeDir, isProtectedPath } from '../shared/pathSafety.js'
import { ignoreDirNames, isPathIgnored } from '../shared/deepseekignore.js'
import { formatToolError } from '../result.js'

/** True when `target` is `root` itself or lies inside it. */
function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

// Directory ignores come from .deepseekignore (or its defaults). What stays
// here is search-tuning only: files that clutter results but remain readable
// by ReadFile — putting these in .deepseekignore would block access entirely.

/** Lockfiles, binaries, media, and other non-source files */
export const GLOB_IGNORE_FILES: string[] = [
  '**/*.map',
  '**/*.min.*',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lock',
  '**/*.{mp4,mov,avi,flv}',
  '**/*.{png,jpg,jpeg,gif,webp,ico,pdf}',
  '**/*.svg',
  '**/*.{zip,gz,tar,7z}',
  '**/*.log',
  '**/.env*',
  '**/.DS_Store',
]

/** Tool that lists files matching a glob. Symlinks are not followed, and results that resolve outside the workspace or are excluded by .deepseekignore are dropped. Output is capped at GLOB_MAX_FILES. */
export const Glob: Tool = {
  name: 'glob',
  description: 'Find files matching a glob pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern' },
      cwd: { type: 'string', default: '.', description: 'Working directory (default: .)' },
    },
    required: ['pattern'],
  },
  async execute(args, context) {
    const cwd = await assertSafeDir((args.cwd as string) || '.', context)
    const workspaceRoot = path.resolve(context?.workspacePath ?? process.cwd())
    const relativeScope = path.relative(workspaceRoot, cwd)
    const scope = isContained(workspaceRoot, cwd) ? relativeScope || '.' : cwd
    const canonicalWorkspaceRoot = await realpath(workspaceRoot)

    // Fast path: simple dir names from .deepseekignore as glob excludes;
    // the post-filter below covers complex patterns.
    const dirIgnores = ignoreDirNames(workspaceRoot).map((d) => `**/${d}/**`)
    const matches = await fg(args.pattern as string, {
      cwd,
      ignore: [...dirIgnores, ...GLOB_IGNORE_FILES],
      dot: true,
      followSymbolicLinks: false,
    })
    let verificationFailures = 0
    const files = (await Promise.all(matches.map(async (file) => {
      const absolute = path.resolve(cwd, file)
      try {
        if (await isProtectedPath(absolute, context)) return null
        const canonical = await realpath(absolute)
        if (!isContained(canonicalWorkspaceRoot, canonical)) return null
        return isPathIgnored(absolute, workspaceRoot) ? null : file
      } catch {
        verificationFailures++
        return null
      }
    }))).filter((file): file is string => file !== null)
    const truncated = files.length > GLOB_MAX_FILES
    const result = files.slice(0, GLOB_MAX_FILES).join('\n')
    const listing = truncated
      ? `${result}\n\n(truncated — ${files.length} files, showing first ${GLOB_MAX_FILES})`
      : result
    if (verificationFailures) {
      const message = `Could not verify ${verificationFailures} of ${matches.length} glob matches; results may be incomplete.`
      return files.length
        ? formatToolError('tool', 'GLOB_PARTIAL', message, false, { output: `Search scope: ${scope}\n${listing}` })
        : formatToolError('tool', 'GLOB_FAILED', message)
    }
    return files.length ? `Search scope: ${scope}\n${listing}` : `Search scope: ${scope}\nNo matches`
  },
}
