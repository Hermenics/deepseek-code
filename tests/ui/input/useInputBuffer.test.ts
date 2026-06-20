import { describe, it, expect, beforeEach } from 'bun:test'

// Este import testa o contrato do hook React useInputBuffer.
// A implementação atual exporta a classe InputBuffer (não um hook React
// com a assinatura UseInputBufferResult). O teste vai falhar (RED) porque
// useInputBuffer como função hook não existe ainda.
import { useInputBuffer } from '../../../src/ui/input/hooks/useInputBuffer.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simula a chamada do hook fora do contexto React.
 * O hook deve ser uma função pura que retorna UseInputBufferResult
 * (ou aceitar ser chamado diretamente em testes sem renderHook).
 */
function createBuffer() {
  return useInputBuffer()
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useInputBuffer', () => {
  describe('push and undo', () => {
    it('should return the first entry when undo is called after two pushes', () => {
      const buf = createBuffer()

      buf.pushToBuffer('hello', 5)
      buf.pushToBuffer('world', 5)

      const entry = buf.undo()

      expect(entry).toBeDefined()
      expect(entry!.text).toBe('hello')
      expect(entry!.cursorOffset).toBe(5)
    })

    it('should return undefined when undo is called on empty buffer', () => {
      const buf = createBuffer()

      const entry = buf.undo()

      expect(entry).toBeUndefined()
    })

    it('should return undefined when undo is called with only one entry (nothing to go back to)', () => {
      const buf = createBuffer()

      buf.pushToBuffer('only', 4)

      const entry = buf.undo()

      expect(entry).toBeUndefined()
    })
  })

  describe('redo after undo', () => {
    it('should return the second entry when redo is called after push→push→undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()

      const entry = buf.redo()

      expect(entry).toBeDefined()
      expect(entry!.text).toBe('second')
      expect(entry!.cursorOffset).toBe(6)
    })

    it('should return undefined when redo is called without a prior undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('hello', 5)

      const entry = buf.redo()

      expect(entry).toBeUndefined()
    })
  })

  describe('canUndo and canRedo', () => {
    it('should have canUndo=false and canRedo=false on empty buffer', () => {
      const buf = createBuffer()

      expect(buf.canUndo).toBe(false)
      expect(buf.canRedo).toBe(false)
    })

    it('should have canUndo=false after single push (nothing to undo to)', () => {
      const buf = createBuffer()

      buf.pushToBuffer('only', 4)

      expect(buf.canUndo).toBe(false)
    })

    it('should have canUndo=true after two pushes', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)

      expect(buf.canUndo).toBe(true)
    })

    it('should have canRedo=true after push→push→undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()

      expect(buf.canRedo).toBe(true)
    })

    it('should have canRedo=false after push→push→undo→redo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()
      buf.redo()

      expect(buf.canRedo).toBe(false)
    })
  })

  describe('clearBuffer', () => {
    it('should reset canUndo and canRedo to false after clear', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.clearBuffer()

      expect(buf.canUndo).toBe(false)
      expect(buf.canRedo).toBe(false)
    })

    it('should return undefined for undo after clear', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.clearBuffer()

      expect(buf.undo()).toBeUndefined()
    })
  })

  describe('push after undo discards redo stack', () => {
    it('should make canRedo=false when a new push happens after undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()

      // Nova entrada descarta o redo stack
      buf.pushToBuffer('third', 5)

      expect(buf.canRedo).toBe(false)
    })

    it('should not be able to redo to "second" after push("third") following undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()
      buf.pushToBuffer('third', 5)

      const entry = buf.redo()

      expect(entry).toBeUndefined()
    })
  })
})
