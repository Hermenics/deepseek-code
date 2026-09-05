import { Script, createContext } from 'node:vm'
import type { WorkflowMeta, WorkflowPhaseMeta } from './types.js'

const MAX_SOURCE_BYTES = 256 * 1024
const WORKFLOW_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const META_PREFIX = /^\s*export\s+const\s+meta\s*=\s*/

export interface ParsedWorkflowSource {
  meta: WorkflowMeta
  body: string
}

export function isWorkflowName(value: string): boolean {
  return WORKFLOW_NAME.test(value)
}

function validateMeta(value: unknown): WorkflowMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workflow metadata must be a plain object literal')
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || !isWorkflowName(record.name)) {
    throw new Error('Invalid workflow name; use 1-64 lowercase letters, numbers, or hyphens')
  }
  if (record.description !== undefined && typeof record.description !== 'string') throw new Error('Workflow description must be a string')
  if (record.whenToUse !== undefined && typeof record.whenToUse !== 'string') throw new Error('Workflow whenToUse must be a string')
  const phases = validatePhases(record.phases)
  return {
    name: record.name,
    ...(record.description ? { description: record.description } : {}),
    ...(record.whenToUse ? { whenToUse: record.whenToUse } : {}),
    ...(phases.length ? { phases } : {}),
  }
}

/** Accepts `['Scan']` or `[{ title: 'Scan', detail: '…' }]` and normalises both shapes. */
function validatePhases(value: unknown): WorkflowPhaseMeta[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Workflow phases must be an array')
  return value.map(entry => {
    if (typeof entry === 'string') {
      if (!entry.trim()) throw new Error('Workflow phase title must be a non-empty string')
      return { title: entry.trim() }
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Workflow phase must be a string or an object')
    const phase = entry as Record<string, unknown>
    if (typeof phase.title !== 'string' || !phase.title.trim()) throw new Error('Workflow phase title must be a non-empty string')
    if (phase.detail !== undefined && typeof phase.detail !== 'string') throw new Error('Workflow phase detail must be a string')
    if (phase.model !== undefined && typeof phase.model !== 'string') throw new Error('Workflow phase model must be a string')
    return { title: phase.title.trim(), ...(phase.detail ? { detail: phase.detail } : {}), ...(phase.model ? { model: phase.model } : {}) }
  })
}

const PLAIN_LITERAL_ERROR = 'Workflow metadata must be a plain object literal'
const MAX_LITERAL_DEPTH = 100

/**
 * Checks the small JavaScript-literal subset accepted for metadata before the value reaches vm.
 * The vm has no host capabilities, but its standard intrinsics would otherwise still allow
 * expressions such as `Object.assign(...)`, spreads, calls and template interpolation.
 */
class LiteralSyntaxParser {
  private index: number

  constructor(private readonly source: string, start: number) {
    this.index = start
  }

  parseObjectEnd(): number {
    this.skipTrivia()
    if (this.source[this.index] !== '{') throw new Error(PLAIN_LITERAL_ERROR)
    this.parseObject(true, 0)
    this.skipTrivia()
    return this.index
  }

  private parseObject(root = false, depth = 0): void {
    if (depth > MAX_LITERAL_DEPTH) throw new Error(PLAIN_LITERAL_ERROR)
    if (!this.consume('{')) throw new Error(PLAIN_LITERAL_ERROR)
    this.skipTrivia()
    if (this.consume('}')) return
    while (true) {
      this.parseKey()
      this.skipTrivia()
      if (!this.consume(':')) throw new Error(PLAIN_LITERAL_ERROR)
      this.parseValue(depth)
      this.skipTrivia()
      if (this.consume('}')) return
      if (!this.consume(',')) {
        if (root && this.index >= this.source.length) throw new Error('Workflow metadata object is not closed')
        throw new Error(PLAIN_LITERAL_ERROR)
      }
      this.skipTrivia()
      if (this.consume('}')) return
    }
  }

  private parseArray(depth = 0): void {
    if (depth > MAX_LITERAL_DEPTH) throw new Error(PLAIN_LITERAL_ERROR)
    if (!this.consume('[')) throw new Error(PLAIN_LITERAL_ERROR)
    this.skipTrivia()
    if (this.consume(']')) return
    while (true) {
      this.parseValue(depth)
      this.skipTrivia()
      if (this.consume(']')) return
      if (!this.consume(',')) throw new Error(PLAIN_LITERAL_ERROR)
      this.skipTrivia()
      if (this.consume(']')) return
    }
  }

  private parseValue(depth = 0): void {
    if (depth > MAX_LITERAL_DEPTH) throw new Error(PLAIN_LITERAL_ERROR)
    this.skipTrivia()
    const char = this.source[this.index]
    if (char === '"' || char === "'") { this.parseString(); return }
    if (char === '{') { this.parseObject(false, depth + 1); return }
    if (char === '[') { this.parseArray(depth + 1); return }
    if (char === '-' || (char !== undefined && /[0-9]/.test(char))) { this.parseNumber(); return }
    if (char !== undefined && /[A-Za-z_$]/.test(char)) {
      const identifier = this.parseIdentifier()
      if (identifier === 'true' || identifier === 'false' || identifier === 'null') return
    }
    throw new Error(PLAIN_LITERAL_ERROR)
  }

  private parseKey(): void {
    this.skipTrivia()
    const char = this.source[this.index]
    if (char === '"' || char === "'") { this.parseString(); return }
    if (char !== undefined && /[A-Za-z_$]/.test(char)) { this.parseIdentifier(); return }
    if (char !== undefined && /[0-9]/.test(char)) { this.parseNumber(); return }
    throw new Error(PLAIN_LITERAL_ERROR)
  }

  private parseString(): void {
    const quote = this.source[this.index++]
    let escaped = false
    while (this.index < this.source.length) {
      const char = this.source[this.index++]!
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === quote) return
      if (char === '\n' || char === '\r') throw new Error(PLAIN_LITERAL_ERROR)
    }
    throw new Error(PLAIN_LITERAL_ERROR)
  }

  private parseNumber(): void {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.source.slice(this.index))
    if (!match) throw new Error(PLAIN_LITERAL_ERROR)
    this.index += match[0].length
  }

  private parseIdentifier(): string {
    const start = this.index
    this.index++
    while (this.index < this.source.length && /[A-Za-z0-9_$]/.test(this.source[this.index]!)) this.index++
    return this.source.slice(start, this.index)
  }

  private skipTrivia(): void {
    while (this.index < this.source.length) {
      const char = this.source[this.index]
      if (char && /\s/.test(char)) { this.index++; continue }
      if (char === '/' && this.source[this.index + 1] === '/') {
        this.index += 2
        while (this.index < this.source.length && this.source[this.index] !== '\n' && this.source[this.index] !== '\r') this.index++
        continue
      }
      if (char === '/' && this.source[this.index + 1] === '*') {
        const end = this.source.indexOf('*/', this.index + 2)
        if (end < 0) throw new Error(PLAIN_LITERAL_ERROR)
        this.index = end + 2
        continue
      }
      return
    }
  }

  private consume(value: string): boolean {
    if (!this.source.startsWith(value, this.index)) return false
    this.index += value.length
    return true
  }
}

