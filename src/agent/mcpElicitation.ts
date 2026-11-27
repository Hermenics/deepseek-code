import { randomUUID } from 'node:crypto'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ElicitRequestFormParams, ElicitRequestParams, ElicitResult } from '@modelcontextprotocol/sdk/types.js'

export type McpElicitationSchema = ElicitRequestFormParams['requestedSchema']
export type McpElicitationContent = NonNullable<ElicitResult['content']>

/** Safe form request forwarded to an interactive host. Values are never added to agent history here. */
export interface McpElicitationRequest {
  serverName: string
  message: string
  requestedSchema: McpElicitationSchema
}

export type McpElicitationResponse =
  | { action: 'accept'; content: McpElicitationContent }
  | { action: 'decline' }
  | { action: 'cancel' }

export interface McpElicitationRedaction {
  hasValues(): boolean
  redactText(value: string): string
  redactTextBlocks(values: readonly string[]): string
  redactValue(value: unknown): unknown
}

export interface McpElicitationRedactionScope extends McpElicitationRedaction {
  close(): void
}

export interface McpElicitationRedactionTracker {
  begin(): McpElicitationRedactionScope
  record(content: unknown): void
  dispose(): void
}

export type McpElicitationHandler = (
  request: McpElicitationRequest,
  signal: AbortSignal,
) => Promise<McpElicitationResponse>

type JsonRecord = Record<string, unknown>

const REDACTED_ELICITATION_VALUE = '[redacted MCP elicitation value]'
const MAX_REDACTION_STORAGE_BYTES = 64 * 1024
const MAX_REDACTION_VALUE_COUNT = 1024
const MAX_REDACTION_TOKEN_COUNT = 2048
const REDACTION_CAPACITY_ERROR = 'MCP elicitation redaction capacity exceeded; the response was not sent to the server.'

interface ElicitationValues {
  strings: Set<string>
  numbers: Set<number>
  booleans: Set<boolean>
  textTokens: Set<string>
  base64Tokens: Set<string>
  textBytes: number
}

function emptyElicitationValues(): ElicitationValues {
  return { strings: new Set(), numbers: new Set(), booleans: new Set(), textTokens: new Set(), base64Tokens: new Set(), textBytes: 0 }
}

function addRedactionToken(token: string, values: ElicitationValues, tokens = values.textTokens): void {
  if (!token || tokens.has(token)) return
  const bytes = Buffer.byteLength(token, 'utf8')
  if (values.textTokens.size + values.base64Tokens.size >= MAX_REDACTION_TOKEN_COUNT || values.textBytes + bytes > MAX_REDACTION_STORAGE_BYTES) {
    throw new Error(REDACTION_CAPACITY_ERROR)
  }
  tokens.add(token)
  values.textBytes += bytes
}

