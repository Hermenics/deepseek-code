import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, realpathSync, statSync } from 'fs'
import { lstat, open, readFile, readdir, readlink, realpath, stat } from 'fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { stripVTControlCharacters } from 'node:util'
import { execa } from 'execa'
import { captureWorkspaceVersion, resolveWorkspaceRoot, type WorkspaceVersion } from './workspaceVersion.js'
import { hashFileContent, isSensitiveWorkspacePath } from '../tools/shared/pathSafety.js'
import { scrubbedEnv } from '../utils/platform.js'
import { redactSecrets } from '../orchestration/events.js'
import { supportedTestRunnerInvocation, verificationTestCount, verificationTestFailureCount, type SupportedTestRunner } from './verificationTestCount.js'
export { verificationTestCount } from './verificationTestCount.js'

export interface VerificationCommand {
  command: string
  args: string[]
  display: string
  /** Explicit ignored or otherwise untracked test fixtures/configuration, relative to the command cwd. */
  verificationInputs?: string[]
}

export interface VerificationResult {
  command: VerificationCommand
  ok: boolean
  output: string
  outputBytes?: number
  status?: 'passed' | 'failed' | 'empty' | 'stale' | 'cancelled' | 'timed_out' | 'inconclusive'
  exitCode?: number | null
  testCount?: number | null
  inputDigest?: string
  finalDigest?: string
  inputWorkspace?: WorkspaceVersion
  finalWorkspace?: WorkspaceVersion
  executionEnvironment?: 'host' | 'linux-bwrap'
  allowNetwork?: boolean
  executionFingerprint?: string
  finalExecutionFingerprint?: string
  durationMs?: number
  cwd?: string
  captureTruncated?: boolean
  drainTimedOut?: boolean
}

export interface VerificationProcessResult {
  exitCode?: number | null
  all?: string
  stdout?: string
  stderr?: string
  outputBytes?: number
  timedOut?: boolean
  isCanceled?: boolean
  captureTruncated?: boolean
  drainTimedOut?: boolean
}

export type VerificationExecutionEnvironment = 'host' | 'linux-bwrap'

export const LINUX_SANDBOX_TEST_ENV: Readonly<NodeJS.ProcessEnv> = Object.freeze({
  PATH: '/opt/bin:/usr/local/bin:/usr/bin:/bin',
  HOME: '/tmp',
  TMPDIR: '/tmp',
})

interface VerificationFingerprintOptions {
  executionEnvironment?: VerificationExecutionEnvironment
  allowNetwork?: boolean
  environment?: NodeJS.ProcessEnv
  executablePathMappings?: Readonly<Record<string, string>>
  workspaceRoot?: string
  signal?: AbortSignal
}

const fileHashCache = new Map<string, string>()
const INSTALL_STATE_FILES = ['node_modules/.package-lock.json', 'node_modules/.modules.yaml', '.yarn/install-state.gz']
const HASH = /^[a-f0-9]{64}$/
const MAX_DEPENDENCY_ENTRIES = 100_000
const MAX_DEPENDENCY_BYTES = 4n * 1024n * 1024n * 1024n
const SMALL_FINGERPRINT_FILE_BYTES = 1024 * 1024
const DEPENDENCY_HASH_CONCURRENCY = 32
const MAX_DECLARED_VERIFICATION_INPUTS = 1_000
// Build output stays outside the broad workspace fingerprint, but a caller may explicitly bind safe dist artifacts as test inputs.
const EXCLUDED_VERIFICATION_INPUT_DIRS = new Set(['.git', '.deepseek', '.deepseek-code', 'node_modules', 'coverage', '__eval_check__'])
// shortcut: cap declared test inputs at 256 MiB; raise only when a project intentionally verifies larger fixtures.
const MAX_DECLARED_VERIFICATION_INPUT_BYTES = 256n * 1024n * 1024n
// shortcut: cap traversal at 100000 entries/4 GiB; raise only with measured verification-time and memory budgets.
// shortcut: hash dependency files in bounded batches; tune only with measured I/O and memory budgets.

function fileIdentity(info: { dev: bigint; ino: bigint; mode: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }): string {
  return [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(':')
}

function mappedPath(directory: string, mappings: Readonly<Record<string, string>>): string {
  for (const [from, to] of Object.entries(mappings).sort(([a], [b]) => b.length - a.length)) {
    if (directory === from) return to
    if (directory.startsWith(`${from}/`)) return join(to, directory.slice(from.length + 1))
  }
  return directory
}

function executableCandidates(command: string, cwd: string, env: NodeJS.ProcessEnv, mappings: Readonly<Record<string, string>>): string[] {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) return [isAbsolute(command) ? command : resolve(cwd, command)]
  const paths = env.PATH ?? env.Path ?? ''
  const names = process.platform === 'win32' && !/\.[^./\\]+$/.test(command)
    ? [command, ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map(extension => `${command}${extension}`)]
    : [command]
  return paths.split(delimiter).filter(Boolean).flatMap(directory => names.map(name => join(mappedPath(directory, mappings), name)))
}

