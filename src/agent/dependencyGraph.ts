import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type * as TS from 'typescript'
import type { ToolExecutionContext } from '../orchestration/types.js'
import { assertSafeDir, assertSafePath, isProtectedPath, isSensitiveWorkspacePath } from '../tools/shared/pathSafety.js'
import { clearIgnoreCache, DEFAULT_IGNORE_LINES, IGNORE_FILE_NAME } from '../tools/shared/deepseekignore.js'
import ignore from 'ignore'

const LIMITS = { files: 2000, entries: 20_000, fileBytes: 256_000, totalBytes: 8_000_000, cacheBytes: 2_000_000, nodes: 100, edges: 200, indexedEdges: 10_000, resolutions: 10_000, resolutionProbes: 100_000, outputBytes: 32_000 }
const SOURCE = /\.(?:[cm]?[jt]sx?)$/i
interface Import { specifier: string; kind: 'import' | 'require' | 'dynamic-import'; line: number }
interface Parsed { hash: string; imports: Import[]; cost: number; truncated: boolean; parseErrors: boolean; resolution?: { version: string; edges: Edge[]; unresolved: string[] } }
interface Cache { entries: Map<string, Parsed>; bytes: number }
interface Edge { from: string; to: string; kind: 'resolved-import' | 'manifest-dependency' | 'package-membership'; origin: string; sourceHash: string; specifier?: string; line?: number; syntax?: Import['kind'] }
interface Node { id: string; kind: 'file' | 'package' | 'external-package'; hash: string | null; name?: string; scripts?: string[] }
const caches = new WeakMap<object, Map<string, Cache>>()
const stamp = (info: BigIntStats) => [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(':')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

/** A bounded, optional index of literal imports and package declarations, never a call graph or type checker. */
export async function queryDependencyGraph(args: { path: string; direction?: string; depth?: number }, context?: ToolExecutionContext) {
  const direction = args.direction ?? 'both'
  const depth = args.depth ?? 1
  if (!['imports', 'dependents', 'both'].includes(direction)) throw new Error('Invalid dependency graph direction')
  if (!Number.isInteger(depth) || depth < 0 || depth > 3) throw new Error('Dependency graph depth must be an integer from 0 to 3')
  context?.signal?.throwIfAborted()
  const root = await realpath(await assertSafeDir(context?.workspacePath ?? process.cwd(), context))
  const anchor = await realpath(await assertSafePath(args.path, context))
  const rel = (file: string) => relative(root, file).split(sep).join('/')
  if (rel(anchor).startsWith('../') || rel(anchor) === '..') throw new Error('Graph anchor must belong to this workspace')
  const owner = context?.session ?? context
  const roots = owner ? caches.get(owner) ?? new Map<string, Cache>() : new Map<string, Cache>()
  if (owner) caches.set(owner, roots)
  const cache = roots.get(root) ?? { entries: new Map<string, Parsed>(), bytes: 0 }
  roots.delete(root); roots.set(root, cache)
  if (roots.size > 4) roots.delete(roots.keys().next().value!)
  const warnings = new Set<string>()
  const observed = new Map<string, string>()
  const texts = new Map<string, { text: string; hash: string }>()
  const stats = { parsedFiles: 0, reusedFiles: 0, resolvedFiles: 0, reusedResolutionFiles: 0, readBytes: 0, catalogFiles: 0 }
  const remember = (file: string, entry: Parsed) => {
    const previous = cache.entries.get(file)
    if (previous) cache.bytes -= previous.cost
    entry.cost = Buffer.byteLength(JSON.stringify({ ...entry, cost: 0 }))
    cache.entries.delete(file); cache.entries.set(file, entry); cache.bytes += entry.cost
    while (cache.bytes > LIMITS.cacheBytes && cache.entries.size) {
      const oldest = cache.entries.keys().next().value!
      cache.bytes -= cache.entries.get(oldest)!.cost; cache.entries.delete(oldest)
    }
  }
  const read = async (file: string) => {
    context?.signal?.throwIfAborted()
    await assertSafePath(file, context)
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const before = await handle.stat({ bigint: true })
      if (!before.isFile() || before.size > BigInt(LIMITS.fileBytes)) { warnings.add('file_byte_limit'); return null }
      if (stats.readBytes + Number(before.size) > LIMITS.totalBytes) { warnings.add('total_byte_limit'); return null }
      const buffer = Buffer.alloc(Number(before.size) + 1)
      let count = 0
      while (count < buffer.length) {
        context?.signal?.throwIfAborted()
        const chunk = await handle.read(buffer, count, buffer.length - count, null)
        if (!chunk.bytesRead) break
        count += chunk.bytesRead
      }
      if (count !== Number(before.size) || stamp(before) !== stamp(await handle.stat({ bigint: true }))) throw new Error('Dependency graph inputs changed while reading; retry')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))
      if (text.includes('\0')) { warnings.add('non_text_input'); return null }
      stats.readBytes += count
      observed.set(file, stamp(before))
      return { text, hash: hash(text) }
    } finally { await handle.close() }
  }
  const ignorePath = join(root, IGNORE_FILE_NAME)
  let ignoreInput: Awaited<ReturnType<typeof read>> = null
  try { ignoreInput = await read(ignorePath) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (!ignoreInput && await lstat(ignorePath).then(() => true, () => false)) throw new Error('Dependency graph ignore configuration exceeds supported limits')
  const matcher = ignore().add([...DEFAULT_IGNORE_LINES.filter(() => !ignoreInput), ...(ignoreInput?.text.split(/\r?\n/) ?? []), '.git/', '.deepseek/'])
  clearIgnoreCache()
  const catalog = async () => {
    const files: string[] = []
    let entries = 0
    const visit = async (directory: string, level: number): Promise<void> => {
      if (level > 32) { warnings.add('directory_depth_limit'); return }
      const stream = await opendir(directory)
      for await (const entry of stream) {
        context?.signal?.throwIfAborted()
        if (++entries > LIMITS.entries || files.length >= LIMITS.files) { warnings.add('catalog_limit'); break }
        const file = join(directory, entry.name)
        if (entry.isSymbolicLink()) { warnings.add('symlinks_excluded'); continue }
        if (matcher.ignores(rel(file) + (entry.isDirectory() ? '/' : '')) || isSensitiveWorkspacePath(file) || await isProtectedPath(file, context)) continue
        if (entry.isDirectory()) await visit(file, level + 1)
        else if (entry.isFile() && (SOURCE.test(file) || extname(file) === '.json')) files.push(file)
        if (entries > LIMITS.entries || files.length >= LIMITS.files) break
      }
    }
    await visit(root, 0)
    return files.sort()
  }
  const files = await catalog()
  stats.catalogFiles = files.length
  const visible = new Set(files)
  for (const [file, entry] of cache.entries) if (!visible.has(file)) { cache.entries.delete(file); cache.bytes -= entry.cost }
  const ts = await import('typescript')
  for (const file of files) {
    if (!SOURCE.test(file) && basename(file) !== 'package.json' && !/^(?:tsconfig.*|jsconfig)\.json$/.test(basename(file))) continue
    const content = await read(file)
    if (content) texts.set(file, content)
  }
  const pendingConfigs = [...texts.keys()].filter(file => /^(?:tsconfig.*|jsconfig)\.json$/.test(basename(file)))
  const checkedConfigs = new Set<string>()
  while (pendingConfigs.length) {
    const file = pendingConfigs.pop()!
    if (checkedConfigs.has(file)) continue
    checkedConfigs.add(file)
    const parsed = ts.parseConfigFileTextToJson(file, texts.get(file)!.text)
    if (typeof parsed.config?.extends !== 'string' || !parsed.config.extends.startsWith('.')) continue
    let parent = resolve(dirname(file), parsed.config.extends)
    if (!parent.endsWith('.json')) parent += '.json'
    if (!visible.has(parent)) continue
    if (!texts.has(parent)) { const content = await read(parent); if (content) texts.set(parent, content) }
    if (texts.has(parent)) pendingConfigs.push(parent)
  }
  if (!visible.has(anchor) || !texts.has(anchor)) throw new Error('Graph anchor is excluded, unreadable or outside the supported source/manifest limits')
  const nodes = new Map<string, Node>()
  const edges: Edge[] = []
  const unresolved: Array<{ from: string; specifier: string }> = []
  const packages = new Map<string, { name?: string; data: Record<string, any> }>()
  for (const [file, content] of texts) if (basename(file) === 'package.json') {
    try {
      const data = JSON.parse(content.text)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid manifest')
      packages.set(file, { name: typeof data.name === 'string' ? data.name : undefined, data })
    } catch { warnings.add('invalid_manifest') }
  }
  const rootManifest = packages.get(join(root, 'package.json'))?.data
  const workspacePatterns = Array.isArray(rootManifest?.workspaces) ? rootManifest.workspaces : rootManifest?.workspaces?.packages
  const patterns: string[] = Array.isArray(workspacePatterns) ? workspacePatterns.filter((value: unknown): value is string => typeof value === 'string').slice(0, 100) : []
  if (Array.isArray(workspacePatterns) && workspacePatterns.length > 100) warnings.add('workspace_pattern_limit')
  const byName = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [file, pkg] of packages) {
    if (pkg.name && pkg.name.length > 256) { warnings.add('manifest_metadata_limit'); continue }
    if (!pkg.name || !/^(?:@[\w.-]+\/)?[\w.-]+$/.test(pkg.name)) continue
    const dir = rel(dirname(file))
    const selected = file === join(root, 'package.json') || patterns.some(pattern => !pattern.startsWith('!') && new Bun.Glob(pattern).match(dir)) && !patterns.some(pattern => pattern.startsWith('!') && new Bun.Glob(pattern.slice(1)).match(dir))
    if (!selected) continue
    if (byName.has(pkg.name)) { ambiguous.add(pkg.name); warnings.add('ambiguous_package_name') }
    else byName.set(pkg.name, dirname(file))
  }
  for (const name of ambiguous) byName.delete(name)
  const scopes = new Set([...byName.keys()].filter(name => name.startsWith('@')).map(name => name.split('/')[0]!))
  const mapVirtual = (file: string) => {
    const normalized = resolve(file)
    if (relative(root, normalized).startsWith('..')) return normalized
    const marker = `${sep}node_modules${sep}`
    const at = normalized.lastIndexOf(marker)
    if (at < 0) return normalized
    const parts = normalized.slice(at + marker.length).split(sep)
    const length = parts[0]?.startsWith('@') ? 2 : 1
    const directory = byName.get(parts.slice(0, length).join('/'))
    return directory ? join(directory, ...parts.slice(length)) : normalized
  }
  const directories = new Set<string>([root])
  for (const file of files) for (let dir = dirname(file); dir.startsWith(root) && !directories.has(dir); dir = dirname(dir)) directories.add(dir)
  let probes = 0
  const probe = () => { if (++probes <= LIMITS.resolutionProbes) return true; warnings.add('resolution_probe_limit'); return false }
  const host: TS.ModuleResolutionHost = {
    fileExists: file => probe() && visible.has(mapVirtual(file)),
    readFile: file => probe() ? texts.get(mapVirtual(file))?.text : undefined,
    directoryExists: file => probe() && (directories.has(mapVirtual(file)) || byName.size > 0 && (resolve(file).endsWith(`${sep}node_modules`) || scopes.has(basename(file)) && dirname(resolve(file)).endsWith(`${sep}node_modules`))),
    realpath: mapVirtual,
    getCurrentDirectory: () => root,
  }
  const configCache = new Map<string, TS.CompilerOptions | null>()
  const configOptions = (file: string, seen = new Set<string>()): TS.CompilerOptions | null => {
    if (configCache.has(file)) return configCache.get(file)!
    if (seen.has(file)) { warnings.add('configuration_cycle'); return null }
    if (seen.size >= 32) { warnings.add('configuration_depth_limit'); return null }
    seen.add(file)
    const content = texts.get(file)
    if (!content) { warnings.add('configuration_unavailable'); return null }
    const parsed = ts.parseConfigFileTextToJson(file, content.text)
    if (parsed.error) { warnings.add('invalid_configuration'); return null }
    let parent: TS.CompilerOptions = {}
    if (parsed.config.extends) {
      if (typeof parsed.config.extends !== 'string' || !parsed.config.extends.startsWith('.')) { warnings.add('unsupported_configuration_extends'); return null }
      let extended = resolve(dirname(file), parsed.config.extends)
      if (!extended.endsWith('.json')) extended += '.json'
      const inherited = configOptions(extended, seen)
      if (!inherited) return null
      parent = inherited
    }
    const converted = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions ?? {}, dirname(file))
    if (converted.errors.length) { warnings.add('invalid_compiler_options'); return null }
    const own = converted.options
    if (own.paths && !own.baseUrl && !parent.baseUrl) own.baseUrl = dirname(file)
    const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowJs: true, resolveJsonModule: true, ...parent, ...own }
    configCache.set(file, options)
    return options
  }
  const optionsFor = (file: string): TS.CompilerOptions | null => {
    for (let dir = dirname(file); ; dir = dirname(dir)) {
      for (const name of ['tsconfig.json', 'jsconfig.json']) if (visible.has(join(dir, name))) return configOptions(join(dir, name))
      if (dir === root || dirname(dir) === dir) break
    }
    return { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowJs: true, resolveJsonModule: true }
  }
  // Resolution depends on available paths and configuration; source contents are checked per cached file.
  const resolutionVersion = hash(JSON.stringify([root, ts.version, LIMITS, files, [...texts].filter(([file]) => !SOURCE.test(file)).map(([file, content]) => [rel(file), content.hash])]))
  const ownerFor = (file: string): string | undefined => {
    for (let dir = dirname(file); ; dir = dirname(dir)) {
      if (packages.has(join(dir, 'package.json'))) return join(dir, 'package.json')
      if (dir === root || dirname(dir) === dir) return undefined
    }
  }
  for (const file of files) nodes.set(rel(file), { id: rel(file), kind: packages.has(file) ? 'package' : 'file', hash: texts.get(file)?.hash ?? null })
  const add = (edge: Edge) => { if (edges.length < LIMITS.indexedEdges) edges.push(edge); else warnings.add('indexed_edge_limit') }
  for (const [file, pkg] of packages) {
    const node = nodes.get(rel(file))!
    node.name = pkg.name && pkg.name.length <= 256 ? pkg.name : undefined
    const scripts = pkg.data.scripts && typeof pkg.data.scripts === 'object' && !Array.isArray(pkg.data.scripts) ? Object.keys(pkg.data.scripts) : []
    node.scripts = scripts.filter(name => name.length <= 128).slice(0, 20)
    if (node.scripts.length !== scripts.length) warnings.add('manifest_metadata_limit')
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const declared = pkg.data[section]
      if (!declared) continue
      if (typeof declared !== 'object' || Array.isArray(declared)) { warnings.add('invalid_manifest_dependency'); continue }
      for (const name of Object.keys(declared)) {
        if (edges.length >= LIMITS.indexedEdges) { warnings.add('indexed_edge_limit'); break }
        if (name.length > 256 || typeof declared[name] !== 'string') { warnings.add('invalid_manifest_dependency'); continue }
        const directory = byName.get(name)
        const target = directory ? rel(join(directory, 'package.json')) : `external-package:${name}`
        if (!directory) nodes.set(target, { id: target, kind: 'external-package', hash: null, name })
        add({ from: rel(file), to: target, kind: 'manifest-dependency', origin: rel(file), sourceHash: texts.get(file)!.hash, specifier: name })
      }
    }
  }
  let resolutions = 0
  let processed = 0
  let unresolvedTotal = 0
  for (const [file, content] of texts) if (SOURCE.test(file)) {
    if (++processed % 16 === 0) await yieldToEventLoop()
    context?.signal?.throwIfAborted()
    let parsed = cache.entries.get(file)
    if (parsed?.hash === content.hash) stats.reusedFiles++
    else {
      const source = ts.createSourceFile(file, content.text, ts.ScriptTarget.Latest, true)
      const imports: Import[] = []
      const stack: TS.Node[] = [source]
      while (stack.length) {
        const node = stack.pop()!
        let literal: TS.StringLiteralLike | undefined
        let kind: Import['kind'] = 'import'
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
          literal = node.moduleSpecifier
          for (const attribute of node.attributes?.elements ?? []) if (attribute.name.text === 'resolution-mode' && ts.isStringLiteralLike(attribute.value)) kind = attribute.value.text === 'require' ? 'require' : 'import'
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) {
          literal = node.moduleReference.expression; kind = 'require'
        } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) { literal = node.arguments[0]; kind = 'dynamic-import' }
          else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') { literal = node.arguments[0]; kind = 'require' }
        }
        if (literal) imports.push({ specifier: literal.text, kind, line: source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1 })
        ts.forEachChild(node, child => { stack.push(child) })
      }
      const bounded = imports.filter(item => item.specifier.length <= 2048).slice(0, 128)
      parsed = { hash: content.hash, imports: bounded, truncated: bounded.length !== imports.length, parseErrors: Boolean((source as TS.SourceFile & { parseDiagnostics?: unknown[] }).parseDiagnostics?.length), cost: 0 }
      remember(file, parsed)
      stats.parsedFiles++
    }
    if (parsed.truncated) warnings.add('file_import_limit')
    if (parsed.parseErrors) warnings.add('parse_diagnostics')
    const owner = ownerFor(file)
    if (owner) add({ from: rel(file), to: rel(owner), kind: 'package-membership', origin: rel(owner), sourceHash: texts.get(owner)!.hash })
    if (parsed.resolution?.version === resolutionVersion) {
      stats.reusedResolutionFiles++
      for (const edge of parsed.resolution.edges) add(edge)
      for (const specifier of parsed.resolution.unresolved) {
        unresolvedTotal++; if (unresolved.length < 200) unresolved.push({ from: rel(file), specifier }); warnings.add('unresolved_imports')
      }
      continue
    }
    stats.resolvedFiles++
    const options = optionsFor(file)
    const resolvedEdges: Edge[] = []
    const unresolvedSpecifiers: string[] = []
    const initialProbes = probes
    let complete = Boolean(options)
    for (const item of parsed.imports) {
      if (++resolutions > LIMITS.resolutions) { warnings.add('resolution_limit'); complete = false; break }
      if (resolutions % 32 === 0) { await yieldToEventLoop(); context?.signal?.throwIfAborted() }
      const specifier = item.specifier
      const nodeResolution = options?.moduleResolution === ts.ModuleResolutionKind.Node16 || options?.moduleResolution === ts.ModuleResolutionKind.NodeNext
      const commonJS = item.kind === 'require' || item.kind !== 'dynamic-import' && (/\.[c][jt]s$/.test(file) || options?.module === ts.ModuleKind.CommonJS || nodeResolution && !/\.m[jt]s$/.test(file) && packages.get(owner ?? '')?.data.type !== 'module')
      const mode = commonJS ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext
      const resolved = options ? ts.resolveModuleName(specifier, file, options, host, undefined, undefined, mode).resolvedModule : undefined
      const target = resolved ? mapVirtual(resolved.resolvedFileName) : undefined
      if (target && visible.has(target)) {
        const edge: Edge = { from: rel(file), to: rel(target), kind: 'resolved-import', origin: rel(file), sourceHash: content.hash, specifier, line: item.line, syntax: item.kind }
        resolvedEdges.push(edge); add(edge)
      } else {
        unresolvedSpecifiers.push(specifier)
        unresolvedTotal++; if (unresolved.length < 200) unresolved.push({ from: rel(file), specifier }); warnings.add('unresolved_imports')
      }
    }
    if (complete && initialProbes <= LIMITS.resolutionProbes && probes <= LIMITS.resolutionProbes) remember(file, { ...parsed, resolution: { version: resolutionVersion, edges: resolvedEdges, unresolved: unresolvedSpecifiers } })
  }
  const selected = new Set<string>([rel(anchor)])
  const anchorOwner = ownerFor(anchor)
  let frontier = [...selected]
  for (let level = 0; level < depth; level++) {
    const next = new Set<string>()
    for (const edge of edges) {
      if (direction !== 'dependents' && frontier.includes(edge.from) && !selected.has(edge.to)) next.add(edge.to)
      if (direction !== 'imports' && frontier.includes(edge.to) && !selected.has(edge.from)) next.add(edge.from)
    }
    for (const id of next) selected.add(id)
    frontier = [...next]
  }
  const ids = [...selected].sort((a, b) => a === rel(anchor) ? -1 : b === rel(anchor) ? 1 : a.localeCompare(b)).slice(0, LIMITS.nodes)
  if (selected.size > ids.length) warnings.add('neighborhood_node_limit')
  const bound = <T>(items: T[], budget: number): T[] => {
    const kept: T[] = []
    for (const item of items) {
      const bytes = Buffer.byteLength(JSON.stringify(item)) + 1
      if (bytes > budget) { warnings.add('output_byte_limit'); continue }
      budget -= bytes; kept.push(item)
    }
    return kept
  }
  const outputNodes = bound(ids.map(id => nodes.get(id)!), 6000)
  if (!outputNodes.some(node => node.id === rel(anchor))) throw new Error('Dependency graph anchor metadata exceeds the output budget; use bounded file reads')
  const kept = new Set(outputNodes.map(node => node.id))
  const neighborhood = edges.filter(edge => kept.has(edge.from) && kept.has(edge.to))
  const outputEdges = bound(neighborhood.slice(0, LIMITS.edges), 10_000)
  const outputUnresolved = bound(unresolved, 3000)
  if (neighborhood.length > LIMITS.edges) warnings.add('neighborhood_edge_limit')
  const finalFiles = await catalog()
  if (JSON.stringify(finalFiles) !== JSON.stringify(files)) throw new Error('Dependency graph catalog changed during the query; retry')
  for (const [file, identity] of observed) {
    context?.signal?.throwIfAborted()
    await assertSafePath(file, context)
    if (stamp(await lstat(file, { bigint: true })) !== identity) throw new Error('Dependency graph inputs changed during the query; retry')
  }
  if (!ignoreInput && await lstat(ignorePath).then(() => true, () => false)) throw new Error('Dependency graph ignore configuration changed; retry')
  const result = {
    schemaVersion: 1, root, anchor: rel(anchor), package: anchorOwner ? rel(anchorOwner) : null, direction, depth,
    indexVersion: hash(JSON.stringify(['dependency_graph_v1', root, ts.version, LIMITS, ignoreInput?.hash ?? 'default-ignore', files, [...texts].map(([file, value]) => [rel(file), value.hash])])),
    coverage: { model: 'static-literal-imports-and-manifest-declarations', incomplete: warnings.size > 0, unresolvedImports: outputUnresolved, unresolvedTotal, extractor: 'TypeScript syntax parser', resolution: 'TypeScript over visible files and virtual package.json workspace links; installed layout is not inspected', dynamicResolution: 'not modeled', symlinks: 'not followed' },
    nodes: outputNodes, edges: outputEdges.map(edge => ({ ...edge })), warnings: [...warnings], stats, limits: { ...LIMITS },
  }
  if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.outputBytes) throw new Error('Dependency graph metadata exceeds the output budget; query a smaller scope')
  return result
}
