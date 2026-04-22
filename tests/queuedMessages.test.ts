import { describe, it, expect } from 'bun:test'
import { enqueue, dequeue, MAX_QUEUE_SIZE } from '../src/ui/queueLogic.js'

describe('queueLogic', () => {
  describe('MAX_QUEUE_SIZE', () => {
    it('should be 10', () => {
      expect(MAX_QUEUE_SIZE).toBe(10)
    })
  })

  describe('enqueue()', () => {
    it('should add message to empty queue', () => {
      // Arrange + Act
      const result = enqueue([], 'hello')

      // Assert
      expect(result).toEqual(['hello'])
    })

    it('should append message to end of existing queue (FIFO)', () => {
      // Arrange + Act
      const result = enqueue(['first'], 'second')

      // Assert
      expect(result).toEqual(['first', 'second'])
    })

    it('should maintain FIFO order with multiple sequential enqueues', () => {
      // Arrange
      let queue: string[] = []

      // Act
      queue = enqueue(queue, 'msg1')
      queue = enqueue(queue, 'msg2')
      queue = enqueue(queue, 'msg3')

      // Assert
      expect(queue).toEqual(['msg1', 'msg2', 'msg3'])
    })

    it('should not mutate the original queue array', () => {
      // Arrange
      const original = ['existing']

      // Act
      enqueue(original, 'new')

      // Assert
      expect(original).toEqual(['existing'])
    })

    it('should reject enqueue when queue is at MAX_QUEUE_SIZE', () => {
      // Arrange
      const full = Array.from({ length: MAX_QUEUE_SIZE }, (_, i) => `msg${i}`)

      // Act
      const result = enqueue(full, 'overflow')

      // Assert — queue unchanged
      expect(result).toEqual(full)
      expect(result.length).toBe(MAX_QUEUE_SIZE)
    })
  })

  describe('dequeue()', () => {
    it('should return null and empty array when queue is empty', () => {
      // Arrange + Act
      const result = dequeue([])

      // Assert
      expect(result.next).toBeNull()
      expect(result.remaining).toEqual([])
    })

    it('should return first message and the rest of the queue', () => {
      // Arrange + Act
      const result = dequeue(['first', 'second', 'third'])

      // Assert
      expect(result.next).toBe('first')
      expect(result.remaining).toEqual(['second', 'third'])
    })

    it('should return the only message and empty remaining when queue has one item', () => {
      // Arrange + Act
      const result = dequeue(['only'])

      // Assert
      expect(result.next).toBe('only')
      expect(result.remaining).toEqual([])
    })

    it('should not mutate the original queue array', () => {
      // Arrange
      const original = ['a', 'b']

      // Act
      dequeue(original)

      // Assert
      expect(original).toEqual(['a', 'b'])
    })
  })
})
