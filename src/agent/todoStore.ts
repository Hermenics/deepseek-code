export type TodoStatus = 'pending' | 'in_progress' | 'done'

export interface TodoItem {
  id: string
  title: string
  status: TodoStatus
}

let todos: TodoItem[] = []
const listeners = new Set<() => void>()

export function getTodos(): TodoItem[] { return todos }

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() { listeners.forEach((fn) => fn()) }

export function addTodo(title: string): TodoItem {
  const item: TodoItem = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title, status: 'pending' }
  todos = [...todos, item]
  notify()
  return item
}

export function updateTodo(id: string, status: TodoStatus): boolean {
  const idx = todos.findIndex((t) => t.id === id)
  if (idx === -1) return false
  todos = todos.map((t) => (t.id === id ? { ...t, status } : t))
  notify()
  return true
}

export function clearTodos(): void {
  todos = []
  notify()
}