function addBase64RedactionTokens(value: string, values: ElicitationValues): void {
  const base64 = Buffer.from(value, 'utf8').toString('base64')
  const base64Url = base64.replace(/\+/g, '-').replace(/\//g, '_')
  for (const token of new Set([base64, base64.replace(/=+$/, ''), base64Url, base64Url.replace(/=+$/, '')])) {
    addRedactionToken(token, values, values.base64Tokens)
  }
}

function collectElicitationValues(value: unknown, values: ElicitationValues): void {
  if (typeof value === 'string') {
    if (value.length === 0) return
    values.strings.add(value)
    addRedactionToken(value, values)
    const escaped = JSON.stringify(value).slice(1, -1)
    addRedactionToken(escaped, values)
    try {
      addRedactionToken(encodeURIComponent(value), values)
    } catch {
      // encodeURIComponent rejects lone surrogates; the raw and JSON forms remain covered.
    }
    // Also cover form-urlencoded values, which encode some punctuation differently and use + for spaces.
    const formEncoded = new URLSearchParams([['value', value]]).toString().slice('value='.length)
    addRedactionToken(formEncoded, values)
    addBase64RedactionTokens(value, values)
    if (values.strings.size + values.numbers.size + values.booleans.size > MAX_REDACTION_VALUE_COUNT) {
      throw new Error(REDACTION_CAPACITY_ERROR)
    }
    return
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    values.numbers.add(value)
    addRedactionToken(String(value), values)
    addBase64RedactionTokens(String(value), values)
    if (values.strings.size + values.numbers.size + values.booleans.size > MAX_REDACTION_VALUE_COUNT) {
      throw new Error(REDACTION_CAPACITY_ERROR)
    }
    return
  }
  if (typeof value === 'boolean') {
    values.booleans.add(value)
    addRedactionToken(String(value), values)
    addBase64RedactionTokens(String(value), values)
    if (values.strings.size + values.numbers.size + values.booleans.size > MAX_REDACTION_VALUE_COUNT) {
      throw new Error(REDACTION_CAPACITY_ERROR)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectElicitationValues(item, values)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectElicitationValues(item, values)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function uniqueBoundarySeparator(value: string): string {
  const common = '\0mcp-elicitation-boundary\0'
  if (!value.includes(common)) return common
  let separator: string
  do { separator = `\0mcp-${randomUUID()}\0` } while (value.includes(separator))
  return separator
}

/** Retains accepted values for this client's lifetime so later echoes remain redacted. */
export function createMcpElicitationRedactionTracker(): McpElicitationRedactionTracker {
  const retained = emptyElicitationValues()
  const activeScopes = new Set<object>()
  let disposed = false
  let insensitiveMatcher: RegExp | undefined
  let base64Matcher: RegExp | undefined
  let blockInsensitiveMatcher: RegExp | undefined
  let blockInsensitiveSeparator: string | undefined
  let blockBase64Matcher: RegExp | undefined
  let blockBase64Separator: string | undefined

  const clearRetained = () => {
    retained.strings.clear()
    retained.numbers.clear()
    retained.booleans.clear()
    retained.textTokens.clear()
    retained.base64Tokens.clear()
    retained.textBytes = 0
    insensitiveMatcher = undefined
    base64Matcher = undefined
    blockInsensitiveMatcher = undefined
    blockInsensitiveSeparator = undefined
    blockBase64Matcher = undefined
    blockBase64Separator = undefined
  }

  const redactString = (value: string) => {
    if (!value) return value
    let redacted = value
    if (retained.base64Tokens.size > 0) {
      const alternatives = [...new Set([...retained.base64Tokens].map(token => token.replace(/=+$/, '')))]
        .sort((left, right) => right.length - left.length).map(escapeRegExp).join('|')
      // Normalize padded and unpadded forms, then consume at most two padding characters as part of the full token.
      base64Matcher ??= new RegExp(`(?<![A-Za-z0-9+/_-])(?:${alternatives})={0,2}(?![A-Za-z0-9+/_=-])`, 'gu')
      base64Matcher.lastIndex = 0
      redacted = redacted.replace(base64Matcher, REDACTED_ELICITATION_VALUE)
    }
    if (retained.textTokens.size > 0) {
      const alternatives = [...retained.textTokens].sort((left, right) => right.length - left.length).map(escapeRegExp).join('|')
      insensitiveMatcher ??= new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])(?:${alternatives})(?![\\p{L}\\p{N}\\p{M}_])`, 'giu')
      insensitiveMatcher.lastIndex = 0
      redacted = redacted.replace(insensitiveMatcher, REDACTED_ELICITATION_VALUE)
    }
    return redacted
  }

  const redactTextBlocks = (blocks: readonly string[]) => {
    if (retained.textTokens.size + retained.base64Tokens.size === 0) return blocks.join('\n')
    if (blocks.length <= 1) return redactString(blocks[0] ?? '')
    const separator = uniqueBoundarySeparator(blocks.join(''))
    let redacted = blocks.join(separator)
    const tokenPattern = (token: string) => token.split('').map(escapeRegExp).join(`(?:${escapeRegExp(separator)})*`)
    if (retained.base64Tokens.size > 0) {
      const alternatives = [...new Set([...retained.base64Tokens].map(token => token.replace(/=+$/, '')))]
        .sort((left, right) => right.length - left.length).map(tokenPattern).join('|')
      if (!blockBase64Matcher || blockBase64Separator !== separator) {
        blockBase64Matcher = new RegExp(`(?<![A-Za-z0-9+/_-])(?:${alternatives})={0,2}(?![A-Za-z0-9+/_=-])`, 'gu')
        blockBase64Separator = separator
      }
      blockBase64Matcher.lastIndex = 0
      redacted = redacted.replace(blockBase64Matcher, REDACTED_ELICITATION_VALUE)
    }
    if (retained.textTokens.size > 0) {
      const alternatives = [...retained.textTokens].sort((left, right) => right.length - left.length).map(tokenPattern).join('|')
      if (!blockInsensitiveMatcher || blockInsensitiveSeparator !== separator) {
        blockInsensitiveMatcher = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])(?:${alternatives})(?![\\p{L}\\p{N}\\p{M}_])`, 'giu')
        blockInsensitiveSeparator = separator
      }
      blockInsensitiveMatcher.lastIndex = 0
      redacted = redacted.replace(blockInsensitiveMatcher, REDACTED_ELICITATION_VALUE)
    }
    return redacted.split(separator).join('\n')
  }
  const redactNested = (value: unknown): unknown => {
    if (typeof value === 'string') return redactString(value)
    if (typeof value === 'number') return retained.numbers.has(value) ? REDACTED_ELICITATION_VALUE : value
    if (typeof value === 'boolean') return retained.booleans.has(value) ? REDACTED_ELICITATION_VALUE : value
    if (Array.isArray(value)) return value.map(redactNested)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactString(key), redactNested(item)]))
    }
    return value
  }

  return {
    begin() {
      if (disposed) throw new Error('MCP elicitation redaction is no longer available for this client.')
      const scope = {}
      activeScopes.add(scope)
      let closed = false
      return {
        hasValues: () => retained.textTokens.size + retained.base64Tokens.size > 0,
        redactText: redactString,
        redactTextBlocks,
        redactValue: redactNested,
        close() {
          if (closed) return
          closed = true
          activeScopes.delete(scope)
          if (disposed && activeScopes.size === 0) clearRetained()
        },
      }
    },
    record(content) {
      if (disposed) throw new Error('MCP elicitation redaction is no longer available for this client.')
      const values = emptyElicitationValues()
      collectElicitationValues(content, values)
      const addedTokens = [...values.textTokens].filter(value => !retained.textTokens.has(value))
      const addedBase64Tokens = [...values.base64Tokens].filter(value => !retained.base64Tokens.has(value))
      const addedValues = values.strings.size - [...values.strings].filter(value => retained.strings.has(value)).length +
        values.numbers.size - [...values.numbers].filter(value => retained.numbers.has(value)).length +
        values.booleans.size - [...values.booleans].filter(value => retained.booleans.has(value)).length
      const addedBytes = [...addedTokens, ...addedBase64Tokens].reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), 0)
      if (retained.strings.size + retained.numbers.size + retained.booleans.size + addedValues > MAX_REDACTION_VALUE_COUNT ||
        retained.textTokens.size + retained.base64Tokens.size + addedTokens.length + addedBase64Tokens.length > MAX_REDACTION_TOKEN_COUNT ||
        retained.textBytes + addedBytes > MAX_REDACTION_STORAGE_BYTES) {
        throw new Error(REDACTION_CAPACITY_ERROR)
      }
      for (const value of values.strings) retained.strings.add(value)
      for (const value of values.numbers) retained.numbers.add(value)
      for (const value of values.booleans) retained.booleans.add(value)
      for (const value of values.textTokens) retained.textTokens.add(value)
      for (const value of values.base64Tokens) retained.base64Tokens.add(value)
      retained.textBytes += addedBytes
      insensitiveMatcher = undefined
      base64Matcher = undefined
      blockInsensitiveMatcher = undefined
      blockInsensitiveSeparator = undefined
      blockBase64Matcher = undefined
      blockBase64Separator = undefined
    },
    dispose() {
      disposed = true
      if (activeScopes.size === 0) clearRetained()
    },
  }
}