function findObjectEnd(source: string, start: number): number {
  try {
    return new LiteralSyntaxParser(source, start).parseObjectEnd()
  } catch (error) {
    if (error instanceof RangeError) throw new Error(PLAIN_LITERAL_ERROR)
    throw error
  }
}

/**
 * `meta` is documented as a plain JavaScript literal, so `JSON.parse` rejects the ordinary
 * form (`{ name: 'x' }`) that every caller actually writes. Evaluating it in an empty vm
 * context with code generation disabled accepts the literal without granting it any
 * capability: with no globals bound, anything that is not a literal simply fails.
 */
function evaluateMetaLiteral(literal: string): unknown {
  const context = createContext(Object.create(null) as object, { codeGeneration: { strings: false, wasm: false } })
  return new Script(`(${literal})`).runInContext(context, { timeout: 1_000 })
}

export function parseWorkflowSource(source: string, fallbackName?: string): ParsedWorkflowSource {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Workflow script cannot be empty')
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new Error(`Workflow script exceeds ${MAX_SOURCE_BYTES} bytes`)
  const prefix = META_PREFIX.exec(source)
  if (!prefix) {
    if (!fallbackName) throw new Error('Workflow script must start with export const meta or provide a name')
    return { meta: validateMeta({ name: fallbackName }), body: source }
  }

  const objectStart = prefix[0].length
  if (source[objectStart] !== '{') throw new Error(PLAIN_LITERAL_ERROR)
  let objectEnd: number
  try {
    objectEnd = findObjectEnd(source, objectStart)
  } catch (error) {
    if (error instanceof RangeError) throw new Error(PLAIN_LITERAL_ERROR)
    throw error
  }
  let meta: unknown
  try { meta = evaluateMetaLiteral(source.slice(objectStart, objectEnd)) } catch {
    throw new Error(PLAIN_LITERAL_ERROR)
  }
  let bodyStart = objectEnd
  while (/\s/.test(source[bodyStart] ?? '')) bodyStart++
  if (source[bodyStart] === ';') bodyStart++
  return { meta: validateMeta(meta), body: source.slice(bodyStart) }
}

export function formatWorkflowSource(meta: WorkflowMeta, body: string): string {
  const validated = validateMeta(meta)
  return `export const meta = ${JSON.stringify(validated)};\n${body.trimStart()}`
}
