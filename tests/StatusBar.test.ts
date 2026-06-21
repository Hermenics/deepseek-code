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

    it('should render Build for build mode', () => {
      expect(MODE_LABELS['build']).toBe('Build')
    })

    it('should render Plan for plan mode', () => {
      expect(MODE_LABELS['plan']).toBe('Plan')
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

    it('should use green for build mode', () => {
      expect(MODE_COLORS['build']).toBe('green')
    })

    it('should use yellow for plan mode', () => {
      expect(MODE_COLORS['plan']).toBe('yellow')
    })

    it('should have distinct colors for all modes', () => {
      const colors = MODES.map((m) => MODE_COLORS[m])
      const unique = new Set(colors)
      expect(unique.size).toBe(MODES.length)
    })
  })
})
