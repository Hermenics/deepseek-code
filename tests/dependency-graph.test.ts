import { expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queryDependencyGraph } from '../src/agent/dependencyGraph.js'
import { Lsp } from '../src/tools/Lsp/Lsp.js'

async function fixture(run: (root: string, context: any, put: (path: string, text: string) => Promise<void>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-dependency-graph-'))
  const context = { sessionId: 'graph-fixture', workspacePath: root, projectRoot: root, permissionProfile: 'researcher-readonly' as const }
  const put = async (path: string, text: string) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text) }
  try { await run(root, context, put) } finally { await rm(root, { recursive: true, force: true }) }
}

it('resolves typed/re-export/require imports, aliases and workspace packages without a language server', async () => {
  await fixture(async (root, context, put) => {
    await put('package.json', '{"private":true,"workspaces":["packages/*"]}')
    await put('packages/core/package.json', '{"name":"@fixture/core","exports":"./src/index.ts","scripts":{"test":"bun test"}}')
    await put('packages/core/src/index.ts', 'export { value } from "./value.js"')
    await put('packages/core/src/value.ts', 'export const value = 1')
    await put('packages/app/package.json', '{"name":"@fixture/app","dependencies":{"@fixture/core":"workspace:*"}}')
    await put('packages/app/tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@core/*":["../core/src/*"]}}}')
    await put('packages/app/src/main.ts', 'import type {value} from "@fixture/core"; const v = require("@core/value"); // import "./decoy"\n')
    const result = await queryDependencyGraph({ path: 'packages/app/src/main.ts', depth: 3 }, context)
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'packages/app/src/main.ts', to: 'packages/core/src/index.ts', kind: 'resolved-import', specifier: '@fixture/core' }),
      expect.objectContaining({ from: 'packages/app/src/main.ts', to: 'packages/core/src/value.ts', kind: 'resolved-import', specifier: '@core/value' }),
      expect.objectContaining({ from: 'packages/core/src/index.ts', to: 'packages/core/src/value.ts', kind: 'resolved-import', specifier: './value.js' }),
      expect.objectContaining({ from: 'packages/app/package.json', to: 'packages/core/package.json', kind: 'manifest-dependency' }),
    ]))
    expect(JSON.stringify(result)).not.toContain('decoy')
    expect(result.coverage.model).toBe('static-literal-imports-and-manifest-declarations')
    const toolResult = JSON.parse(await Lsp.execute({ operation: 'dependency_graph', path: 'packages/core/src/value.ts', direction: 'dependents', depth: 3 }, context))
    expect(toolResult.nodes.some((node: any) => node.id === 'packages/app/src/main.ts')).toBe(true)
  })
})

it('reuses only content-identical parsing and refreshes config, additions and deletion', async () => {
  await fixture(async (root, context, put) => {
    await put('tsconfig.json', '{"compilerOptions":{"paths":{"@target":["./a.ts"]}}}')
    await put('entry.ts', 'import "@target"')
    await put('a.ts', 'export const a = 1')
    await put('b.ts', 'export const b = 1')
    const first = await queryDependencyGraph({ path: 'entry.ts' }, context)
    const second = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(second.indexVersion).toBe(first.indexVersion)
    expect(second.stats.parsedFiles).toBe(0)
    expect(second.stats.reusedFiles).toBe(3)
    expect(second.stats.resolvedFiles).toBe(0)
    expect(second.stats.reusedResolutionFiles).toBe(3)
    await put('tsconfig.json', '{"compilerOptions":{"paths":{"@target":["./b.ts"]}}}')
    const changed = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(changed.indexVersion).not.toBe(first.indexVersion)
    expect(changed.edges.some(edge => edge.from === 'entry.ts' && edge.to === 'b.ts')).toBe(true)
    expect(changed.stats.resolvedFiles).toBe(3)
    await put('caller.ts', 'import "./entry"')
    expect((await queryDependencyGraph({ path: 'entry.ts', direction: 'dependents' }, context)).nodes.some(node => node.id === 'caller.ts')).toBe(true)
    await rm(join(root, 'caller.ts'))
    expect((await queryDependencyGraph({ path: 'entry.ts', direction: 'dependents' }, context)).nodes.some(node => node.id === 'caller.ts')).toBe(false)
    const original = await stat(join(root, 'entry.ts'))
    await put('entry.ts', 'import "./a"')
    await utimes(join(root, 'entry.ts'), original.atime, original.mtime)
    const edited = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(edited.stats.parsedFiles).toBe(1)
    expect(edited.stats.resolvedFiles).toBe(1)
    expect(edited.stats.reusedResolutionFiles).toBe(2)
    expect(edited.edges.some(edge => edge.from === 'entry.ts' && edge.to === 'a.ts')).toBe(true)
  })
})

