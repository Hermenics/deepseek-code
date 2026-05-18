import { describe, it, expect } from 'bun:test'
import { getMatches } from '../src/ui/input/commandMatches.js'

describe('InputBox', () => {
  describe('getMatches()', () => {
    it('should return empty array for empty string', () => {
      expect(getMatches('')).toEqual([])
    })

    it('should return empty array for string not starting with /', () => {
      expect(getMatches('help')).toEqual([])
      expect(getMatches('clear')).toEqual([])
    })

    it('should return matching commands for partial /c prefix', () => {
      const result = getMatches('/c')
      expect(result.length).toBeGreaterThan(0)
      result.forEach((cmd) => expect(cmd.startsWith('/c')).toBe(true))
    })

    it('should include exact match in results', () => {
      const result = getMatches('/quit')
      expect(result).toContain('/quit')
    })

    it('should return empty array when no command matches the prefix', () => {
      expect(getMatches('/zzznomatch')).toEqual([])
    })

    it('should return all commands starting with /a', () => {
      const result = getMatches('/a')
      expect(result).toContain('/agent')
      expect(result).toContain('/agents')
    })

    it('should not return commands that do not start with the given prefix', () => {
      const result = getMatches('/cl')
      result.forEach((cmd) => expect(cmd.startsWith('/cl')).toBe(true))
    })

    it('should handle / alone and return all commands', () => {
      const result = getMatches('/')
      expect(result.length).toBeGreaterThan(0)
      result.forEach((cmd) => expect(cmd.startsWith('/')).toBe(true))
    })
  })
})
