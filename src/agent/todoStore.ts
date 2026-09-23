import { randomBytes } from 'crypto'

export type TodoStatus = 'pending' | 'in_progress' | 'done'

export interface TodoItem {
  id: string
  title: string
  status: TodoStatus
}

let todos: TodoItem[] = []
const listeners = new Set<() => void>()

export function getTodos(): TodoItem[] { return todos }

/** Registers a listener called after every todo change; returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() { listeners.forEach((fn) => fn()) }

/** Appends a new pending todo with a random id and notifies listeners. */
export function addTodo(title: string): TodoItem {
  const item: TodoItem = { id: randomBytes(4).toString('hex'), title, status: 'pending' }
  todos = [...todos, item]
  notify()
  return item
}

/** Sets a todo's status and notifies listeners; returns false when the id is unknown. */
export function updateTodo(id: string, status: TodoStatus): boolean {
  const idx = todos.findIndex((t) => t.id === id)
  if (idx === -1) return false
  todos = todos.map((t) => (t.id === id ? { ...t, status } : t))
  notify()
  return true
}

/** Removes one item by id. */
export function removeTodo(id: string): boolean {
  if (!todos.some((t) => t.id === id)) return false
  todos = todos.filter((t) => t.id !== id)
  notify()
  return true
}

export function clearTodos(): void {
  todos = []
  notify()
}
