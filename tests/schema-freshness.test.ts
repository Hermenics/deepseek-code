import { expect, it } from 'bun:test'
import { Glob } from '../src/tools/Glob/Glob.js'
import { Grep } from '../src/tools/Grep/Grep.js'
import { ReadFile } from '../src/tools/ReadFile/ReadFile.js'
import { ReadFolder } from '../src/tools/ReadFolder/ReadFolder.js'
import { Git } from '../src/tools/Git/Git.js'
import { Workflow } from '../src/tools/Workflow/Workflow.js'
import { DevServer } from '../src/tools/DevServer/DevServer.js'
import { Lsp } from '../src/tools/Lsp/Lsp.js'
import { Shell } from '../src/tools/Shell/Shell.js'
import { SubAgent } from '../src/tools/SubAgent/SubAgent.js'
import { allTools, toolMap } from '../src/tools/index.js'
import { validateSchema, validateToolArguments } from '../src/orchestration/schema.js'

function collectDefaultPaths(value: unknown, path = '$', paths: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectDefaultPaths(child, `${path}.${index}`, paths))
    return paths
  }
  if (!value || typeof value !== 'object') return paths
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (key === 'default') paths.push(childPath)
    else collectDefaultPaths(child, childPath, paths)
  }
  return paths
}

it('invalidates cached validation when a schema is changed in place', () => {
  const schema = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }
  expect(validateToolArguments(schema, { value: 'old' }).valid).toBe(true)
  schema.properties.value.type = 'number'
  expect(validateToolArguments(schema, { value: 'old' }).valid).toBe(false)
  expect(validateToolArguments(schema, { value: 3 }).valid).toBe(true)
  schema.required.push('newField')
  expect(validateToolArguments(schema, { value: 3 }).valid).toBe(false)
})

it('updates cached top-level required fields and continues to reject undeclared arguments', () => {
  const schema = { type: 'object', properties: { old: { type: 'string' }, current: { type: 'string' } }, required: ['old'] }
  expect(validateToolArguments(schema, { old: 'x' }).valid).toBe(true)
  schema.required = ['current']
  expect(validateToolArguments(schema, { old: 'x' }).valid).toBe(false)
  expect(validateToolArguments(schema, { current: 'x' }).valid).toBe(true)
  expect(validateToolArguments(schema, { current: 'x', undeclared: 'x' }).valid).toBe(false)
})

it('recompiles immutable validator snapshots when schema IDs and content change', () => {
  const schema = { $id: 'schema-freshness-original', type: 'string', minLength: 1 }
  expect(validateSchema(schema, 'x').valid).toBe(true)
  schema.$id = 'schema-freshness-current'
  schema.minLength = 3
  expect(validateSchema(schema, 'x').valid).toBe(false)
  expect(validateSchema(schema, 'xxx').valid).toBe(true)
})

it('fails closed on a corrupted schema instead of using its last valid cached validator', () => {
  const schema = { type: 'string' }
  expect(validateSchema(schema, 'x').valid).toBe(true)
  schema.type = 'invalid-schema-type'
  expect(() => validateSchema(schema, 'x')).toThrow()
})

it('revalidates tool schemas with unchanged IDs after mutation', () => {
  const schema = { $id: 'tool-schema-freshness', type: 'object', properties: { value: { type: 'string', minLength: 1 } } }
  expect(validateToolArguments(schema, { value: 'x' }).valid).toBe(true)
  schema.properties.value.minLength = 3
  expect(validateToolArguments(schema, { value: 'x' }).valid).toBe(false)
  expect(validateToolArguments(schema, { value: 'xxx' }).valid).toBe(true)
})

it('applies declared tool defaults to a copy without replacing explicit false values', () => {
  const schema = {
    type: 'object',
    properties: {
      scope: { type: 'string', default: 'workspace' },
      enabled: { type: 'boolean', default: true },
    },
  }
  const input = { enabled: false }
  const result = validateToolArguments(schema, input)
  expect(result).toMatchObject({ valid: true, value: { scope: 'workspace', enabled: false } })
  expect(input).toEqual({ enabled: false })
})

it('publishes and resolves the literal defaults documented by native tools', () => {
  expect(validateToolArguments(Glob.parameters, { pattern: '*.ts' }).value).toEqual({ pattern: '*.ts', cwd: '.' })
  expect(validateToolArguments(Grep.parameters, { pattern: 'needle' }).value).toEqual({ pattern: 'needle', path: '.', limit: 200, group_by: 'file' })
  expect(validateToolArguments(SubAgent.parameters, { task: 'inspect the API' }).value).toEqual({ task: 'inspect the API', role: 'reader', mode: 'foreground' })
})

