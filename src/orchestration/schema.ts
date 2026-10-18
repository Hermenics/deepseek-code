import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import type { TaskMessageV1, TaskRecordV1, TaskResultEnvelopeV1 } from './types.js'

const ajv = new Ajv({ allErrors: true, strict: false })
const toolArgumentAjv = new Ajv({ allErrors: true, strict: false, useDefaults: true })
const validators = new WeakMap<object, { schemaText: string; compiledSchema: object; validate: ValidateFunction }>()
const toolArgumentValidators = new WeakMap<object, { schemaText: string; compiledSchema: object; validate: ValidateFunction }>()
const closedSchemas = new WeakMap<object, { schemaText: string; closed: object }>()

export interface SchemaValidation<T> {
  valid: boolean
  value?: T
  errors: string[]
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
}

/** Validate a value against a JSON schema with Ajv, caching the compiled validator per schema object. */
export function validateSchema<T>(schema: object, value: unknown): SchemaValidation<T> {
  const schemaText = JSON.stringify(schema)
  let cached = validators.get(schema)
  if (!cached || cached.schemaText !== schemaText) {
    // Ajv also caches by object identity; invalidate it when the same schema object changes.
    if (cached) ajv.removeSchema(cached.compiledSchema)
    const compiledSchema = JSON.parse(schemaText) as object
    const validate = ajv.compile(compiledSchema)
    cached = { schemaText, compiledSchema, validate }
    validators.set(schema, cached)
  }
  const { validate } = cached
  if (validate(value)) return { valid: true, value: value as T, errors: [] }
  return { valid: false, errors: formatErrors(validate.errors) }
}

/** Validate tool-call arguments. Object schemas with properties are closed (extra keys rejected); without a schema only a plain object is required. */
export function validateToolArguments(schema: object | undefined, value: unknown): SchemaValidation<Record<string, unknown>> {
  if (!schema) return value && typeof value === 'object' && !Array.isArray(value)
    ? { valid: true, value: value as Record<string, unknown>, errors: [] }
    : { valid: false, errors: ['/ must be an object'] }
  const schemaText = JSON.stringify(schema)
  let cached = closedSchemas.get(schema)
  if (!cached || cached.schemaText !== schemaText) {
    const previous = cached && toolArgumentValidators.get(cached.closed)
    if (previous) toolArgumentAjv.removeSchema(previous.compiledSchema)
    // MCP servers (zod v4, e.g. Playwright MCP) declare `$schema` draft 2020-12, which this Ajv does not
    // register and would throw on; the declaration is metadata, so drop it and validate the keywords.
    const { $schema: _draft, ...source } = schema as { $schema?: string; type?: string; properties?: Record<string, unknown> }
    const closed = source.type === 'object' && source.properties !== undefined ? { ...source, additionalProperties: false } : source
    if (cached) toolArgumentValidators.delete(cached.closed)
    cached = { schemaText, closed }
    closedSchemas.set(schema, cached)
  }
  let normalized: unknown
  try { normalized = structuredClone(value) }
  catch { return { valid: false, errors: ['/ must be a JSON-compatible value'] } }

  const argumentSchemaText = JSON.stringify(cached.closed)
  let validator = toolArgumentValidators.get(cached.closed)
  if (!validator || validator.schemaText !== argumentSchemaText) {
    if (validator) toolArgumentAjv.removeSchema(validator.compiledSchema)
    const compiledSchema = JSON.parse(argumentSchemaText) as object
    const validate = toolArgumentAjv.compile(compiledSchema)
    validator = { schemaText: argumentSchemaText, compiledSchema, validate }
    toolArgumentValidators.set(cached.closed, validator)
  }
  if (validator.validate(normalized)) return { valid: true, value: normalized as Record<string, unknown>, errors: [] }
  return { valid: false, errors: formatErrors(validator.validate.errors) }
}

export const SUBAGENT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    filesRead: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    issuesFound: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
    metadata: { type: 'object' },
  },
  required: ['summary', 'confidence', 'filesRead', 'filesChanged', 'issuesFound', 'suggestions', 'metadata'],
} as const

export const VERIFICATION_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
    reason: { type: 'string', minLength: 1 },
    issues: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'reason', 'issues', 'evidence'],
} as const

export const TASK_MESSAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    schemaVersion: { const: 1 }, messageId: { type: 'string', minLength: 1 },
    senderId: { type: 'string', minLength: 1 }, recipientId: { type: 'string', minLength: 1 },
    type: { enum: ['progress', 'result', 'blocked', 'question', 'error', 'cancel', 'permission', 'resource'] },
    correlationId: { type: 'string', minLength: 1 }, taskId: { type: 'string', minLength: 1 },
    timestamp: { type: 'string' }, payload: { type: 'object' }, status: { enum: ['pending', 'processed'] },
  },
  required: ['schemaVersion', 'messageId', 'senderId', 'recipientId', 'type', 'correlationId', 'taskId', 'timestamp', 'payload', 'status'],
} as const

