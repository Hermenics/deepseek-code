import { Tool } from '../types.js'
import { loadMemory, addEntry, replaceEntry, removeEntry } from '../../agent/memory.js'
import type { MemoryTarget } from '../../agent/memory.js'

export const MemoryTool: Tool = {
  name: 'memory',
  description:
    'Manage persistent memory across sessions. Use this to remember important facts about the project, ' +
    'user preferences, or things learned. Memory persists between sessions and is injected into context at startup.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'replace', 'remove', 'list'],
        description: 'Action to perform: add new entry, replace existing by substring match, remove by substring match, or list all entries',
      },
      target: {
        type: 'string',
        enum: ['agent', 'user'],
        description: 'Which memory store: agent (facts, conventions) or user (preferences, style)',
      },
      content: {
        type: 'string',
        description: 'For add: the new entry text. For replace: the new text. For remove: not needed.',
      },
      match: {
        type: 'string',
        description: 'For replace/remove: unique substring to find the entry to modify',
      },
    },
    required: ['action', 'target'],
  },
  async execute(args) {
    const action = args.action as string
    const target = args.target as MemoryTarget
    const content = (args.content as string | undefined)?.trim()
    const match = (args.match as string | undefined)?.trim()

    if ((action === 'add' || action === 'replace') && !content) {
      return 'Error: content is required for add/replace actions.'
    }
    if ((action === 'replace' || action === 'remove') && !match) {
      return 'Error: match is required for replace/remove actions.'
    }

    switch (action) {
      case 'list': {
        const entries = await loadMemory(target)
        if (entries.length === 0) return `No entries in ${target} memory.`
        return entries.map((e, i) => `${i + 1}. ${e}`).join('\n')
      }
      case 'add':
        return addEntry(target, content!)
      case 'replace':
        return replaceEntry(target, match!, content!)
      case 'remove':
        return removeEntry(target, match!)
      default:
        return `Unknown action: ${action}`
    }
  },
}
