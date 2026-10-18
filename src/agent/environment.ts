import { release, type as osType } from 'node:os'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { validRange } from 'semver'
import { runGitInspection } from '../utils/gitInspection.js'

const PACKAGE_JSON_MAX_BYTES = 64 * 1024
const LOCKFILES = [
  ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
] as const
const PROJECT_CONFIGS = [
  ['Python', ['pyproject.toml', 'requirements.txt', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'uv.lock', 'pdm.lock', 'setup.py', 'setup.cfg']],
  ['Rust', ['Cargo.toml', 'Cargo.lock']],
  ['Go', ['go.mod', 'go.sum']],
  ['Ruby', ['Gemfile', 'Gemfile.lock']],
  ['PHP', ['composer.json', 'composer.lock']],
  ['Maven', ['pom.xml']],
  ['Gradle', ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts', 'gradle.lockfile']],
  ['Deno', ['deno.json', 'deno.jsonc', 'deno.lock']],
] as const

export interface EnvironmentInfo {
  workingDirectory: string
  additionalDirectories?: string[]
  platform: string
  osVersion: string
  shell: string
  isGitRepository: boolean
  gitBranch?: string
  model: string
  provider: string
  date: string
  runtime: string
  packageManager: string
  lockfiles: string[]
  projectConfigurations: string[]
  targetProjectConfigurations?: string[]
  projectRuntime?: string
  targetPackage?: string
  targetPackageManager?: string
  targetProjectRuntime?: string
}

/** Runs a git command with a 3s timeout, returning trimmed stdout on success and undefined on any failure. */
async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await runGitInspection(args, cwd, { reject: false, timeout: 3_000 })
    return result.exitCode === 0 ? result.stdout.trim() : undefined
  } catch { return undefined }
}

async function readProjectPackage(root: string): Promise<Record<string, unknown> | undefined> {
  try {
    const path = join(root, 'package.json')
    if (!(await lstat(path)).isFile()) return undefined
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_NOFOLLOW ?? 0)
    const file = await open(path, flags)
    try {
      if (!(await file.stat()).isFile()) return undefined
      const bytes = Buffer.alloc(PACKAGE_JSON_MAX_BYTES + 1)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      if (bytesRead > PACKAGE_JSON_MAX_BYTES) return undefined
      const value: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
    } finally { await file.close() }
  } catch { return undefined }
}

async function boundedTargetDirectories(root: string, target: string): Promise<{ repositoryRoot: string; targetDirectory: string } | undefined> {
  try {
    const [repositoryRoot, targetDirectory] = await Promise.all([realpath(resolve(root)), realpath(resolve(target))])
    const targetRelativePath = relative(repositoryRoot, targetDirectory)
    if (targetRelativePath === '..' || targetRelativePath.startsWith(`..${sep}`) || isAbsolute(targetRelativePath)) return undefined
    return { repositoryRoot, targetDirectory }
  } catch { return undefined }
}

