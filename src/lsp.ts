import { createHash, randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { realpath } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import type { DeepSeekSettings, LspServerSettings } from './settings/types.js'
import { scrubbedEnv } from './utils/platform.js'
import { signalProcessGroup } from './utils/processGroup.js'
import { applyTextEdits, type TextEdit } from './tools/shared/textEdits.js'

export type LspOperation = 'definition' | 'references' | 'hover' | 'document_symbols' | 'workspace_symbols' | 'diagnostics' | 'rename_preview' | 'code_actions' | 'code_action_preview'
export interface LspRequest {
  operation: LspOperation
  filePath?: string
  line?: number
  character?: number
  query?: string
  workspacePath: string
  fileContent?: string
  endLine?: number
  endCharacter?: number
  kind?: string
  actionId?: string
  newName?: string
}
interface LspOptions {
  owner?: object
  signal?: AbortSignal
  readDocument?: (path: string) => Promise<string | null>
}
interface Document { path: string; text: string; version: number; hash: string }
const LIMITS = { frameBytes: 1_048_576, headerBytes: 8192, documentBytes: 524_288, openBytes: 2_097_152, documents: 32, servers: 4, queued: 32, diagnostics: 200, diagnosticReportBytes: 65_536, diagnosticCacheBytes: 262_144 }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

function diagnosticResult(mode: 'push' | 'pull', version: number | undefined, items: unknown, versionBinding: 'request' | 'server' | 'unverified') {
  if (!Array.isArray(items)) throw new Error('Invalid LSP diagnostic array')
  const retained: Array<Record<string, unknown>> = []
  let bytes = 0
  for (const item of items) {
    const position = (value: any) => value && Number.isInteger(value.line) && value.line >= 0 && value.line <= 2_147_483_647 && Number.isInteger(value.character) && value.character >= 0 && value.character <= 2_147_483_647
    if (!item || typeof item.message !== 'string' || !position(item.range?.start) || !position(item.range?.end)
      || item.range.end.line < item.range.start.line || item.range.end.line === item.range.start.line && item.range.end.character < item.range.start.character
      || item.severity !== undefined && ![1, 2, 3, 4].includes(item.severity)
      || item.code !== undefined && typeof item.code !== 'string' && !Number.isInteger(item.code)
      || item.source !== undefined && typeof item.source !== 'string') throw new Error('Invalid LSP diagnostic item')
    const diagnostic = { range: { start: { line: item.range.start.line, character: item.range.start.character }, end: { line: item.range.end.line, character: item.range.end.character } }, message: item.message, severity: item.severity, code: item.code, source: item.source }
    const cost = Buffer.byteLength(JSON.stringify(diagnostic)) + 1
    if (retained.length >= LIMITS.diagnostics || bytes + cost > LIMITS.diagnosticReportBytes) continue
    retained.push(diagnostic); bytes += cost
  }
  const unversioned = versionBinding === 'unverified'
  const versionBound = unversioned ? [] : retained
  return { status: unversioned ? 'unversioned' : 'reported', mode, version, versionBinding, items: versionBound, omitted: items.length - versionBound.length, truncated: versionBound.length < items.length, ...(unversioned ? { omittedReason: 'unverified-document-version', unverified: { items: retained, omitted: items.length - retained.length, truncated: retained.length < items.length } } : {}), scope: 'requested-document', buildContext: 'not-verified', fields: 'range,message,severity,code,source', cached: false, observedAt: new Date().toISOString() }
}
type DiagnosticReport = ReturnType<typeof diagnosticResult>

function workspaceTextEdits(value: any): Array<{ uri: string; version?: number | null; edits: TextEdit[] }> {
  if (value === null) return []
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.changeAnnotations !== undefined) throw new Error('Invalid or annotated workspace edit')
  let entries: Array<{ uri: string; version?: number | null; edits: TextEdit[] }>
  if (value.documentChanges !== undefined) {
    if (!Array.isArray(value.documentChanges)) throw new Error('Invalid workspace edit documentChanges')
    entries = value.documentChanges.map((change: any) => {
      if (!change || change.kind !== undefined || !change.textDocument || typeof change.textDocument.uri !== 'string') throw new Error('Workspace edit resource operations are not supported; no files were changed')
      const version = change.textDocument.version
      if (version !== null && !Number.isInteger(version)) throw new Error('Invalid workspace edit document version')
      return { uri: change.textDocument.uri, version, edits: change.edits }
    })
  } else {
    if (value.changes !== undefined && (!value.changes || typeof value.changes !== 'object' || Array.isArray(value.changes))) throw new Error('Invalid workspace edit changes')
    entries = Object.entries(value.changes ?? {}).map(([uri, edits]) => ({ uri, edits: edits as TextEdit[] }))
  }
  if (entries.length > 20 || entries.some(entry => !Array.isArray(entry.edits)) || entries.reduce((sum, entry) => sum + entry.edits.length, 0) > 200) throw new Error('Workspace edit exceeds file/edit limits; no partial preview was produced')
  return entries.filter(entry => entry.edits.length > 0)
}

