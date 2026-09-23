import type { Tool } from '../types.js'
import { addTodo, updateTodo, removeTodo, clearTodos, getTodos, type TodoStatus } from '../../agent/todoStore.js'

type TodoOperation = { action: 'add' | 'update' | 'remove'; title?: string; id?: string; status?: TodoStatus }

function perform(operation: TodoOperation): string {
  if (operation.action === 'add') {
    if (!operation.title?.trim()) return 'Error: title is required for add'
    const item = addTodo(operation.title)
    return `Added: [${item.id}] ${item.title}`
  }
  if (operation.action === 'update') {
    if (!operation.id || !['pending', 'in_progress', 'done'].includes(operation.status ?? '')) return 'Error: id and valid status are required for update'
    return updateTodo(operation.id, operation.status!) ? `Updated [${operation.id}] → ${operation.status}` : `Todo [${operation.id}] not found`
  }
  if (operation.action === 'remove') {
    if (!operation.id) return 'Error: id is required for remove'
    return removeTodo(operation.id) ? `Removed [${operation.id}]` : `Todo [${operation.id}] not found`
  }
  return `Unknown action: ${String(operation.action)}`
}

/** Tool that adds, updates, clears or lists items in the in-memory todo store shown in the UI. */
export const Todo: Tool = {
  name: 'todo',
  description: `Manage a TODO list visible to the user in the UI. Use this to track your plan and progress on complex tasks.
Actions:
- add: add a new todo item (requires title)
- update: update status of an item (requires id and status: pending|in_progress|done)
- remove: remove one item (requires id)
- batch: perform multiple add, update or remove operations in order (requires operations)
- clear: remove all todos
- list: list all current todos`,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'update', 'remove', 'batch', 'clear', 'list'], description: 'Action to perform' },
      title: { type: 'string', description: 'Title for new todo (required for add)' },
      id: { type: 'string', description: 'Todo ID (required for update)' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: 'New status (required for update)' },
      operations: { type: 'array', description: 'Ordered operations for batch', items: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'update', 'remove'] }, title: { type: 'string' }, id: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['action'] } },
    },
    required: ['action'],
  },
  async execute(args) {
    const { action, title, id, status, operations } = args as { action: string; title?: string; id?: string; status?: TodoStatus; operations?: TodoOperation[] }
    switch (action) {
      case 'add': case 'update': case 'remove': return perform({ action, title, id, status })
      case 'batch': return Array.isArray(operations) && operations.length > 0
        ? operations.map(perform).join('\n')
        : 'Error: operations must be a non-empty array for batch'
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
