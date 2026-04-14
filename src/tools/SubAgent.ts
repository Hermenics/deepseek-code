import { Tool } from './types.js'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

const SUBAGENT_PROMPT = `You are a subagent of DeepSeek Code. You have been given a specific task to complete. Focus only on this task. Be concise. Return only the result.`

export const SubAgent: Tool = {
  name: 'subagent',
  description: 'Spawn a subagent to handle a specific subtask independently with its own context and access to all tools (filesystem, shell, grep, etc.). Use this to delegate focused subtasks like analyzing a directory, refactoring a file, running tests, or researching something. Returns the subagent\'s final result.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The task for the subagent to complete' },
    },
    required: ['task'],
  },
  async execute(args) {
    const task = args.task as string

    // Lazy import to avoid circular dependency
    const { allTools, toolMap } = await import('./index.js')
    const subagentTools = allTools.filter((t) => t.name !== 'subagent')
    const openaiTools: ChatCompletionTool[] = subagentTools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
    }))

    const client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    })

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SUBAGENT_PROMPT },
      { role: 'user', content: task },
    ]

    for (let i = 0; i < 10; i++) {
      const response = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages,
        tools: openaiTools,
      })

      const msg = response.choices[0]!.message

      if (!msg.tool_calls?.length) {
        return msg.content ?? '(no output)'
      }

      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls })

      for (const tc of msg.tool_calls) {
        let parsedArgs: Record<string, unknown> = {}
        try { parsedArgs = JSON.parse(tc.function.arguments) } catch {}

        const tool = toolMap.get(tc.function.name)
        let result: string
        if (tool) {
          try { result = await tool.execute(parsedArgs) } catch (e: unknown) {
            result = `Error: ${(e as Error).message}`
          }
        } else {
          result = `Unknown tool: ${tc.function.name}`
        }

        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
    }

    return '(subagent reached max iterations)'
  },
}