it('honors ignores, private scope, symlinks, cancellation and explicit graph limits', async () => {
  await fixture(async (root, context, put) => {
    await put('entry.ts', 'import "./hidden/secret"; import "./alias"; import "./big"')
    await put('.deepseekignore', 'hidden/\n')
    await put('hidden/secret.ts', 'export const sensitive = "canary-must-not-appear"')
    await put('big.ts', 'x'.repeat(300_000))
    await symlink(join(root, 'hidden', 'secret.ts'), join(root, 'alias.ts'))
    const result = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(result.coverage.incomplete).toBe(true)
    expect(result.warnings).toContain('file_byte_limit')
    expect(result.nodes.some(node => node.id === 'hidden/secret.ts')).toBe(false)
    expect(JSON.stringify(result)).not.toContain('canary-must-not-appear')
    const controller = new AbortController(); controller.abort(new Error('Stop graph query'))
    await expect(queryDependencyGraph({ path: 'entry.ts' }, { ...context, signal: controller.signal })).rejects.toThrow('Stop graph query')
    await expect(queryDependencyGraph({ path: '../outside.ts' }, context)).rejects.toThrow()
    await expect(queryDependencyGraph({ path: 'entry.ts', depth: 9 }, context)).rejects.toThrow('depth')
  })
})

it('distinguishes conditional import/require exports and labels external declarations', async () => {
  await fixture(async (_root, context, put) => {
    await put('package.json', '{"workspaces":["packages/*"],"dependencies":{"external-lib":"^1.0.0"}}')
    await put('packages/lib/package.json', '{"name":"@fixture/lib","exports":{"import":"./esm.ts","require":"./cjs.ts"}}')
    await put('packages/lib/esm.ts', 'export const esm = 1')
    await put('packages/lib/cjs.ts', 'export const cjs = 1')
    await put('entry.ts', 'import {esm} from "@fixture/lib";\nconst cjs = require("@fixture/lib");')
    const result = await queryDependencyGraph({ path: 'entry.ts', direction: 'imports' }, context)
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: 'packages/lib/esm.ts', syntax: 'import', line: 1 }),
      expect.objectContaining({ to: 'packages/lib/cjs.ts', syntax: 'require', line: 2 }),
    ]))
    const packages = await queryDependencyGraph({ path: 'package.json', direction: 'imports' }, context)
    expect(packages.nodes).toContainEqual(expect.objectContaining({ id: 'external-package:external-lib', kind: 'external-package', hash: null }))
  })
})

it('refreshes inherited aliases without executing configuration plugins', async () => {
  await fixture(async (root, context, put) => {
    await put('tsconfig.json', '{"extends":"./config/base","compilerOptions":{"plugins":[{"name":"./plugin.js"}]}}')
    await put('config/base.json', '{"compilerOptions":{"paths":{"@target":["../a.ts"]}}}')
    await put('a.ts', 'export const a = 1')
    await put('b.ts', 'export const b = 1')
    await put('entry.ts', 'import "@target"')
    await put('plugin.js', `await Bun.write(${JSON.stringify(join(root, 'plugin-ran'))}, 'executed')`)
    const first = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(first.edges.some(edge => edge.from === 'entry.ts' && edge.to === 'a.ts')).toBe(true)
    await put('config/base.json', '{"compilerOptions":{"paths":{"@target":["../b.ts"]}}}')
    const second = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(second.edges.some(edge => edge.from === 'entry.ts' && edge.to === 'b.ts')).toBe(true)
    expect(second.indexVersion).not.toBe(first.indexVersion)
    await expect(Bun.file(join(root, 'plugin-ran')).exists()).resolves.toBe(false)
  })
})

it('invalidates exports and dependency declarations without exposing cached edges to callers', async () => {
  await fixture(async (_root, context, put) => {
    await put('package.json', '{"workspaces":["packages/*"],"dependencies":{"@fixture/lib":"workspace:*"}}')
    await put('packages/lib/package.json', '{"name":"@fixture/lib","exports":"./one.ts"}')
    await put('packages/lib/one.ts', 'export const one = 1')
    await put('packages/lib/two.ts', 'export const two = 1')
    await put('entry.ts', 'import "@fixture/lib"; import "./missing"')
    const first = await queryDependencyGraph({ path: 'entry.ts' }, context)
    first.edges.find(edge => edge.kind === 'resolved-import')!.to = 'fabricated.ts'
    const warm = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(warm.edges.some(edge => edge.to === 'fabricated.ts')).toBe(false)
    expect(warm.edges.some(edge => edge.to === 'packages/lib/one.ts')).toBe(true)
    expect(warm.coverage.unresolvedTotal).toBe(1)
    expect(warm.warnings).toContain('unresolved_imports')
    await put('packages/lib/package.json', '{"name":"@fixture/lib","exports":"./two.ts"}')
    await put('package.json', '{"workspaces":["packages/*"],"dependencies":{"external-lib":"^1.0.0"}}')
    const changed = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(changed.edges.some(edge => edge.to === 'packages/lib/two.ts')).toBe(true)
    expect(changed.edges.some(edge => edge.to === 'packages/lib/one.ts')).toBe(false)
    expect(changed.indexVersion).not.toBe(warm.indexVersion)
    const manifest = await queryDependencyGraph({ path: 'package.json', direction: 'imports' }, context)
    expect(manifest.edges.some(edge => edge.to === 'external-package:external-lib')).toBe(true)
    expect(manifest.edges.some(edge => edge.kind === 'manifest-dependency' && edge.to === 'packages/lib/package.json')).toBe(false)
    await put('missing.ts', 'export const found = 1')
    const found = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(found.coverage.unresolvedTotal).toBe(0)
    expect(found.edges.some(edge => edge.to === 'missing.ts')).toBe(true)
  })
})

