import { describe, it, expect } from 'bun:test'
import {
  COMPACT_BOUNDARY_ROLE,
  createBoundaryMarker,
  isBoundaryMarker,
  getMessagesAfterBoundary,
  type MessageOrBoundary,
} from './compactBoundary'

describe('isBoundaryMarker', () => {
  it('should return true for a boundary marker', () => {
    // Arrange
    const marker: MessageOrBoundary = { role: COMPACT_BOUNDARY_ROLE }

    // Act
    const result = isBoundaryMarker(marker)

    // Assert
    expect(result).toBe(true)
  })

  it('should return false for a system message', () => {
    // Arrange
    const msg: MessageOrBoundary = { role: 'system', content: 'You are a helpful assistant.' }

    // Act
    const result = isBoundaryMarker(msg)

    // Assert
    expect(result).toBe(false)
  })

  it('should return false for a user message', () => {
    // Arrange
    const msg: MessageOrBoundary = { role: 'user', content: 'Hello' }

    // Act
    const result = isBoundaryMarker(msg)

    // Assert
    expect(result).toBe(false)
  })

  it('should return false for an assistant message', () => {
    // Arrange
    const msg: MessageOrBoundary = { role: 'assistant', content: 'Hi there!' }

    // Act
    const result = isBoundaryMarker(msg)

    // Assert
    expect(result).toBe(false)
  })
})

describe('createBoundaryMarker', () => {
  it('should return an object with role equal to COMPACT_BOUNDARY_ROLE', () => {
    // Act
    const marker = createBoundaryMarker()

    // Assert
    expect(marker.role).toBe(COMPACT_BOUNDARY_ROLE)
  })
})

describe('getMessagesAfterBoundary', () => {
  const system: MessageOrBoundary = { role: 'system', content: 'System prompt.' }
  const user1: MessageOrBoundary = { role: 'user', content: 'First user message.' }
  const assistant1: MessageOrBoundary = { role: 'assistant', content: 'First assistant reply.' }
  const user2: MessageOrBoundary = { role: 'user', content: 'Second user message.' }
  const assistant2: MessageOrBoundary = { role: 'assistant', content: 'Second assistant reply.' }
  const boundary = { role: COMPACT_BOUNDARY_ROLE } as MessageOrBoundary

  it('should return the full array unchanged when there is no boundary', () => {
    // Arrange
    const messages: MessageOrBoundary[] = [system, user1, assistant1]

    // Act
    const result = getMessagesAfterBoundary(messages)

    // Assert
    expect(result).toEqual([system, user1, assistant1])
  })

  it('should return [system, ...messages after boundary] when there is one boundary', () => {
    // Arrange
    const messages: MessageOrBoundary[] = [system, user1, assistant1, boundary, user2, assistant2]

    // Act
    const result = getMessagesAfterBoundary(messages)

    // Assert
    expect(result).toEqual([system, user2, assistant2])
  })

  it('should use the LAST boundary when there are multiple boundaries', () => {
    // Arrange
    const boundary2 = { role: COMPACT_BOUNDARY_ROLE } as MessageOrBoundary
    const messages: MessageOrBoundary[] = [
      system,
      user1,
      boundary,
      assistant1,
      user2,
      boundary2,
      assistant2,
    ]

    // Act
    const result = getMessagesAfterBoundary(messages)

    // Assert
    expect(result).toEqual([system, assistant2])
  })

  it('should return only [system] when boundary is the last element', () => {
    // Arrange
    const messages: MessageOrBoundary[] = [system, user1, assistant1, boundary]

    // Act
    const result = getMessagesAfterBoundary(messages)

    // Assert
    expect(result).toEqual([system])
  })

  it('should never contain boundary markers in the result', () => {
    // Arrange
    const messages: MessageOrBoundary[] = [system, user1, boundary, user2, assistant2]

    // Act
    const result = getMessagesAfterBoundary(messages)

    // Assert
    const hasBoundary = result.some((m) => (m.role as string) === COMPACT_BOUNDARY_ROLE)
    expect(hasBoundary).toBe(false)
  })

  it('should always have the system prompt as the first element when boundary exists', () => {
    // Arrange
    const messages: MessageOrBoundary[] = [system, user1, boundary, user2]

    // Act
    const result = getMessagesAfterBoundary(messages)

    // Assert
    expect(result[0]).toEqual(system)
  })

  it('should return an empty array when input is empty', () => {
    // Arrange
    const messages: MessageOrBoundary[] = []

    // Act
    const result = getMessagesAfterBoundary(messages)

    // Assert
    expect(result).toEqual([])
  })

  it('should return [system] when input has only a system message and no boundary', () => {
    // Arrange
    const messages: MessageOrBoundary[] = [system]

    // Act
    const result = getMessagesAfterBoundary(messages)

    // Assert
    expect(result).toEqual([system])
  })
})