it('exercises every default declared by the native tool catalog', () => {
  const cases: Array<{ tool: string; args: Record<string, unknown>; expected: Record<string, unknown>; defaults: string[] }> = [
    { tool: 'read_file', args: { path: 'README.md' }, expected: { path: 'README.md', start_line: 1 }, defaults: ['$.allOf.0.then.properties.start_line.default'] },
    { tool: 'read_folder', args: { path: '.' }, expected: { path: '.', recursive: false }, defaults: ['$.properties.recursive.default'] },
    { tool: 'grep', args: { pattern: 'needle' }, expected: { pattern: 'needle', path: '.', limit: 200, group_by: 'file' }, defaults: ['$.properties.path.default', '$.properties.limit.default', '$.properties.group_by.default'] },
    { tool: 'glob', args: { pattern: '*.ts' }, expected: { pattern: '*.ts', cwd: '.' }, defaults: ['$.properties.cwd.default'] },
    { tool: 'lsp', args: { operation: 'dependency_graph', path: 'src/index.ts' }, expected: { operation: 'dependency_graph', path: 'src/index.ts', direction: 'both', depth: 1 }, defaults: ['$.allOf.0.then.properties.direction.default', '$.allOf.0.then.properties.depth.default'] },
    { tool: 'shell', args: { command: 'true' }, expected: { command: 'true', timeout: 300 }, defaults: ['$.allOf.0.then.properties.timeout.default'] },
    { tool: 'dev_server', args: { action: 'logs' }, expected: { action: 'logs', lines: 40 }, defaults: ['$.allOf.0.then.properties.lines.default'] },
    { tool: 'subagent', args: { task: 'inspect the API' }, expected: { task: 'inspect the API', role: 'reader', mode: 'foreground' }, defaults: ['$.properties.role.default', '$.properties.mode.default'] },
    { tool: 'workflow', args: { script: 'export const meta = {};' }, expected: { script: 'export const meta = {};', timeoutMs: 120_000 }, defaults: ['$.properties.timeoutMs.default'] },
    { tool: 'git', args: { action: 'log' }, expected: { action: 'log', n: 20 }, defaults: ['$.allOf.0.then.properties.n.default'] },
    { tool: 'git', args: { action: 'batch', operations: [{ action: 'log' }, { action: 'status' }] }, expected: { action: 'batch', operations: [{ action: 'log', n: 20 }, { action: 'status' }] }, defaults: ['$.properties.operations.items.allOf.0.then.properties.n.default'] },
  ]

  const declared = allTools.flatMap(tool => collectDefaultPaths(tool.parameters, tool.name).map(path => `${tool.name}:${path}`)).sort()
  const exercised = cases.flatMap(testCase => testCase.defaults.map(path => `${testCase.tool}:${testCase.tool}${path.slice(1)}`)).sort()
  expect(exercised).toEqual(declared)

  for (const testCase of cases) {
    const tool = toolMap.get(testCase.tool)!
    expect(validateToolArguments(tool.parameters, testCase.args)).toEqual({ valid: true, value: testCase.expected, errors: [] })
  }
})

it('applies conditional defaults only to the operation that consumes them', () => {
  expect(validateToolArguments(ReadFile.parameters, { path: 'README.md' }).value).toMatchObject({ start_line: 1 })
  expect(validateToolArguments(ReadFile.parameters, { path: 'README.md', start_char: 12 }).value).not.toHaveProperty('start_line')
  expect(validateToolArguments(ReadFile.parameters, { path: 'README.md', start_byte: 12 }).value).not.toHaveProperty('start_line')
  expect(validateToolArguments(Git.parameters, { action: 'log' }).value).toEqual({ action: 'log', n: 20 })
  expect(validateToolArguments(Git.parameters, { action: 'status' }).value).toEqual({ action: 'status' })
  expect(validateToolArguments(Git.parameters, { action: 'batch', operations: [{ action: 'log' }, { action: 'status' }] }).value)
    .toEqual({ action: 'batch', operations: [{ action: 'log', n: 20 }, { action: 'status' }] })
  expect(validateToolArguments(Workflow.parameters, { script: 'export const meta = {};' }).value).toMatchObject({ timeoutMs: 120_000 })
  expect(validateToolArguments(DevServer.parameters, { action: 'logs' }).value).toEqual({ action: 'logs', lines: 40 })
  expect(validateToolArguments(DevServer.parameters, { action: 'list' }).value).toEqual({ action: 'list' })
  expect(validateToolArguments(Lsp.parameters, { operation: 'dependency_graph', path: 'src/index.ts' }).value)
    .toMatchObject({ direction: 'both', depth: 1 })
  expect(validateToolArguments(Lsp.parameters, { operation: 'hover', path: 'src/index.ts', line: 1, character: 1 }).value)
    .not.toHaveProperty('direction')
  expect(validateToolArguments(ReadFolder.parameters, { path: '.' }).value).toEqual({ path: '.', recursive: false })
  expect(validateToolArguments(Shell.parameters, { command: 'true' }).value).toMatchObject({ timeout: 300 })
  expect(validateToolArguments(Shell.parameters, { output_id: 'saved-output' }).value).toEqual({ output_id: 'saved-output' })
})