it('bounds neighborhood serialization and preserves depth-zero semantics', async () => {
  await fixture(async (_root, context, put) => {
    await put('package.json', '{"name":"bounded-fixture"}')
    const names = Array.from({ length: 130 }, (_, index) => `module-${index}-${'x'.repeat(150)}`)
    for (const name of names) await put(`${name}.ts`, 'export const value = 1')
    await put('entry.ts', names.map(name => `import "./${name}"`).join('\n'))
    const result = await queryDependencyGraph({ path: 'entry.ts', depth: 3 }, context)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32_000)
    expect(result.coverage.incomplete).toBe(true)
    expect(result.warnings).toContain('file_import_limit')
    expect(result.nodes.some(node => node.id === 'entry.ts')).toBe(true)
    const zero = await queryDependencyGraph({ path: 'entry.ts', depth: 0 }, context)
    expect(zero.nodes.map(node => node.id)).toEqual(['entry.ts'])
    expect(zero.edges).toEqual([])
  })
})

it('does not return cached private nodes after scope or same-mtime ignore changes', async () => {
  await fixture(async (root, context, put) => {
    await put('entry.ts', 'import "./one/item"; import "./two/item"')
    await put('one/item.ts', 'export const one = 1')
    await put('two/item.ts', 'export const two = 1')
    await put('.deepseekignore', 'one/\n')
    const first = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(first.nodes.some(node => node.id === 'two/item.ts')).toBe(true)
    const original = await stat(join(root, '.deepseekignore'))
    await put('.deepseekignore', 'two/\n')
    await utimes(join(root, '.deepseekignore'), original.atime, original.mtime)
    const second = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(second.nodes.some(node => node.id === 'two/item.ts')).toBe(false)
    expect(second.nodes.some(node => node.id === 'one/item.ts')).toBe(true)
    context.protectedPaths = [join(root, 'one')]
    const privateResult = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(privateResult.nodes.some(node => node.id === 'one/item.ts')).toBe(false)
  })
})

it('reports unsupported/cyclic configuration without inventing resolved imports', async () => {
  await fixture(async (_root, context, put) => {
    await put('entry.ts', 'import "./target"')
    await put('target.ts', 'export const target = 1')
    await put('tsconfig.json', '{"extends":"some-external-config"}')
    const external = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(external.warnings).toContain('unsupported_configuration_extends')
    expect(external.edges.some(edge => edge.kind === 'resolved-import')).toBe(false)
    await put('tsconfig.json', '{"extends":"./config/base"}')
    await put('config/base.json', '{"extends":"../tsconfig"}')
    const cycle = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(cycle.warnings).toContain('configuration_cycle')
    expect(cycle.coverage.incomplete).toBe(true)
  })
})

it('does not substitute default resolution when a visible configuration exceeds the read limit', async () => {
  await fixture(async (_root, context, put) => {
    await put('entry.ts', 'import "./target"')
    await put('target.ts', 'export const target = 1')
    await put('tsconfig.json', ' '.repeat(256_001))
    const result = await queryDependencyGraph({ path: 'entry.ts' }, context)
    expect(result.warnings).toContain('configuration_unavailable')
    expect(result.coverage.incomplete).toBe(true)
    expect(result.edges.some(edge => edge.kind === 'resolved-import')).toBe(false)
  })
})

it('ships the lazy parser inside a standalone Bun bundle', async () => {
  await fixture(async (root, _context, put) => {
    await put('entry.ts', 'import "./target"')
    await put('target.ts', 'export const target = 1')
    const output = join(root, 'compiled')
    const built = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/agent/dependencyGraph.ts')], outdir: output, target: 'bun', minify: true, naming: 'graph.mjs', external: [] })
    expect(built.success).toBe(true)
    const { execa } = await import('execa')
    const { scrubbedEnv } = await import('../src/utils/platform.js')
    const script = `const {queryDependencyGraph}=await import(${JSON.stringify(join(output, 'graph.mjs'))}); const result=await queryDependencyGraph({path:'entry.ts'}, {sessionId:'bundle',workspacePath:${JSON.stringify(root)},projectRoot:${JSON.stringify(root)},permissionProfile:'researcher-readonly'}); console.log(JSON.stringify(result.edges))`
    const result = await execa(process.execPath, ['-e', script], { cwd: root, env: scrubbedEnv(), extendEnv: false })
    expect(JSON.parse(result.stdout)).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'entry.ts', to: 'target.ts', kind: 'resolved-import' })]))
  })
}, 15_000)