export const TASK_RESULT_ENVELOPE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'taskId', 'sessionId', 'status', 'artifacts', 'metrics', 'completedAt'],
  properties: {
    schemaVersion: { const: 1 }, taskId: { type: 'string', minLength: 1 }, sessionId: { type: 'string', minLength: 1 },
    status: { enum: ['done', 'failed', 'cancelled', 'timed_out'] }, value: {}, partial: {},
    artifacts: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'kind'],
        properties: {
          id: { type: 'string', minLength: 1 }, kind: { enum: ['file', 'patch', 'log', 'result', 'other'] },
          path: { type: 'string' }, contentHash: { type: 'string' }, metadata: { type: 'object' },
        },
      },
    },
    metrics: {
      type: 'object', additionalProperties: false, required: ['usageAvailable'],
      properties: {
        model: { type: 'string' }, provider: { type: 'string' }, tokens: { type: 'number', minimum: 0 },
        promptTokens: { type: 'number', minimum: 0 }, completionTokens: { type: 'number', minimum: 0 }, cachedTokens: { type: 'number', minimum: 0 },
        costUsd: { type: 'number', minimum: 0 }, latencyMs: { type: 'number', minimum: 0 }, usageAvailable: { type: 'boolean' }, costAvailable: { type: 'boolean' },
      },
    },
    completedAt: { type: 'string', minLength: 1 }, rawOutput: { type: 'string' },
    error: {
      type: 'object', additionalProperties: false, required: ['code', 'message', 'retryable'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, cause: { type: 'string' } },
    },
  },
} as const

const TASK_ARTIFACTS_SCHEMA = TASK_RESULT_ENVELOPE_SCHEMA.properties.artifacts

const TASK_WORKSPACE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['path', 'projectRoot', 'isolation'],
  properties: {
    path: { type: 'string', minLength: 1 }, projectRoot: { type: 'string', minLength: 1 },
    isolation: { enum: ['readonly-shared', 'git-worktree', 'serialized-writer'] },
    baseHead: { type: 'string' }, integrated: { type: 'boolean' }, preserved: { type: 'boolean' },
  },
} as const

