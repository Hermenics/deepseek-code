import { describe, it, expect, mock, beforeEach, afterEach, beforeAll } from 'bun:test'
import { Agent } from '../src/agent/agent.js'
import type { AgentCallbacks, ToolPermissionResult } from '../src/agent/agent.js'

// Agent requires an API key to instantiate the OpenAI client
beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
})

// Helper: create a no-op callbacks object
function createMockCallbacks(): AgentCallbacks & { tokens: string[]; toolCalls: string[]; done: boolean } {
  const state = { tokens: [] as string[], toolCalls: [] as string[], done: false }
  return {
    ...state,
    onToken(text: string) { state.tokens.push(text) },
    onToolCall(name: string) { state.toolCalls.push(name) },
    onToolResult() {},
    onDone() { state.done = true },
  }
}

describe('Agent class', () => {
  describe('constructor', () => {
    it('should create an agent with default config', () => {
      const agent = new Agent()
      expect(agent.model).toBe('deepseek-chat')
      expect(agent.activeAgent).toBeNull()
      expect(agent.provider).toBe('deepseek')
    })

    it('should accept provider config', () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      expect(agent.provider).toBe('deepseek')
    })
  })

  describe('setModel', () => {
    it('should change the model', () => {
      const agent = new Agent()
      agent.setModel('deepseek-reasoner')
      expect(agent.model).toBe('deepseek-reasoner')
    })

    it('should update context limit when changing model', () => {
      const agent = new Agent()
      agent.setModel('deepseek-reasoner')
      expect(agent.contextLimit).toBe(128_000)
    })
  })

  describe('clearHistory', () => {
    it('should reset messages to only system prompt', () => {
      const agent = new Agent()
      agent.clearHistory()
      const messages = agent.getMessages()
      expect(messages.length).toBe(1)
      expect(messages[0].role).toBe('system')
    })
  })

  describe('getFilesModified', () => {
    it('should return empty array initially', () => {
      const agent = new Agent()
      expect(agent.getFilesModified()).toEqual([])
    })
  })

  describe('getSystemPrompt', () => {
    it('should return a non-empty string', () => {
      const agent = new Agent()
      const prompt = agent.getSystemPrompt()
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(100)
    })
  })

  describe('getToolNames', () => {
    it('should return array of tool names', () => {
      const agent = new Agent()
      const names = agent.getToolNames()
      expect(names).toBeArray()
      expect(names.length).toBeGreaterThan(0)
      expect(names).toContain('read_file')
      expect(names).toContain('write_file')
      expect(names).toContain('shell')
    })
  })

  describe('getCostSummary', () => {
    it('should return formatted cost string', () => {
      const agent = new Agent()
      const summary = agent.getCostSummary()
      expect(summary).toContain('Model:')
      expect(summary).toContain('Tokens:')
      expect(summary).toContain('Estimated cost:')
    })
  })

  describe('getLastUserMessage', () => {
    it('should return null initially', () => {
      const agent = new Agent()
      expect(agent.getLastUserMessage()).toBeNull()
    })
  })

  describe('setLanguage', () => {
    it('should add language instruction to system prompt', () => {
      const agent = new Agent()
      agent.setLanguage('Portuguese')
      const prompt = agent.getSystemPrompt()
      expect(prompt).toContain('PREFERRED LANGUAGE')
      expect(prompt).toContain('Portuguese')
    })

    it('should replace existing language instruction', () => {
      const agent = new Agent()
      agent.setLanguage('English')
      agent.setLanguage('Portuguese')
      const prompt = agent.getSystemPrompt()
      expect(prompt).toContain('Portuguese')
      expect(prompt).not.toContain('Always respond in English')
    })
  })

  describe('loadSessionMessages', () => {
    it('should replace current messages', () => {
      const agent = new Agent()
      const newMessages = [
        { role: 'system' as const, content: 'custom prompt' },
        { role: 'user' as const, content: 'hello' },
      ]
      agent.loadSessionMessages(newMessages)
      expect(agent.getMessages()).toEqual(newMessages)
    })
  })

  describe('applyAgentConfig', () => {
    it('should set active agent name', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        systemPrompt: 'You are a test agent.',
      })
      expect(agent.activeAgent).toBe('test-agent')
    })

    it('should set model from config', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        model: 'deepseek-reasoner',
        systemPrompt: 'Test prompt.',
      })
      expect(agent.model).toBe('deepseek-reasoner')
    })

    it('should clear history when applying config', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        systemPrompt: 'New system prompt.',
      })
      const messages = agent.getMessages()
      expect(messages.length).toBe(1)
      expect(messages[0].content).toBe('New system prompt.')
    })
  })

  describe('resetAgent', () => {
    it('should reset to defaults', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        model: 'deepseek-reasoner',
        systemPrompt: 'Custom.',
      })
      agent.resetAgent()
      expect(agent.activeAgent).toBeNull()
      expect(agent.model).toBe('deepseek-chat')
    })
  })

  describe('undo', () => {
    it('should return "Nothing to undo." when stack is empty', async () => {
      const agent = new Agent()
      const result = await agent.undo()
      expect(result).toBe('Nothing to undo.')
    })
  })

  describe('setConfirmHandler', () => {
    it('should accept null handler', () => {
      const agent = new Agent()
      expect(() => agent.setConfirmHandler(null)).not.toThrow()
    })

    it('should accept function handler', () => {
      const agent = new Agent()
      const handler = async () => true
      expect(() => agent.setConfirmHandler(handler)).not.toThrow()
    })
  })

  describe('setToolPermissionHandler', () => {
    it('should accept null handler', () => {
      const agent = new Agent()
      expect(() => agent.setToolPermissionHandler(null)).not.toThrow()
    })

    it('should accept function handler', () => {
      const agent = new Agent()
      const handler = async (): Promise<ToolPermissionResult> => 'once'
      expect(() => agent.setToolPermissionHandler(handler)).not.toThrow()
    })
  })

  describe('abort', () => {
    it('should not throw when called without active request', () => {
      const agent = new Agent()
      expect(() => agent.abort()).not.toThrow()
    })
  })
})
