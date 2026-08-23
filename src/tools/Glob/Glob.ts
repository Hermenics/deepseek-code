import { Tool } from '../types.js'
import fg from 'fast-glob'
import { realpath } from 'node:fs/promises'
import * as path from 'node:path'
import { GLOB_MAX_FILES } from '../../constants.js'
import { assertSafeDir } from '../shared/pathSafety.js'
import { ignoreDirNames, isPathIgnored } from '../shared/deepseekignore.js'

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

export const Glob: Tool = {
  name: 'glob',
  description: 'Find files matching a glob pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern' },
      cwd: { type: 'string', description: 'Working directory (default: .)' },
    },
    required: ['pattern'],
  },
  async execute(args, context) {
    const cwd = await assertSafeDir((args.cwd as string) || '.', context)
    const workspaceRoot = path.resolve(context?.workspacePath ?? process.cwd())
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
    const files = (await Promise.all(matches.map(async (file) => {
      const absolute = path.resolve(cwd, file)
      try {
        const canonical = await realpath(absolute)
        if (!isContained(canonicalWorkspaceRoot, canonical)) return null
        return isPathIgnored(absolute, workspaceRoot) ? null : file
      } catch {
        return null
      }
    }))).filter((file): file is string => file !== null)
    if (!files.length) return 'No matches'
    const truncated = files.length > GLOB_MAX_FILES
    const result = files.slice(0, GLOB_MAX_FILES).join('\n')
    return truncated
      ? `${result}\n\n(truncated — ${files.length} files, showing first ${GLOB_MAX_FILES})`
      : result
  },
}
