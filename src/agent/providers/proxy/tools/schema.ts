import type { JsonSchema } from './types.js'

export class SchemaValidationError extends Error {
  public readonly path: string
  public readonly value: unknown

  constructor(message: string, path: string, value?: unknown) {
    super(message)
    this.name = 'SchemaValidationError'
    this.path = path
    this.value = value
  }
}

export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path = '$'
): unknown {
  switch (schema.type) {
    case 'object':
      return validateObject(value, schema, path)
    case 'array':
      return validateArray(value, schema, path)
    case 'string':
      if (typeof value !== 'string') {
        throw new SchemaValidationError(`Expected string at ${path}`, path, value)
      }
      return value
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new SchemaValidationError(`Expected number at ${path}`, path, value)
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        throw new SchemaValidationError(`Expected integer at ${path}`, path, value)
      }
      return value
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new SchemaValidationError(`Expected boolean at ${path}`, path, value)
      }
      return value
    case 'null':
      if (value !== null) {
        throw new SchemaValidationError(`Expected null at ${path}`, path, value)
      }
      return value
    default:
      return value
  }
}

function validateObject(value: unknown, schema: JsonSchema, path: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SchemaValidationError(`Expected object at ${path}`, path, value)
  }

  const objectValue = value as Record<string, unknown>

  for (const requiredField of schema.required ?? []) {
    if (!(requiredField in objectValue)) {
      throw new SchemaValidationError(
        `Missing required property '${requiredField}' at ${path}`,
        `${path}.${requiredField}`,
        undefined
      )
    }
  }

  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    if (key in objectValue) {
      validateAgainstSchema(objectValue[key], propertySchema, `${path}.${key}`)
    }
  }

  return value
}

function validateArray(value: unknown, schema: JsonSchema, path: string): unknown {
  if (!Array.isArray(value)) {
    throw new SchemaValidationError(`Expected array at ${path}`, path, value)
  }

  if (schema.items) {
    value.forEach((item, index) => {
      validateAgainstSchema(item, schema.items as JsonSchema, `${path}[${index}]`)
    })
  }

  return value
}