function resolveVerificationExecutable(command: string, cwd: string, env: NodeJS.ProcessEnv, mappings: Readonly<Record<string, string>>): string {
  for (const candidate of executableCandidates(command, cwd, env, mappings)) {
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return realpathSync(candidate)
    } catch { /* Try the next PATH entry. */ }
  }
  throw new Error(`Verification executable is unavailable: ${basename(command)}`)
}

async function hashStableFile(path: string, signal?: AbortSignal, maxBytes?: bigint): Promise<{ identity: string; sha256: string; size: string }> {
  signal?.throwIfAborted()
  const canonical = await realpath(path)
  const before = await stat(canonical, { bigint: true })
  if (!before.isFile()) throw new Error('Verification input is not a regular file')
  if (maxBytes !== undefined && before.size > maxBytes) throw new Error('Declared verification inputs exceed 256 MiB')
  const identity = fileIdentity(before)
  const key = `${canonical}\0${identity}`
  let sha256 = fileHashCache.get(key)
  if (!sha256) {
    if (before.size <= BigInt(SMALL_FINGERPRINT_FILE_BYTES)) {
      const content = await readFile(canonical, { signal })
      if (BigInt(content.length) !== before.size) throw new Error('Verification input changed while fingerprinting')
      sha256 = createHash('sha256').update(content).digest('hex')
    } else {
      sha256 = await hashFileContent(canonical, undefined, signal)
    }
    fileHashCache.set(key, sha256)
    if (fileHashCache.size > MAX_DEPENDENCY_ENTRIES) fileHashCache.delete(fileHashCache.keys().next().value!)
  }
  const after = await stat(canonical, { bigint: true }).catch(() => undefined)
  if (!after || fileIdentity(after) !== identity) throw new Error('Verification input changed while fingerprinting')
  return { identity, sha256, size: String(before.size) }
}

async function hashExecutable(path: string, signal?: AbortSignal): Promise<{ identity: string; sha256: string }> {
  const info = await stat(path, { bigint: true })
  if (!info.isFile()) throw new Error('Verification executable is not a regular file')
  return hashStableFile(path, signal)
}

