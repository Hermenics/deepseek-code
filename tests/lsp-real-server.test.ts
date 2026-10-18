import { expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { Lsp } from '../src/tools/Lsp/Lsp.js'
import { ReadFile } from '../src/tools/ReadFile/ReadFile.js'
import { EditFile } from '../src/tools/EditFile/EditFile.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import type { FileVersion } from '../src/orchestration/types.js'
import { scrubbedEnv } from '../src/utils/platform.js'

const localServer = resolve(import.meta.dir, '../node_modules/.bin/typescript-language-server')
const configuredServer = process.env.DEEPSEEK_LSP_TEST_SERVER ?? (existsSync(localServer) ? localServer : Bun.which('typescript-language-server'))

// Prefer an explicit server path; otherwise use the installed development dependency.
it.skipIf(!configuredServer || process.platform === 'win32')('integrates a real TypeScript server, source versions, rename application and compiler checks', async () => {
  const cli = await realpath(configuredServer!)
  const node = Bun.which(process.env.DEEPSEEK_LSP_TEST_NODE ?? 'node')
  if (!node) throw new Error('The real TypeScript LSP fixture requires Node.js')
  const modules = dirname(dirname(dirname(cli)))
  const typescript = join(modules, 'typescript')
  const compiler = join(typescript, 'bin/tsc')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'deepseek-real-ts-lsp-')))
  const home = join(root, 'home'); await mkdir(home)
  const main = join(root, 'main.ts'), library = join(root, 'lib.ts')
  const versions = new Map<string, FileVersion>()
  let session: OrchestratorSession | undefined
  try {
    await mkdir(join(root, 'node_modules'))
    await symlink(typescript, join(root, 'node_modules/typescript'), 'dir')
    await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true,"noEmit":true,"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext"},"include":["*.ts"]}\n')
    await writeFile(library, 'export function formatValue(value: number): string { return String(value) }\n')
    await writeFile(main, "import { formatValue } from './lib.js'\nconst label: number = formatValue(3)\nconsole.log(label)\n")
    const wrapper = join(root, 'server.mjs')
    await writeFile(wrapper, `process.env.HOME = ${JSON.stringify(home)}; await import(${JSON.stringify(pathToFileURL(cli).href)});\n`)
    session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null, settings: { lsp: { timeoutMs: 30_000, servers: [{ name: 'Real TypeScript fixture', command: node, args: [wrapper, '--stdio', '--log-level', '1'], extensions: ['.ts'] }] } } })
    const context = (path?: string) => ({ ...session!.toolContext(), expectedFileVersion: path ? versions.get(path) : undefined, onFileReadReturned: (file: string, value: FileVersion) => versions.set(file, value), onFileWriteCommitted: (file: string, value: FileVersion) => { versions.set(file, value) } })
    const query = async (args: Record<string, unknown>) => JSON.parse(await Lsp.execute(args, context()))
    const compile = () => execa(node, [compiler, '-p', root, '--pretty', 'false'], { cwd: root, env: { ...scrubbedEnv(), HOME: home }, extendEnv: false, reject: false, timeout: 30_000, maxBuffer: 1_000_000 })
    const before = await compile()
    expect(before.exitCode).not.toBe(0)
    expect(before.stdout).toContain('TS2322')
    const cold = await query({ operation: 'definition', path: main, line: 1, character: 12 })
    expect(Array.isArray(cold.result)).toBe(true)
    // The adapter can publish empty syntax diagnostics before semantic results.
    let diagnostic = await query({ operation: 'diagnostics', path: main })
    const diagnosticItems = (value: any) => value.result.status === 'unversioned' ? value.result.unverified.items : value.result.items
    const diagnosticDeadline = Date.now() + 30_000
    while (!diagnosticItems(diagnostic).some((item: any) => Number(item.code) === 2322)) {
      if (Date.now() >= diagnosticDeadline) throw new Error('TypeScript semantic diagnostic TS2322 was not observed')
      await Bun.sleep(25)
      diagnostic = await query({ operation: 'diagnostics', path: main })
    }
    if (diagnostic.result.status === 'unversioned') {
      expect(diagnostic.result.items).toEqual([])
      expect(Array.isArray(diagnostic.result.unverified?.items)).toBe(true)
      expect(diagnostic.result.versionBinding).toBe('unverified')
    }
    const messages = diagnostic.result.status === 'unversioned' ? diagnostic.result.unverified.items : diagnostic.result.items
    expect(messages.some((item: any) => Number(item.code) === 2322)).toBe(true)
    // Cold requests can use the syntax process until the server publishes semantic diagnostics.
    const definition = await query({ operation: 'definition', path: main, line: 1, character: 12 })
    expect(definition.result.some((location: any) => (location.uri ?? location.targetUri) === pathToFileURL(library).href)).toBe(true)
    const hover = await query({ operation: 'hover', path: main, line: 2, character: 25 })
    expect(hover.generation).toBe(cold.generation)
    expect(JSON.stringify(hover.result)).toContain('formatValue')
    const proposal = await query({ operation: 'rename_preview', path: library, line: 1, character: 20, new_name: 'stringifyValue' })
    expect(proposal.result.status).toBe('proposal-only')
    expect(proposal.result.files.map((file: any) => file.arguments.path).sort()).toEqual([library, main].sort())
    expect(await readFile(main, 'utf8')).toContain('formatValue(3)')
    for (const file of proposal.result.files) {
      await ReadFile.execute({ path: file.arguments.path }, context())
      expect(versions.get(file.arguments.path)?.hash).toBe(file.arguments.expected_hash)
      await EditFile.execute(file.arguments, context(file.arguments.path))
    }
    expect(await readFile(main, 'utf8')).toContain('stringifyValue(3)')
    expect(await readFile(main, 'utf8')).not.toContain('formatValue')
    expect(await readFile(library, 'utf8')).toContain('function stringifyValue(')
    const afterRename = await compile()
    expect(afterRename.stdout).toContain('TS2322')
    expect(afterRename.stdout).not.toMatch(/TS2304|TS2305|TS2552/)
    await ReadFile.execute({ path: main }, context())
    await EditFile.execute({ path: main, edits: [{ line: 2, old: ['label: number'], new: ['label: string'] }] }, context(main))
    const afterFix = await compile()
    expect(afterFix.exitCode).toBe(0)
    expect(afterFix.failed).toBe(false)
    expect(afterFix.stdout).toBe('')
    expect(afterFix.stderr).toBe('')
    const fresh = await query({ operation: 'hover', path: main, line: 2, character: 25 })
    expect(fresh.document.hash).toBe(versions.get(main)?.hash)
    expect(fresh.document.version).toBeGreaterThan(hover.document.version)
    await session.shutdown()
    session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null, settings: { lsp: { timeoutMs: 30_000, servers: [{ name: 'Real semantic TypeScript fixture', command: node, args: [wrapper, '--stdio', '--log-level', '1'], extensions: ['.ts'], initializationOptions: { tsserver: { useSyntaxServer: 'never' } } }] } } })
    const coldRename = await query({ operation: 'rename_preview', path: library, line: 1, character: 20, new_name: 'serializeValue' })
    expect(coldRename.generation).not.toBe(definition.generation)
    expect(coldRename.result.files.map((file: any) => file.arguments.path).sort()).toEqual([library, main].sort())
    const actionFile = join(root, 'actions.ts')
    await writeFile(actionFile, "import { stringifyValue } from './lib.js'\nconsole.log('ready')\n")
    const listing = await query({ operation: 'code_actions', path: actionFile, line: 1, character: 1, kind: 'source.removeUnusedImports' })
    const action = listing.result.actions.find((value: any) => value.kind === 'source.removeUnusedImports.ts')
    expect(action?.status).toBe('edit-preview')
    const actionPreview = await query({ operation: 'code_action_preview', path: actionFile, action_id: action.id })
    expect(actionPreview.result.files).toHaveLength(1)
    expect(await readFile(actionFile, 'utf8')).toContain('import')
    for (const file of actionPreview.result.files) {
      await ReadFile.execute({ path: file.arguments.path }, context())
      await EditFile.execute(file.arguments, context(file.arguments.path))
    }
    expect(await readFile(actionFile, 'utf8')).toBe("console.log('ready')\n")
    const afterAction = await compile()
    expect(afterAction.exitCode).toBe(0)
    expect(afterAction.failed).toBe(false)
    expect(afterAction.stdout).toBe('')
    expect(afterAction.stderr).toBe('')
    const serverPackage = JSON.parse(await readFile(join(dirname(dirname(cli)), 'package.json'), 'utf8'))
    const tsPackage = JSON.parse(await readFile(join(typescript, 'package.json'), 'utf8'))
    console.log(JSON.stringify({ fixture: 'real-typescript-lsp', serverVersion: serverPackage.version, typescriptVersion: tsPackage.version, diagnosticBinding: diagnostic.result.versionBinding, renamedFiles: proposal.result.files.length, compilerExit: afterFix.exitCode }))
  } finally {
    await session?.shutdown()
    await rm(root, { recursive: true, force: true })
  }
}, 90_000)
