import { readFile } from 'fs/promises'
import { Tool } from '../types.js'
import { assertSafePath } from '../shared/pathSafety.js'
import { runLspRequest, type LspOperation } from '../../lsp.js'

const OPERATIONS: LspOperation[] = ['definition', 'references', 'hover', 'document_symbols', 'workspace_symbols']

export const Lsp: Tool = {
  name: 'lsp',
  description: 'Use a user-configured Language Server for definitions, references, hover documentation, document symbols, or workspace symbols. Read-only. If unavailable, use grep instead.',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: OPERATIONS },
      path: { type: 'string', description: 'File path. Required except for workspace_symbols.' },
      line: { type: 'number', description: '1-based line. Required except for document_symbols and workspace_symbols.' },
      character: { type: 'number', description: '1-based character offset. Required except for document_symbols and workspace_symbols.' },
      query: { type: 'string', description: 'Symbol query for workspace_symbols.' },
    },
    required: ['operation'],
  },
  async execute(args, context) {
    const operation = args.operation as LspOperation
    if (!OPERATIONS.includes(operation)) return 'Error: unsupported LSP operation.'
    const rawPath = typeof args.path === 'string' ? args.path : undefined
    if (!rawPath && operation !== 'workspace_symbols') return 'Error: path is required for this LSP operation.'
    if (operation !== 'document_symbols' && operation !== 'workspace_symbols' && (!Number.isInteger(args.line) || !Number.isInteger(args.character) || Number(args.line) < 1 || Number(args.character) < 1)) {
      return 'Error: line and character must be positive 1-based numbers.'
    }
    const path = rawPath ? await assertSafePath(rawPath, context) : undefined
    const settings = context?.session?.runtimeSnapshot().settings
    if (!settings) return 'Error: LSP settings are unavailable in this session.'
    const fileContent = path ? await readFile(path, 'utf8') : undefined
    const result = await runLspRequest(settings, {
      operation,
      filePath: path,
      fileContent,
      line: typeof args.line === 'number' ? args.line : undefined,
      character: typeof args.character === 'number' ? args.character : undefined,
      query: typeof args.query === 'string' ? args.query : undefined,
      workspacePath: context?.workspacePath ?? process.cwd(),
    })
    return JSON.stringify(result, null, 2)
  },
}
