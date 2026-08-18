import { Tool } from '../types.js'
import { execa } from 'execa'
import * as path from 'node:path'
import { GREP_MAX_LINES } from '../../constants.js'
import { assertSafeDir } from '../shared/pathSafety.js'
import { ignoreDirNames, isPathIgnored } from '../shared/deepseekignore.js'
import { hasBinary } from '../../utils/platform.js'
import { jsGrep } from './jsGrep.js'

const nativeGrepCapability = new Map<string, Promise<boolean>>()

async function supportsNativeGrep(): Promise<boolean> {
  const platform = process.platform
  const cached = nativeGrepCapability.get(platform)
  if (cached) return cached

  const probe = (async () => {
    if (!hasBinary('grep')) return false
    try {
      await execa('grep', ['-rnzZ', '--', '', platform === 'win32' ? 'NUL' : '/dev/null'], { timeout: 3000 })
      return true
    } catch (error) {
      return (error as { exitCode?: number }).exitCode === 1
    }
  })()
  nativeGrepCapability.set(platform, probe)
  return probe
}

function unsupportedGrepOptions(error: unknown): boolean {
  const failure = error as { exitCode?: number; stderr?: string; message?: string }
  const text = `${failure.stderr || ''} ${failure.message || ''}`
  return failure.exitCode === 2 && /(invalid|unknown|unrecognized|illegal|unsupported).*option|usage:\s*grep/i.test(text)
}

export const Grep: Tool = {
  name: 'grep',
  description: 'Search for a regex pattern in files using grep.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern' },
      path: { type: 'string', description: 'Directory to search (default: .)' },
      include: { type: 'string', description: 'File glob filter, e.g. "*.ts"' },
    },
    required: ['pattern'],
  },
  async execute(args, context) {
    const dir = await assertSafeDir((args.path as string) || '.', context)
    const pattern = args.pattern as string
    const include = args.include as string | undefined
    const workspaceRoot = path.resolve(context?.workspacePath ?? process.cwd())

    const grepArgs = ['-rnzZ']
    if (include) grepArgs.push(`--include=${include}`)

    // Fast path: plain directory names from .deepseekignore (or defaults)
    // become --exclude-dir. Complex patterns are handled by the post-filter.
    for (const d of [...ignoreDirNames(workspaceRoot), '.DS_Store']) grepArgs.push(`--exclude-dir=${d}`)

    grepArgs.push('--', pattern, dir)

    const render = (lines: string[], totalMatches = lines.length) => {
      const truncated = totalMatches > GREP_MAX_LINES
      const result = lines.slice(0, GREP_MAX_LINES).join('\n')
      return truncated
        ? `${result}\n\n(truncated — ${totalMatches} results, showing first ${GREP_MAX_LINES})`
        : result || 'No matches'
    }

    const runJsFallback = async () => {
      const { lines, totalMatches, error } = await jsGrep({
        dir,
        pattern,
        include,
        workspaceRoot,
        ignoreDirs: [...ignoreDirNames(workspaceRoot), '.DS_Store'],
        limit: GREP_MAX_LINES,
        signal: context?.signal,
      })
      return error ? `Error: ${error}` : render(lines, totalMatches)
    }

    // Native grep is used only when the exact NUL-separator options are known
    // to work; Windows and BSD grep commonly lack -z or -Z.
    if (!(await supportsNativeGrep())) return runJsFallback()

    try {
      const { stdout } = await execa('grep', grepArgs, { timeout: 15000, cancelSignal: context?.signal })
      const lines = stdout.split('\0').flatMap((part, index, parts) => {
        if (index % 2 !== 1) return []
        const file = parts[index - 1]!
        return part.split('\n').filter(Boolean)
          // Post-filter: drop matches in files .deepseekignore excludes.
          .filter(() => !isPathIgnored(path.resolve(file), workspaceRoot))
          .map((match) => `${file}:${match}`)
      })
      return render(lines)
    } catch (err: unknown) {
      const exitCode = (err as { exitCode?: number })?.exitCode
      if (exitCode === 1) return 'No matches'
      if (unsupportedGrepOptions(err)) return runJsFallback()
      const msg = (err as { stderr?: string })?.stderr || 'Grep failed'
      return `Error: ${msg}`
    }
  },
}