const SENSITIVE_FORM_TEXT = /password|pass[\s_-]?(?:code|phrase|key)|secret|(?:access|refresh|bearer|session)?[\s_-]?token|credential|api[\s_-]?key|private[\s_-]?key|(?:authorization|authorisation)[\s_-]?(?:code|token)|auth[\s_-]?(?:code|token)|oauth[\s_-]?(?:(?:authorization|authorisation)[\s_-]?)?(?:code|token)|(?:session|auth(?:entication)?|login|access|refresh)?[\s_-]?cookie|cookie[\s_-]?(?:value|header|jar)|(?:credit|debit|payment)[\s_-]?card|card[\s_-]?(?:number|no\.?|pan)|cvv|cvc|ssn|social[\s_-]?security|(?:recovery|backup)[\s_-]?(?:codes?|phrases?)|(?:seed[\s_-]?(?:phrase|words?)|mnemonics?)|(?:one[\s_-]?time|verification|security)[\s_-]?(?:password|passcode|code|token)|(?:otp|authenticator|authentication)[\s_-]?(?:password|passcode|code|token)?|(?:mfa|2fa|multi[\s_-]?factor(?:[\s_-]?(?:auth|authentication))?|two[\s_-]?factor(?:[\s_-]?(?:auth|authentication))?)[\s_:/-]?(?:(?:recovery|backup|verification|authentication|authenticator|auth|one[\s_-]?time)[\s_:/-]?)?(?:pass[\s_-]?codes?|passwords?|codes?|tokens?|otps?)\b|(?:recovery|backup)[\s_-]?codes?[\s_-]?(?:for[\s_-]?)?(?:mfa|2fa|multi[\s_-]?factor(?:[\s_-]?(?:auth|authentication))?|two[\s_-]?factor(?:[\s_-]?(?:auth|authentication))?)|(?:codes?|passcodes?|tokens?)[\s_-]?(?:for[\s_-]?)?(?:mfa|2fa|multi[\s_-]?factor|two[\s_-]?factor)\b|\bpin\b/i
const FORM_SCHEMA_KEYS = new Set(['type', 'properties', 'required'])
const COMMON_PROPERTY_KEYS = ['type', 'title', 'description', 'default'] as const

function isRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false
  const indexes = Object.getOwnPropertyNames(value).filter(key => {
    const index = Number(key)
    return Number.isInteger(index) && index >= 0 && index < value.length && String(index) === key
  })
  return indexes.length === value.length
}

function isStringArray(value: unknown): value is string[] {
  return isDenseArray(value) && value.every(item => typeof item === 'string')
}

function validEnum(value: unknown, schema: JsonRecord): boolean {
  if (Array.isArray(schema.enum)) return schema.enum.includes(value)
  if (Array.isArray(schema.oneOf)) return schema.oneOf.some(option => isRecord(option) && option.const === value)
  return true
}

function arrayChoices(schema: JsonRecord): string[] | undefined {
  if (!isRecord(schema.items)) return undefined
  const items = schema.items
  if (items.type !== undefined && items.type !== 'string') return undefined
  if (items.type === 'string' && isStringArray(items.enum)) return items.enum
  // MCP's titled multi-select form uses `items.anyOf` without `items.type`.
  if (isDenseArray(items.anyOf) && items.anyOf.every(option => isRecord(option) && typeof option.const === 'string')) {
    return items.anyOf.map(option => (option as JsonRecord).const as string)
  }
  return undefined
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false

  const offsetHour = match[5] === undefined ? 0 : Number(match[5])
  const offsetMinute = match[6] === undefined ? 0 : Number(match[6])
  return validDate(match[1]!) && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59 && Number.isFinite(Date.parse(value))
}

function validEmail(value: string): boolean {
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return false
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  const atom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/
  if (local.length > 64 || /\s/.test(local) || local.split('.').some(part => !atom.test(part))) return false
  if (!domain || domain.length > 253 || /\s/.test(domain)) return false
  const labels = domain.split('.')
  return labels.length >= 2 && labels.every(label => label.length > 0 && label.length <= 63 &&
    /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u.test(label))
}

function validFormat(value: string, format: unknown): boolean {
  if (format === undefined) return true
  if (format === 'date') return validDate(value)
  if (format === 'date-time') return validDateTime(value)
  if (format === 'email') return validEmail(value)
  if (format === 'uri') {
    try { return new URL(value).protocol !== '' }
    catch { return false }
  }
  return false
}

function validValue(value: unknown, schema: JsonRecord): boolean {
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return false
      const length = [...value].length
      if (typeof schema.minLength === 'number' && length < schema.minLength) return false
      if (typeof schema.maxLength === 'number' && length > schema.maxLength) return false
      return validEnum(value, schema) && validFormat(value, schema.format)
    }
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) &&
        (typeof schema.minimum !== 'number' || value >= schema.minimum) &&
        (typeof schema.maximum !== 'number' || value <= schema.maximum)
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value) &&
        (typeof schema.minimum !== 'number' || value >= schema.minimum) &&
        (typeof schema.maximum !== 'number' || value <= schema.maximum)
    case 'array': {
      const choices = arrayChoices(schema)
      return isDenseArray(value) && choices !== undefined && value.every(item => typeof item === 'string' && choices.includes(item)) &&
        (typeof schema.minItems !== 'number' || value.length >= schema.minItems) &&
        (typeof schema.maxItems !== 'number' || value.length <= schema.maxItems)
    }
    default:
      return false
  }
}

