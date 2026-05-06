import { describe, it, expect } from 'bun:test'
import { parseKey, getMatches } from '../src/ui/input/InputBox.js'

describe('InputBox', () => {
  describe('parseKey()', () => {
    it('should parse arrow up sequence', () => {
      expect(parseKey('\x1b[A')).toMatchObject({ name: 'up' })
    })

    it('should parse arrow down sequence', () => {
      expect(parseKey('\x1b[B')).toMatchObject({ name: 'down' })
    })

    it('should parse arrow right sequence', () => {
      expect(parseKey('\x1b[C')).toMatchObject({ name: 'right' })
    })

    it('should parse arrow left sequence', () => {
      expect(parseKey('\x1b[D')).toMatchObject({ name: 'left' })
    })

    it('should parse home key', () => {
      expect(parseKey('\x1b[H')).toMatchObject({ name: 'home' })
    })

    it('should parse end key', () => {
      expect(parseKey('\x1b[F')).toMatchObject({ name: 'end' })
    })

    it('should parse delete key', () => {
      expect(parseKey('\x1b[3~')).toMatchObject({ name: 'delete' })
    })

    it('should parse backspace as non-ctrl non-meta', () => {
      const key = parseKey('\x7f')
      expect(key.name).toBe('backspace')
      expect(key.ctrl).toBe(false)
      expect(key.meta).toBe(false)
    })

    it('should parse carriage return as return', () => {
      expect(parseKey('\r')).toMatchObject({ name: 'return' })
    })

    it('should parse newline as return', () => {
      expect(parseKey('\n')).toMatchObject({ name: 'return' })
    })

    it('should parse escape key', () => {
      expect(parseKey('\x1b')).toMatchObject({ name: 'escape' })
    })

    it('should parse tab key', () => {
      expect(parseKey('\t')).toMatchObject({ name: 'tab' })
    })

    it('should return undefined name for regular printable char', () => {
      const key = parseKey('a')
      expect(key.name).toBeUndefined()
      expect(key.ctrl).toBe(false)
      expect(key.meta).toBe(false)
    })

    it('should preserve the original sequence in all cases', () => {
      expect(parseKey('\x1b[A').sequence).toBe('\x1b[A')
      expect(parseKey('z').sequence).toBe('z')
    })
  })

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

    it('should exclude exact match from results', () => {
      // /quit is an exact command — should not appear in its own matches
      const result = getMatches('/quit')
      expect(result).not.toContain('/quit')
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
