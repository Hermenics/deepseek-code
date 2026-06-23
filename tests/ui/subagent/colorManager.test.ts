import { describe, it, expect } from 'bun:test'
import { getAgentColor, AGENT_COLOR_KEYS } from '../../../src/ui/subagent/colorManager.js'
import { getThemeColors } from '../../../src/ui/theme.js'

const darkColors = getThemeColors('dark')
const lightColors = getThemeColors('light')

describe('colorManager', () => {
  describe('AGENT_COLOR_KEYS', () => {
    it('should have 8 color keys', () => {
      expect(AGENT_COLOR_KEYS.length).toBe(8)
    })

    it('should contain all expected color names', () => {
      const expected = ['agentBlue', 'agentGreen', 'agentYellow', 'agentPurple', 'agentOrange', 'agentPink', 'agentCyan', 'agentRed'] as const
      for (const key of expected) {
        expect(AGENT_COLOR_KEYS).toContain(key as typeof AGENT_COLOR_KEYS[number])
      }
    })
  })

  describe('getAgentColor', () => {
    it('should return the color for index 0 (agentBlue) with dark theme', () => {
      const result = getAgentColor(0, darkColors)
      expect(result).toBe(darkColors.agentBlue)
    })

    it('should return the color for index 1 (agentGreen) with dark theme', () => {
      const result = getAgentColor(1, darkColors)
      expect(result).toBe(darkColors.agentGreen)
    })

    it('should return the color for index 2 (agentYellow) with dark theme', () => {
      const result = getAgentColor(2, darkColors)
      expect(result).toBe(darkColors.agentYellow)
    })

    it('should return the color for index 7 (agentRed) with dark theme', () => {
      const result = getAgentColor(7, darkColors)
      expect(result).toBe(darkColors.agentRed)
    })

    it('should round-robin: index 8 returns same as index 0', () => {
      const result0 = getAgentColor(0, darkColors)
      const result8 = getAgentColor(8, darkColors)
      expect(result8).toBe(result0)
    })

    it('should round-robin: index 9 returns same as index 1', () => {
      const result1 = getAgentColor(1, darkColors)
      const result9 = getAgentColor(9, darkColors)
      expect(result9).toBe(result1)
    })

    it('should round-robin: index 16 returns same as index 0', () => {
      const result0 = getAgentColor(0, darkColors)
      const result16 = getAgentColor(16, darkColors)
      expect(result16).toBe(result0)
    })

    it('should work with light theme colors', () => {
      const result = getAgentColor(0, lightColors)
      expect(result).toBe(lightColors.agentBlue)
    })

    it('should return different color for index 0 vs index 1 with light theme', () => {
      const result0 = getAgentColor(0, lightColors)
      const result1 = getAgentColor(1, lightColors)
      expect(result0).not.toBe(result1)
    })

    it('should return a non-empty string', () => {
      const result = getAgentColor(3, darkColors)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })
})
