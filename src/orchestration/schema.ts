import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import type { TaskMessageV1, TaskRecordV1, TaskResultEnvelopeV1 } from './types.js'

const ajv = new Ajv({ allErrors: true, strict: false })
const validators = new WeakMap<object, ValidateFunction>()
const closedSchemas = new WeakMap<object, object>()

export interface SchemaValidation<T> {
  valid: boolean
  value?: T
  errors: string[]
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
}

export function validateSchema<T>(schema: object, value: unknown): SchemaValidation<T> {
  let validate = validators.get(schema)
  if (!validate) {
    validate = ajv.compile(schema)
    validators.set(schema, validate)
  }
  if (validate(value)) return { valid: true, value: value as T, errors: [] }
  return { valid: false, errors: formatErrors(validate.errors) }
}

export function validateToolArguments(schema: object | undefined, value: unknown): SchemaValidation<Record<string, unknown>> {
  if (!schema) return value && typeof value === 'object' && !Array.isArray(value)
    ? { valid: true, value: value as Record<string, unknown>, errors: [] }
    : { valid: false, errors: ['/ must be an object'] }
  const source = schema as { type?: string; properties?: Record<string, unknown> }
  let closed: object = source
  if (source.type === 'object' && source.properties !== undefined) {
    closed = closedSchemas.get(schema) ?? { ...source, additionalProperties: false }
    closedSchemas.set(schema, closed)
  }
  return validateSchema<Record<string, unknown>>(closed, value)
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
        costUsd: { type: 'number', minimum: 0 }, latencyMs: { type: 'number', minimum: 0 }, usageAvailable: { type: 'boolean' },
      },
    },
    completedAt: { type: 'string', minLength: 1 }, rawOutput: { type: 'string' },
    error: {
      type: 'object', additionalProperties: false, required: ['code', 'message', 'retryable'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, cause: { type: 'string' } },
    },
  },
} as const

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
    parentTaskId: { type: 'string', minLength: 1 }, type: { type: 'string', minLength: 1 },
    mode: { enum: ['foreground', 'background'] }, contextMode: { enum: ['fresh', 'fork'] },
    state: { enum: ['queued', 'running', 'blocked', 'done', 'failed', 'cancelled', 'timed_out'] },
    depth: { type: 'integer', minimum: 0 }, dependencies: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    dependents: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    createdAt: { type: 'string', minLength: 1 }, queuedAt: { type: 'string', minLength: 1 },
    startedAt: { type: 'string', minLength: 1 }, updatedAt: { type: 'string', minLength: 1 },
    completedAt: { type: 'string', minLength: 1 }, deadline: { type: 'string', minLength: 1 },
    attempt: { type: 'integer', minimum: 0 }, maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 86_400_000 }, maxDepth: { type: 'integer', minimum: 0, maximum: 32 },
    maxFanOut: { type: 'integer', minimum: 1, maximum: 100 }, allowDelegation: { type: 'boolean' },
    maxTokens: { type: 'integer', minimum: 1 }, maxCostUsd: { type: 'number', exclusiveMinimum: 0 },
    permissionProfile: { enum: ['researcher-readonly', 'tester', 'writer-worktree', 'coordinator-integrator'] },
    allowedTools: { anyOf: [{ const: '*' }, { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } }] },
    contextSummary: { type: 'string' }, artifactRefs: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    result: TASK_RESULT_ENVELOPE_SCHEMA,
    error: {
      type: 'object', additionalProperties: false, required: ['code', 'message', 'retryable'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, cause: { type: 'string' } },
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
  return validateSchema(TASK_RECORD_SCHEMA, value)
}

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
