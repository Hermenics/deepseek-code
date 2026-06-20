import { describe, it, expect } from 'bun:test'
// truncateMessage e buildQueueItems ainda não existem — RED phase
import { truncateMessage, buildQueueItems, MAX_MSG_LEN } from '../src/ui/input/QueuedMessagesList.js'

describe('QueuedMessagesList', () => {
  describe('MAX_MSG_LEN', () => {
    it('should be a positive number', () => {
      expect(typeof MAX_MSG_LEN).toBe('number')
      expect(MAX_MSG_LEN).toBeGreaterThan(0)
    })
  })

  describe('truncateMessage()', () => {
    it('should return message unchanged when shorter than MAX_MSG_LEN', () => {
      // Arrange
      const short = 'a'.repeat(MAX_MSG_LEN - 1)

      // Act
      const result = truncateMessage(short)

      // Assert
      expect(result).toBe(short)
    })

    it('should return message unchanged when exactly MAX_MSG_LEN characters', () => {
      // Arrange
      const exact = 'a'.repeat(MAX_MSG_LEN)

      // Act
      const result = truncateMessage(exact)

      // Assert
      expect(result).toBe(exact)
    })

    it('should truncate and append ellipsis when message exceeds MAX_MSG_LEN', () => {
      // Arrange
      const long = 'a'.repeat(MAX_MSG_LEN + 10)

      // Act
      const result = truncateMessage(long)

      // Assert
      expect(result.endsWith('…')).toBe(true)
      expect(result.length).toBeLessThan(long.length)
    })

    it('should truncate to MAX_MSG_LEN chars plus ellipsis', () => {
      // Arrange
      const long = 'x'.repeat(MAX_MSG_LEN + 20)

      // Act
      const result = truncateMessage(long)

      // Assert
      expect(result).toBe('x'.repeat(MAX_MSG_LEN) + '…')
    })

    it('should handle empty string without throwing', () => {
      expect(() => truncateMessage('')).not.toThrow()
      expect(truncateMessage('')).toBe('')
    })
  })

  describe('buildQueueItems()', () => {
    it('should return empty array when messages is empty', () => {
      // Arrange + Act
      const result = buildQueueItems([])

      // Assert
      expect(result).toEqual([])
    })

    it('should return one item for each message', () => {
      // Arrange
      const messages = ['msg1', 'msg2', 'msg3']

      // Act
      const result = buildQueueItems(messages)

      // Assert
      expect(result.length).toBe(3)
    })

    it('should preserve message text in each item', () => {
      // Arrange
      const messages = ['hello', 'world']

      // Act
      const result = buildQueueItems(messages)

      // Assert
      expect(result[0]!.text).toBe('hello')
      expect(result[1]!.text).toBe('world')
    })

    it('should truncate long messages in items', () => {
      // Arrange
      const longMsg = 'z'.repeat(MAX_MSG_LEN + 5)

      // Act
      const result = buildQueueItems([longMsg])

      // Assert
      expect(result[0]!.text.endsWith('…')).toBe(true)
    })

    it('should maintain original order (FIFO)', () => {
      // Arrange
      const messages = ['first', 'second', 'third']

      // Act
      const result = buildQueueItems(messages)

      // Assert
      expect(result[0]!.text).toBe('first')
      expect(result[1]!.text).toBe('second')
      expect(result[2]!.text).toBe('third')
    })
  })
})
