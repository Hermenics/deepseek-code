import { describe, it, expect, beforeEach } from 'bun:test'
import {
  pushToKillRing,
  getLastKill,
  resetKillAccumulation,
  yankPop,
  recordYank,
  resetYankState,
  clearKillRing,
} from '../../src/ui/input/cursor/killRing.js'

describe('killRing', () => {
  beforeEach(() => {
    clearKillRing()
  })

  describe('pushToKillRing', () => {
    it('should add text to the ring when ring is empty', () => {
      pushToKillRing('hello')
      expect(getLastKill()).toBe('hello')
    })

    it('should add a new entry when previous action was not a kill', () => {
      pushToKillRing('first')
      resetKillAccumulation()
      pushToKillRing('second')
      expect(getLastKill()).toBe('second')
    })

    it('should not add empty string to the ring', () => {
      pushToKillRing('')
      expect(getLastKill()).toBe('')
    })

    it('should accumulate consecutive kills by appending (default direction)', () => {
      pushToKillRing('hello')
      pushToKillRing(' world')
      expect(getLastKill()).toBe('hello world')
    })

    it('should accumulate consecutive kills by prepending when direction is prepend', () => {
      pushToKillRing('world')
      pushToKillRing('hello ', 'prepend')
      expect(getLastKill()).toBe('hello world')
    })

    it('should stop accumulating after resetKillAccumulation', () => {
      pushToKillRing('first')
      resetKillAccumulation()
      pushToKillRing('second')
      // ring now has ['second', 'first'] — last kill is 'second'
      expect(getLastKill()).toBe('second')
    })

    it('should cap ring at 10 entries', () => {
      for (let i = 0; i < 12; i++) {
        resetKillAccumulation()
        pushToKillRing(`item${i}`)
      }
      // Only 10 entries should remain; getLastKill returns the most recent
      expect(getLastKill()).toBe('item11')
    })
  })

  describe('getLastKill', () => {
    it('should return empty string when ring is empty', () => {
      expect(getLastKill()).toBe('')
    })

    it('should return the most recently pushed text', () => {
      pushToKillRing('alpha')
      resetKillAccumulation()
      pushToKillRing('beta')
      expect(getLastKill()).toBe('beta')
    })
  })

  describe('resetKillAccumulation', () => {
    it('should break consecutive kill accumulation', () => {
      pushToKillRing('part1')
      resetKillAccumulation()
      pushToKillRing('part2')
      // 'part2' must be a separate entry, not appended to 'part1'
      expect(getLastKill()).toBe('part2')
    })
  })

  describe('recordYank + yankPop', () => {
    it('should return null when ring has only one item', () => {
      pushToKillRing('only')
      recordYank(0, 4)
      const result = yankPop()
      expect(result).toBeNull()
    })

    it('should return null when last action was not a yank', () => {
      pushToKillRing('first')
      resetKillAccumulation()
      pushToKillRing('second')
      // no recordYank called — yank state is not set
      const result = yankPop()
      expect(result).toBeNull()
    })

    it('should cycle to the next kill ring item after recordYank', () => {
      pushToKillRing('first')
      resetKillAccumulation()
      pushToKillRing('second')
      // ring is ['second', 'first']
      recordYank(0, 6) // pretend we yanked 'second' at offset 0
      const result = yankPop()
      expect(result).not.toBeNull()
      expect(result!.text).toBe('first')
      expect(result!.start).toBe(0)
      expect(result!.length).toBe(6)
    })

    it('should cycle back to the first item after exhausting the ring', () => {
      pushToKillRing('a')
      resetKillAccumulation()
      pushToKillRing('b')
      resetKillAccumulation()
      pushToKillRing('c')
      // ring is ['c', 'b', 'a']
      recordYank(0, 1)
      const pop1 = yankPop() // cycles to index 1 → 'b'
      expect(pop1!.text).toBe('b')
      const pop2 = yankPop() // cycles to index 2 → 'a'
      expect(pop2!.text).toBe('a')
      const pop3 = yankPop() // wraps back to index 0 → 'c'
      expect(pop3!.text).toBe('c')
    })
  })

  describe('resetYankState', () => {
    it('should prevent yankPop from working after reset', () => {
      pushToKillRing('first')
      resetKillAccumulation()
      pushToKillRing('second')
      recordYank(0, 6)
      resetYankState()
      const result = yankPop()
      expect(result).toBeNull()
    })
  })

  describe('clearKillRing', () => {
    it('should empty the ring completely', () => {
      pushToKillRing('something')
      clearKillRing()
      expect(getLastKill()).toBe('')
    })

    it('should reset yank state so yankPop returns null', () => {
      pushToKillRing('a')
      resetKillAccumulation()
      pushToKillRing('b')
      recordYank(0, 1)
      clearKillRing()
      expect(yankPop()).toBeNull()
    })
  })
})