function projectRuntime(engines: unknown): string | undefined {
  if (!engines || typeof engines !== 'object' || Array.isArray(engines)) return undefined
  const values = Object.entries(engines as Record<string, unknown>)
    .filter((entry): entry is [string, string] =>
      ['bun', 'node', 'deno'].includes(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= 60)
    .flatMap(([name, value]) => {
      const range = validRange(value)
      return range ? [`${name} ${range}`] : []
    })
  return values.length ? values.join('; ') : undefined
}

function packageManagerDeclaration(metadata: Record<string, unknown> | undefined): string | undefined {
  const declaration = metadata?.packageManager
  if (typeof declaration !== 'string') return undefined
  return /^(bun|npm|pnpm|yarn)@[0-9][\w.+-]{0,39}(?:\+sha\d+-[a-f0-9]{6,})?$/i.test(declaration)
    ? declaration
    : 'unknown (unrecognized packageManager declaration)'
}

async function nearestPackage(root: string, target: string, rootMetadata: Record<string, unknown> | undefined): Promise<{ relativeDirectory: string; metadata?: Record<string, unknown> } | undefined> {
  const bounded = await boundedTargetDirectories(root, target)
  if (!bounded) return undefined
  const { repositoryRoot, targetDirectory } = bounded

  for (let directory = targetDirectory; ; directory = dirname(directory)) {
    try {
      if ((await lstat(join(directory, 'package.json'))).isFile()) {
        const metadata = directory === repositoryRoot ? rootMetadata : await readProjectPackage(directory)
        return {
          relativeDirectory: relative(repositoryRoot, directory),
          ...(metadata ? { metadata } : {}),
        }
      }
    } catch { /* Continue toward the repository root when this directory has no regular package manifest. */ }
    if (directory === repositoryRoot) return undefined
  }
}

async function nearestProjectConfigurations(root: string, target: string): Promise<string[] | undefined> {
  const bounded = await boundedTargetDirectories(root, target)
  if (!bounded) return undefined
  const { repositoryRoot, targetDirectory } = bounded
  for (let directory = targetDirectory; ; directory = dirname(directory)) {
    const configurations = (await Promise.all(PROJECT_CONFIGS.map(async ([ecosystem, names]) => {
      const files = (await Promise.all(names.map(async name => {
        try { return (await stat(join(directory, name))).isFile() ? name : undefined }
        catch { return undefined }
      }))).filter((name): name is NonNullable<typeof name> => Boolean(name))
      return files.length ? { ecosystem, files } : undefined
    }))).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    if (configurations.length && directory !== repositoryRoot) {
      const relativeDirectory = relative(repositoryRoot, directory).split(sep).join('/')
      return configurations.map(({ ecosystem, files }) => `${ecosystem} (${files.map(name => `${relativeDirectory}/${name}`).join(', ')})`)
    }
    if (directory === repositoryRoot) return undefined
  }
}

async function detectProjectToolchain(root: string, target: string): Promise<Pick<EnvironmentInfo, 'packageManager' | 'lockfiles' | 'projectConfigurations' | 'targetProjectConfigurations' | 'projectRuntime' | 'targetPackage' | 'targetPackageManager' | 'targetProjectRuntime'>> {
  const [metadata, existingLockfiles, existingProjectConfigs] = await Promise.all([
    readProjectPackage(root),
    Promise.all(LOCKFILES.map(async ([name, manager]) => {
      try { return (await stat(join(root, name))).isFile() ? { name, manager } : undefined }
      catch { return undefined }
    })),
    Promise.all(PROJECT_CONFIGS.map(async ([ecosystem, names]) => {
      const files = (await Promise.all(names.map(async name => {
        try { return (await stat(join(root, name))).isFile() ? name : undefined }
        catch { return undefined }
      }))).filter((name): name is NonNullable<typeof name> => Boolean(name))
      return files.length ? `${ecosystem} (${files.join(', ')})` : undefined
    })),
  ])
  const lockfiles = existingLockfiles.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  const runtime = projectRuntime(metadata?.engines)
  const declaredManager = packageManagerDeclaration(metadata)
  let packageManager = 'unknown (no declaration or lockfile)'
  if (declaredManager) {
    packageManager = declaredManager
  } else {
    const managers = [...new Set(lockfiles.map(({ manager }) => manager))]
    packageManager = managers.length === 1 ? `${managers[0]} (inferred from lockfile)`
      : managers.length > 1 ? `ambiguous (${lockfiles.map(({ name }) => name).join(', ')})`
        : packageManager
  }
  const [targetPackage, targetProjectConfigurations] = await Promise.all([
    nearestPackage(root, target, metadata),
    nearestProjectConfigurations(root, target),
  ])
  const targetRelativePath = targetPackage?.relativeDirectory.split(sep).join('/') ?? ''
  const targetManager = packageManagerDeclaration(targetPackage?.metadata)
  const targetRuntime = projectRuntime(targetPackage?.metadata?.engines)
  return {
    packageManager,
    lockfiles: lockfiles.map(({ name }) => name),
    projectConfigurations: existingProjectConfigs.filter((config): config is Exclude<typeof config, undefined> => config !== undefined),
    ...(targetProjectConfigurations ? { targetProjectConfigurations } : {}),
    ...(runtime ? { projectRuntime: runtime } : {}),
    ...(targetPackage && targetPackage.relativeDirectory ? {
      targetPackage: `${targetRelativePath ? `${targetRelativePath}/` : ''}package.json`,
      ...(targetManager ? { targetPackageManager: targetManager } : {}),
      ...(targetRuntime ? { targetProjectRuntime: targetRuntime } : {}),
    } : {}),
  }
}

/** Gathers bounded workspace and runtime facts for the system prompt's environment block. */
export async function collectEnvironmentInfo(options: {
  workingDirectory: string
  additionalDirectories?: string[]
  model: string
  provider: string
  now?: Date
}): Promise<EnvironmentInfo> {
  const [inside, branch, gitRoot] = await Promise.all([
    git(options.workingDirectory, ['rev-parse', '--is-inside-work-tree']),
    git(options.workingDirectory, ['branch', '--show-current']),
    git(options.workingDirectory, ['rev-parse', '--show-toplevel']),
  ])
  const toolchain = await detectProjectToolchain(gitRoot ?? options.workingDirectory, options.workingDirectory)
  const shellPath = process.env.SHELL || (process.platform === 'win32' ? 'powershell' : 'sh')
  return {
    workingDirectory: options.workingDirectory,
    ...(options.additionalDirectories?.length ? { additionalDirectories: options.additionalDirectories } : {}),
    platform: process.platform,
    osVersion: `${osType()} ${release()}`,
    shell: basename(shellPath),
    isGitRepository: inside === 'true',
    ...(branch ? { gitBranch: branch } : {}),
    model: options.model,
    provider: options.provider,
    date: (options.now ?? new Date()).toISOString().slice(0, 10),
    runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node ?? process.version}`,
    ...toolchain,
  }
}

/**
 * Environment facts the model otherwise has to guess or discover with tool calls:
 * where it is, which OS, shell, runtime and project package manager it uses, whether Git is available, and today's date.
 * Rendered as a plain block so it reads the same on every provider.
 */
export function formatEnvironmentInfo(info: EnvironmentInfo): string {
  const lines = [
    `Working directory: ${info.workingDirectory}`,
    ...(info.additionalDirectories?.length ? [`Additional working directories: ${info.additionalDirectories.join(', ')}`] : []),
    `Is a git repository: ${info.isGitRepository ? 'yes' : 'no'}${info.gitBranch ? ` (branch ${info.gitBranch})` : ''}`,
    `Platform: ${info.platform}`,
    `OS version: ${info.osVersion}`,
    `Shell: ${info.shell}${info.platform === 'win32' ? ' (use Unix shell syntax; forward slashes in paths)' : ''}`,
    `Agent runtime: ${info.runtime}`,
    `Package manager: ${info.packageManager}`,
    `Lockfiles: ${info.lockfiles.length ? info.lockfiles.join(', ') : 'none detected'}`,
    ...(info.projectConfigurations.length ? [`Project configuration: ${info.projectConfigurations.join('; ')}`] : []),
    ...(info.targetProjectConfigurations?.length ? [`Target project configuration: ${info.targetProjectConfigurations.join('; ')}`] : []),
    ...(info.projectRuntime ? [`Project runtime constraints: ${info.projectRuntime}`] : []),
    ...(info.targetPackage ? [`Target package: ${info.targetPackage}`] : []),
    ...(info.targetPackageManager ? [`Target package manager: ${info.targetPackageManager}`] : []),
    ...(info.targetProjectRuntime ? [`Target runtime constraints: ${info.targetProjectRuntime}`] : []),
    ...(info.platform === 'linux' ? [`Shell sandbox: when sandboxed, shell commands see the working directory at /mnt (pwd prints /mnt); the host workspace path above is also mounted. Contextual file tools accept /mnt paths as workspace aliases and accept host workspace paths. Containment, symlink and sensitive-file checks apply to both.`] : []),
    `Model: ${info.model} via ${info.provider}`,
    `Today's date: ${info.date}`,
  ]
  return lines.join('\n')
}