function validatePropertySchema(key: string, value: unknown, message: string): value is JsonRecord {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (SENSITIVE_FORM_TEXT.test(`${key} ${String(value.title ?? '')} ${String(value.description ?? '')} ${message}`)) return false

  const stringEnum = Array.isArray(value.enum)
  const stringOneOf = Array.isArray(value.oneOf)
  if (value.type === 'string') {
    if (stringEnum) {
      if (!hasOnlyKeys(value, [...COMMON_PROPERTY_KEYS, 'enum', 'enumNames']) || !isStringArray(value.enum) || value.enum.length === 0) return false
      if (new Set(value.enum).size !== value.enum.length) return false
      if (value.enumNames !== undefined && (!isStringArray(value.enumNames) || value.enumNames.length !== value.enum.length)) return false
    } else if (stringOneOf) {
      if (!hasOnlyKeys(value, [...COMMON_PROPERTY_KEYS, 'oneOf']) || !isDenseArray(value.oneOf) || value.oneOf.length === 0) return false
      if (!value.oneOf.every(option => isRecord(option) && hasOnlyKeys(option, ['const', 'title']) && typeof option.const === 'string' && typeof option.title === 'string')) return false
      if (new Set(value.oneOf.map(option => (option as JsonRecord).const)).size !== value.oneOf.length) return false
    } else {
      // `pattern` is deliberately unsupported; the raw schema is retained so this allowlist can reject it.
      if (!hasOnlyKeys(value, [...COMMON_PROPERTY_KEYS, 'minLength', 'maxLength', 'format'])) return false
      if (value.minLength !== undefined && (!Number.isSafeInteger(value.minLength) || (value.minLength as number) < 0)) return false
      if (value.maxLength !== undefined && (!Number.isSafeInteger(value.maxLength) || (value.maxLength as number) < 0)) return false
      if (typeof value.minLength === 'number' && typeof value.maxLength === 'number' && value.minLength > value.maxLength) return false
      if (value.format !== undefined && !['date', 'date-time', 'email', 'uri'].includes(String(value.format))) return false
    }
  } else if (value.type === 'boolean') {
    if (!hasOnlyKeys(value, COMMON_PROPERTY_KEYS)) return false
  } else if (value.type === 'number' || value.type === 'integer') {
    if (!hasOnlyKeys(value, [...COMMON_PROPERTY_KEYS, 'minimum', 'maximum'])) return false
    if (value.minimum !== undefined && (typeof value.minimum !== 'number' || !Number.isFinite(value.minimum))) return false
    if (value.maximum !== undefined && (typeof value.maximum !== 'number' || !Number.isFinite(value.maximum))) return false
    if (typeof value.minimum === 'number' && typeof value.maximum === 'number' && value.minimum > value.maximum) return false
  } else if (value.type === 'array') {
    if (!hasOnlyKeys(value, [...COMMON_PROPERTY_KEYS, 'items', 'minItems', 'maxItems'])) return false
    if (arrayChoices(value) === undefined) return false
    const items = value.items as JsonRecord
    if (!hasOnlyKeys(items, ['type', 'enum', 'anyOf'])) return false
    if (items.enum !== undefined && items.anyOf !== undefined) return false
    if (items.enum !== undefined && (!isStringArray(items.enum) || items.enum.length === 0 || new Set(items.enum).size !== items.enum.length)) return false
    if (items.anyOf !== undefined && (!isDenseArray(items.anyOf) || items.anyOf.length === 0 ||
      !items.anyOf.every(option => isRecord(option) && hasOnlyKeys(option, ['const', 'title']) && typeof option.const === 'string' && typeof option.title === 'string') ||
      new Set(items.anyOf.map(option => isRecord(option) ? option.const : undefined)).size !== items.anyOf.length)) return false
    if (value.minItems !== undefined && (!Number.isSafeInteger(value.minItems) || (value.minItems as number) < 0)) return false
    if (value.maxItems !== undefined && (!Number.isSafeInteger(value.maxItems) || (value.maxItems as number) < 0)) return false
    if (typeof value.minItems === 'number' && typeof value.maxItems === 'number' && value.minItems > value.maxItems) return false
  } else {
    return false
  }

  if (value.title !== undefined && typeof value.title !== 'string') return false
  if (value.description !== undefined && typeof value.description !== 'string') return false
  if (value.default === undefined) return true
  if (value.type === 'array' && Array.isArray(value.default) && new Set(value.default).size !== value.default.length) return false
  return validValue(value.default, value)
}

