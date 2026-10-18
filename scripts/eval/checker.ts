import { realpathSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { execa } from 'execa'
import { verificationTestCount } from '../../src/agent/verificationTestCount.js'
import { isLinux, sandboxAvailable, scrubbedEnv } from '../../src/utils/platform.js'
import { redactSecrets } from '../../src/orchestration/events.js'

const PROJECT_ROOT = resolve(import.meta.dir, '../..')
const BUN_BINARY = realpathSync(process.execPath)

/** Check the OS namespace before starting any eval model worker. */
export function assertCheckerSandboxAvailable(): void {
  if (!isLinux || !sandboxAvailable()) {
    throw new Error('Eval checker requires Linux bubblewrap filesystem containment; refusing to run untrusted checks without it')
  }
}

export interface IsolatedCheckerResult {
  exitCode: number
  all: string
  testCount: number | null
  positiveTestEvidence: boolean
}

async function readOnlyBindArgs(cwd: string, paths: readonly string[] = []): Promise<string[]> {
  const root = await realpath(cwd)
  const args: string[] = []
  for (const path of new Set(paths)) {
    if (!path || isAbsolute(path)) throw new Error('Checker read-only paths must be relative to the fixture workspace')
    const target = resolve(root, path)
    const rel = relative(root, target)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('Checker read-only paths must stay inside the fixture workspace')
    }
    const source = await realpath(target)
    if (source !== target || !(await lstat(target)).isDirectory()) {
      throw new Error('Checker read-only paths must be real directories inside the fixture workspace')
    }
    args.push('--ro-bind', source, join('/mnt', rel))
  }
  return args
}

/** Run fixture checks with only the task fixture and approved runtime mounted; selected workspace directories can be frozen read-only. */
export async function runIsolatedChecker(args: string[], cwd: string, options: { allowNetwork?: boolean; readOnlyPaths?: readonly string[] } = {}): Promise<IsolatedCheckerResult> {
  assertCheckerSandboxAvailable()
  // Place the scratch dir under /tmp because that path is replaced by a tmpfs in the namespace.
  const sandbox = await mkdtemp(join('/tmp', 'deepseek-eval-checker-'))
  const home = join(sandbox, 'home')
  const temp = join(sandbox, 'tmp')
  try {
    await Promise.all([mkdir(home, { recursive: true }), mkdir(temp, { recursive: true })])
    const commandArgs = [
      '--die-with-parent', '--new-session',
      '--ro-bind', '/usr', '/usr',
      '--ro-bind-try', '/bin', '/bin', '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
      '--bind', cwd, '/mnt',
      ...await readOnlyBindArgs(cwd, options.readOnlyPaths),
      '--dir', '/opt/bun', '--ro-bind', BUN_BINARY, '/opt/bun/bun',
      '--dir', '/node_modules',
      '--ro-bind-try', join(PROJECT_ROOT, 'node_modules'), '/node_modules',
      '--tmpfs', '/tmp', '--dir', sandbox, '--bind', sandbox, sandbox,
      '--dev', '/dev', '--proc', '/proc',
    ]
    if (options.allowNetwork) {
      const resolvTarget = (() => { try { return realpathSync('/etc/resolv.conf') } catch { return null } })()
      commandArgs.push('--dir', '/etc', '--dir', '/etc/ssl')
      commandArgs.push('--ro-bind-try', resolvTarget ?? '/etc/resolv.conf', '/etc/resolv.conf', '--ro-bind-try', '/etc/ssl/certs', '/etc/ssl/certs')
    } else {
      commandArgs.push('--unshare-net')
    }
    commandArgs.push(
      '--unshare-pid', '--unshare-ipc', '--unshare-uts',
      '--clearenv', '--setenv', 'PATH', '/opt/bun:/usr/local/bin:/usr/bin:/bin',
      '--setenv', 'HOME', home, '--setenv', 'TMPDIR', temp,
      '--setenv', 'TMP', temp, '--setenv', 'TEMP', temp,
      '--setenv', 'XDG_CONFIG_HOME', join(home, '.config'),
      '--setenv', 'XDG_CACHE_HOME', join(home, '.cache'),
      '--setenv', 'XDG_DATA_HOME', join(home, '.local', 'share'),
      '--setenv', 'APPDATA', join(home, 'AppData', 'Roaming'),
      '--setenv', 'LOCALAPPDATA', join(home, 'AppData', 'Local'),
      '--setenv', 'USERPROFILE', home,
      '--chdir', '/mnt', '--', '/opt/bun/bun', ...args,
    )
    const result = await execa('bwrap', commandArgs, {
      cwd, env: scrubbedEnv(), extendEnv: false, reject: false, all: true,
      timeout: 120_000, maxBuffer: 4 * 1024 * 1024, stdin: 'ignore', shell: false,
    })
    const all = String(redactSecrets(stripVTControlCharacters(result.all ?? [result.stdout, result.stderr].filter(Boolean).join('\n'))))
    const testCount = verificationTestCount(all, 'bun')
    return { exitCode: result.exitCode ?? -1, all, testCount, positiveTestEvidence: testCount !== null && testCount > 0 }
  } catch (error) {
    const details = error as { all?: string; message?: string }
    const all = String(redactSecrets(stripVTControlCharacters(details.all ?? details.message ?? 'CheckerError')))
    return { exitCode: -1, all, testCount: verificationTestCount(all, 'bun'), positiveTestEvidence: false }
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}
