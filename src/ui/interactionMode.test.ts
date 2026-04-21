import { describe, it, expect } from 'bun:test'
import {
  nextMode,
  isAutoAccept,
  canUseTool,
  canModelActivateMode,
  DEFAULT_MODE,
  MODES,
  type InteractionMode,
} from './interactionMode.js'

describe('interactionMode', () => {
  describe('MODES', () => {
    it('should define the cycle order as chat, plan, agent, auto-accept', () => {
      expect(MODES).toEqual(['chat', 'plan', 'agent', 'auto-accept'])
    })
  })

  describe('DEFAULT_MODE', () => {
    it('should have chat as the default initial mode', () => {
      expect(DEFAULT_MODE).toBe('chat')
    })
  })

  describe('nextMode()', () => {
    it('should return plan when current mode is chat', () => {
      expect(nextMode('chat')).toBe('plan')
    })

    it('should return agent when current mode is plan', () => {
      expect(nextMode('plan')).toBe('agent')
    })

    it('should return auto-accept when current mode is agent', () => {
      expect(nextMode('agent')).toBe('auto-accept')
    })

    it('should return chat when current mode is auto-accept (full cycle)', () => {
      expect(nextMode('auto-accept')).toBe('chat')
    })

    it('should return chat after 8 consecutive calls starting from chat (2 complete cycles)', () => {
      // Arrange
      let mode: InteractionMode = 'chat'

      // Act — 8 trocas = 2 ciclos completos
      for (let i = 0; i < 8; i++) {
        mode = nextMode(mode)
      }

      // Assert
      expect(mode).toBe('chat')
    })
  })

  describe('isAutoAccept()', () => {
    it('should return true for auto-accept', () => {
      expect(isAutoAccept('auto-accept')).toBe(true)
    })

    it('should return false for chat', () => {
      expect(isAutoAccept('chat')).toBe(false)
    })

    it('should return false for plan', () => {
      expect(isAutoAccept('plan')).toBe(false)
    })

    it('should return false for agent', () => {
      expect(isAutoAccept('agent')).toBe(false)
    })
  })

  describe('canUseTool()', () => {
    describe('chat mode', () => {
      it('should allow read_file', () => {
        expect(canUseTool('chat', 'read_file')).toBe(true)
      })

      it('should allow web_fetch', () => {
        expect(canUseTool('chat', 'web_fetch')).toBe(true)
      })

      it('should allow shell', () => {
        expect(canUseTool('chat', 'shell')).toBe(true)
      })

      it('should block write_file', () => {
        expect(canUseTool('chat', 'write_file')).toBe(false)
      })
    })

    describe('plan mode', () => {
      it('should allow read_file', () => {
        expect(canUseTool('plan', 'read_file')).toBe(true)
      })

      it('should allow web_fetch', () => {
        expect(canUseTool('plan', 'web_fetch')).toBe(true)
      })

      it('should block write_file', () => {
        expect(canUseTool('plan', 'write_file')).toBe(false)
      })

      it('should block shell', () => {
        expect(canUseTool('plan', 'shell')).toBe(false)
      })
    })

    describe('agent mode', () => {
      it('should allow read_file', () => {
        expect(canUseTool('agent', 'read_file')).toBe(true)
      })

      it('should allow write_file', () => {
        expect(canUseTool('agent', 'write_file')).toBe(true)
      })

      it('should allow shell', () => {
        expect(canUseTool('agent', 'shell')).toBe(true)
      })

      it('should allow web_fetch', () => {
        expect(canUseTool('agent', 'web_fetch')).toBe(true)
      })
    })

    describe('auto-accept mode', () => {
      it('should allow read_file (same as agent)', () => {
        expect(canUseTool('auto-accept', 'read_file')).toBe(true)
      })

      it('should allow write_file (same as agent)', () => {
        expect(canUseTool('auto-accept', 'write_file')).toBe(true)
      })

      it('should allow shell (same as agent)', () => {
        expect(canUseTool('auto-accept', 'shell')).toBe(true)
      })

      it('should allow web_fetch (same as agent)', () => {
        expect(canUseTool('auto-accept', 'web_fetch')).toBe(true)
      })
    })
  })

  describe('canModelActivateMode()', () => {
    it('should return false for auto-accept (model can never activate it)', () => {
      expect(canModelActivateMode('auto-accept')).toBe(false)
    })

    it('should return true for chat', () => {
      expect(canModelActivateMode('chat')).toBe(true)
    })

    it('should return true for plan', () => {
      expect(canModelActivateMode('plan')).toBe(true)
    })

    it('should return true for agent', () => {
      expect(canModelActivateMode('agent')).toBe(true)
    })
  })
})