/** Throws a safe protocol error when a form asks for sensitive or unsupported data. */
export function assertSupportedMcpElicitationSchema(schema: unknown, message: string): asserts schema is McpElicitationSchema {
  if (SENSITIVE_FORM_TEXT.test(message) || !isRecord(schema) || !hasOnlyKeys(schema, [...FORM_SCHEMA_KEYS]) ||
    schema.type !== 'object' || !isRecord(schema.properties)) {
    throw new McpError(ErrorCode.InvalidParams, 'MCP form elicitation has an unsupported or unsafe schema.')
  }

  const propertyNames = Object.keys(schema.properties)
  for (const key of propertyNames) {
    if (!validatePropertySchema(key, schema.properties[key], message)) {
      throw new McpError(ErrorCode.InvalidParams, 'MCP form elicitation has an unsupported or unsafe schema.')
    }
  }

  if (schema.required !== undefined) {
    if (!isStringArray(schema.required) || new Set(schema.required).size !== schema.required.length ||
      schema.required.some(key => !Object.prototype.hasOwnProperty.call(schema.properties, key))) {
      throw new McpError(ErrorCode.InvalidParams, 'MCP form elicitation has an unsupported or unsafe schema.')
    }
  }
}

function assertValidContent(schema: McpElicitationSchema, content: unknown): asserts content is McpElicitationContent {
  if (!isRecord(content)) throw new McpError(ErrorCode.InvalidParams, 'MCP form elicitation response must be an object.')
  const properties = schema.properties as Record<string, JsonRecord>
  const required = schema.required ?? []
  const keys = Object.keys(content)
  if (keys.some(key => !Object.prototype.hasOwnProperty.call(properties, key)) ||
    required.some(key => !Object.prototype.hasOwnProperty.call(content, key)) ||
    keys.some(key => !validValue(content[key], properties[key]!))) {
    throw new McpError(ErrorCode.InvalidParams, 'MCP form elicitation response does not match the requested schema.')
  }
}

function cancellationError(): McpError {
  return new McpError(ErrorCode.ConnectionClosed, 'MCP form elicitation request was cancelled.')
}

function awaitWithAbort<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancellationError())
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: (value: T) => void, result: T) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback(result)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(cancellationError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    value.then(result => finish(resolve, result), error => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

/** Adapts the MCP request to the UI contract and validates every accepted value before replying. */
export async function handleMcpElicitationRequest(
  serverName: string,
  params: ElicitRequestParams,
  handler: McpElicitationHandler | undefined,
  signal: AbortSignal,
): Promise<ElicitResult> {
  if ((params.mode ?? 'form') !== 'form') {
    throw new McpError(ErrorCode.InvalidParams, `Only form-mode MCP elicitation is supported for server '${serverName}'.`)
  }
  const form = params as ElicitRequestFormParams
  assertSupportedMcpElicitationSchema(form.requestedSchema, form.message)
  if (!handler) {
    throw new McpError(ErrorCode.InvalidParams, `MCP form elicitation is unavailable because no interactive UI handler is registered for server '${serverName}'.`)
  }
  if (signal.aborted) throw cancellationError()

  let pending: Promise<McpElicitationResponse>
  try {
    pending = Promise.resolve(handler({
      serverName,
      message: form.message,
      requestedSchema: form.requestedSchema,
    }, signal))
  } catch (error) {
    throw error
  }
  const response = await awaitWithAbort(pending, signal)
  if (signal.aborted) throw cancellationError()
  if (!isRecord(response) || !['accept', 'decline', 'cancel'].includes(String(response.action))) {
    throw new McpError(ErrorCode.InvalidParams, 'MCP form elicitation handler returned an invalid response.')
  }
  if (response.action === 'decline' || response.action === 'cancel') return { action: response.action }
  assertValidContent(form.requestedSchema, response.content)
  return { action: 'accept', content: Object.fromEntries(Object.entries(response.content)) as McpElicitationContent }
}
