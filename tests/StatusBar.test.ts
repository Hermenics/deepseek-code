import { describe, it, expect } from 'bun:test'
import { MODE_COLORS, MODE_LABELS, MODES } from '../src/ui/interactionMode.js'

describe('StatusBar', () => {
  describe('MODE_LABELS', () => {
    it('should define a label for every mode in the cycle', () => {
      MODES.forEach((mode) => {
        expect(MODE_LABELS[mode]).toBeDefined()
        expect(typeof MODE_LABELS[mode]).toBe('string')
        expect(MODE_LABELS[mode].length).toBeGreaterThan(0)
      })
    })

    it('should render Chat for chat mode', () => {
      expect(MODE_LABELS['chat']).toBe('Chat')
    })

    it('should render Plan for plan mode', () => {
      expect(MODE_LABELS['plan']).toBe('Plan')
    })

    it('should render Agent for agent mode', () => {
      expect(MODE_LABELS['agent']).toBe('Agent')
    })

    it('should render Auto for auto-accept mode', () => {
      expect(MODE_LABELS['auto-accept']).toBe('Auto')
    })
  })

  describe('MODE_COLORS', () => {
    it('should define a color for every mode in the cycle', () => {
      MODES.forEach((mode) => {
        expect(MODE_COLORS[mode]).toBeDefined()
        expect(typeof MODE_COLORS[mode]).toBe('string')
        expect(MODE_COLORS[mode].length).toBeGreaterThan(0)
      })
    })

    it('should use blue for chat mode', () => {
      expect(MODE_COLORS['chat']).toBe('blue')
    })

    it('should use yellow for plan mode', () => {
      expect(MODE_COLORS['plan']).toBe('yellow')
    })

    it('should use green for agent mode', () => {
      expect(MODE_COLORS['agent']).toBe('green')
    })

    it('should use red for auto-accept mode (danger signal)', () => {
      expect(MODE_COLORS['auto-accept']).toBe('red')
    })

    it('should have distinct colors for all 4 modes', () => {
      const colors = MODES.map((m) => MODE_COLORS[m])
      const unique = new Set(colors)
      expect(unique.size).toBe(MODES.length)
    })
  })
})