function languageIdFor(filePath: string, server: LspServerSettings): string {
  return server.languageId ?? ({ '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact', '.py': 'python', '.rs': 'rust', '.go': 'go' } as Record<string, string>)[extname(filePath).toLowerCase()] ?? 'plaintext'
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
  private readonly generation = randomUUID()
  private readonly process: ChildProcess
  private readonly closed: Promise<void>
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private failure: Error | null = null
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private readonly documents = new Map<string, Document>()
  private tail: Promise<unknown> = Promise.resolve()
  private queued = 0
  private initialized = false
  private syncChanges = false
  private renameProvider?: { prepareProvider?: boolean }
  private codeActionProvider?: { resolveProvider?: boolean }
  private readonly actions = new Map<string, { uri: string; sourceHash: string; params: Record<string, unknown>; identity: string; action: Record<string, any> }>()
  private nextDocumentVersion = 0
  private pullDiagnostics?: { identifier?: string }
  private readonly diagnostics = new Map<string, { report: DiagnosticReport; bytes: number }>()
  private diagnosticWait?: { uri: string; resolve(report: DiagnosticReport): void }
  private idle?: ReturnType<typeof setTimeout>
  private rejectActive?: (error: Error) => void

  constructor(private readonly server: LspServerSettings, private readonly root: string) {
    this.process = spawn(server.command, server.args ?? [], { cwd: root, env: scrubbedEnv(), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'] })
    this.closed = new Promise(resolve => {
      this.process.once('exit', () => resolve())
      this.process.once('close', () => resolve())
    })
    this.process.stdout!.on('data', (chunk: Buffer) => {
      if (this.failure) return
      try {
        if (this.buffer.length + chunk.length > LIMITS.frameBytes + LIMITS.headerBytes) throw new Error('LSP receive buffer exceeds its byte limit')
        this.buffer = Buffer.concat([this.buffer, chunk])
        this.parseMessages()
      } catch (error) { this.close(error instanceof Error ? error : new Error('Invalid LSP message')) }
    })
    this.process.stdin!.on('error', () => this.close(new Error('LSP input stream failed')))
    this.process.stdout!.on('error', () => this.close(new Error('LSP output stream failed')))
    this.process.on('error', () => this.close(new Error('Configured language server could not start')))
    this.process.on('close', () => this.close(new Error('Language server exited before replying')))
    this.process.unref()
    ;(this.process.stdin as unknown as { unref?(): void }).unref?.()
    ;(this.process.stdout as unknown as { unref?(): void }).unref?.()
  }

  get usable(): boolean { return !this.failure }
  private send(value: unknown): void {
    if (this.failure) throw this.failure
    const frame = frameLspMessage(value)
    if (frame.length > LIMITS.frameBytes) throw new Error('LSP request exceeds its byte limit')
    this.process.stdin!.write(frame)
  }
  private parseMessages(): void {
    while (this.buffer.length) {
      const end = this.buffer.indexOf('\r\n\r\n')
      if (end < 0) { if (this.buffer.length > LIMITS.headerBytes) throw new Error('LSP header exceeds its byte limit'); return }
      if (end > LIMITS.headerBytes) throw new Error('LSP header exceeds its byte limit')
      const lengths = [...this.buffer.subarray(0, end).toString('ascii').matchAll(/^Content-Length:\s*(\d+)\s*$/gim)]
      if (lengths.length !== 1) throw new Error('Invalid LSP Content-Length header')
      const length = Number(lengths[0]![1])
      if (!Number.isSafeInteger(length) || length < 1 || length > LIMITS.frameBytes) throw new Error('LSP frame exceeds its byte limit')
      if (this.buffer.length < end + 4 + length) return
      const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.subarray(end + 4, end + 4 + length)))
      this.buffer = this.buffer.subarray(end + 4 + length)
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') throw new Error('Invalid LSP JSON-RPC message')
      if (typeof message.method === 'string') {
        if (message.id !== undefined) this.respond(message)
        else if (message.method === 'textDocument/publishDiagnostics') this.publishDiagnostics(message.params)
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        if (!message.error && !('result' in message)) throw new Error('Invalid LSP response')
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(`Language server returned an error for request ${message.id}`))
        else pending.resolve(message.result)
      }
    }
  }
  private respond(message: { id: string | number; method: string; params?: { items?: unknown[] } }): void {
    let result: unknown
    if (message.method === 'workspace/configuration') result = Array.isArray(message.params?.items) ? message.params.items.map(() => null) : []
    else if (message.method === 'workspace/workspaceFolders') result = [{ uri: pathToFileURL(this.root).href, name: 'workspace' }]
    else if (message.method === 'workspace/applyEdit') result = { applied: false, failureReason: 'Language-server edits require an explicit version-checked proposal.' }
    else if (['client/registerCapability', 'client/unregisterCapability', 'window/workDoneProgress/create'].includes(message.method)) result = null
    else { this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client method is not supported' } }); return }
    this.send({ jsonrpc: '2.0', id: message.id, result })
  }
  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try { this.send({ jsonrpc: '2.0', id, method, params }) } catch (error) { this.pending.delete(id); reject(error) }
    })
  }
  private forget(uri: string): void {
    this.send({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri } } })
    this.documents.delete(uri)
    this.actions.clear()
    this.diagnostics.delete(uri)
  }
  private publishDiagnostics(params: any): void {
    if (!params || typeof params.uri !== 'string') throw new Error('Invalid LSP diagnostics URI')
    const document = this.documents.get(params.uri)
    if (!document) return
    if (params.version !== undefined && !Number.isInteger(params.version)) throw new Error('Invalid LSP diagnostic version')
    if (params.version !== undefined && params.version !== document.version) return
    const report = diagnosticResult('push', params.version, params.diagnostics, params.version === undefined ? 'unverified' : 'server')
    this.rememberDiagnostics(params.uri, report)
    const waiting = this.diagnosticWait
    if (waiting && waiting.uri === params.uri) { waiting.resolve(structuredClone(report)); this.diagnosticWait = undefined }
  }
  private rememberDiagnostics(uri: string, report: DiagnosticReport): void {
    this.diagnostics.delete(uri)
    this.diagnostics.set(uri, { report, bytes: Buffer.byteLength(JSON.stringify(report)) })
    let bytes = [...this.diagnostics.values()].reduce((sum, value) => sum + value.bytes, 0)
    while (bytes > LIMITS.diagnosticCacheBytes) {
      const oldest = this.diagnostics.keys().next().value!
      bytes -= this.diagnostics.get(oldest)!.bytes; this.diagnostics.delete(oldest)
    }
  }
  private async diagnosticReport(document: Document): Promise<DiagnosticReport> {
    const uri = pathToFileURL(document.path).href
    if (this.pullDiagnostics) {
      const response = await this.request('textDocument/diagnostic', { textDocument: { uri }, identifier: this.pullDiagnostics.identifier }) as { kind?: string; items?: unknown } | null
      if (response?.kind !== 'full') throw new Error('Language server must return a full diagnostic report without a previous result ID')
      const report = diagnosticResult('pull', document.version, response.items, 'request')
      this.rememberDiagnostics(uri, report)
      return report
    }
    const cached = this.diagnostics.get(uri)?.report
    if (cached) return structuredClone({ ...cached, cached: true })
    return new Promise(resolve => { this.diagnosticWait = { uri, resolve } })
  }
  private async renamePreview(input: LspRequest, document: Document, options: LspOptions) {
    if (typeof input.newName !== 'string' || !input.newName.trim() || input.newName.length > 256 || /[\x00-\x1f\x7f]/.test(input.newName)) throw new Error('Rename requires a bounded new name without control characters')
    if (!this.renameProvider) throw new Error('Language server does not support rename previews')
    if (!options.readDocument) throw new Error('Rename previews require a scope-authorized document reader')
    const params = { textDocument: { uri: pathToFileURL(document.path).href }, position: { line: input.line! - 1, character: input.character! - 1 } }
    if (this.renameProvider.prepareProvider && await this.request('textDocument/prepareRename', params) === null) throw new Error('Language server cannot rename this position')
    return this.workspacePreview(() => this.request('textDocument/rename', { ...params, newName: input.newName }), options, { newName: input.newName })
  }
  private async workspacePreview(query: () => Promise<unknown>, options: LspOptions, metadata: Record<string, unknown> = {}) {
    if (!options.readDocument) throw new Error('Workspace previews require a scope-authorized document reader')
    for (let round = 0; round < 3; round++) {
      const before = new Map(this.documents)
      const edits = workspaceTextEdits(await query())
      const targets = new Map<string, { document: Document; edits: TextEdit[] }>()
      let discovered = false
      for (const entry of edits) {
        options.signal?.throwIfAborted()
        const url = new URL(entry.uri)
        if (url.protocol !== 'file:' || url.search || url.hash || url.username || url.password || url.hostname && url.hostname !== 'localhost') throw new Error('Workspace edit target must be a local file URI')
        const requestedPath = fileURLToPath(url)
        const text = await options.readDocument(requestedPath)
        if (text === null) throw new Error('Workspace edit target no longer exists; retry')
        const path = await realpath(requestedPath)
        const uri = pathToFileURL(path).href
        const known = before.get(uri)
        if (known && known.text !== text) throw new Error('Workspace edit source changed during the query; retry')
        const current = known ?? this.synchronize(path, text)
        if (!known) discovered = true
        if (known && entry.version != null && entry.version !== known.version) throw new Error('Workspace edit returned a stale document version; retry')
        const previous = targets.get(path)
        targets.set(path, { document: current, edits: [...(previous?.edits ?? []), ...entry.edits] })
        if ([...targets.values()].reduce((sum, target) => sum + Buffer.byteLength(target.document.text), 0) > LIMITS.openBytes) throw new Error('Workspace edit exceeds the synchronized document budget')
      }
      if ([...targets].some(([path, target]) => this.documents.get(pathToFileURL(path).href)?.version !== target.document.version)) throw new Error('Workspace edit exceeds the synchronized document budget')
      if (discovered) continue
      const files = [...targets].map(([path, target]) => {
        const transformed = applyTextEdits(target.document.text, target.edits)
        return { arguments: { path, expected_hash: target.document.hash, text_edits: transformed.edits }, documentVersion: target.document.version, proposedHash: hash(transformed.content), preview: transformed.preview, lineEndingNormalization: transformed.lineEndingNormalization }
      })
      const result = { status: files.length ? 'proposal-only' : 'no-edits', applyWith: 'edit_file', readBeforeApply: true, atomicity: 'per-file', positionEncoding: 'utf-16', files, ...metadata }
      if (Buffer.byteLength(JSON.stringify(result)) > 32_000) throw new Error('Workspace edit preview exceeds its output budget; no partial preview was produced')
      return result
    }
    throw new Error('Workspace edit scope did not stabilize; no partial preview was produced')
  }
  private actionIdentity(action: Record<string, any>): string {
    const { edit, ...identity } = action
    return hash(JSON.stringify(identity))
  }
  private async queryActions(params: Record<string, unknown>): Promise<Array<Record<string, any>>> {
    const result = await this.request('textDocument/codeAction', params)
    if (result === null) return []
    if (!Array.isArray(result) || result.some(action => !action || typeof action !== 'object' || Array.isArray(action) || typeof action.title !== 'string' || action.kind !== undefined && typeof action.kind !== 'string')) throw new Error('Invalid LSP code action response')
    return result
  }
  private async codeActions(input: LspRequest, document: Document) {
    if (!this.codeActionProvider) throw new Error('Language server does not support code actions')
    const uri = pathToFileURL(document.path).href
    if (![input.line, input.character, input.endLine === undefined ? input.line : input.endLine, input.endCharacter === undefined ? input.character : input.endCharacter].every(value => Number.isInteger(value) && value! > 0)) throw new Error('Code action coordinates must be positive 1-based integers')
    const range = { start: { line: input.line! - 1, character: input.character! - 1 }, end: { line: (input.endLine ?? input.line!) - 1, character: (input.endCharacter ?? input.character!) - 1 } }
    // Reuse the writer's UTF-16 boundary validation without changing the source.
    applyTextEdits(document.text, [{ range, newText: '' }])
    if (input.kind !== undefined && (typeof input.kind !== 'string' || input.kind.length > 256 || /[\x00-\x1f\x7f]/.test(input.kind))) throw new Error('Invalid code action kind')
    const diagnostic = this.diagnostics.get(uri)?.report
    const hints = diagnostic?.items ?? []
    const diagnostics = diagnostic?.versionBinding === 'unverified' ? diagnostic.unverified!.items : hints
    const overlaps = (item: any) => {
      const before = (a: any, b: any) => a.line < b.line || a.line === b.line && a.character < b.character
      return !before(item.range.end, range.start) && !before(range.end, item.range.start)
    }
    const params = { textDocument: { uri }, range, context: { diagnostics: diagnostics.filter(overlaps), ...(input.kind !== undefined ? { only: [input.kind] } : {}), triggerKind: 1 } }
    const actions = await this.queryActions(params)
    this.actions.clear()
    const retained = []
    const listing = randomUUID()
    let bytes = 0, outputBytes = 0
    for (const action of actions) {
      if (input.kind && !(action.kind === input.kind || action.kind?.startsWith(input.kind + '.'))) continue
      const cost = Buffer.byteLength(JSON.stringify(action))
      const id = hash(JSON.stringify([this.generation, listing, uri, document.hash, params, action]))
      const item = { id, title: action.title, kind: action.kind, isPreferred: action.isPreferred === true, status: action.disabled !== undefined ? 'disabled' : action.command !== undefined ? 'command-required' : action.edit !== undefined ? 'edit-preview' : this.codeActionProvider.resolveProvider ? 'resolve-required' : 'unavailable' }
      const outputCost = Buffer.byteLength(JSON.stringify(item)) + 1
      if (retained.length >= 32 || cost > 65_536 || bytes + cost > 262_144 || outputBytes + outputCost > 16_000) continue
      bytes += cost; outputBytes += outputCost
      retained.push(item)
      this.actions.set(id, { uri, sourceHash: document.hash, params, identity: this.actionIdentity(action), action })
    }
    return { status: 'listed', actions: retained, omitted: actions.length - retained.length, truncated: actions.length > retained.length, diagnosticContext: diagnostic?.versionBinding ?? 'none', previewWith: 'lsp', previewOperation: 'code_action_preview', commandsExecuted: false }
  }
  private async codeActionPreview(input: LspRequest, document: Document, options: LspOptions) {
    const selected = input.actionId ? this.actions.get(input.actionId) : undefined
    if (!selected || selected.uri !== pathToFileURL(document.path).href || selected.sourceHash !== document.hash) throw new Error('Code action expired or source changed; list actions again')
    const editable = (action: Record<string, any>) => {
      if (action.disabled !== undefined) throw new Error('Code action is disabled')
      if (action.command !== undefined) throw new Error('Code action requires a command; no partial edit preview was produced')
    }
    editable(selected.action)
    return this.workspacePreview(async () => {
      const candidates = (await this.queryActions(selected.params)).filter(action => this.actionIdentity(action) === selected.identity)
      if (candidates.length !== 1) throw new Error('Code action changed or is ambiguous; list actions again')
      let action = candidates[0]!
      editable(action)
      if (action.edit === undefined && this.codeActionProvider?.resolveProvider) {
        const resolved = await this.request('codeAction/resolve', action) as Record<string, any> | null
        if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved) || this.actionIdentity(resolved) !== this.actionIdentity(action)) throw new Error('Invalid resolved code action')
        action = resolved
        editable(action)
      }
      if (action.edit === undefined) throw new Error('Code action has no text edit preview')
      return action.edit
    }, options, { actionId: input.actionId, title: selected.action.title, commandsExecuted: false })
  }
  private synchronize(path: string, text: string): Document {
    if (Buffer.byteLength(text) > LIMITS.documentBytes) throw new Error('LSP document exceeds its byte limit; use bounded file reads')
    const uri = pathToFileURL(path).href
    const previous = this.documents.get(uri)
    if (previous?.text === text) return previous
    if (previous && !this.syncChanges) throw new Error('Language server does not support document change synchronization; retry with a fresh connection')
    // Versions never repeat within a connection, including after eviction/reopen.
    if (this.nextDocumentVersion >= 2_147_483_647) throw new Error('LSP document version limit reached; retry with a fresh connection')
    const document = { path, text, hash: hash(text), version: ++this.nextDocumentVersion }
    this.diagnostics.clear()
    this.actions.clear()
    let bytes = Buffer.byteLength(text)
    for (const [otherUri, other] of this.documents) if (otherUri !== uri) bytes += Buffer.byteLength(other.text)
    while ((this.documents.size >= LIMITS.documents && !previous) || bytes > LIMITS.openBytes) {
      const oldest = [...this.documents.keys()].find(key => key !== uri)
      if (!oldest) throw new Error('LSP open-document budget exceeded')
      bytes -= Buffer.byteLength(this.documents.get(oldest)!.text); this.forget(oldest)
    }
    if (previous) this.send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version: document.version }, contentChanges: [{ text }] } })
    else this.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: languageIdFor(path, this.server), version: document.version, text } } })
    this.documents.set(uri, document)
    return document
  }
  async run(input: LspRequest, options: LspOptions, timeoutMs: number) {
    if (this.queued >= LIMITS.queued) throw new Error('LSP request queue limit reached')
    this.queued++
    const execute = async () => {
      if (options.signal?.aborted) {
        if (!this.initialized) this.close(new Error('LSP request cancelled before initialization'))
        options.signal.throwIfAborted()
      }
      if (this.idle) clearTimeout(this.idle)
      const expired = new Promise<never>((_, reject) => { this.rejectActive = reject })
      const abort = () => this.close(options.signal?.reason instanceof Error ? options.signal.reason : new Error('LSP request cancelled'))
      const timer = setTimeout(() => this.close(new Error(`LSP request timed out after ${timeoutMs}ms`)), timeoutMs)
      options.signal?.addEventListener('abort', abort, { once: true })
      const work = async () => {
        options.signal?.throwIfAborted()
        if (this.failure) throw this.failure
        if (!this.initialized) {
          const initialized = await this.request('initialize', { processId: null, rootUri: pathToFileURL(this.root).href, initializationOptions: this.server.initializationOptions, capabilities: { general: { positionEncodings: ['utf-16'] }, workspace: { applyEdit: false, workspaceEdit: { documentChanges: true, resourceOperations: [], failureHandling: 'abort', normalizesLineEndings: true } }, textDocument: { codeAction: { dynamicRegistration: false, codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } }, isPreferredSupport: true, disabledSupport: true, dataSupport: true, resolveSupport: { properties: ['edit'] }, honorsChangeAnnotations: false }, rename: { dynamicRegistration: false, prepareSupport: true, honorsChangeAnnotations: false }, publishDiagnostics: { versionSupport: true, relatedInformation: false }, diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false } } }, workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: 'workspace' }] }) as { capabilities?: { textDocumentSync?: number | { change?: number }; positionEncoding?: string; renameProvider?: boolean | { prepareProvider?: boolean }; codeActionProvider?: boolean | { resolveProvider?: boolean }; diagnosticProvider?: { identifier?: string } } } | null
          if (initialized?.capabilities?.positionEncoding && initialized.capabilities.positionEncoding !== 'utf-16') throw new Error('Language server selected an unsupported position encoding')
          const rename = initialized?.capabilities?.renameProvider
          if (rename === true || rename && typeof rename === 'object') this.renameProvider = rename === true ? {} : rename
          const codeAction = initialized?.capabilities?.codeActionProvider
          if (codeAction === true || codeAction && typeof codeAction === 'object') this.codeActionProvider = codeAction === true ? {} : codeAction
          const synchronization = initialized?.capabilities?.textDocumentSync
          const change = typeof synchronization === 'number' ? synchronization : synchronization?.change
          this.syncChanges = change === 1 || change === 2
          if (initialized?.capabilities?.diagnosticProvider) {
            const identifier = initialized.capabilities.diagnosticProvider.identifier
            if (identifier !== undefined && (typeof identifier !== 'string' || identifier.length > 2048)) throw new Error('Invalid LSP diagnostic provider identifier')
            this.pullDiagnostics = { identifier }
          }
          this.send({ jsonrpc: '2.0', method: 'initialized', params: {} }); this.initialized = true
        }
        for (const [uri, document] of [...this.documents]) {
          options.signal?.throwIfAborted()
          if (document.path === input.filePath) continue
          if (!options.readDocument) { this.forget(uri); continue }
          const current = await options.readDocument(document.path)
          if (current === null) this.forget(uri)
          else this.synchronize(document.path, current)
        }
        if (input.operation === 'diagnostics' && !this.pullDiagnostics && input.filePath) {
          const uri = pathToFileURL(input.filePath).href
          if (this.documents.has(uri) && !this.diagnostics.has(uri)) this.forget(uri)
        }
        const document = input.filePath && input.fileContent !== undefined ? this.synchronize(input.filePath, input.fileContent) : undefined
        const uri = document ? pathToFileURL(document.path).href : undefined
        const position = { line: (input.line ?? 1) - 1, character: (input.character ?? 1) - 1 }
        const methods = { definition: 'textDocument/definition', references: 'textDocument/references', hover: 'textDocument/hover', document_symbols: 'textDocument/documentSymbol', workspace_symbols: 'workspace/symbol', diagnostics: 'textDocument/diagnostic', rename_preview: 'textDocument/rename', code_actions: 'textDocument/codeAction', code_action_preview: 'codeAction/resolve' }
        const params = input.operation === 'workspace_symbols' ? { query: input.query ?? '' } : { textDocument: { uri }, position, ...(input.operation === 'references' ? { context: { includeDeclaration: true } } : {}) }
        const result = input.operation === 'code_actions' ? await this.codeActions(input, document!) : input.operation === 'code_action_preview' ? await this.codeActionPreview(input, document!, options) : input.operation === 'rename_preview' ? await this.renamePreview(input, document!, options) : input.operation === 'diagnostics' ? await this.diagnosticReport(document!) : await this.request(methods[input.operation], params)
        options.signal?.throwIfAborted()
        if (this.failure) throw this.failure
        return { result, server: this.server.name, generation: this.generation, workspace: this.root, document: document ? { path: document.path, version: document.version, hash: document.hash } : null }
      }
      try { return await Promise.race([work(), expired]) } catch (error) {
        this.close(error instanceof Error ? error : new Error('LSP request failed'))
        throw error
      } finally {
        this.rejectActive = undefined
        this.diagnosticWait = undefined
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort)
        if (!this.failure) { this.idle = setTimeout(() => this.close(new Error('LSP idle connection expired')), 30_000); this.idle.unref() }
      }
    }
    const result = this.tail.then(execute).finally(() => { this.queued-- })
    this.tail = result.catch(() => undefined)
    if (!options.signal) return result
    const signal = options.signal
    return new Promise<Awaited<typeof result>>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('LSP request cancelled')) }
      signal.addEventListener('abort', abort, { once: true })
      result.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
      if (signal.aborted) abort()
    })
  }
  close(reason = new Error('LSP session closed')): Promise<void> {
    if (!this.failure) {
      this.failure = reason
      this.rejectActive?.(reason)
      if (this.idle) clearTimeout(this.idle)
      for (const pending of this.pending.values()) pending.reject(reason)
      this.actions.clear(); this.pending.clear(); this.documents.clear(); this.diagnostics.clear(); this.diagnosticWait = undefined; this.buffer = Buffer.alloc(0)
      try { signalProcessGroup(this.process, 'SIGKILL') } catch { /* already exited */ }
      this.process.stdin?.destroy(); this.process.stdout?.destroy()
    }
    return this.closed
  }
}

