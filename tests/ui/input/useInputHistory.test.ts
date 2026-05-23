import { describe, it, expect, beforeEach } from 'bun:test'

// Este import testa o contrato do hook React useInputHistory.
// A implementação atual exporta a classe InputHistory (não um hook React
// com a assinatura UseInputHistoryResult). O teste vai falhar (RED) porque
// useInputHistory como função hook com esse retorno não existe ainda.
import { useInputHistory } from '../../../src/ui/input/hooks/useInputHistory.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cria uma instância do hook com histórico pré-carregado.
 * O hook deve aceitar um array inicial de entradas.
 */
function createHistory(entries: string[] = []) {
  return useInputHistory({ entries })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useInputHistory', () => {
  describe('historyUp', () => {
    it('should return the last entry when historyUp is called with empty draft', () => {
      const history = createHistory(['first', 'second', 'third'])

      const result = history.historyUp('')

      expect(result).toBe('third')
    })

    it('should return progressively older entries on successive historyUp calls', () => {
      const history = createHistory(['first', 'second', 'third'])

      history.historyUp('')
      const result = history.historyUp('')

      expect(result).toBe('second')
    })

    it('should return undefined when historyUp is called on empty history', () => {
      const history = createHistory([])

      const result = history.historyUp('draft text')

      expect(result).toBeUndefined()
    })

    it('should return undefined when already at the oldest entry', () => {
      const history = createHistory(['only'])

      history.historyUp('')   // goes to 'only'
      const result = history.historyUp('')  // already at oldest

      expect(result).toBeUndefined()
    })

    it('should preserve the draft passed to the first historyUp call', () => {
      const history = createHistory(['entry1'])

      history.historyUp('my draft')
      // navigate back down to restore draft
      const restored = history.historyDown()

      expect(restored).toBe('my draft')
    })
  })

  describe('historyDown', () => {
    it('should return the next newer entry when historyDown is called mid-navigation', () => {
      const history = createHistory(['first', 'second', 'third'])

      history.historyUp('')   // → 'third'
      history.historyUp('')   // → 'second'
      const result = history.historyDown()  // → 'third'

      expect(result).toBe('third')
    })

    it('should return the saved draft when historyDown is called at the newest entry', () => {
      const history = createHistory(['first', 'second'])

      history.historyUp('current draft')  // → 'second'
      const result = history.historyDown()  // → restore draft

      expect(result).toBe('current draft')
    })

    it('should return undefined when historyDown is called without prior historyUp', () => {
      const history = createHistory(['first', 'second'])

      const result = history.historyDown()

      expect(result).toBeUndefined()
    })
  })

  describe('resetHistory', () => {
    it('should make isNavigating false after reset', () => {
      const history = createHistory(['entry1', 'entry2'])

      history.historyUp('')
      history.resetHistory()

      expect(history.isNavigating).toBe(false)
    })

    it('should make historyDown return undefined after reset', () => {
      const history = createHistory(['entry1', 'entry2'])

      history.historyUp('')
      history.resetHistory()

      const result = history.historyDown()

      expect(result).toBeUndefined()
    })

    it('should allow historyUp to start fresh after reset', () => {
      const history = createHistory(['first', 'second'])

      history.historyUp('')   // → 'second'
      history.historyUp('')   // → 'first'
      history.resetHistory()

      // After reset, historyUp should start from the end again
      const result = history.historyUp('new draft')

      expect(result).toBe('second')
    })
  })

  describe('isNavigating', () => {
    it('should be false before any navigation', () => {
      const history = createHistory(['entry1'])

      expect(history.isNavigating).toBe(false)
    })

    it('should be true after historyUp is called', () => {
      const history = createHistory(['entry1'])

      history.historyUp('')

      expect(history.isNavigating).toBe(true)
    })

    it('should be false after navigating back to draft via historyDown', () => {
      const history = createHistory(['entry1'])

      history.historyUp('draft')
      history.historyDown()  // restores draft, exits navigation

      expect(history.isNavigating).toBe(false)
    })
  })
})
