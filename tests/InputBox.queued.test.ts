import { describe, it, expect, mock } from 'bun:test'
// handleEnterPress ainda não existe — este import vai falhar (RED phase)
import { handleEnterPress } from '../src/ui/input/InputBox.js'

describe('InputBox — queued messages behavior', () => {
  describe('handleEnterPress()', () => {
    it('should call onQueue and not onSubmit when isLoading is true', () => {
      // Arrange
      const onSubmit = mock(() => {})
      const onQueue = mock(() => {})

      // Act
      handleEnterPress({ value: 'hello world', isLoading: true, onSubmit, onQueue })

      // Assert
      expect(onQueue).toHaveBeenCalledTimes(1)
      expect(onQueue).toHaveBeenCalledWith('hello world')
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should signal input clear after queuing when isLoading is true', () => {
      // Arrange
      const onSubmit = mock(() => {})
      const onQueue = mock(() => {})

      // Act
      const result = handleEnterPress({ value: 'hello', isLoading: true, onSubmit, onQueue })

      // Assert
      expect(result.clearInput).toBe(true)
    })

    it('should call onSubmit and not onQueue when isLoading is false', () => {
      // Arrange
      const onSubmit = mock(() => {})
      const onQueue = mock(() => {})

      // Act
      handleEnterPress({ value: 'hello world', isLoading: false, onSubmit, onQueue })

      // Assert
      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect(onSubmit).toHaveBeenCalledWith('hello world')
      expect(onQueue).not.toHaveBeenCalled()
    })

    it('should not call onQueue when value is empty and isLoading is true', () => {
      // Arrange
      const onSubmit = mock(() => {})
      const onQueue = mock(() => {})

      // Act
      handleEnterPress({ value: '', isLoading: true, onSubmit, onQueue })

      // Assert
      expect(onQueue).not.toHaveBeenCalled()
    })

    it('should not call onSubmit when value is empty and isLoading is false', () => {
      // Arrange
      const onSubmit = mock(() => {})
      const onQueue = mock(() => {})

      // Act
      handleEnterPress({ value: '', isLoading: false, onSubmit, onQueue })

      // Assert
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should work without onQueue prop when isLoading is false (backward compat)', () => {
      // Arrange
      const onSubmit = mock(() => {})

      // Act + Assert — não deve lançar erro
      expect(() => {
        handleEnterPress({ value: 'test', isLoading: false, onSubmit })
      }).not.toThrow()
      expect(onSubmit).toHaveBeenCalledWith('test')
    })
  })
})