export const TASK_RECORD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: [
    'schemaVersion', 'taskId', 'sessionId', 'type', 'mode', 'contextMode', 'state', 'depth',
    'dependencies', 'dependents', 'createdAt', 'queuedAt', 'updatedAt', 'attempt', 'maxRetries',
    'timeoutMs', 'maxDepth', 'maxFanOut', 'allowDelegation', 'permissionProfile', 'artifactRefs',
    'metrics', 'metadata', 'dependencyFailurePolicy', 'cancellationPolicy',
  ],
  properties: {
    schemaVersion: { const: 1 }, taskId: { type: 'string', minLength: 1 }, sessionId: { type: 'string', minLength: 1 },
    parentTaskId: { type: 'string', minLength: 1 }, parentEffectId: { type: 'string', minLength: 1, maxLength: 128 },
    parentEffectAttempt: { type: 'integer', minimum: 1 }, budgetGroupId: { type: 'string', minLength: 1 }, type: { type: 'string', minLength: 1 },
    mode: { enum: ['foreground', 'background'] }, contextMode: { enum: ['fresh', 'fork'] },
    state: { enum: ['queued', 'running', 'blocked', 'done', 'failed', 'cancelled', 'timed_out'] },
    depth: { type: 'integer', minimum: 0 }, dependencies: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    dependents: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    createdAt: { type: 'string', minLength: 1 }, queuedAt: { type: 'string', minLength: 1 },
    startedAt: { type: 'string', minLength: 1 }, updatedAt: { type: 'string', minLength: 1 },
    completedAt: { type: 'string', minLength: 1 }, deadline: { type: 'string', minLength: 1 },
    attempt: { type: 'integer', minimum: 0 }, maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
    effectPolicy: { enum: ['unknown', 'tool-gated', 'retry-safe'] },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 86_400_000 }, maxDepth: { type: 'integer', minimum: 0, maximum: 32 },
    maxFanOut: { type: 'integer', minimum: 1, maximum: 100 }, allowDelegation: { type: 'boolean' },
    maxTokens: { type: 'integer', minimum: 1 }, maxCostUsd: { type: 'number', exclusiveMinimum: 0 },
    permissionProfile: { enum: ['researcher-readonly', 'tester', 'writer-worktree', 'coordinator-integrator'] },
    allowedTools: { anyOf: [{ const: '*' }, { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } }] },
    contextSummary: { type: 'string' }, artifactRefs: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    artifacts: TASK_ARTIFACTS_SCHEMA, partial: {}, effectMayHaveStarted: { type: 'boolean' },
    effectLedger: {
      type: 'array', maxItems: 128,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'attempt', 'tool', 'state', 'startedAt'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128 },
          attempt: { type: 'integer', minimum: 1 },
          tool: { type: 'string', minLength: 1, maxLength: 128 },
          state: { enum: ['unknown', 'no-effect', 'effect-observed'] },
          startedAt: { type: 'string', minLength: 1 },
          resolvedAt: { type: 'string', minLength: 1 },
          evidence: { type: 'string', minLength: 1, maxLength: 256 },
        },
      },
    },
    effectLedgerTruncated: { type: 'boolean' },
    effectReconciliations: {
      type: 'array', maxItems: 16,
      items: {
        type: 'object', additionalProperties: false,
        required: ['attempt', 'resolution', 'evidence', 'actor', 'reconciledAt'],
        properties: {
          attempt: { type: 'integer', minimum: 1 },
          resolution: { enum: ['no-effect', 'effect-observed', 'compensated'] },
          evidence: { type: 'string', minLength: 1, maxLength: 2_000 },
          actor: { const: 'user' },
          reconciledAt: { type: 'string', minLength: 1 },
          processSettledAt: { type: 'string', minLength: 1 },
        },
      },
    },
    result: TASK_RESULT_ENVELOPE_SCHEMA,
    error: {
      type: 'object', additionalProperties: false, required: ['code', 'message', 'retryable'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, cause: { type: 'string' } },
    },
    process: {
      type: 'object', additionalProperties: false,
      required: ['status', 'observedAt', 'provenance', 'scope', 'progress'],
      properties: {
        identity: {
          type: 'object', additionalProperties: false, required: ['platform', 'pid', 'bootId', 'pidNamespace', 'startTimeTicks'],
          properties: { platform: { const: 'linux' }, pid: { type: 'integer', minimum: 1 }, bootId: { type: 'string', pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' }, pidNamespace: { type: 'string', pattern: '^pid:\\[[0-9]+\\]$' }, startTimeTicks: { type: 'string', pattern: '^[0-9]+$', maxLength: 32 }, sessionId: { type: 'integer', minimum: 1 }, processGroupId: { type: 'integer', minimum: 0 } },
        },
        processGroup: {
          type: 'object', additionalProperties: false, required: ['id', 'status', 'observedAt'],
          properties: { id: { type: 'integer', minimum: 1 }, status: { enum: ['alive', 'exited', 'unknown'] }, observedAt: { type: 'string', minLength: 1 }, memberCount: { type: 'integer', minimum: 0 }, reason: { type: 'string' } },
        },
        status: { enum: ['alive', 'exited', 'identity-mismatch', 'unknown'] }, observedAt: { type: 'string', minLength: 1 },
        provenance: { enum: ['kernel', 'child-event', 'unavailable'] }, scope: { enum: ['leader-only', 'process-group'] }, progress: { const: 'not-measured' },
        reason: { type: 'string' }, exitCode: { type: ['integer', 'null'] }, signal: { type: ['string', 'null'] },
      },
    },
    blockReason: { type: 'string' }, workspace: TASK_WORKSPACE_SCHEMA,
    metrics: TASK_RESULT_ENVELOPE_SCHEMA.properties.metrics, metadata: { type: 'object' },
    dependencyFailurePolicy: { enum: ['block', 'fail', 'cancel'] }, cancellationPolicy: { enum: ['cascade', 'detach'] },
  },
} as const

export function validateTaskMessage(value: unknown): SchemaValidation<TaskMessageV1> {
  return validateSchema(TASK_MESSAGE_SCHEMA, value)
}

export function validateTaskResultEnvelope(value: unknown): SchemaValidation<TaskResultEnvelopeV1> {
  return validateSchema(TASK_RESULT_ENVELOPE_SCHEMA, value)
}

export function validateTaskRecord(value: unknown): SchemaValidation<TaskRecordV1> {
  const record = validateSchema<TaskRecordV1>(TASK_RECORD_SCHEMA, value)
  if (!record.valid || !record.value?.process) return record
  const process = record.value.process
  if (process.scope === 'process-group'
    && (!process.identity || process.identity.processGroupId !== process.identity.pid || process.processGroup?.id !== process.identity.processGroupId)) {
    return { valid: false, errors: ['/process process-group scope does not match its recorded identity'] }
  }
  if (process.scope === 'leader-only' && process.processGroup) {
    return { valid: false, errors: ['/process leader-only scope cannot include a process group'] }
  }
  return record
}

/** Validate a snapshot task record and check that it and its result envelope belong to this session and agree on task ID and status. */
export function validateRestoredTaskRecord(value: unknown, sessionId: string): SchemaValidation<TaskRecordV1> {
  const record = validateTaskRecord(value)
  if (!record.valid || !record.value) return record
  if (record.value.sessionId !== sessionId) return { valid: false, errors: ['/sessionId does not match the registry'] }
  if (record.value.result) {
    const result = validateTaskResultEnvelope(record.value.result)
    if (!result.valid) return { valid: false, errors: result.errors.map(error => `/result${error}`) }
    if (record.value.result.taskId !== record.value.taskId || record.value.result.sessionId !== sessionId || record.value.result.status !== record.value.state) {
      return { valid: false, errors: ['/result identity or status does not match the task'] }
    }
  }
  return record
}
