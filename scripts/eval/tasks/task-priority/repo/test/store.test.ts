import { expect, it } from 'bun:test'
import { TaskStore } from '../src/store'
import { formatTask } from '../src/format'

it('adds and lists tasks in insertion order', () => {
  const store = new TaskStore()
  store.add('a')
  store.add('b')
  expect(store.list().map((t) => t.title)).toEqual(['a', 'b'])
})

it('completes a task', () => {
  const store = new TaskStore()
  const task = store.add('a')
  store.complete(task.id)
  expect(store.list()[0]!.done).toBe(true)
})

it('formats a task', () => {
  expect(formatTask({ id: 1, title: 'a', done: false })).toBe('[ ] a')
})