const sessions = new WeakMap<object, { configuration: string; connections: Map<string, LspConnection> }>()
/** Starts termination synchronously and resolves when the owned server process exits. */
export function closeLspSession(owner: object): Promise<void> {
  const session = sessions.get(owner)
  if (!session) return Promise.resolve()
  sessions.delete(owner)
  return Promise.all([...session.connections.values()].map(connection => connection.close())).then(() => undefined)
}

/** Configured servers are trusted executables, not filesystem/network-sandboxed plugins. */
export async function runLspRequest(settings: DeepSeekSettings, request: LspRequest, options: LspOptions = {}) {
  options.signal?.throwIfAborted()
  const lsp = structuredClone(settings.lsp)
  if (!request.filePath && request.operation !== 'workspace_symbols') throw new Error('A file path is required for this LSP operation.')
  const server = request.filePath ? findLspServer({ lsp }, request.filePath) : lsp?.servers?.[0]
  if (!server) throw new Error('No user-configured language server supports this file. Configure lsp.servers in User settings.')
  const initialization = server.initializationOptions
  if (initialization !== undefined && (!initialization || typeof initialization !== 'object' || Array.isArray(initialization) || Buffer.byteLength(JSON.stringify(initialization)) > 65_536)) throw new Error('LSP initializationOptions must be a JSON object within 65536 UTF-8 bytes')
  const root = await realpath(request.workspacePath)
  options.signal?.throwIfAborted()
  const configuration = hash(JSON.stringify(lsp))
  let session = options.owner ? sessions.get(options.owner) : undefined
  if (session && session.configuration !== configuration) { await closeLspSession(options.owner!); session = undefined }
  if (!session) {
    session = { configuration, connections: new Map() }
    if (options.owner) sessions.set(options.owner, session)
  }
  const key = JSON.stringify([root, server])
  let connection = session.connections.get(key)
  if (!connection?.usable) {
    if (session.connections.size >= LIMITS.servers) {
      const first = session.connections.keys().next().value!
      session.connections.get(first)!.close(); session.connections.delete(first)
    }
    connection = new LspConnection(server, root); session.connections.set(key, connection)
  }
  const timeoutMs = lsp?.timeoutMs ?? 10_000
  try { return { ...await connection.run(request, options, timeoutMs), configuration } }
  finally { if (!options.owner) connection.close() }
}
