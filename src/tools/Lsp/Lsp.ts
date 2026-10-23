import { realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Tool } from '../types.js'
import { assertSafePath, assertSafeDir } from '../shared/pathSafety.js'
import { closeLspSession, runLspRequest, type LspOperation } from '../../lsp.js'
import { queryDependencyGraph } from '../../agent/dependencyGraph.js'
import { readTextDocument } from '../shared/textEdits.js'

const OPERATIONS: LspOperation[] = ['definition', 'references', 'hover', 'document_symbols', 'workspace_symbols', 'diagnostics', 'rename_preview', 'code_actions', 'code_action_preview']

/** Read-only language-server navigation and bounded local import/package queries. */
export const Lsp: Tool = {
  name: 'lsp',
  description: 'Read-only navigation. Configured language servers expose definitions, references, hover, symbols and one-document diagnostics with source/version/configuration identities. code_actions lists bounded actions for a UTF-16 range; code_action_preview selects a listed action_id and proposes text edits only. Command-dependent/disabled actions are refused; opaque provider data stays private. IDs expire on source/configuration/server changes or another listing. rename_preview synchronizes every server-returned text target and returns bounded proposals with base hashes; it never writes. Read targets and apply the returned arguments separately with edit_file; resource/annotated edits are refused. diagnostics distinguishes server-versioned push from request-bound pull reports; unversioned messages remain bounded investigation hints under unverified.items, and omissions/cache reuse are labeled. Observed source changes refuse results. This is not a build/test receipt or a guarantee of project-wide freshness. dependency_graph queries bounded local TS/JS literal imports and package.json workspace declarations without a server, scripts or plugins; use file anchors for imports/dependents and package.json for declared package dependents. The graph is not type checking, a semantic call graph or test coverage. Use grep for unsupported or omitted scope.',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: [...OPERATIONS, 'dependency_graph'] },
      path: { type: 'string', description: 'File path. Required except for workspace_symbols.' },
      line: { type: 'number', description: '1-based line. Required for definition, references, hover, rename_preview and code_actions.' },
      character: { type: 'number', description: '1-based UTF-16 character offset. Required for definition, references, hover, rename_preview and code_actions.' },
      end_line: { type: 'integer', minimum: 1, description: 'Optional 1-based end line for code_actions; defaults to line.' },
      end_character: { type: 'integer', minimum: 1, description: 'Optional 1-based UTF-16 range end for code_actions; defaults to character.' },
      kind: { type: 'string', maxLength: 256, description: 'Optional code action kind filter, e.g. quickfix or source.organizeImports.' },
      action_id: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Native ID from code_actions, required for code_action_preview on the same path.' },
      query: { type: 'string', description: 'Symbol query for workspace_symbols.' },
      new_name: { type: 'string', minLength: 1, maxLength: 256, description: 'New symbol name for rename_preview. Returns proposals only; apply separately with edit_file after reading each target.' },
      direction: { type: 'string', enum: ['imports', 'dependents', 'both'], description: 'Dependency graph direction (default both).' },
      depth: { type: 'integer', minimum: 0, maximum: 3, description: 'Dependency graph neighborhood depth (default 1).' },
    },
    allOf: [{ if: { properties: { operation: { const: 'dependency_graph' } }, required: ['operation'] }, then: { properties: { direction: { default: 'both' }, depth: { default: 1 } } } }],
    required: ['operation'],
  },
  async execute(args, context) {
    if (args.operation === 'dependency_graph') {
      if (typeof args.path !== 'string' || !args.path.trim()) return 'Error: dependency_graph requires a file or package.json path.'
      return JSON.stringify(await queryDependencyGraph({ path: args.path, direction: args.direction as string | undefined, depth: args.depth as number | undefined }, context))
    }
    const operation = args.operation as LspOperation
    if (!OPERATIONS.includes(operation)) return 'Error: unsupported LSP operation.'
    const rawPath = typeof args.path === 'string' ? args.path : undefined
    if (!rawPath && operation !== 'workspace_symbols') return 'Error: path is required for this LSP operation.'
    if (['definition', 'references', 'hover', 'rename_preview', 'code_actions'].includes(operation) && (!Number.isInteger(args.line) || !Number.isInteger(args.character) || Number(args.line) < 1 || Number(args.character) < 1)) {
      return 'Error: line and character must be positive 1-based numbers.'
    }
    if (operation === 'rename_preview' && (typeof args.new_name !== 'string' || !args.new_name.trim() || args.new_name.length > 256 || /[\x00-\x1f\x7f]/.test(args.new_name))) return 'Error: rename_preview requires a bounded, non-empty new_name without control characters.'
    if (operation === 'code_action_preview' && (typeof args.action_id !== 'string' || !/^[a-f0-9]{64}$/.test(args.action_id))) return 'Error: code_action_preview requires a listed action_id.'
    const path = rawPath ? await realpath(await assertSafePath(rawPath, context)) : undefined
    const settings = context?.session?.runtimeSnapshot().settings
    if (!settings) return 'Error: LSP settings are unavailable in this session.'
    const inputs = new Map<string, string | null>()
    const fingerprint = (text: string | null) => text === null ? null : createHash('sha256').update(text).digest('hex')
    const readDocument = async (file: string): Promise<string | null> => {
      try {
        const snapshot = await readTextDocument(file, context)
        inputs.set(file, snapshot.hash)
        return snapshot.text
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { inputs.set(file, null); return null }
        throw error
      }
    }
    const fileContent = path ? await readDocument(path) : undefined
    if (fileContent === null) throw new Error('LSP document no longer exists; retry')
    const result = await runLspRequest(settings, {
      operation,
      filePath: path,
      fileContent,
      line: typeof args.line === 'number' ? args.line : undefined,
      character: typeof args.character === 'number' ? args.character : undefined,
      query: typeof args.query === 'string' ? args.query : undefined,
      endLine: args.end_line as number | undefined,
      endCharacter: args.end_character as number | undefined,
      kind: args.kind as string | undefined,
      actionId: args.action_id as string | undefined,
      newName: typeof args.new_name === 'string' ? args.new_name : undefined,
      workspacePath: await realpath(await assertSafeDir(context?.workspacePath ?? process.cwd(), context)),
    }, { owner: context?.session, signal: context?.signal, readDocument })
    try {
      if (rawPath && await realpath(await assertSafePath(rawPath, context)) !== path) throw new Error('LSP source path changed during the query; retry')
      for (const [file, expected] of [...inputs]) {
        if (fingerprint(await readDocument(file)) !== expected) throw new Error('LSP sources changed during the query; retry')
      }
      context?.signal?.throwIfAborted()
    } catch (error) {
      if (context?.session) await closeLspSession(context.session)
      throw error
    }
    const preview = operation === 'rename_preview' || operation === 'code_action_preview'
    const output = JSON.stringify(result, null, preview ? undefined : 2)
    if (preview && Buffer.byteLength(output) > 32_000) throw new Error('LSP preview exceeds its output budget; no partial preview was produced')
    return output
  },
}
