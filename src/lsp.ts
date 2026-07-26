import { extname } from 'path'
import { pathToFileURL } from 'url'
import { spawn, type ChildProcess } from 'child_process'
import type { Writable, Readable } from 'stream'
import type { DeepSeekSettings, LspServerSettings } from './settings/types.js'

export type LspOperation = 'definition' | 'references' | 'hover' | 'document_symbols' | 'workspace_symbols'

export interface LspRequest {
  operation: LspOperation
  filePath?: string
  line?: number
  character?: number
  query?: string
  workspacePath: string
  fileContent?: string
}

function languageIdFor(filePath: string, server: LspServerSettings): string {
  if (server.languageId) return server.languageId
  return ({ '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact', '.py': 'python', '.rs': 'rust', '.go': 'go' } as Record<string, string>)[extname(filePath)] ?? 'plaintext'
}

export function findLspServer(settings: DeepSeekSettings, filePath: string): LspServerSettings | null {
  const extension = extname(filePath).toLowerCase()
  return settings.lsp?.servers?.find(server => server.extensions.map(value => value.toLowerCase()).includes(extension)) ?? null
}

export function frameLspMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value))
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
}

class LspConnection {
  private readonly process: ChildProcess
  private readonly stdin: Writable
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private closed = false
  private failure: Error | null = null
  private wake: (() => void) | null = null

  constructor(private readonly server: LspServerSettings, cwd: string) {
    this.process = spawn(server.command, server.args ?? [], { cwd, stdio: ['pipe', 'pipe', 'ignore'] })
    this.stdin = this.process.stdin!
    const stdout = this.process.stdout as Readable
    stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.wake?.()
      this.wake = null
    })
    this.process.on('error', error => {
      this.failure = error
      this.wake?.()
      this.wake = null
    })
    this.process.on('close', () => {
      this.closed = true
      this.wake?.()
      this.wake = null
    })
  }

  private send(value: unknown): void {
    this.stdin.write(frameLspMessage(value))
  }

  private async nextMessage(): Promise<Record<string, unknown>> {
    while (true) {
      const end = this.buffer.indexOf('\r\n\r\n')
      if (end >= 0) {
        const header = this.buffer.subarray(0, end).toString('utf8')
        const match = /content-length:\s*(\d+)/i.exec(header)
        if (!match) throw new Error(`${this.server.name} sent an invalid LSP header`)
        const length = Number(match[1])
        const start = end + 4
        if (this.buffer.length >= start + length) {
          const body = this.buffer.subarray(start, start + length)
          this.buffer = this.buffer.slice(start + length)
          return JSON.parse(body.toString('utf8')) as Record<string, unknown>
        }
      }
      if (this.failure) throw this.failure
      if (this.closed) throw new Error(`${this.server.name} exited before replying`)
      await new Promise<void>(resolve => { this.wake = resolve })
    }
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    this.send({ jsonrpc: '2.0', id, method, params })
    while (true) {
      const message = await this.nextMessage()
      if (message.id === id) {
        if (message.error) throw new Error(`${this.server.name}: ${JSON.stringify(message.error)}`)
        return message.result
      }
    }
  }

  async run(request: LspRequest): Promise<unknown> {
    const rootUri = pathToFileURL(request.workspacePath).href
    await this.request('initialize', { processId: null, rootUri, capabilities: {}, workspaceFolders: [{ uri: rootUri, name: 'workspace' }] })
    this.send({ jsonrpc: '2.0', method: 'initialized', params: {} })
    if (request.operation === 'workspace_symbols') return this.request('workspace/symbol', { query: request.query ?? '' })

    if (!request.filePath || request.fileContent === undefined) throw new Error('filePath is required')
    const uri = pathToFileURL(request.filePath).href
    this.send({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: { textDocument: { uri, languageId: languageIdFor(request.filePath, this.server), version: 1, text: request.fileContent } },
    })
    if (request.operation === 'document_symbols') return this.request('textDocument/documentSymbol', { textDocument: { uri } })
    if (request.line === undefined || request.character === undefined) throw new Error('line and character are required')
    const position = { line: request.line - 1, character: request.character - 1 }
    if (request.operation === 'definition') return this.request('textDocument/definition', { textDocument: { uri }, position })
    if (request.operation === 'references') return this.request('textDocument/references', { textDocument: { uri }, position, context: { includeDeclaration: true } })
    if (request.operation === 'hover') return this.request('textDocument/hover', { textDocument: { uri }, position })
    throw new Error(`Unsupported LSP operation: ${request.operation}`)
  }

  async close(): Promise<void> {
    try {
      this.send({ jsonrpc: '2.0', id: this.nextId++, method: 'shutdown', params: null })
      this.send({ jsonrpc: '2.0', method: 'exit', params: null })
    } catch {
      // The process is terminated below even if it does not implement shutdown.
    } finally {
      this.process.kill()
    }
  }
}

export async function runLspRequest(settings: DeepSeekSettings, request: LspRequest): Promise<unknown> {
  if (!request.filePath && request.operation !== 'workspace_symbols') throw new Error('A file path is required for this LSP operation.')
  const server = request.filePath ? findLspServer(settings, request.filePath) : settings.lsp?.servers?.[0]
  if (!server) throw new Error('No user-configured language server supports this file. Configure lsp.servers in User settings.')
  const connection = new LspConnection(server, request.workspacePath)
  const timeoutMs = settings.lsp?.timeoutMs ?? 10_000
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<unknown>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`LSP request timed out after ${timeoutMs}ms`)), timeoutMs)
      connection.run(request).then(resolve, reject)
    })
  } finally {
    if (timeout) clearTimeout(timeout)
    await connection.close()
  }
}
