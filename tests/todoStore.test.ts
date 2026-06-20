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
  it('retorna array vazio após clear', () => {
    expect(getTodos()).toEqual([])
  })

  it('retorna todos adicionados', () => {
    addTodo('tarefa 1')
    addTodo('tarefa 2')
    expect(getTodos()).toHaveLength(2)
  })
})

describe('addTodo', () => {
  it('adiciona item com status pending', () => {
    const item = addTodo('minha tarefa')
    expect(item.status).toBe('pending')
  })

  it('retorna item com id, title e status', () => {
    const item = addTodo('teste')
    expect(item.id).toBeDefined()
    expect(item.title).toBe('teste')
    expect(item.status).toBe('pending')
  })

  it('id é uma string não vazia', () => {
    const item = addTodo('teste')
    expect(typeof item.id).toBe('string')
    expect(item.id.length).toBeGreaterThan(0)
  })

  it('múltiplos todos têm ids únicos', async () => {
    const a = addTodo('a')
    await new Promise(r => setTimeout(r, 2))
    const b = addTodo('b')
    expect(a.id).not.toBe(b.id)
  })
})

describe('updateTodo', () => {
  it('atualiza status e retorna true', () => {
    const item = addTodo('tarefa')
    const result = updateTodo(item.id, 'in_progress')
    expect(result).toBe(true)
    expect(getTodos()[0]?.status).toBe('in_progress')
  })

  it('atualiza para done', () => {
    const item = addTodo('tarefa')
    updateTodo(item.id, 'done')
    expect(getTodos()[0]?.status).toBe('done')
  })

  it('id inexistente retorna false', () => {
    const result = updateTodo('id-que-nao-existe', 'done')
    expect(result).toBe(false)
  })

  it('não altera outros todos', () => {
    const a = addTodo('a')
    const b = addTodo('b')
    updateTodo(a.id, 'done')
    expect(getTodos().find(t => t.id === b.id)?.status).toBe('pending')
  })
})

describe('clearTodos', () => {
  it('esvazia a lista', () => {
    addTodo('a')
    addTodo('b')
    clearTodos()
    expect(getTodos()).toEqual([])
  })
})

describe('subscribe', () => {
  it('listener é chamado ao addTodo', () => {
    const fn = mock(() => {})
    const unsub = subscribe(fn)
    addTodo('teste')
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('listener é chamado ao updateTodo', () => {
    const item = addTodo('teste')
    const fn = mock(() => {})
    const unsub = subscribe(fn)
    updateTodo(item.id, 'done')
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('listener é chamado ao clearTodos', () => {
    const fn = mock(() => {})
    const unsub = subscribe(fn)
    clearTodos()
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('unsubscribe remove o listener', () => {
    const fn = mock(() => {})
    const unsub = subscribe(fn)
    unsub()
    addTodo('teste')
    expect(fn).not.toHaveBeenCalled()
  })
})
