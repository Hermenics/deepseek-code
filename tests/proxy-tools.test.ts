import { describe, it, expect, beforeEach } from 'bun:test'
import {
  validateAgainstSchema,
  SchemaValidationError,
} from '../src/agent/providers/proxy/tools/schema.js'
import type { JsonSchema } from '../src/agent/providers/proxy/tools/types.js'
import {
  registerTool,
  getTool,
  getAllTools,
  clearTools,
} from '../src/agent/providers/proxy/tools/registry.js'
import { executeToolCalls } from '../src/agent/providers/proxy/tools/executor.js'
import type { ToolDefinition } from '../src/agent/providers/proxy/tools/registry.js'
import type { ParsedToolCall } from '../src/agent/providers/proxy/tools/executor.js'

// ─────────────────────────────────────────────────────────────────────────────
// SchemaValidationError + validateAgainstSchema
// ─────────────────────────────────────────────────────────────────────────────

describe('schema', () => {
  describe('validateAgainstSchema', () => {
    it('should return the value when a string matches type "string"', () => {
      // Arrange
      const schema: JsonSchema = { type: 'string' }

      // Act
      const result = validateAgainstSchema('hello', schema)

      // Assert
      expect(result).toBe('hello')
    })

    it('should throw SchemaValidationError when value type does not match schema type', () => {
      // Arrange
      const schema: JsonSchema = { type: 'string' }

      // Act + Assert
      expect(() => validateAgainstSchema(42, schema)).toThrow(SchemaValidationError)
    })

    it('should return the value when an object satisfies all required fields', () => {
      // Arrange
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      }
      const value = { name: 'Alice', age: 30 }

      // Act
      const result = validateAgainstSchema(value, schema)

      // Assert
      expect(result).toEqual(value)
    })

    it('should throw SchemaValidationError when a required field is missing', () => {
      // Arrange
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      }
      const value = { name: 'Alice' } // missing "age"

      // Act + Assert
      expect(() => validateAgainstSchema(value, schema)).toThrow(SchemaValidationError)
    })

    it('should return the value when an array matches the items schema', () => {
      // Arrange
      const schema: JsonSchema = {
        type: 'array',
        items: { type: 'string' },
      }
      const value = ['a', 'b', 'c']

      // Act
      const result = validateAgainstSchema(value, schema)

      // Assert
      expect(result).toEqual(value)
    })

    it('should throw SchemaValidationError when an array item does not match items schema', () => {
      // Arrange
      const schema: JsonSchema = {
        type: 'array',
        items: { type: 'string' },
      }
      const value = ['a', 2, 'c'] // 2 is not a string

      // Act + Assert
      expect(() => validateAgainstSchema(value, schema)).toThrow(SchemaValidationError)
    })
  })

  describe('SchemaValidationError', () => {
    it('should expose "path" and "value" properties on the thrown error', () => {
      // Arrange
      const schema: JsonSchema = { type: 'string' }

      // Act
      let caught: unknown
      try {
        validateAgainstSchema(99, schema, 'root.field')
      } catch (err) {
        caught = err
      }

      // Assert
      expect(caught).toBeInstanceOf(SchemaValidationError)
      const error = caught as SchemaValidationError
      expect(typeof error.path).toBe('string')
      expect(error.value).toBe(99)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// registry
// ─────────────────────────────────────────────────────────────────────────────

describe('registry', () => {
  // Isolate each test — registry is module-level state
  beforeEach(() => {
    clearTools()
  })

  const makeTool = (name: string): ToolDefinition => ({
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: async (_args) => `result from ${name}`,
  })

  describe('registerTool', () => {
    it('should add a tool so that getTool returns it afterwards', () => {
      // Arrange
      const tool = makeTool('read_file')

      // Act
      registerTool(tool)

      // Assert
      expect(getTool('read_file')).toBe(tool)
    })

    it('should overwrite an existing tool when registered with the same name', () => {
      // Arrange
      const original = makeTool('shell')
      const replacement: ToolDefinition = {
        ...makeTool('shell'),
        description: 'Replaced shell tool',
      }

      // Act
      registerTool(original)
      registerTool(replacement)

      // Assert
      expect(getTool('shell')?.description).toBe('Replaced shell tool')
    })
  })

  describe('getTool', () => {
    it('should return the registered tool by name', () => {
      // Arrange
      const tool = makeTool('grep')
      registerTool(tool)

      // Act
      const result = getTool('grep')

      // Assert
      expect(result).toBe(tool)
    })

    it('should return undefined for a name that was never registered', () => {
      // Act
      const result = getTool('nonexistent_tool')

      // Assert
      expect(result).toBeUndefined()
    })
  })

  describe('getAllTools', () => {
    it('should return all registered tools', () => {
      // Arrange
      registerTool(makeTool('tool_a'))
      registerTool(makeTool('tool_b'))
      registerTool(makeTool('tool_c'))

      // Act
      const all = getAllTools()

      // Assert
      expect(all).toHaveLength(3)
      const names = all.map((t) => t.name)
      expect(names).toContain('tool_a')
      expect(names).toContain('tool_b')
      expect(names).toContain('tool_c')
    })
  })

  describe('clearTools', () => {
    it('should remove all tools from the registry', () => {
      // Arrange
      registerTool(makeTool('tool_x'))
      registerTool(makeTool('tool_y'))

      // Act
      clearTools()

      // Assert
      expect(getAllTools()).toHaveLength(0)
      expect(getTool('tool_x')).toBeUndefined()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// executor
// ─────────────────────────────────────────────────────────────────────────────

describe('executor', () => {
  beforeEach(() => {
    clearTools()
  })

  describe('executeToolCalls', () => {
    it('should execute a registered tool and return its result', async () => {
      // Arrange
      registerTool({
        name: 'echo',
        description: 'Echoes the input',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
        execute: async (args) => `echo: ${args.text}`,
      })

      const toolCalls: ParsedToolCall[] = [
        { id: 'call_001', name: 'echo', arguments: { text: 'hello' } },
      ]

      // Act
      const results = await executeToolCalls(toolCalls)

      // Assert
      expect(results).toHaveLength(1)
      expect(results[0]!.toolCallId).toBe('call_001')
      expect(results[0]!.name).toBe('echo')
      expect(results[0]!.result).toBe('echo: hello')
      expect(results[0]!.isError).toBe(false)
    })

    it('should return isError=true when the tool name is not registered', async () => {
      // Arrange — registry is empty (cleared in beforeEach)
      const toolCalls: ParsedToolCall[] = [
        { id: 'call_002', name: 'unknown_tool', arguments: {} },
      ]

      // Act
      const results = await executeToolCalls(toolCalls)

      // Assert
      expect(results).toHaveLength(1)
      expect(results[0]!.isError).toBe(true)
      expect(results[0]!.name).toBe('unknown_tool')
      expect(results[0]!.toolCallId).toBe('call_002')
    })

    it('should return isError=true when execute() throws an error', async () => {
      // Arrange
      registerTool({
        name: 'failing_tool',
        description: 'Always throws',
        parameters: { type: 'object', properties: {} },
        execute: async (_args) => {
          throw new Error('Simulated failure')
        },
      })

      const toolCalls: ParsedToolCall[] = [
        { id: 'call_003', name: 'failing_tool', arguments: {} },
      ]

      // Act
      const results = await executeToolCalls(toolCalls)

      // Assert
      expect(results).toHaveLength(1)
      expect(results[0]!.isError).toBe(true)
      expect(results[0]!.name).toBe('failing_tool')
    })

    it('should execute multiple tool calls and return results for all of them', async () => {
      // Arrange
      registerTool({
        name: 'add',
        description: 'Adds two numbers',
        parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
        execute: async (args) => String((args.a as number) + (args.b as number)),
      })

      registerTool({
        name: 'upper',
        description: 'Uppercases a string',
        parameters: { type: 'object', properties: { text: { type: 'string' } } },
        execute: async (args) => (args.text as string).toUpperCase(),
      })

      const toolCalls: ParsedToolCall[] = [
        { id: 'call_004', name: 'add', arguments: { a: 3, b: 4 } },
        { id: 'call_005', name: 'upper', arguments: { text: 'hello' } },
      ]

      // Act
      const results = await executeToolCalls(toolCalls)

      // Assert
      expect(results).toHaveLength(2)

      const addResult = results.find((r) => r.name === 'add')!
      expect(addResult.result).toBe('7')
      expect(addResult.isError).toBe(false)

      const upperResult = results.find((r) => r.name === 'upper')!
      expect(upperResult.result).toBe('HELLO')
      expect(upperResult.isError).toBe(false)
    })
  })
})