function isContained(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function dependencyRoots(command: VerificationCommand, cwd: string, projectRoot: string): string[] {
  const roots = new Set<string>()
  for (let directory = cwd; ; directory = dirname(directory)) {
    if (!isContained(projectRoot, directory)) throw new Error('Verification cwd escapes the workspace root')
    for (const name of ['node_modules', '.yarn/cache', 'vendor']) roots.add(relative(projectRoot, join(directory, name)))
    if (isAbsolute(command.command)) {
      const runner = resolve(command.command)
      for (const name of ['.venv', 'venv']) {
        const environment = join(directory, name)
        if (isContained(environment, runner)) roots.add(relative(projectRoot, environment))
      }
    }
    if (directory === projectRoot) break
    const parent = dirname(directory)
    if (parent === directory) throw new Error('Verification workspace root is unavailable')
  }
  return [...roots].sort()
}

async function fingerprintDependencyTrees(command: VerificationCommand, cwd: string, workspaceRoot: string, signal?: AbortSignal): Promise<string> {
  const projectRoot = await realpath(resolve(workspaceRoot))
  const projectCwd = await realpath(resolve(cwd))
  if (!isContained(projectRoot, projectCwd)) throw new Error('Verification cwd escapes the workspace root')
  const entries: unknown[] = []
  const pendingFiles: Array<{ row: unknown[]; path: string; identity: string }> = []
  const pendingDirectories: Array<{ path: string; identity: string; name: string }> = []
  const pendingLinks: Array<{ path: string; identity: string; target: string; name: string }> = []
  const missingRoots: string[] = []
  const visitedDirectories = new Set<string>()
  const visitedFiles = new Set<string>()
  let entryCount = 0
  let totalBytes = 0n
  const addEntry = (entry: unknown) => {
    if (++entryCount > MAX_DEPENDENCY_ENTRIES) throw new Error('Dependency fingerprint exceeds 100000 entries; verification scope is unavailable')
    entries.push(entry)
  }

  const visit = async (path: string, name: string): Promise<void> => {
    signal?.throwIfAborted()
    const before = await lstat(path, { bigint: true })
    if (before.isSymbolicLink()) {
      const linkTarget = await readlink(path)
      pendingLinks.push({ path, identity: fileIdentity(before), target: linkTarget, name })
      const resolvedTarget = await realpath(path)
      if (!isContained(projectRoot, resolvedTarget)) throw new Error(`Dependency symlink escapes the project: ${name}`)
      addEntry([name, 'link', linkTarget, relative(projectRoot, resolvedTarget).split(sep).join('/')])
      const target = await stat(resolvedTarget, { bigint: true })
      if (target.isDirectory()) return visit(resolvedTarget, name)
      if (!target.isFile()) throw new Error(`Unsupported dependency symlink target: ${name}`)
      if (!visitedFiles.has(resolvedTarget)) {
        visitedFiles.add(resolvedTarget)
        totalBytes += target.size
      }
      if (totalBytes > MAX_DEPENDENCY_BYTES) throw new Error('Dependency fingerprint exceeds 4 GiB; verification scope is unavailable')
      const row = [`${name}/@target`, 'file', String(target.mode), String(target.size), null]
      addEntry(row)
      pendingFiles.push({ row, path: resolvedTarget, identity: fileIdentity(target) })
      return
    }
    if (before.isDirectory()) {
      const canonical = await realpath(path)
      if (!isContained(projectRoot, canonical)) throw new Error(`Dependency directory escapes the project: ${name}`)
      addEntry([name, 'directory', String(before.mode)])
      pendingDirectories.push({ path, identity: fileIdentity(before), name })
      if (visitedDirectories.has(canonical)) return
      visitedDirectories.add(canonical)
      for (const child of (await readdir(path)).sort()) await visit(join(path, child), `${name}/${child}`)
      const after = await lstat(path, { bigint: true }).catch(() => undefined)
      if (!after || fileIdentity(before) !== fileIdentity(after)) throw new Error(`Dependency directory changed while fingerprinting: ${name}`)
      return
    }
    if (!before.isFile()) throw new Error(`Unsupported dependency input: ${name}`)
    const canonical = await realpath(path)
    if (!visitedFiles.has(canonical)) {
      visitedFiles.add(canonical)
      totalBytes += before.size
    }
    if (totalBytes > MAX_DEPENDENCY_BYTES) throw new Error('Dependency fingerprint exceeds 4 GiB; verification scope is unavailable')
    if (!isContained(projectRoot, canonical)) throw new Error(`Dependency file escapes the project: ${name}`)
    const row = [name, 'file', String(before.mode), String(before.size), null]
    addEntry(row)
    pendingFiles.push({ row, path: canonical, identity: fileIdentity(before) })
  }

  for (const root of dependencyRoots(command, projectCwd, projectRoot)) {
    const path = join(projectRoot, root)
    const name = root.split(sep).join('/')
    try { await lstat(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { addEntry([name, 'missing']); missingRoots.push(path); continue }
      throw error
    }
    await visit(path, name)
  }

  const hashes = new Map<string, Promise<string>>()
  for (let index = 0; index < pendingFiles.length; index += DEPENDENCY_HASH_CONCURRENCY) {
    signal?.throwIfAborted()
    await Promise.all(pendingFiles.slice(index, index + DEPENDENCY_HASH_CONCURRENCY).map(async file => {
      const key = `${file.path}\0${file.identity}`
      let hash = hashes.get(key)
      if (!hash) {
        hash = hashStableFile(file.path, signal).then(result => {
          if (result.identity !== file.identity) throw new Error('Dependency input changed while fingerprinting')
          return result.sha256
        })
        hashes.set(key, hash)
      }
      file.row[4] = await hash
    }))
  }
  for (const directory of pendingDirectories) {
    const after = await lstat(directory.path, { bigint: true }).catch(() => undefined)
    if (!after || !after.isDirectory() || fileIdentity(after) !== directory.identity) {
      throw new Error(`Dependency directory changed while fingerprinting: ${directory.name}`)
    }
  }
  for (const link of pendingLinks) {
    const after = await lstat(link.path, { bigint: true }).catch(() => undefined)
    if (!after?.isSymbolicLink() || fileIdentity(after) !== link.identity || await readlink(link.path).catch(() => undefined) !== link.target) {
      throw new Error(`Dependency symlink changed while fingerprinting: ${link.name}`)
    }
  }
  for (const path of missingRoots) {
    try { await lstat(path); throw new Error('Dependency root appeared while fingerprinting') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return createHash('sha256').update(JSON.stringify({ schema: 'dependency_tree_v1', entries })).digest('hex')
}

async function fingerprintInstallState(cwd: string, workspaceRoot: string, signal?: AbortSignal): Promise<Array<[string, string | null]>> {
  const projectRoot = await realpath(resolve(workspaceRoot))
  const projectCwd = await realpath(resolve(cwd))
  if (!isContained(projectRoot, projectCwd)) throw new Error('Verification cwd escapes the workspace root')
  const result: Array<[string, string | null]> = []
  for (let directory = projectCwd; ; directory = dirname(directory)) {
    for (const relativePath of INSTALL_STATE_FILES) {
      signal?.throwIfAborted()
      const path = join(directory, relativePath)
      const name = relative(projectRoot, path).split(sep).join('/')
      try {
        const before = await lstat(path, { bigint: true })
        if (!before.isFile()) throw new Error(`Unsupported package installation metadata: ${name}`)
        const { sha256 } = await hashStableFile(path, signal)
        const after = await lstat(path, { bigint: true }).catch(() => undefined)
        if (!after || fileIdentity(before) !== fileIdentity(after)) throw new Error(`Package installation metadata changed while fingerprinting: ${name}`)
        result.push([name, sha256])
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') result.push([name, null])
        else throw error
      }
    }
    if (directory === projectRoot) break
    const parent = dirname(directory)
    if (parent === directory) throw new Error('Verification workspace root is unavailable')
  }
  return result
}

async function fingerprintDeclaredVerificationInputs(command: VerificationCommand, cwd: string, workspaceRoot: string, signal?: AbortSignal): Promise<Array<[string, string]>> {
  const paths = command.verificationInputs
  if (paths === undefined) return []
  if (!Array.isArray(paths) || paths.length > MAX_DECLARED_VERIFICATION_INPUTS || paths.some(path => typeof path !== 'string')) {
    throw new Error('Invalid declared verification inputs')
  }
  const projectRoot = await realpath(resolve(workspaceRoot))
  const projectCwd = await realpath(resolve(cwd))
  if (!isContained(projectRoot, projectCwd)) throw new Error('Verification cwd escapes the workspace root')
  const inputs: Array<[string, string]> = []
  const seen = new Set<string>()
  let totalBytes = 0n
  for (const input of paths) {
    signal?.throwIfAborted()
    const normalized = input.replace(/\\/g, '/')
    const parts = normalized.split('/')
    if (!normalized || normalized.length > 1024 || isAbsolute(input) || parts.some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Invalid declared verification input path: ${input}`)
    }
    if (parts.some(part => EXCLUDED_VERIFICATION_INPUT_DIRS.has(part))) throw new Error(`Excluded verification input: ${input}`)
    const path = resolve(projectCwd, input)
    const relativePath = relative(projectRoot, path).split(sep).join('/')
    if (!isContained(projectRoot, path) || isSensitiveWorkspacePath(relativePath)) throw new Error(`Unsafe declared verification input: ${input}`)
    if (seen.has(relativePath)) throw new Error(`Duplicate declared verification input: ${input}`)
    seen.add(relativePath)
    const before = await lstat(path, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Declared verification input is not a regular file: ${input}`)
    const canonical = await realpath(path)
    if (!isContained(projectRoot, canonical)) throw new Error(`Declared verification input escapes the workspace: ${input}`)
    const canonicalRelative = relative(projectRoot, canonical).split(sep).join('/')
    if (isSensitiveWorkspacePath(canonicalRelative)) throw new Error(`Unsafe declared verification input: ${input}`)
    if (canonicalRelative.split('/').some(part => EXCLUDED_VERIFICATION_INPUT_DIRS.has(part))) throw new Error(`Excluded verification input: ${input}`)
    const { sha256, size } = await hashStableFile(canonical, signal, MAX_DECLARED_VERIFICATION_INPUT_BYTES - totalBytes)
    totalBytes += BigInt(size)
    inputs.push([relativePath, sha256])
  }
  return inputs.sort(([a], [b]) => a.localeCompare(b))
}

/** Hash the runtime, selected runner executable, effective allowlisted environment, and known package-manager install state. */
export async function captureVerificationFingerprint(
  command: VerificationCommand,
  cwd = process.cwd(),
  options: VerificationFingerprintOptions = {},
): Promise<string> {
  const executionEnvironment = options.executionEnvironment ?? 'host'
  const environment = options.environment ?? (executionEnvironment === 'linux-bwrap' ? LINUX_SANDBOX_TEST_ENV : scrubbedEnv())
  const pathMappings = options.executablePathMappings ?? (executionEnvironment === 'linux-bwrap'
    ? { '/opt/bin': dirname(realpathSync(process.execPath)) }
    : {})
  const workspaceRoot = options.workspaceRoot ?? await resolveWorkspaceRoot(cwd, options.signal)
  const executable = resolveVerificationExecutable(command.command, cwd, environment, pathMappings)
  const [runner, runtime, installState, dependencyTrees, declaredInputs, sandboxLauncher] = await Promise.all([
    hashExecutable(executable, options.signal),
    hashExecutable(process.execPath, options.signal),
    fingerprintInstallState(cwd, workspaceRoot, options.signal),
    fingerprintDependencyTrees(command, cwd, workspaceRoot, options.signal),
    fingerprintDeclaredVerificationInputs(command, cwd, workspaceRoot, options.signal),
    executionEnvironment === 'linux-bwrap'
      ? hashExecutable(resolveVerificationExecutable('bwrap', cwd, scrubbedEnv(), {}), options.signal)
      : Promise.resolve(null),
  ])
  const companions = /^(?:npm|npx|pnpm|yarn|corepack)(?:\.cmd)?$/i.test(basename(command.command))
    ? await hashExecutable(resolveVerificationExecutable('node', cwd, environment, pathMappings), options.signal)
    : null
  const inputs = {
    schema: 'verification_execution_v3', executionEnvironment, allowNetwork: options.allowNetwork ?? false, cwd: resolve(cwd), command,
    runtime: { platform: process.platform, arch: process.arch, versions: process.versions, executable: runtime },
    runner, companions, dependencyTrees, declaredInputs, sandboxLauncher,
    environment: Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined).sort(([a], [b]) => a.localeCompare(b))),
    installState,
  }
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex')
}

/** Recompute the current execution identity for a previously captured receipt without exposing environment values. */
export async function currentVerificationFingerprint(value: unknown, cwd = process.cwd(), signal?: AbortSignal): Promise<string | undefined> {
  if (!value || typeof value !== 'object') return undefined
  const receipt = value as Record<string, unknown>
  const command = receipt.command as Partial<VerificationCommand> | undefined
  const executionEnvironment = receipt.executionEnvironment
  if (!command || typeof command.command !== 'string' || !Array.isArray(command.args) || !command.args.every(arg => typeof arg === 'string') ||
      typeof command.display !== 'string' || typeof receipt.allowNetwork !== 'boolean' ||
      executionEnvironment !== 'host' && executionEnvironment !== 'linux-bwrap') return undefined
  try {
    return await captureVerificationFingerprint(command as VerificationCommand, cwd, { executionEnvironment, allowNetwork: receipt.allowNetwork, signal })
  } catch { return undefined }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Identify native executable containers from bounded headers; never treat a shebang script as Python. */
async function hasNativeExecutableSignature(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const canonical = await realpath(path)
    const info = await stat(canonical, { bigint: true })
    if (!info.isFile() || info.size < 4n) return false
    handle = await open(canonical, 'r')
    const header = Buffer.alloc(64)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)

    if (process.platform === 'linux') {
      if (bytesRead < 52 || header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) return false
      const elfClass = header[4]
      const dataEncoding = header[5]
      if ((elfClass !== 1 && elfClass !== 2) || (dataEncoding !== 1 && dataEncoding !== 2) || header[6] !== 1) return false
      const littleEndian = dataEncoding === 1
      const type = littleEndian ? header.readUInt16LE(16) : header.readUInt16BE(16)
      const machine = littleEndian ? header.readUInt16LE(18) : header.readUInt16BE(18)
      const version = littleEndian ? header.readUInt32LE(20) : header.readUInt32BE(20)
      const headerSize = littleEndian ? header.readUInt16LE(elfClass === 1 ? 40 : 52) : header.readUInt16BE(elfClass === 1 ? 40 : 52)
      return (type === 2 || type === 3) && machine !== 0 && version === 1 && headerSize >= (elfClass === 1 ? 52 : 64) && bytesRead >= headerSize
    }

    if (process.platform === 'win32') {
      if (bytesRead < 64 || header[0] !== 0x4d || header[1] !== 0x5a) return false
      const peOffset = header.readUInt32LE(0x3c)
      if (peOffset < 64 || peOffset > 1024 * 1024 || BigInt(peOffset + 26) > info.size) return false
      const peHeader = Buffer.alloc(26)
      const peRead = await handle.read(peHeader, 0, peHeader.length, peOffset)
      if (peRead.bytesRead !== peHeader.length || peHeader[0] !== 0x50 || peHeader[1] !== 0x45 || peHeader[2] !== 0 || peHeader[3] !== 0) return false
      const machine = peHeader.readUInt16LE(4)
      const sections = peHeader.readUInt16LE(6)
      const optionalHeaderSize = peHeader.readUInt16LE(20)
      const optionalMagic = peHeader.readUInt16LE(24)
      return machine !== 0 && sections > 0 && optionalHeaderSize >= 2 && BigInt(peOffset + 24 + optionalHeaderSize) <= info.size && (optionalMagic === 0x10b || optionalMagic === 0x20b)
    }

    if (process.platform === 'darwin') {
      if (bytesRead < 8) return false
      const magic = header.subarray(0, 4).toString('hex')
      const littleEndian = magic === 'cefaedfe' || magic === 'cffaedfe'
      const is64Bit = magic === 'feedfacf' || magic === 'cffaedfe'
      const is32Bit = magic === 'feedface' || magic === 'cefaedfe'
      if (is32Bit || is64Bit) {
        const headerSize = is64Bit ? 32 : 28
        if (bytesRead < headerSize) return false
        const cpuType = littleEndian ? header.readUInt32LE(4) : header.readUInt32BE(4)
        const fileType = littleEndian ? header.readUInt32LE(12) : header.readUInt32BE(12)
        return cpuType !== 0 && fileType === 2
      }

      const fatBigEndian = magic === 'cafebabe' || magic === 'cafebabf'
      const fatLittleEndian = magic === 'bebafeca' || magic === 'bfbafeca'
      if (fatBigEndian || fatLittleEndian) {
        const architectureCount = fatLittleEndian ? header.readUInt32LE(4) : header.readUInt32BE(4)
        const isFat64 = magic === 'cafebabf' || magic === 'bfbafeca'
        const entrySize = isFat64 ? 32 : 20
        const tableSize = 8 + architectureCount * entrySize
        if (architectureCount === 0 || architectureCount > 64 || BigInt(tableSize) > info.size) return false
        const fatHeader = Buffer.alloc(tableSize)
        const tableRead = await handle.read(fatHeader, 0, tableSize, 0)
        if (tableRead.bytesRead !== tableSize) return false
        for (let index = 0; index < architectureCount; index++) {
          const offset = 8 + index * entrySize
          const cpuType = fatLittleEndian ? fatHeader.readUInt32LE(offset) : fatHeader.readUInt32BE(offset)
          const sliceOffset = isFat64
            ? fatLittleEndian ? fatHeader.readBigUInt64LE(offset + 8) : fatHeader.readBigUInt64BE(offset + 8)
            : BigInt(fatLittleEndian ? fatHeader.readUInt32LE(offset + 8) : fatHeader.readUInt32BE(offset + 8))
          const sliceSize = isFat64
            ? fatLittleEndian ? fatHeader.readBigUInt64LE(offset + 16) : fatHeader.readBigUInt64BE(offset + 16)
            : BigInt(fatLittleEndian ? fatHeader.readUInt32LE(offset + 12) : fatHeader.readUInt32BE(offset + 12))
          if (cpuType === 0 || sliceSize === 0n || sliceOffset + sliceSize > info.size) return false
        }
        return true
      }
    }
    return false
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function hasPytestConfiguration(cwd: string): Promise<boolean> {
  if (existsSync(join(cwd, 'pytest.ini'))) return true
  for (const [file, pattern] of [
    ['pyproject.toml', /^\s*\[tool\.pytest\.ini_options\]/m],
    ['setup.cfg', /^\s*\[tool:pytest\]/m],
  ] as const) {
    try {
      if (pattern.test(await readFile(join(cwd, file), 'utf8'))) return true
    } catch {}
  }
  try {
    const sections = (await readFile(join(cwd, 'tox.ini'), 'utf8')).split(/^\s*\[([^\]]+)\]\s*$/m)
    for (let index = 1; index < sections.length; index += 2) {
      const name = sections[index]?.trim() ?? ''
      if (name === 'pytest' || /^testenv(?::.*)?$/.test(name) && /\bpytest\b/.test(sections[index + 1] ?? '')) return true
    }
  } catch {}
  return false
}

/** Only complete positive execution evidence for this source and execution environment can satisfy a test criterion. */
export function isPassedVerificationForWorkspace(value: unknown, digest: string, executionFingerprint: string | undefined): boolean {
  if (!value || typeof value !== 'object') return false
  const receipt = value as Record<string, unknown>
  return receipt.ok === true && receipt.status === 'passed' && receipt.exitCode === 0 &&
    receipt.captureTruncated !== true && receipt.drainTimedOut !== true &&
    typeof receipt.testCount === 'number' && Number.isSafeInteger(receipt.testCount) && receipt.testCount > 0 &&
    receipt.inputDigest === digest && receipt.finalDigest === digest &&
    typeof executionFingerprint === 'string' && HASH.test(executionFingerprint) &&
    receipt.executionFingerprint === executionFingerprint && receipt.finalExecutionFingerprint === executionFingerprint
}

/** Trust output summaries only when the selected invocation reaches a supported test runner. */
async function hasPackageManagerScriptShellOverride(cwd: string, workspaceRoot: string, environment: NodeJS.ProcessEnv): Promise<boolean> {
  if (Object.entries(environment).some(([key, value]) => /^npm_config_script_shell$/i.test(key) && Boolean(value))) return true
  const projectRoot = resolve(workspaceRoot)
  for (let directory = resolve(cwd); ; directory = dirname(directory)) {
    for (const file of ['.npmrc', '.yarnrc', '.yarnrc.yml']) {
      try {
        const lines = (await readFile(join(directory, file), 'utf8')).split(/\r?\n/)
        if (lines.some(line => {
          const entry = line.trim()
          return entry && !entry.startsWith('#') && !entry.startsWith(';') && /^(?:--)?script[-_]?shell\s*(?:=|:|\s|$)/i.test(entry)
        })) return true
      } catch {}
    }
    if (directory === projectRoot) break
    const parent = dirname(directory)
    if (parent === directory || !isContained(projectRoot, parent)) break
  }
  return false
}

function hasLocalRunnerOverride(cwd: string, runner: string): boolean {
  for (let directory = resolve(cwd); ; directory = dirname(directory)) {
    if ([runner, `${runner}.cmd`, `${runner}.exe`].some(name => existsSync(join(directory, 'node_modules', '.bin', name)))) return true
    const parent = dirname(directory)
    if (parent === directory) return false
  }
}

function isRuntimeBun(command: string, cwd: string, environment: NodeJS.ProcessEnv, executablePathMappings: Readonly<Record<string, string>>): boolean {
  try {
    const resolved = resolveVerificationExecutable(command, cwd, environment, executablePathMappings)
    const runtime = realpathSync(process.execPath)
    return process.platform === 'win32' ? resolved.toLowerCase() === runtime.toLowerCase() : resolved === runtime
  } catch {
    return false
  }
}

async function supportedTestRunner(command: VerificationCommand, cwd: string, workspaceRoot: string, environment: NodeJS.ProcessEnv, executablePathMappings: Readonly<Record<string, string>>): Promise<SupportedTestRunner | null> {
  const executable = basename(command.command).toLowerCase().replace(/\.(?:cmd|exe)$/i, '')
  if (executable === 'bun' && command.args[0] === 'test') return isRuntimeBun(command.command, cwd, environment, executablePathMappings) ? 'bun' : null
  if (executable === 'cargo' && command.args[0] === 'test') return 'cargo'
  if (executable === 'go' && command.args[0] === 'test') return 'go'
  if (/^python(?:3(?:\.\d+)?)?$/.test(executable) && command.args[0] === '-I' && command.args[1] === '-m' && command.args[2] === 'pytest') {
    try {
      const resolved = resolveVerificationExecutable(command.command, cwd, environment, executablePathMappings)
      return await hasNativeExecutableSignature(resolved) ? 'pytest' : null
    } catch {
      return null
    }
  }

  const packageScript = executable === 'bun' && command.args[0] === 'run' && command.args[1] === 'test'
    || ['npm', 'pnpm', 'yarn'].includes(executable) && command.args[0] === 'test'
  if (!packageScript) return null
  try {
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }
    const lifecycleHooks = ['pretest', 'posttest'].some(name => typeof pkg.scripts?.[name] === 'string' && (pkg.scripts[name] as string).trim().length > 0)
    const packageManagerShellOverride = ['npm', 'pnpm', 'yarn'].includes(executable) && await hasPackageManagerScriptShellOverride(cwd, workspaceRoot, environment)
    if (lifecycleHooks || typeof pkg.scripts?.test !== 'string' || packageManagerShellOverride) return null
    const runner = supportedTestRunnerInvocation(pkg.scripts.test)
    if (runner !== 'bun' || hasLocalRunnerOverride(cwd, 'bun') || !isRuntimeBun('bun', cwd, environment, executablePathMappings)) return null
    return runner
  } catch {
    return null
  }
}

/** Return one existing project test command; never invent a new test setup. */
export async function detectVerificationCommand(cwd = process.cwd()): Promise<VerificationCommand | null> {
  const packagePath = join(cwd, 'package.json')
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { scripts?: Record<string, unknown>; verificationInputs?: unknown }
      if (typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim()) {
        const command = existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))
          ? { command: 'bun', args: ['run', 'test'], display: 'bun run test' }
          : existsSync(join(cwd, 'pnpm-lock.yaml'))
            ? { command: 'pnpm', args: ['test'], display: 'pnpm test' }
            : existsSync(join(cwd, 'yarn.lock'))
              ? { command: 'yarn', args: ['test'], display: 'yarn test' }
              : { command: 'npm', args: ['test'], display: 'npm test' }
        if (pkg.verificationInputs !== undefined) {
          if (!Array.isArray(pkg.verificationInputs) || !pkg.verificationInputs.every(input => typeof input === 'string')) {
            return null
          }
          return { ...command, verificationInputs: pkg.verificationInputs }
        }
        return command
      }
    } catch {
      // A malformed manifest cannot establish a configured test script.
    }
  }
  if (existsSync(join(cwd, 'Cargo.toml'))) return { command: 'cargo', args: ['test'], display: 'cargo test' }
  if (existsSync(join(cwd, 'go.mod'))) return { command: 'go', args: ['test', '-json', './...'], display: 'go test -json ./...' }
  if (await hasPytestConfiguration(cwd)) {
    const interpreters = process.platform === 'win32'
      ? [resolve(cwd, '.venv', 'Scripts', 'python.exe'), resolve(cwd, 'venv', 'Scripts', 'python.exe')]
      : [resolve(cwd, '.venv', 'bin', 'python'), resolve(cwd, 'venv', 'bin', 'python')]
    const interpreter = interpreters.find(isExecutableFile)
    if (interpreter) return { command: interpreter, args: ['-I', '-m', 'pytest'], display: `${shellQuote(interpreter)} -I -m pytest` }
  }
  return null
}

