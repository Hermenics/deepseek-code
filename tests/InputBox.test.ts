import { describe, it, expect } from 'bun:test'
import { getMatches } from '../src/ui/input/commandMatches.js'
import { shouldFilterKey, type FilterFilterKeyEvent } from '../src/ui/input/keyFilter.js'

describe('InputBox ghost cursor filter', () => {
  describe('mouse click events — should be filtered', () => {
    it('should filter key event with raw = "\\x1b[M" (mouse click) and name = undefined', () => {
      const key: FilterKeyEvent = { raw: '\x1b[M', name: undefined }
      expect(shouldFilterKey(key)).toBe(true)
    })

    it('should filter any raw starting with ESC when name is undefined', () => {
      const key: FilterKeyEvent = { raw: '\x1b[<0;10;20M', name: undefined }
      expect(shouldFilterKey(key)).toBe(true)
    })

    it('should filter raw = "\\x1b" alone (bare ESC with no name)', () => {
      const key: FilterKeyEvent = { raw: '\x1b', name: undefined }
      expect(shouldFilterKey(key)).toBe(true)
    })
  })

  describe('ANSI suffix single uppercase letters — should be filtered', () => {
    it('should filter key with raw = "A" and name = "A" (ANSI up suffix) without modifiers', () => {
      const key: FilterKeyEvent = { raw: 'A', name: 'A', ctrl: false, meta: false, shift: false }
      expect(shouldFilterKey(key)).toBe(true)
    })

    it('should filter key with raw = "B" and name = "B" (ANSI down suffix)', () => {
      const key: FilterKeyEvent = { raw: 'B', name: 'B', ctrl: false, meta: false, shift: false }
      expect(shouldFilterKey(key)).toBe(true)
    })

    it('should filter key with raw = "M" and name = "M" (mouse event suffix)', () => {
      const key: FilterKeyEvent = { raw: 'M', name: 'M', ctrl: false, meta: false, shift: false }
      expect(shouldFilterKey(key)).toBe(true)
    })

    it('should filter key with raw = "H" and name = "H" (home ANSI suffix)', () => {
      const key: FilterKeyEvent = { raw: 'H', name: 'H', ctrl: false, meta: false, shift: false }
      expect(shouldFilterKey(key)).toBe(true)
    })
  })

  describe('normal lowercase input — should NOT be filtered', () => {
    it('should NOT filter key with raw = "a" (lowercase — normal input)', () => {
      const key: FilterKeyEvent = { raw: 'a', name: 'a', ctrl: false, meta: false, shift: false }
      expect(shouldFilterKey(key)).toBe(false)
    })

    it('should NOT filter key with raw = "h" and name = "h" (vim navigation, not ANSI suffix)', () => {
      const key: FilterKeyEvent = { raw: 'h', name: 'h', ctrl: false, meta: false, shift: false }
      expect(shouldFilterKey(key)).toBe(false)
    })

    it('should NOT filter key with raw = "z" (normal letter)', () => {
      const key: FilterKeyEvent = { raw: 'z', name: 'z', ctrl: false, meta: false, shift: false }
      expect(shouldFilterKey(key)).toBe(false)
    })
  })

  describe('normal key events — should NOT be filtered', () => {
    it('should NOT filter key with raw = "h" and name = "h" (normal char)', () => {
      const key: FilterKeyEvent = { raw: 'h', name: 'h' }
      expect(shouldFilterKey(key)).toBe(false)
    })

    it('should NOT filter return key', () => {
      const key: FilterKeyEvent = { raw: '\r', name: 'return' }
      expect(shouldFilterKey(key)).toBe(false)
    })

    it('should NOT filter backspace key', () => {
      const key: FilterKeyEvent = { raw: '\x7f', name: 'backspace' }
      expect(shouldFilterKey(key)).toBe(false)
    })

    it('should NOT filter Ctrl+C (has ctrl modifier)', () => {
      const key: FilterKeyEvent = { raw: '\x03', name: 'c', ctrl: true }
      expect(shouldFilterKey(key)).toBe(false)
    })

    it('should NOT filter uppercase A when shift modifier is set (Shift+A = real input)', () => {
      const key: FilterKeyEvent = { raw: 'A', name: 'A', ctrl: false, meta: false, shift: true }
      expect(shouldFilterKey(key)).toBe(false)
    })

    it('should NOT filter uppercase A when ctrl modifier is set', () => {
      const key: FilterKeyEvent = { raw: 'A', name: 'A', ctrl: true, meta: false, shift: false }
      expect(shouldFilterKey(key)).toBe(false)
    })
  })

  describe('mouse scroll events — should be filtered', () => {
    it('should filter up arrow with raw longer than 3 bytes (mouse scroll)', () => {
      // Mouse scroll events arrive as name:'up' with raw like \x1b[<64;10;20M (> 3 bytes)
      const key: FilterKeyEvent = { raw: '\x1b[<64;10;20M', name: 'up' }
      expect(shouldFilterKey(key)).toBe(true)
    })

    it('should filter down arrow with raw longer than 3 bytes (mouse scroll)', () => {
      const key: FilterKeyEvent = { raw: '\x1b[<65;10;20M', name: 'down' }
      expect(shouldFilterKey(key)).toBe(true)
    })

    it('should NOT filter real up arrow (raw = "\\x1b[A", exactly 3 bytes)', () => {
      const key: FilterKeyEvent = { raw: '\x1b[A', name: 'up' }
      expect(shouldFilterKey(key)).toBe(false)
    })

    it('should NOT filter real down arrow (raw = "\\x1b[B", exactly 3 bytes)', () => {
      const key: FilterKeyEvent = { raw: '\x1b[B', name: 'down' }
      expect(shouldFilterKey(key)).toBe(false)
    })
  })

  describe('control characters without name — should be filtered', () => {
    it('should filter single-byte control char (charCode < 32) with no name', () => {
      // e.g. \x01 = Ctrl+A arriving without a parsed name
      const key: FilterKeyEvent = { raw: '\x01', name: undefined }
      expect(shouldFilterKey(key)).toBe(true)
    })

    it('should filter \\x00 (null byte) with no name', () => {
      const key: FilterKeyEvent = { raw: '\x00', name: undefined }
      expect(shouldFilterKey(key)).toBe(true)
    })

    it('should NOT filter space (charCode 32) with no name — space is valid input', () => {
      // charCode 32 is NOT < 32, so it passes the control char filter
      const key: FilterKeyEvent = { raw: ' ', name: undefined }
      expect(shouldFilterKey(key)).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Correction 3: Dropdown during loading (src/ui/input/InputBox.tsx)
//
// The dropdown (command autocomplete) must appear even when isLoading=true,
// because showDropdown depends only on value starting with '/' — not on isLoading.
// ─────────────────────────────────────────────────────────────────────────────

describe('InputBox dropdown visibility during loading', () => {
  describe('getMatches() — dropdown data source is independent of loading state', () => {
    it('should return matches for "/" prefix (dropdown would show during loading)', () => {
      const matches = getMatches('/')
      expect(matches.length).toBeGreaterThan(0)
    })

    it('should return matches for "/m" prefix (would show /msg, /model, /models)', () => {
      const matches = getMatches('/m')
      expect(matches.length).toBeGreaterThan(0)
      matches.forEach((cmd) => expect(cmd.startsWith('/m')).toBe(true))
    })

    it('should return matches for "/msg" prefix even when called during any state', () => {
      const matches = getMatches('/msg')
      expect(matches).toContain('/msg')
    })

    it('should return empty array for non-slash input (no dropdown)', () => {
      expect(getMatches('hello')).toEqual([])
      expect(getMatches('')).toEqual([])
    })

    it('should return empty array for unknown command (no dropdown)', () => {
      expect(getMatches('/zzznomatch')).toEqual([])
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Original getMatches() tests
// ─────────────────────────────────────────────────────────────────────────────

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
