import { expect, test } from 'bun:test'
import { sortQueue } from '../src/queue.js'

test('sorts scores numerically rather than lexicographically', () => {
  expect(sortQueue([{ ref: 'T-9', score: 9 }, { ref: 'T-120', score: 120 }, { ref: 'T-24', score: 24 }]).map(row => row.score)).toEqual([9, 24, 120])
})
