import { expect, it } from 'bun:test'
import { LRUCache } from '../src/lru'

it('rejects a capacity below 1', () => {
  expect(() => new LRUCache(0)).toThrow(RangeError)
})

it('evicts the least recently used entry', () => {
  const cache = new LRUCache<string, number>(2)
  cache.set('a', 1)
  cache.set('b', 2)
  cache.get('a')
  cache.set('c', 3)
  expect(cache.has('b')).toBe(false)
  expect(cache.get('a')).toBe(1)
  expect(cache.get('c')).toBe(3)
  expect(cache.size).toBe(2)
})

it('refreshes recency on update without growing', () => {
  const cache = new LRUCache<string, number>(2)
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('a', 10)
  cache.set('c', 3)
  expect(cache.get('a')).toBe(10)
  expect(cache.has('b')).toBe(false)
  expect(cache.size).toBe(2)
})

it('has() does not change recency', () => {
  const cache = new LRUCache<string, number>(2)
  cache.set('a', 1)
  cache.set('b', 2)
  cache.has('a')
  cache.set('c', 3)
  expect(cache.has('a')).toBe(false)
  expect(cache.has('b')).toBe(true)
})

it('expires entries ttlMs after they were set', () => {
  let time = 0
  const cache = new LRUCache<string, number>(3, 100, () => time)
  cache.set('a', 1)
  time = 99
  expect(cache.get('a')).toBe(1)
  time = 200
  expect(cache.get('a')).toBeUndefined()
  expect(cache.has('a')).toBe(false)
  expect(cache.size).toBe(0)
})

it('counts only live entries in size', () => {
  let time = 0
  const cache = new LRUCache<string, number>(3, 50, () => time)
  cache.set('a', 1)
  time = 30
  cache.set('b', 2)
  time = 60
  expect(cache.size).toBe(1)
})

it('delete reports whether the key existed', () => {
  const cache = new LRUCache<string, number>(2)
  cache.set('a', 1)
  expect(cache.delete('a')).toBe(true)
  expect(cache.delete('a')).toBe(false)
})
