import { describe, it, expect, beforeEach, mock } from 'bun:test'
import {
  getTodos,
  addTodo,
  updateTodo,
  clearTodos,
  subscribe,
} from '../src/agent/todoStore.js'

beforeEach(() => {
  clearTodos()
})

describe('getTodos', () => {
  it('returns an empty array after clear', () => {
    expect(getTodos()).toEqual([])
  })

  it('returns all added todos', () => {
    addTodo('task 1')
    addTodo('task 2')
    expect(getTodos()).toHaveLength(2)
  })
})

describe('addTodo', () => {
  it('adds an item with pending status', () => {
    const item = addTodo('my task')
    expect(item.status).toBe('pending')
  })

  it('returns an item with id, title, and status', () => {
    const item = addTodo('test')
    expect(item.id).toBeDefined()
    expect(item.title).toBe('test')
    expect(item.status).toBe('pending')
  })

  it('id is a non-empty string', () => {
    const item = addTodo('test')
    expect(typeof item.id).toBe('string')
    expect(item.id.length).toBeGreaterThan(0)
  })

  it('multiple todos have unique ids', async () => {
    const a = addTodo('a')
    await new Promise(r => setTimeout(r, 2))
    const b = addTodo('b')
    expect(a.id).not.toBe(b.id)
  })
})

describe('updateTodo', () => {
  it('updates status and returns true', () => {
    const item = addTodo('task')
    const result = updateTodo(item.id, 'in_progress')
    expect(result).toBe(true)
    expect(getTodos()[0]?.status).toBe('in_progress')
  })

  it('updates to done', () => {
    const item = addTodo('task')
    updateTodo(item.id, 'done')
    expect(getTodos()[0]?.status).toBe('done')
  })

  it('returns false for a nonexistent id', () => {
    const result = updateTodo('nonexistent-id', 'done')
    expect(result).toBe(false)
  })

  it('does not change other todos', () => {
    const a = addTodo('a')
    const b = addTodo('b')
    updateTodo(a.id, 'done')
    expect(getTodos().find(t => t.id === b.id)?.status).toBe('pending')
  })
})

describe('clearTodos', () => {
  it('empties the list', () => {
    addTodo('a')
    addTodo('b')
    clearTodos()
    expect(getTodos()).toEqual([])
  })
})

describe('subscribe', () => {
  it('calls the listener when addTodo runs', () => {
    const fn = mock(() => {})
    const unsub = subscribe(fn)
    addTodo('test')
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('calls the listener when updateTodo runs', () => {
    const item = addTodo('test')
    const fn = mock(() => {})
    const unsub = subscribe(fn)
    updateTodo(item.id, 'done')
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('calls the listener when clearTodos runs', () => {
    const fn = mock(() => {})
    const unsub = subscribe(fn)
    clearTodos()
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('unsubscribe removes the listener', () => {
    const fn = mock(() => {})
    const unsub = subscribe(fn)
    unsub()
    addTodo('test')
    expect(fn).not.toHaveBeenCalled()
  })
})