// Exact messages of runners that exit 1 only because no test files exist yet. Collection, configuration
// and import errors print something else and keep failing.
const NO_TESTS_FOUND = [
  /^error: 0 test files matching\b/m, // bun, compact output used inside AI agents (CLAUDECODE and similar)
  /^No tests found!$/m, // bun, regular terminal output
  /No tests found, exiting with code 1/, // jest
  /No test files found, exiting with code 1/, // vitest
  /^Error: No test files found\b/m, // mocha
]

/** A green exit only verifies unchanged source/execution inputs; empty or changing suites are inconclusive. */
export async function runVerification(command: VerificationCommand, cwd = process.cwd(), options: {
  signal?: AbortSignal
  timeoutMs?: number
  execute?: () => Promise<VerificationProcessResult>
  executionEnvironment?: VerificationExecutionEnvironment
  allowNetwork?: boolean
  environment?: NodeJS.ProcessEnv
  executablePathMappings?: Readonly<Record<string, string>>
} = {}): Promise<VerificationResult> {
  const started = Date.now()
  let inputDigest: string | undefined
  let inputWorkspace: WorkspaceVersion | undefined
  const executionEnvironment = options.executionEnvironment ?? 'host'
  let executionFingerprint: string | undefined
  try {
    inputWorkspace = await captureWorkspaceVersion(cwd, options.signal)
    inputDigest = inputWorkspace.digest
    const allowNetwork = options.allowNetwork ?? false
    const fingerprintOptions = { executionEnvironment, allowNetwork, environment: options.environment, executablePathMappings: options.executablePathMappings, workspaceRoot: inputWorkspace.root, signal: options.signal }
    executionFingerprint = await captureVerificationFingerprint(command, cwd, fingerprintOptions)
    const result: VerificationProcessResult = options.execute ? await options.execute() : await execa(command.command, command.args, { cwd, env: options.environment ?? scrubbedEnv(), extendEnv: false, reject: false, timeout: options.timeoutMs ?? 120_000, all: true, cancelSignal: options.signal })
    const rawOutput = result.all ?? [result.stdout, result.stderr].filter(Boolean).join('\n')
    const outputBytes = Number.isSafeInteger(result.outputBytes) && result.outputBytes! >= 0
      ? result.outputBytes! : Buffer.byteLength(rawOutput, 'utf8')
    const output = redactSecrets(stripVTControlCharacters(rawOutput).trim()) as string
    if (result.timedOut || result.isCanceled) return { command, ok: false, status: result.isCanceled ? 'cancelled' : 'timed_out', output,
      outputBytes, exitCode: result.exitCode ?? null, inputDigest, inputWorkspace, executionEnvironment, allowNetwork, executionFingerprint, cwd, durationMs: Date.now() - started }
    const environment = options.environment ?? (executionEnvironment === 'linux-bwrap' ? LINUX_SANDBOX_TEST_ENV : scrubbedEnv())
    const executablePathMappings = options.executablePathMappings ?? (executionEnvironment === 'linux-bwrap' ? { '/opt/bin': dirname(realpathSync(process.execPath)) } : {})
    const testRunner = await supportedTestRunner(command, cwd, inputWorkspace.root, environment, executablePathMappings)
    const normalizedOutput = output.replace(/\r\n/g, '\n')
    const counted = testRunner ? verificationTestCount(output, testRunner) : null
    const reportedFailures = testRunner ? verificationTestFailureCount(output, testRunner) : null
    const empty = testRunner !== null && (counted === 0 || counted === null && (NO_TESTS_FOUND.some(pattern => pattern.test(normalizedOutput)) || /^\s*(?:0 tests? (?:ran|collected|passed)|Ran 0 tests|0 passed|.*\[no test files\])\s*$/im.test(normalizedOutput)))
    const testCount = empty ? 0 : counted
    const finalWorkspace = await captureWorkspaceVersion(cwd, options.signal)
    const finalDigest = finalWorkspace.digest
    const finalExecutionFingerprint = await captureVerificationFingerprint(command, cwd, { ...fingerprintOptions, workspaceRoot: finalWorkspace.root })
    const incompleteCapture = result.captureTruncated || result.drainTimedOut
    const inconclusiveNote = incompleteCapture ? '\n[Verification capture is incomplete; a passing result cannot be established.]' : '\n[No complete, successful executed-test evidence was established.]'
    const stale = inputDigest !== finalDigest || executionFingerprint !== finalExecutionFingerprint
    const status = stale ? 'stale' : reportedFailures !== null && reportedFailures > 0 ? 'failed' : empty && !incompleteCapture ? 'empty' : result.exitCode == null ? 'inconclusive' : result.exitCode !== 0 ? 'failed' : incompleteCapture || testCount === null ? 'inconclusive' : 'passed'
    return { command, ok: status === 'passed', status, exitCode: result.exitCode ?? null, testCount, inputDigest, finalDigest, inputWorkspace, finalWorkspace,
      executionEnvironment, allowNetwork, executionFingerprint, finalExecutionFingerprint,
      outputBytes, durationMs: Date.now() - started, cwd, captureTruncated: result.captureTruncated, drainTimedOut: result.drainTimedOut, output: `${output || '(no output)'}${status === 'empty' ? '\n[No tests ran; this is not evidence that the change is correct.]' : status === 'stale' ? '\n[Inputs or execution environment changed during verification; this result does not verify the current state.]' : status === 'inconclusive' ? inconclusiveNote : ''}` }
  } catch (error) {
    const failure = error as { all?: string; stdout?: string; stderr?: string; outputBytes?: number; totalBytes?: number; message?: string; timedOut?: boolean; exitCode?: number }
    const rawOutput = failure.all ?? ([failure.stdout, failure.stderr].filter(Boolean).join('\n') || failure.message || String(error))
    const outputBytes = Number.isSafeInteger(failure.outputBytes) && failure.outputBytes! >= 0
      ? failure.outputBytes! : Number.isSafeInteger(failure.totalBytes) && failure.totalBytes! >= 0
        ? failure.totalBytes! : Buffer.byteLength(rawOutput, 'utf8')
    const status = options.signal?.aborted ? 'cancelled' : failure.timedOut ? 'timed_out' : 'inconclusive'
    return { command, ok: false, status, exitCode: failure.exitCode ?? null, inputDigest, inputWorkspace, executionEnvironment, allowNetwork: options.allowNetwork ?? false, executionFingerprint, cwd,
      outputBytes, durationMs: Date.now() - started, output: redactSecrets(stripVTControlCharacters(rawOutput)) as string }
  }
}
