import type { WorkflowMeta } from './types.js'

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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workflow metadata must be a JSON-compatible object')
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || !isWorkflowName(record.name)) {
    throw new Error('Invalid workflow name; use 1-64 lowercase letters, numbers, or hyphens')
  }
  if (record.description !== undefined && typeof record.description !== 'string') throw new Error('Workflow description must be a string')
  return { name: record.name, ...(record.description ? { description: record.description } : {}) }
}

function findObjectEnd(source: string, start: number): number {
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = start; index < source.length; index++) {
    const char = source[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"') { quote = char; continue }
    if (char === '{') depth++
    if (char === '}' && --depth === 0) return index + 1
  }
  throw new Error('Workflow metadata object is not closed')
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
  if (source[objectStart] !== '{') throw new Error('Workflow metadata must be a JSON-compatible object')
  const objectEnd = findObjectEnd(source, objectStart)
  let meta: unknown
  try { meta = JSON.parse(source.slice(objectStart, objectEnd)) } catch {
    throw new Error('Workflow metadata must be a JSON-compatible object')
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
