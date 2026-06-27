/**
 * Edge cases for Correction 1: /msg during loading (src/ui/App.tsx)
 *
 * The handleQueue function detects /msg and executes immediately (adds a note),
 * while all other messages are enqueued normally.
 *
 * These tests exercise the pure regex logic extracted from handleQueue,
 * since App.tsx is a React component that requires a full TUI environment.
 */

import { describe, it, expect } from 'bun:test'
import { handleQueueLogic } from '../src/ui/queueLogic.js'

// ─────────────────────────────────────────────────────────────────────────────
// /msg detection — happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('handleQueue /msg detection', () => {
  describe('/msg with valid content', () => {
    it('should extract note content when /msg has a single word', () => {
      const result = handleQueueLogic('/msg hello', [])
      expect(result.note).toBe('hello')
      expect(result.queued).toBeNull()
    })

    it('should extract full sentence after /msg', () => {
      const result = handleQueueLogic('/msg please stop and wait', [])
      expect(result.note).toBe('please stop and wait')
      expect(result.queued).toBeNull()
    })

    it('should not enqueue when /msg is detected', () => {
      const queue = ['existing message']
      const result = handleQueueLogic('/msg add this note', queue)
      expect(result.queued).toBeNull()
      // Original queue must be untouched
      expect(queue).toEqual(['existing message'])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // /msg edge cases — must NOT trigger note path
  // ─────────────────────────────────────────────────────────────────────────

  describe('/msg without content — should enqueue normally, not crash', () => {
    it('should enqueue when message is exactly "/msg" with no content', () => {
      const result = handleQueueLogic('/msg', [])
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(['/msg'])
    })

    it('should enqueue when message is "/msg " (trailing space only)', () => {
      // The regex /^\/msg\s+(.+)/ requires at least one non-whitespace char after /msg
      const result = handleQueueLogic('/msg ', [])
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(['/msg '])
    })

    it('should treat "/msg   " (only spaces after /msg) as a note with whitespace content — documents current behavior', () => {
      // BUG REPORT: The regex /^\/msg\s+(.+)/ matches "/msg   " because (.+) captures
      // the last trailing space as content. \s+ consumes greedily but (.+) requires
      // at least one char — so it backtracks and captures the final space.
      // This means agent.addNote(" ") is called with a whitespace-only string
      // instead of treating it as "no content" and enqueueing normally.
      // Expected (ideal): enqueue when content is whitespace-only.
      // Actual (current): note = " " (one trailing space captured by (.+))
      const result = handleQueueLogic('/msg   ', [])
      // Document current behavior — note receives one trailing space
      expect(result.note).toBe(' ')
      expect(result.queued).toBeNull()
    })
  })

  describe('/msg with multiline content — should work', () => {
    it('should extract first line and rest as note when content has newlines', () => {
      // The regex (.+) matches everything after /msg\s+ including newlines
      // because . in JS does not match \n by default — only first line is captured
      const result = handleQueueLogic('/msg line one\nline two', [])
      // (.+) stops at \n — only "line one" is captured
      expect(result.note).toBe('line one')
      expect(result.queued).toBeNull()
    })

    it('should extract content when /msg has a tab separator', () => {
      const result = handleQueueLogic('/msg\tcontent after tab', [])
      expect(result.note).toBe('content after tab')
      expect(result.queued).toBeNull()
    })
  })

  describe('case sensitivity — /MSG and variants must NOT trigger note path', () => {
    it('should enqueue /MSG (uppercase) as a normal message', () => {
      const result = handleQueueLogic('/MSG hello', [])
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(['/MSG hello'])
    })

    it('should enqueue /Msg (mixed case) as a normal message', () => {
      const result = handleQueueLogic('/Msg hello', [])
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(['/Msg hello'])
    })
  })

  describe('/msgfoo (no space) — must NOT trigger note path', () => {
    it('should enqueue /msgfoo as a normal message (not a /msg command)', () => {
      const result = handleQueueLogic('/msgfoo bar', [])
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(['/msgfoo bar'])
    })

    it('should enqueue /messaging as a normal message', () => {
      const result = handleQueueLogic('/messaging something', [])
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(['/messaging something'])
    })
  })

  describe('normal messages during loading — must enqueue', () => {
    it('should enqueue a plain text message', () => {
      const result = handleQueueLogic('do something else', [])
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(['do something else'])
    })

    it('should enqueue a message starting with / that is not /msg', () => {
      const result = handleQueueLogic('/help', [])
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(['/help'])
    })

    it('should append to existing queue when loading', () => {
      const queue = ['first queued']
      const result = handleQueueLogic('second queued', queue)
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(['first queued', 'second queued'])
    })

    it('should not enqueue when queue is full (MAX_QUEUE_SIZE)', () => {
      const full = Array.from({ length: 10 }, (_, i) => `msg${i}`)
      const result = handleQueueLogic('overflow', full)
      expect(result.note).toBeNull()
      expect(result.queued).toEqual(full)
      expect(result.queued!.length).toBe(10)
    })
  })
})
