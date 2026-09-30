import { expect, test } from 'bun:test'
import { sortQueue } from '../src/queue.js'

test('keeps empty and one-ticket queues valid', () => {
  expect(sortQueue([])).toEqual([])
  expect(sortQueue([{ ref: 'T-1', score: 4 }])).toEqual([{ ref: 'T-1', score: 4 }])
})
