import type { Tool } from './types.js'
import { addTodo, updateTodo, clearTodos, getTodos, type TodoStatus } from '../agent/todoStore.js'

export const Todo: Tool = {
  name: 'todo',
  description: `Manage a TODO list visible to the user in the UI. Use this to track your plan and progress on complex tasks.
Actions:
- add: add a new todo item (requires title)
- update: update status of an item (requires id and status: pending|in_progress|done)
- clear: remove all todos
- list: list all current todos`,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'update', 'clear', 'list'], description: 'Action to perform' },
      title: { type: 'string', description: 'Title for new todo (required for add)' },
      id: { type: 'string', description: 'Todo ID (required for update)' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: 'New status (required for update)' },
    },
    required: ['action'],
  },
  async execute(args) {
    const { action, title, id, status } = args as { action: string; title?: string; id?: string; status?: string }
    switch (action) {
      case 'add': {
        if (!title) return 'Error: title is required for add'
        const item = addTodo(title)
        return `Added: [${item.id}] ${item.title}`
      }
      case 'update': {
        if (!id || !status) return 'Error: id and status are required for update'
        const ok = updateTodo(id, status as TodoStatus)
        return ok ? `Updated [${id}] → ${status}` : `Todo [${id}] not found`
      }
      case 'clear': {
        clearTodos()
        return 'Todos cleared'
      }
      case 'list': {
        const items = getTodos()
        if (!items.length) return 'No todos'
        return items.map((t) => `[${t.status}] ${t.id}: ${t.title}`).join('\n')
      }
      default: return `Unknown action: ${action}`
    }
  },
}
